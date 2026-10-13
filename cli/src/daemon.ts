import net from 'node:net';
import fs from 'node:fs';
import { Engine } from './engine/index.js';
import { PALETTE, voiceByName } from './palette.js';
import { loadUserConfig, resolveVoice } from './config.js';
import {
  debug, isControlMessage, pidPath, socketPath,
  type Agent, type ControlMessage, type ControlReply, type HookMessage, type SessionStatus, type StatusReply,
} from './ipc.js';
import type { CanonicalEvent, SessionState, Voice } from './engine/types.js';
import type { TextureMode } from './engine/texture.js';

interface Session {
  id: string;
  agent: Agent;
  pid?: number;
  cwd: string;
  projectRoot: string;
  voice: Voice;
  texture: TextureMode;
  muted: boolean;
  lastPermissionAt: number;
}

const PID_POLL_MS = 2000;
const PERMISSION_DEDUPE_MS = 2000;
const EMPTY_EXIT_MS = 8000;
const END_TAIL_S = 5;
const PREVIEW_ID = '__preview__';
const PREVIEW_TTL_MS = 10_000;
const STATES: SessionState[] = ['working', 'blocked', 'waiting', 'ended'];
const EVENTS: CanonicalEvent[] = ['session.start', 'session.end', 'turn.end', 'turn.fail', 'permission.request', 'compact', 'working', 'waiting', 'activity'];

export interface DaemonOpts {
  /** Socket path; defaults to the per-user socket. */
  socket?: string;
  pidFile?: string;
  /** Seconds the end roll rings before a voice's graph is dropped. */
  endTail?: number;
  /** How long the daemon waits with no sessions before exiting. */
  emptyExitMs?: number;
  /**
   * When false the daemon never calls process.exit and registers no signal
   * handlers; `close()` on the handle stops it. For tests and embedding.
   */
  exit?: boolean;
}

export interface DaemonHandle {
  socket: string;
  pid: number;
  /** Stop listening, end every session, release the device. */
  close(): Promise<void>;
}

/**
 * One per user. Owns the audio device, keeps the session table, watches
 * agent PIDs, answers control messages, and exits once the last session is
 * gone. Prints nothing unless TAMBRE_DEBUG=1.
 */
export async function runDaemon(opts: DaemonOpts = {}): Promise<DaemonHandle> {
  const sock = opts.socket ?? socketPath();
  const pidFile = opts.pidFile ?? (opts.socket ? opts.socket.replace(/\.sock$/, '') + '.pid' : pidPath());
  const exitProcess = opts.exit !== false;
  const emptyExitMs = opts.emptyExitMs ?? EMPTY_EXIT_MS;
  const user = loadUserConfig();
  const engine = new Engine({ endTail: opts.endTail ?? END_TAIL_S, volume: user.volume, mute: user.mute });
  const sessions = new Map<string, Session>();
  const conns = new Set<net.Socket>();
  let emptyTimer: NodeJS.Timeout | null = null;
  let previewTimer: NodeJS.Timeout | null = null;
  let pidTimer: NodeJS.Timeout | null = null;
  let closing = false;

  const cleanupFiles = () => {
    for (const f of [pidFile, ...(process.platform === 'win32' ? [] : [sock])]) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
  };

  const shutdown = async (why: string): Promise<void> => {
    if (closing) return;
    closing = true;
    debug('shutdown:', why);
    if (emptyTimer) clearTimeout(emptyTimer);
    if (previewTimer) clearTimeout(previewTimer);
    if (pidTimer) clearInterval(pidTimer);
    for (const c of conns) c.destroy();
    await new Promise<void>((res) => server.close(() => res()));
    cleanupFiles();
    await engine.close();
    if (exitProcess) process.exit(0);
  };

  const armEmptyExit = () => {
    if (emptyTimer) clearTimeout(emptyTimer);
    emptyTimer = setTimeout(() => {
      emptyTimer = null;
      if (sessions.size === 0) void shutdown('no sessions');
    }, emptyExitMs);
  };

  const pickVoice = (wanted?: string): Voice => {
    const inUse = new Set([...sessions.values()].map((s) => s.voice.name));
    if (wanted) {
      const v = voiceByName(wanted);
      if (v && !inUse.has(v.name)) return resolveVoice(v.name);
    }
    return resolveVoice((PALETTE.find((v) => !inUse.has(v.name)) ?? PALETTE[sessions.size % PALETTE.length]).name);
  };

  const endSession = (id: string, why: string) => {
    const s = sessions.get(id);
    if (!s) return;
    debug(`session ${id} end (${why})`);
    sessions.delete(id);
    engine.event(id, 'session.end');
    if (sessions.size === 0) armEmptyExit();
  };

  // ---- hook messages ----

  const handleHook = (m: HookMessage) => {
    if (typeof m.sessionId !== 'string' || !m.sessionId || m.sessionId === PREVIEW_ID) return;
    if (!EVENTS.includes(m.event)) { debug('unknown event', String(m.event)); return; }
    if (emptyTimer) { clearTimeout(emptyTimer); emptyTimer = null; }
    let s = sessions.get(m.sessionId);
    if (!s) {
      if (m.event === 'session.end') return;
      if (sessions.size === 0 && m.frame) {
        debug('frame proposed by first session:', m.frame.root, m.frame.bpm);
        engine.setFrame(m.frame);
      }
      s = {
        id: m.sessionId,
        agent: m.agent ?? 'claude-code',
        pid: m.pid,
        cwd: m.cwd ?? '',
        projectRoot: m.projectRoot ?? m.cwd ?? '',
        voice: m.voiceSpec ? resolveVoice(m.voiceSpec) : pickVoice(m.voice),
        texture: m.texture ?? user.texture,
        muted: false,
        lastPermissionAt: 0,
      };
      sessions.set(s.id, s);
      debug(`session ${s.id} start as "${s.voice.name}"/${s.texture} pid=${s.pid ?? '?'} root=${s.projectRoot}`);
      engine.addSession(s.id, s.voice, s.texture);
      if (m.event !== 'session.start') engine.event(s.id, 'session.start');
    }
    if (m.pid && !s.pid) s.pid = m.pid;
    if (m.event === 'permission.request') {
      const now = Date.now();
      if (now - s.lastPermissionAt < PERMISSION_DEDUPE_MS) return;
      s.lastPermissionAt = now;
    }
    if (m.event === 'session.end') { endSession(s.id, 'hook'); return; }
    debug(`session ${s.id} ${m.event}`);
    engine.event(s.id, m.event);
  };

  // ---- control messages ----

  const statusReply = (): StatusReply => {
    const list: SessionStatus[] = [];
    for (const s of sessions.values()) {
      list.push({
        id: s.id,
        agent: s.agent,
        projectRoot: s.projectRoot,
        voice: s.voice.name,
        texture: s.texture,
        state: engine.session(s.id)?.state ?? 'ended',
        muted: s.muted,
        pid: s.pid,
      });
    }
    return { ok: true, frame: engine.frame, sessions: list, volume: engine.volume, mute: engine.mute };
  };

  const schedulePreviewCleanup = () => {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewTimer = null;
      engine.removeSession(PREVIEW_ID);
      debug('preview session dropped');
    }, PREVIEW_TTL_MS);
    previewTimer.unref();
  };

  const preview = (m: Extract<ControlMessage, { cmd: 'preview' }>): ControlReply => {
    if (m.what !== 'event' && m.what !== 'state') return { ok: false, error: 'what must be "event" or "state"' };
    if (m.what === 'event' && !EVENTS.includes(m.name as CanonicalEvent)) return { ok: false, error: `unknown event "${m.name}"` };
    if (m.what === 'state' && !STATES.includes(m.name as SessionState)) return { ok: false, error: `unknown state "${m.name}"` };
    const voice = resolveVoice(m.voice);
    const texture = m.texture ?? user.texture;
    const existing = engine.session(PREVIEW_ID);
    if (existing) {
      if (JSON.stringify(existing.voice) !== JSON.stringify(voice)) engine.setSessionVoice(PREVIEW_ID, voice);
      engine.setSessionTexture(PREVIEW_ID, texture);
    } else {
      engine.addSession(PREVIEW_ID, voice, texture);
      if (m.what === 'state' || m.name !== 'session.start') engine.setState(PREVIEW_ID, 'waiting');
    }
    if (m.what === 'event') {
      if (m.name === 'session.end') {
        // Ring the end roll but keep the preview session around for the next audition.
        engine.session(PREVIEW_ID)?.sessionEnd();
        engine.setState(PREVIEW_ID, 'waiting');
      } else {
        engine.event(PREVIEW_ID, m.name as CanonicalEvent);
      }
    } else {
      engine.setState(PREVIEW_ID, m.name === 'ended' ? 'waiting' : (m.name as SessionState));
    }
    schedulePreviewCleanup();
    return { ok: true };
  };

  const handleControl = (m: ControlMessage): ControlReply => {
    // A client talking to the daemon pushes the idle exit back, so a TUI that
    // polls status keeps it alive while open; previews never count as sessions.
    if (sessions.size === 0) armEmptyExit();
    switch (m.cmd) {
      case 'status':
        return statusReply();
      case 'mute': {
        if (typeof m.value !== 'boolean') return { ok: false, error: 'value must be a boolean' };
        const scope = m.scope ?? 'all';
        if (scope === 'all') {
          engine.setMute(m.value);
          return { ok: true };
        }
        if (typeof scope === 'object' && scope && 'session' in scope) {
          const s = sessions.get(scope.session);
          if (!s) return { ok: false, error: `no session "${scope.session}"` };
          s.muted = m.value;
          engine.muteSession(s.id, m.value);
          return { ok: true };
        }
        if (typeof scope === 'object' && scope && 'project' in scope) {
          for (const s of sessions.values()) {
            if (s.projectRoot === scope.project) { s.muted = m.value; engine.muteSession(s.id, m.value); }
          }
          return { ok: true };
        }
        return { ok: false, error: 'scope must be "all", { project } or { session }' };
      }
      case 'volume':
        if (typeof m.value !== 'number' || !Number.isFinite(m.value)) return { ok: false, error: 'value must be a number 0..1' };
        engine.setVolume(m.value);
        return { ok: true };
      case 'preview':
        return preview(m);
      case 'set': {
        const s = sessions.get(m.session);
        if (!s) return { ok: false, error: `no session "${m.session}"` };
        if (m.voice) { s.voice = resolveVoice(m.voice); engine.setSessionVoice(s.id, s.voice); }
        if (m.texture) { s.texture = m.texture; engine.setSessionTexture(s.id, m.texture); }
        return { ok: true };
      }
      case 'shutdown':
        setTimeout(() => void shutdown('control'), 0);
        return { ok: true };
      default:
        return { ok: false, error: `unknown cmd "${String((m as { cmd: unknown }).cmd)}"` };
    }
  };

  // ---- socket ----

  const server = net.createServer((conn) => {
    conns.add(conn);
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: unknown;
        try { msg = JSON.parse(line); } catch (e) { debug('bad message:', String(e)); continue; }
        if (isControlMessage(msg)) {
          let reply: ControlReply;
          try { reply = handleControl(msg); } catch (e) { reply = { ok: false, error: String((e as Error)?.message ?? e) }; }
          conn.end(JSON.stringify(reply) + '\n');
          return;
        }
        try { handleHook(msg as HookMessage); } catch (e) { debug('hook error:', String(e)); }
      }
    });
    conn.on('error', (e) => debug('conn error:', e.message));
    conn.on('close', () => conns.delete(conn));
  });

  // A stale socket from a crashed daemon refuses connections; replace it.
  if (process.platform !== 'win32' && fs.existsSync(sock)) {
    const alive = await new Promise<boolean>((res) => {
      const c = net.connect(sock);
      c.once('connect', () => { c.end(); res(true); });
      c.once('error', () => res(false));
    });
    if (alive) {
      debug('daemon already running');
      if (exitProcess) process.exit(0);
      throw new Error(`a daemon is already listening on ${sock}`);
    }
    try { fs.unlinkSync(sock); } catch { /* ignore */ }
  }

  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(sock, () => res());
  });
  fs.writeFileSync(pidFile, String(process.pid));
  debug('listening on', sock, 'pid', process.pid);

  try {
    await engine.start();
  } catch (e) {
    // No device: keep the session table and answer status, play nothing.
    debug('audio failed to open:', String((e as Error)?.message ?? e));
  }
  armEmptyExit();

  pidTimer = setInterval(() => {
    for (const s of sessions.values()) {
      if (!s.pid) continue;
      try { process.kill(s.pid, 0); } catch { endSession(s.id, 'agent pid gone'); }
    }
  }, PID_POLL_MS);
  pidTimer.unref();

  if (exitProcess) {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(sig, () => void shutdown(sig));
    }
    process.on('uncaughtException', (e) => { debug('uncaught:', e.stack ?? String(e)); cleanupFiles(); process.exit(0); });
  }

  return { socket: sock, pid: process.pid, close: () => shutdown('handle.close') };
}
