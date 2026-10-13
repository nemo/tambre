import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { Engine } from './engine/index.js';
import { PALETTE, voiceByName } from './palette.js';
import {
  loadUserConfig, mergeFrame, resolveSession, resolveVoice, saveUserConfig, validatePartialFrame, validateTexture, validateVoiceRef,
  type ResolvedSession, type UserConfig,
} from './config.js';
import {
  debug, isControlMessage, pidAlive, pidPath, readPidFile, socketPath,
  type Agent, type ControlMessage, type ControlReply, type HookMessage, type SessionStatus, type StatusReply,
} from './ipc.js';
import type { CanonicalEvent, SessionState, Voice } from './engine/types.js';
import type { TextureMode } from './engine/texture.js';

interface Session {
  id: string;
  agent: Agent;
  pid?: number;
  /** When `pid` was adopted; a pid that dies within PID_GRACE_MS of this was a wrapper shell, not the agent. */
  pidSince: number;
  cwd: string;
  projectRoot: string;
  voice: Voice;
  texture: TextureMode;
  muted: boolean;
  /**
   * The daemon's own view of the state. It mirrors the engine's, and is what
   * status reports when the audio device failed to open and no voice exists.
   */
  state: SessionState;
  lastPermissionAt: number;
}

const PID_POLL_MS = 2000;
/**
 * A hook's parent is the agent only when the shell that ran the hook command
 * exec'd into node. A wrapper (`cd x && node …`) makes it a shell that exits
 * at once; a pid gone this soon after adoption is dropped, not mourned.
 */
const PID_GRACE_MS = 5000;
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
  /**
   * `tambre daemon --foreground`: log every event to stderr and never exit
   * for want of sessions, so a developer can watch one daemon across runs.
   */
  foreground?: boolean;
  /** How long after adoption a dead pid is treated as a wrapper shell rather than the agent. Tests set 0. */
  pidGraceMs?: number;
}

export interface DaemonHandle {
  socket: string;
  pid: number;
  /** The engine, for tests that need to look at a voice. */
  engine: Engine;
  /** Stop listening, end every session, release the device. Idempotent. */
  close(): Promise<void>;
}

/** The state a session is in after `evt`, mirroring Engine.event. */
export function nextState(state: SessionState, evt: CanonicalEvent): SessionState {
  switch (evt) {
    case 'session.start': case 'working': case 'activity': return 'working';
    case 'permission.request': return 'blocked';
    case 'turn.end': case 'turn.fail': case 'waiting': return 'waiting';
    case 'session.end': return 'ended';
    case 'compact': return state;
  }
}

const isPid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Check every field of a hook message at the boundary. Anything another
 * local client could get wrong is dropped (with a debug line) rather than
 * handed to the engine; a message with no usable id or event is null.
 */
export function sanitizeHook(raw: unknown): HookMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (!isStr(m.sessionId) || !EVENTS.includes(m.event as CanonicalEvent)) return null;
  const w: string[] = [];
  const out: HookMessage = {
    event: m.event as CanonicalEvent,
    sessionId: m.sessionId,
    agent: isStr(m.agent) ? (m.agent as Agent) : 'claude-code',
    cwd: typeof m.cwd === 'string' ? m.cwd : '',
  };
  if (m.pid !== undefined) { if (isPid(m.pid)) out.pid = m.pid; else w.push('pid must be a positive integer'); }
  if (m.voice !== undefined) { if (isStr(m.voice)) out.voice = m.voice; else w.push('voice must be a name'); }
  if (m.voiceSpec !== undefined) {
    const ref = validateVoiceRef(m.voiceSpec, 'hook', w);
    if (ref !== undefined) out.voiceSpec = resolveVoice(ref);
  }
  if (m.texture !== undefined) out.texture = validateTexture(m.texture, 'hook', w);
  if (m.frame !== undefined) {
    const f = validatePartialFrame(m.frame, 'hook', w);
    if (f && Object.keys(f).length) out.frame = f;
  }
  if (m.projectRoot !== undefined) { if (isStr(m.projectRoot)) out.projectRoot = m.projectRoot; else w.push('projectRoot must be a path'); }
  for (const x of w) debug(`hook ${out.sessionId} ${out.event}: ${x}; field ignored`);
  return out;
}

/**
 * One per user. Owns the audio device, keeps the session table, watches
 * agent PIDs, answers control messages, and exits once the last session is
 * gone. Prints nothing unless TAMBRE_DEBUG=1 (which --foreground sets).
 */
export async function runDaemon(opts: DaemonOpts = {}): Promise<DaemonHandle> {
  const sock = opts.socket ?? socketPath();
  const pidFile = opts.pidFile ?? (opts.socket ? opts.socket.replace(/\.sock$/, '') + '.pid' : pidPath());
  const exitProcess = opts.exit !== false;
  const foreground = opts.foreground === true;
  const emptyExitMs = opts.emptyExitMs ?? EMPTY_EXIT_MS;
  const pidGraceMs = opts.pidGraceMs ?? PID_GRACE_MS;
  let user: UserConfig = loadUserConfig();
  const engine = new Engine({ endTail: opts.endTail ?? END_TAIL_S, volume: user.volume, mute: user.mute });
  const sessions = new Map<string, Session>();
  const conns = new Set<net.Socket>();
  let emptyTimer: NodeJS.Timeout | null = null;
  let previewTimer: NodeJS.Timeout | null = null;
  let pidTimer: NodeJS.Timeout | null = null;
  let closing: Promise<void> | null = null;

  /** Re-read ~/.tambre/config.json so later sessions and previews see edits. */
  const reloadUser = () => {
    user = loadUserConfig();
  };

  /** Write a field back to the user config; never throws, never prints. */
  const persist = (patch: Parameters<typeof saveUserConfig>[0]) => {
    try { saveUserConfig(patch); } catch (e) { debug('could not persist config:', String(e)); }
  };

  /** Run an engine call only when the device opened; a failed device never breaks the table. */
  const play = (fn: () => void) => {
    if (!engine.isStarted) return;
    try { fn(); } catch (e) { debug('engine error:', String((e as Error)?.message ?? e)); }
  };

  const cleanupFiles = () => {
    // A Windows named pipe vanishes with its process; only unix sockets leave a file.
    for (const f of [pidFile, ...(process.platform === 'win32' ? [] : [sock])]) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
  };

  const shutdown = (why: string): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      debug('shutdown:', why);
      if (emptyTimer) clearTimeout(emptyTimer);
      if (previewTimer) clearTimeout(previewTimer);
      if (pidTimer) clearInterval(pidTimer);
      for (const c of conns) c.destroy();
      await new Promise<void>((res) => server.close(() => res()));
      cleanupFiles();
      await engine.close();
      if (exitProcess) process.exit(0);
    })();
    return closing;
  };

  const armEmptyExit = () => {
    if (foreground) return;
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

  const stateOf = (s: Session): SessionState => engine.session(s.id)?.state ?? s.state;

  const endSession = (id: string, why: string) => {
    const s = sessions.get(id);
    if (!s) return;
    debug(`session ${id} end (${why})`);
    sessions.delete(id);
    s.state = 'ended';
    play(() => engine.event(id, 'session.end'));
    if (sessions.size === 0) {
      debug('last session gone; frame released');
      armEmptyExit();
    }
  };

  // ---- hook messages ----

  /**
   * A session first seen through anything but its session.start (the start
   * was lost, or this daemon came up mid-session) carries no voice, texture,
   * frame or root. Resolve them from the project the agent runs in, exactly
   * as the hook would have; the daemon has the time the hook does not.
   */
  const adopt = (m: HookMessage): ResolvedSession | null => {
    if (m.voiceSpec || !m.cwd) return null;
    try {
      const r = resolveSession(m.cwd, { user });
      debug(`session ${m.sessionId} adopted from ${m.event}: project ${r.projectRoot}, voice ${r.voice.name} (${r.voiceSource})`);
      return r;
    } catch (e) {
      debug('resolveSession failed:', String(e));
      return null;
    }
  };

  const startSession = (m: HookMessage): Session => {
    reloadUser();
    const r = adopt(m);
    if (sessions.size === 0) {
      // First real session sets the frame: its project's proposal, else the
      // user frame. The engine refuses this while any real session is live.
      const proposal = m.frame ? mergeFrame(user.frame, m.frame) : r?.frame;
      const frame = proposal ?? user.frame;
      const took = engine.setFrame(frame);
      debug(`frame ${took ? 'set' : 'kept'} by first session: root ${frame.root} bpm ${frame.bpm}${proposal ? ' (project)' : ' (user)'}`);
    }
    const voice = m.voiceSpec ? m.voiceSpec
      : r && r.voiceSource !== 'user' ? r.voice
        : pickVoice(m.voice);
    const s: Session = {
      id: m.sessionId,
      agent: m.agent ?? 'claude-code',
      pid: m.pid,
      pidSince: Date.now(),
      cwd: m.cwd ?? '',
      projectRoot: m.projectRoot ?? r?.projectRoot ?? m.cwd ?? '',
      voice,
      texture: m.texture ?? r?.texture ?? user.texture,
      muted: false,
      state: 'working',
      lastPermissionAt: 0,
    };
    sessions.set(s.id, s);
    debug(`session ${s.id} start as "${s.voice.name}"/${s.texture} pid=${s.pid ?? '?'} root=${s.projectRoot}`);
    play(() => {
      engine.addSession(s.id, s.voice, s.texture);
      if (m.event !== 'session.start') engine.event(s.id, 'session.start');
    });
    return s;
  };

  const handleHook = (raw: unknown) => {
    const m = sanitizeHook(raw);
    if (!m) { debug('malformed hook message ignored'); return; }
    if (m.sessionId === PREVIEW_ID) return;
    let s = sessions.get(m.sessionId);
    if (!s) {
      // An end for a session never seen leaves the idle timer alone: nothing
      // is live, so the daemon must still exit on its own.
      if (m.event === 'session.end') { if (sessions.size === 0) armEmptyExit(); return; }
      s = startSession(m);
    }
    if (emptyTimer) { clearTimeout(emptyTimer); emptyTimer = null; }
    if (m.pid && !s.pid) { s.pid = m.pid; s.pidSince = Date.now(); }
    if (m.event === 'permission.request') {
      // One ping per block: a second PermissionRequest (or the Notification
      // that mirrors it) while this session is already blocked is ignored.
      if (stateOf(s) === 'blocked') { debug(`session ${s.id} permission.request ignored (already blocked)`); return; }
      const now = Date.now();
      if (now - s.lastPermissionAt < PERMISSION_DEDUPE_MS) { debug(`session ${s.id} permission.request deduped`); return; }
      s.lastPermissionAt = now;
    }
    if (m.event === 'session.end') { endSession(s.id, 'hook'); return; }
    debug(`session ${s.id} ${m.event}`);
    s.state = nextState(s.state, m.event);
    play(() => engine.event(s.id, m.event));
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
        state: stateOf(s),
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
      play(() => engine.removeSession(PREVIEW_ID));
      debug('preview session dropped');
    }, PREVIEW_TTL_MS);
    previewTimer.unref();
  };

  const preview = (m: Extract<ControlMessage, { cmd: 'preview' }>): ControlReply => {
    if (m.what !== 'event' && m.what !== 'state') return { ok: false, error: 'what must be "event" or "state"' };
    if (m.what === 'event' && !EVENTS.includes(m.name as CanonicalEvent)) return { ok: false, error: `unknown event "${m.name}"` };
    if (m.what === 'state' && !STATES.includes(m.name as SessionState)) return { ok: false, error: `unknown state "${m.name}"` };
    if (!engine.isStarted) return { ok: false, error: 'audio device did not open; nothing to preview' };
    const w: string[] = [];
    const ref = validateVoiceRef(m.voice, 'preview', w);
    if (ref === undefined) return { ok: false, error: w[0] ?? 'voice must be a palette name or a voice object' };
    const texture = m.texture === undefined ? user.texture : validateTexture(m.texture, 'preview', w);
    if (texture === undefined) return { ok: false, error: w[0] ?? 'unknown texture' };
    const voice = resolveVoice(ref);
    const existing = engine.session(PREVIEW_ID);
    if (existing) {
      if (JSON.stringify(existing.voice) !== JSON.stringify(voice)) engine.setSessionVoice(PREVIEW_ID, voice);
      engine.setSessionTexture(PREVIEW_ID, texture);
    } else {
      // Previews never lock the frame and never count as sessions for exit.
      engine.addSession(PREVIEW_ID, voice, texture, { preview: true });
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
    debug(`preview ${m.what} ${m.name} as "${voice.name}"/${texture}`);
    schedulePreviewCleanup();
    return { ok: true };
  };

  const sameRoot = (a: string, b: string): boolean => path.resolve(a) === path.resolve(b);

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
          persist({ mute: m.value });
          debug(`mute all ${m.value}`);
          return { ok: true };
        }
        if (typeof scope === 'object' && scope && 'session' in scope) {
          const s = sessions.get(scope.session);
          if (!s) return { ok: false, error: `no session "${scope.session}"` };
          s.muted = m.value;
          play(() => engine.muteSession(s.id, m.value));
          debug(`mute session ${s.id} ${m.value}`);
          return { ok: true };
        }
        if (typeof scope === 'object' && scope && 'project' in scope) {
          if (typeof scope.project !== 'string' || !scope.project) return { ok: false, error: 'project must be a path' };
          let n = 0;
          for (const s of sessions.values()) {
            if (!sameRoot(s.projectRoot, scope.project)) continue;
            s.muted = m.value;
            play(() => engine.muteSession(s.id, m.value));
            n++;
          }
          debug(`mute project ${scope.project} ${m.value} (${n} sessions)`);
          return { ok: true };
        }
        return { ok: false, error: 'scope must be "all", { project } or { session }' };
      }
      case 'volume': {
        if (typeof m.value !== 'number' || !Number.isFinite(m.value)) return { ok: false, error: 'value must be a number 0..1' };
        engine.setVolume(m.value);
        persist({ volume: engine.volume });
        debug(`volume ${engine.volume}`);
        return { ok: true };
      }
      case 'preview':
        return preview(m);
      case 'set': {
        reloadUser();
        const s = sessions.get(m.session);
        if (!s) return { ok: false, error: `no session "${m.session}"` };
        const w: string[] = [];
        const ref = m.voice === undefined ? undefined : validateVoiceRef(m.voice, 'set', w);
        if (m.voice !== undefined && ref === undefined) return { ok: false, error: w[0] ?? 'voice must be a palette name or a voice object' };
        const texture = m.texture === undefined ? undefined : validateTexture(m.texture, 'set', w);
        if (m.texture !== undefined && texture === undefined) return { ok: false, error: w[0] ?? 'unknown texture' };
        if (ref !== undefined) { s.voice = resolveVoice(ref); play(() => engine.setSessionVoice(s.id, s.voice)); }
        if (texture !== undefined) { s.texture = texture; play(() => engine.setSessionTexture(s.id, texture)); }
        debug(`set session ${s.id} voice=${s.voice.name} texture=${s.texture}`);
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
        // The socket is up before the device is: a hook that arrives while
        // the native addon is still loading waits for it, in arrival order.
        void engineReady.then(() => {
          try { handleHook(msg); } catch (e) { debug('hook error:', String(e)); }
        });
      }
    });
    conn.on('error', (e) => debug('conn error:', e.message));
    conn.on('close', () => conns.delete(conn));
  });

  // Start opening the device first: the hooks that arrive once the socket
  // is bound queue behind this, and engine.isStarted stays false until the
  // whole graph exists (or forever, when the device cannot open).
  const engineReady: Promise<void> = engine.start().then(
    () => debug('audio open'),
    // No device: keep the session table and answer status, play nothing.
    (e) => debug('audio failed to open:', String((e as Error)?.message ?? e)),
  );

  await claimSocket(server, sock, pidFile, exitProcess);
  fs.writeFileSync(pidFile, String(process.pid));
  debug('listening on', sock, 'pid', process.pid, foreground ? '(foreground)' : '');

  await engineReady;
  armEmptyExit();

  pidTimer = setInterval(() => {
    const now = Date.now();
    for (const s of sessions.values()) {
      if (!s.pid || pidAlive(s.pid)) continue;
      if (now - s.pidSince < pidGraceMs) {
        debug(`session ${s.id}: pid ${s.pid} died ${now - s.pidSince} ms after adoption; a wrapper shell, not the agent. Dropped.`);
        s.pid = undefined;
        continue;
      }
      endSession(s.id, 'agent pid gone');
    }
  }, PID_POLL_MS);
  pidTimer.unref();

  if (exitProcess) {
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(sig, () => void shutdown(sig));
    }
    process.on('uncaughtException', (e) => { debug('uncaught:', e.stack ?? String(e)); cleanupFiles(); process.exit(0); });
  }

  return { socket: sock, pid: process.pid, engine, close: () => shutdown('handle.close') };
}

/** True when something accepts connections at `sock` right now. */
function socketAnswers(sock: string): Promise<boolean> {
  return new Promise((res) => {
    const c = net.connect(sock);
    const t = setTimeout(() => { c.destroy(); res(false); }, 500);
    c.once('connect', () => { clearTimeout(t); c.end(); res(true); });
    c.once('error', () => { clearTimeout(t); res(false); });
  });
}

/**
 * Bind the socket, recovering from what a SIGKILLed daemon leaves behind:
 * a socket file nothing listens on and a pid file naming a dead process.
 * A live daemon on the socket wins; we exit (or throw, when embedded).
 *
 * Windows: a named pipe disappears with its owner, so there is nothing to
 * unlink; EADDRINUSE on listen is the only sign of another daemon.
 */
async function claimSocket(server: net.Server, sock: string, pidFile: string, exitProcess: boolean): Promise<void> {
  const alreadyRunning = (): never => {
    debug('daemon already running on', sock);
    if (exitProcess) process.exit(0);
    throw new Error(`a daemon is already listening on ${sock}`);
  };

  const oldPid = readPidFile(pidFile);
  if (oldPid !== null && oldPid !== process.pid) {
    if (pidAlive(oldPid)) debug(`pid file names ${oldPid}, still alive; checking its socket`);
    else {
      debug(`stale pid file for ${oldPid}; removing`);
      try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
    }
  }

  if (process.platform !== 'win32' && fs.existsSync(sock)) {
    if (await socketAnswers(sock)) alreadyRunning();
    debug('stale socket; removing', sock);
    try { fs.unlinkSync(sock); } catch { /* ignore */ }
  }

  const listen = () => new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(sock, () => { server.removeListener('error', rej); res(); });
  });

  try {
    await listen();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    // Someone bound it between our check and our listen, or the unlink raced.
    if (await socketAnswers(sock)) alreadyRunning();
    if (process.platform === 'win32') alreadyRunning();
    try { fs.unlinkSync(sock); } catch { /* ignore */ }
    await listen();
  }
}
