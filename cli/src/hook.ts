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

async function readStdin(timeoutMs = 500): Promise<string> {
  if (process.stdin.isTTY) return '';
  return new Promise((res) => {
    let data = '';
    const t = setTimeout(() => res(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => { clearTimeout(t); res(data); });
    process.stdin.on('error', () => { clearTimeout(t); res(data); });
  });
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
    if (r.frame) msg.frame = r.frame;
  } catch (e) {
    debug('resolveSession failed:', String(e));
    if (voiceOverride) msg.voice = voiceOverride;
  }
}

/** Turn a parsed native payload into the message the daemon takes. Pure; used by tests. */
export function buildHookMessage(agent: Agent, parsed: ParsedHook, opts: { voice?: string; cwd?: string; ppid?: number } = {}): HookMessage {
  const msg: HookMessage = {
    event: parsed.event,
    sessionId: parsed.sessionId,
    agent,
    cwd: parsed.cwd ?? opts.cwd ?? process.cwd(),
    pid: parsed.event === 'session.start' ? (opts.ppid ?? process.ppid) : undefined,
  };
  if (parsed.event === 'session.start') announce(msg, opts.voice);
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
