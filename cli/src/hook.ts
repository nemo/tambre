import net from 'node:net';
import { spawn } from 'node:child_process';
import type { CanonicalEvent } from './engine/types.js';
import { debug, socketPath, type Agent, type HookMessage } from './ipc.js';

const CONNECT_RETRY_MS = 100;
const CONNECT_BUDGET_MS = 2500;

/** Claude Code hook payload, the fields we read. */
interface ClaudeHookInput {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  notification_type?: string;
  tool_name?: string;
}

export function mapClaudeCode(input: ClaudeHookInput): CanonicalEvent | null {
  switch (input.hook_event_name) {
    case 'SessionStart': return 'session.start';
    case 'SessionEnd': return 'session.end';
    case 'UserPromptSubmit': return 'working';
    case 'PreToolUse':
    case 'PostToolUse': return 'activity';
    case 'PermissionRequest': return 'permission.request';
    case 'Stop': return 'turn.end';
    case 'StopFailure': return 'turn.fail';
    case 'PreCompact': return 'compact';
    case 'Notification':
      switch (input.notification_type) {
        case 'permission_prompt': return 'permission.request';
        case 'idle_prompt':
        case 'agent_completed': return 'waiting';
        default: return null;
      }
    default: return null;
  }
}

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

function spawnDaemon(): void {
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1], 'daemon'], {
    detached: true,
    stdio: process.env.TAMBRE_DEBUG ? ['ignore', 'inherit', 'inherit'] : 'ignore',
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  debug('spawned daemon pid', child.pid);
}

function tryConnect(path: string): Promise<net.Socket | null> {
  return new Promise((res) => {
    const c = net.connect(path);
    c.once('connect', () => res(c));
    c.once('error', () => res(null));
  });
}

/** Connect, spawning the daemon on first failure, within a short budget. */
async function connect(path: string, mayStart: boolean): Promise<net.Socket | null> {
  const deadline = Date.now() + CONNECT_BUDGET_MS;
  let c = await tryConnect(path);
  if (c || !mayStart) return c;
  spawnDaemon();
  while (!c && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CONNECT_RETRY_MS));
    c = await tryConnect(path);
  }
  return c;
}

export async function runHook(agent: Agent, opts: { voice?: string } = {}): Promise<void> {
  const t0 = Date.now();
  const raw = await readStdin();
  let msg: HookMessage | null = null;

  if (agent === 'claude-code') {
    let input: ClaudeHookInput;
    try { input = JSON.parse(raw); } catch { debug('no/invalid stdin'); return; }
    const event = mapClaudeCode(input);
    if (!event) { debug('ignored', input.hook_event_name, input.notification_type ?? ''); return; }
    msg = {
      event,
      sessionId: input.session_id,
      agent,
      cwd: input.cwd ?? process.cwd(),
      pid: event === 'session.start' ? process.ppid : undefined,
      voice: opts.voice,
    };
  } else {
    debug('agent not implemented:', agent);
    return;
  }

  // Only a session start (or anything but an end) is worth booting the daemon for.
  const mayStart = msg.event !== 'session.end';
  const sock = await connect(socketPath(), mayStart);
  if (!sock) { debug('no daemon reachable'); return; }
  await new Promise<void>((res) => sock.end(JSON.stringify(msg) + '\n', () => res()));
  debug(`sent ${msg.event} for ${msg.sessionId} in ${Date.now() - t0} ms`);
}
