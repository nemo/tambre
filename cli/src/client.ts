import net from 'node:net';
import { spawn } from 'node:child_process';
import { debug, isStatusReply, socketPath, type ControlMessage, type ControlReply, type HookMessage, type StatusReply } from './ipc.js';

/**
 * Everything that talks to the daemon goes through here: hooks, the CLI and
 * the TUI. Nothing in this file prints; callers decide what to say.
 */

export const SEND_TIMEOUT_MS = 500;
const SPAWN_RETRY_MS = 100;
const SPAWN_BUDGET_MS = 3000;

export interface ClientOpts {
  /** Socket to use instead of the default for this user. */
  socket?: string;
  timeoutMs?: number;
}

export class DaemonError extends Error {
  constructor(message: string, public readonly code: 'unreachable' | 'timeout' | 'bad-reply' | 'refused') {
    super(message);
    this.name = 'DaemonError';
  }
}

/** Open a connection, or resolve null when no daemon answers within the timeout. */
export function connect(opts: ClientOpts = {}): Promise<net.Socket | null> {
  const sock = opts.socket ?? socketPath();
  const timeoutMs = opts.timeoutMs ?? SEND_TIMEOUT_MS;
  return new Promise((res) => {
    const c = net.connect(sock);
    const t = setTimeout(() => { c.destroy(); res(null); }, timeoutMs);
    c.once('connect', () => { clearTimeout(t); res(c); });
    c.once('error', () => { clearTimeout(t); res(null); });
  });
}

/** Fire a hook message. Resolves false when no daemon is reachable. */
export async function sendHook(msg: HookMessage, opts: ClientOpts = {}): Promise<boolean> {
  const sock = await connect(opts);
  if (!sock) return false;
  await new Promise<void>((res) => sock.end(JSON.stringify(msg) + '\n', () => res()));
  return true;
}

/**
 * Send one control message and wait for its one-line reply. Throws a
 * DaemonError when nothing answers in time.
 */
export async function send(msg: ControlMessage, opts: ClientOpts = {}): Promise<ControlReply> {
  const timeoutMs = opts.timeoutMs ?? SEND_TIMEOUT_MS;
  const sock = await connect(opts);
  if (!sock) throw new DaemonError('daemon not running', 'unreachable');
  return new Promise<ControlReply>((res, rej) => {
    let buf = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      sock.destroy();
      fn();
    };
    const t = setTimeout(() => finish(() => rej(new DaemonError(`no reply to "${msg.cmd}" in ${timeoutMs} ms`, 'timeout'))), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      try {
        const reply = JSON.parse(line) as ControlReply;
        finish(() => res(reply));
      } catch {
        finish(() => rej(new DaemonError('unparseable reply from daemon', 'bad-reply')));
      }
    });
    sock.on('error', (e) => finish(() => rej(new DaemonError(e.message, 'unreachable'))));
    sock.on('close', () => finish(() => rej(new DaemonError('daemon closed the connection without a reply', 'bad-reply'))));
    sock.write(JSON.stringify(msg) + '\n');
  });
}

/** `status`, or null when the daemon is not running. Throws on a malformed reply. */
export async function status(opts: ClientOpts = {}): Promise<StatusReply | null> {
  let reply: ControlReply;
  try {
    reply = await send({ cmd: 'status' }, opts);
  } catch (e) {
    if (e instanceof DaemonError && (e.code === 'unreachable' || e.code === 'timeout')) return null;
    throw e;
  }
  if (!isStatusReply(reply)) throw new DaemonError(`unexpected status reply: ${JSON.stringify(reply)}`, 'bad-reply');
  return reply;
}

/** Start the daemon detached from this process. The caller does not wait for it. */
export function spawnDaemon(): number | undefined {
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1], 'daemon'], {
    detached: true,
    stdio: process.env.TAMBRE_DEBUG ? ['ignore', 'inherit', 'inherit'] : 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  debug('spawned daemon pid', child.pid);
  return child.pid;
}

/**
 * Make sure a daemon answers `status`, spawning one if needed. Resolves the
 * status reply, or null when nothing came up within the budget.
 */
export async function ensureDaemon(opts: ClientOpts & { budgetMs?: number } = {}): Promise<StatusReply | null> {
  const first = await status(opts);
  if (first) return first;
  spawnDaemon();
  const deadline = Date.now() + (opts.budgetMs ?? SPAWN_BUDGET_MS);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SPAWN_RETRY_MS));
    const s = await status(opts);
    if (s) return s;
  }
  return null;
}
