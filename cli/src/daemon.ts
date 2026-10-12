import net from 'node:net';
import fs from 'node:fs';
import { Engine } from './engine/index.js';
import { PALETTE, voiceByName } from './palette.js';
import { debug, pidPath, socketPath, type HookMessage } from './ipc.js';
import type { Voice } from './engine/types.js';

interface Session {
  id: string;
  pid?: number;
  cwd: string;
  voice: Voice;
  lastPermissionAt: number;
}

const PID_POLL_MS = 2000;
const PERMISSION_DEDUPE_MS = 2000;
const EMPTY_EXIT_MS = 8000;
const END_TAIL_S = 5;

/**
 * One per user. Owns the audio device, keeps the session table, assigns
 * voices, watches agent PIDs, and exits once the last session is gone.
 */
export async function runDaemon(): Promise<void> {
  const sock = socketPath();
  const pidFile = pidPath();
  const engine = new Engine({ endTail: END_TAIL_S });
  const sessions = new Map<string, Session>();
  let emptyTimer: NodeJS.Timeout | null = null;
  let closing = false;

  const cleanupFiles = () => {
    for (const f of [pidFile, ...(process.platform === 'win32' ? [] : [sock])]) {
      try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
  };

  const shutdown = async (why: string) => {
    if (closing) return;
    closing = true;
    debug('shutdown:', why);
    server.close();
    cleanupFiles();
    await engine.close();
    process.exit(0);
  };

  const armEmptyExit = () => {
    if (emptyTimer) clearTimeout(emptyTimer);
    emptyTimer = setTimeout(() => {
      if (sessions.size === 0) void shutdown('no sessions');
    }, EMPTY_EXIT_MS);
  };

  const pickVoice = (wanted?: string): Voice => {
    const inUse = new Set([...sessions.values()].map((s) => s.voice.name));
    if (wanted) {
      const v = voiceByName(wanted);
      if (v && !inUse.has(v.name)) return v;
    }
    return PALETTE.find((v) => !inUse.has(v.name)) ?? PALETTE[sessions.size % PALETTE.length];
  };

  const endSession = (id: string, why: string) => {
    const s = sessions.get(id);
    if (!s) return;
    debug(`session ${id} end (${why})`);
    sessions.delete(id);
    engine.event(id, 'session.end');
    if (sessions.size === 0) armEmptyExit();
  };

  const handle = (m: HookMessage) => {
    if (emptyTimer) { clearTimeout(emptyTimer); emptyTimer = null; }
    let s = sessions.get(m.sessionId);
    if (!s) {
      if (m.event === 'session.end') return;
      if (sessions.size === 0 && m.frame) {
        debug('frame proposed by first session:', m.frame.root, m.frame.bpm);
        engine.setFrame(m.frame);
      }
      s = { id: m.sessionId, pid: m.pid, cwd: m.cwd, voice: pickVoice(m.voice), lastPermissionAt: 0 };
      sessions.set(s.id, s);
      debug(`session ${s.id} start as "${s.voice.name}" pid=${s.pid ?? '?'} cwd=${s.cwd}`);
      engine.addSession(s.id, s.voice);
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

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { handle(JSON.parse(line) as HookMessage); } catch (e) { debug('bad message:', String(e)); }
      }
    });
    conn.on('error', (e) => debug('conn error:', e.message));
  });

  // A stale socket from a crashed daemon refuses connections; replace it.
  if (process.platform !== 'win32' && fs.existsSync(sock)) {
    const alive = await new Promise<boolean>((res) => {
      const c = net.connect(sock);
      c.once('connect', () => { c.end(); res(true); });
      c.once('error', () => res(false));
    });
    if (alive) { debug('daemon already running'); process.exit(0); }
    try { fs.unlinkSync(sock); } catch { /* ignore */ }
  }

  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(sock, () => res());
  });
  fs.writeFileSync(pidFile, String(process.pid));
  debug('listening on', sock, 'pid', process.pid);

  await engine.start();
  armEmptyExit();

  setInterval(() => {
    for (const s of sessions.values()) {
      if (!s.pid) continue;
      try { process.kill(s.pid, 0); } catch { endSession(s.id, 'agent pid gone'); }
    }
  }, PID_POLL_MS).unref();

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => void shutdown(sig));
  }
  process.on('uncaughtException', (e) => { debug('uncaught:', e.stack ?? String(e)); cleanupFiles(); process.exit(0); });
}
