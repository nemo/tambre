import type { CanonicalEvent } from './engine/types.js';
import { debug, type Agent, type HookMessage } from './ipc.js';
import { connect, spawnDaemon } from './client.js';
import { resolveSession, resolveVoice } from './config.js';

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
    };
    if (event === 'session.start') announce(msg, opts.voice);
    else if (opts.voice) msg.voice = opts.voice;
  } else {
    debug('agent not implemented:', agent);
    return;
  }

  // Only a session start (or anything but an end) is worth booting the daemon for.
  const mayStart = msg.event !== 'session.end';
  const sock = await connectOrStart(mayStart);
  if (!sock) { debug('no daemon reachable'); return; }
  await new Promise<void>((res) => sock.end(JSON.stringify(msg) + '\n', () => res()));
  debug(`sent ${msg.event} for ${msg.sessionId} in ${Date.now() - t0} ms`);
}
