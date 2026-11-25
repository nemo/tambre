import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { debug, type Agent, type HookMessage } from './ipc.js';
import { connect, spawnDaemon } from './client.js';
import { resolveSession, resolveVoice } from './config.js';
import { getAdapter } from './adapters/index.js';
import type { ParsedHook } from './adapters/types.js';

/**
 * `tambre hook <agent>`: read the agent's native JSON payload from stdin, map
 * it through the agent's adapter to a canonical event, connect to (or spawn)
 * the daemon, write one line, exit. Never prints, never throws out.
 */

const CONNECT_RETRY_MS = 100;
const CONNECT_BUDGET_MS = 2500;

/**
 * Read all of stdin within the budget. On timeout the stream is destroyed:
 * a launcher that leaves the pipe open must not keep this process alive
 * past the budget (the open handle would, until the writer closed it).
 */
export async function readStdin(stream: Readable & { isTTY?: boolean } = process.stdin, timeoutMs = 500): Promise<string> {
  if (stream.isTTY) return '';
  return new Promise((res) => {
    let data = '';
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(t); res(data); };
    const t = setTimeout(() => { finish(); stream.destroy(); }, timeoutMs);
    stream.setEncoding('utf8');
    stream.on('data', (c: string) => (data += c));
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', finish);
  });
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'ash', 'tcsh', 'csh']);
const MAX_SHELL_HOPS = 4;

/** `{ ppid, comm }` of a process, or null. /proc on Linux, one `ps` elsewhere. */
function parentOf(pid: number): { ppid: number; comm: string } | null {
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const m = /^\d+ \((.*)\) \S (\d+)/s.exec(stat);
      return m ? { ppid: Number(m[2]), comm: m[1] } : null;
    }
    if (process.platform === 'win32') return null;
    const out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8', timeout: 300, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = /^(\d+)\s+(.+)$/.exec(out);
    return m ? { ppid: Number(m[1]), comm: m[2] } : null;
  } catch {
    return null;
  }
}

/**
 * The agent's pid. Our parent is the agent only when the shell that ran the
 * hook command exec'd into node; a wrapper such as `cd x && node …` leaves a
 * short-lived shell in between, so walk up past any shell. Costs one `ps` per
 * hop on macOS; the session start is the only hook that pays it.
 */
export function agentPid(from: number = process.ppid, lookup: (pid: number) => { ppid: number; comm: string } | null = parentOf): number {
  let pid = from;
  for (let i = 0; i < MAX_SHELL_HOPS; i++) {
    const p = lookup(pid);
    if (!p) return pid;
    const name = path.basename(p.comm).replace(/^-/, '');
    if (!SHELLS.has(name) || p.ppid <= 1) return pid;
    pid = p.ppid;
  }
  return pid;
}

/** Connect, spawning the daemon on first failure, within a short budget. */
async function connectOrStart(mayStart: boolean) {
  const deadline = Date.now() + CONNECT_BUDGET_MS;
  let c = await connect({ timeoutMs: 300 });
  if (c || !mayStart) return c;
  spawnDaemon();
  while (!c && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CONNECT_RETRY_MS));
    c = await connect({ timeoutMs: 300 });
  }
  return c;
}

/**
 * Fill in what a session.start needs: the resolved voice, texture, the
 * project's frame proposal and root. Never throws; on any failure the
 * daemon falls back to its own defaults.
 */
function announce(msg: HookMessage, voiceOverride?: string): void {
  try {
    const r = resolveSession(msg.cwd);
    msg.projectRoot = r.projectRoot;
    msg.voiceSpec = voiceOverride ? resolveVoice(voiceOverride) : r.voice;
    msg.texture = r.texture;
    if (r.preset) msg.preset = r.preset;
    if (r.frame) msg.frame = r.frame;
    // Play the chosen preset as a one-shot on session start.
    if (r.preset && msg.event === 'session.start') {
      try {
        const home = (process.env.HOME || process.env.USERPROFILE || '');
        const wav = `${home}/.tambre/presets/${r.preset}.wav`;
        if (fs.existsSync(wav)) {
          const c = spawn('afplay', [wav], { detached: true, stdio: 'ignore' });
          c.unref();
        }
      } catch { /* fail silent */ }
    }
  } catch (e) {
    debug('resolveSession failed:', String(e));
    if (voiceOverride) msg.voice = voiceOverride;
  }
}

/**
 * Turn a parsed native payload into the message the daemon takes. Every
 * event carries the agent pid: a session the daemon first sees through a
 * later event (its start was lost, or the daemon restarted) still gets its
 * liveness backstop. Only the start pays for the shell walk; the daemon
 * discards a pid that dies within seconds of adoption. Used by tests.
 */
export function buildHookMessage(agent: Agent, parsed: ParsedHook, opts: { voice?: string; cwd?: string; ppid?: number } = {}): HookMessage {
  const start = parsed.event === 'session.start';
  const msg: HookMessage = {
    event: parsed.event,
    sessionId: parsed.sessionId,
    agent,
    cwd: parsed.cwd ?? opts.cwd ?? process.cwd(),
    pid: opts.ppid ?? (start ? agentPid() : process.ppid),
  };
  if (start) announce(msg, opts.voice);
  else if (opts.voice) msg.voice = opts.voice;
  return msg;
}

export async function runHook(agent: Agent, opts: { voice?: string } = {}): Promise<void> {
  const t0 = Date.now();
  const adapter = getAdapter(agent);
  if (!adapter) { debug('agent not implemented:', agent); return; }

  const raw = await readStdin();
  let input: unknown;
  try { input = JSON.parse(raw); } catch { debug('no/invalid stdin'); return; }

  const parsed = adapter.parse(input);
  if (!parsed) {
    const name = typeof input === 'object' && input ? String((input as { hook_event_name?: unknown }).hook_event_name ?? '?') : '?';
    debug('ignored', agent, name);
    return;
  }
  const msg = buildHookMessage(agent, parsed, { voice: opts.voice });

  // Only a session start (or anything but an end) is worth booting the daemon for.
  const mayStart = msg.event !== 'session.end';
  const sock = await connectOrStart(mayStart);
  if (!sock) { debug('no daemon reachable'); return; }
  await new Promise<void>((res) => sock.end(JSON.stringify(msg) + '\n', () => res()));
  debug(`sent ${msg.event} for ${msg.sessionId} (${parsed.nativeEvent}) in ${Date.now() - t0} ms`);
}
