import os from 'node:os';
import path from 'node:path';
import type { CanonicalEvent, Frame } from './engine/types.js';

export type Agent = 'claude-code' | 'codex' | 'opencode' | 'pi' | 'amp' | 'demo';

/** One newline-delimited JSON message from a hook to the daemon. */
export interface HookMessage {
  event: CanonicalEvent;
  sessionId: string;
  agent: Agent;
  cwd: string;
  /** PID of the agent process, so the daemon can notice it die. */
  pid?: number;
  /** Palette voice name the project asked for. */
  voice?: string;
  /** A frame the project proposes; honoured only for the first session. */
  frame?: Frame;
}

export function socketPath(): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\tambre-${os.userInfo().username}`;
  }
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime) return path.join(runtime, 'tambre.sock');
  const uid = typeof process.getuid === 'function' ? process.getuid() : os.userInfo().uid;
  return path.join(process.env.TMPDIR || os.tmpdir(), `tambre-${uid}.sock`);
}

export function pidPath(): string {
  if (process.platform === 'win32') {
    return path.join(process.env.TEMP || os.tmpdir(), `tambre-${os.userInfo().username}.pid`);
  }
  return socketPath().replace(/\.sock$/, '.pid');
}

export const debug = (...args: unknown[]): void => {
  if (process.env.TAMBRE_DEBUG) process.stderr.write(`[tambre] ${args.map(String).join(' ')}\n`);
};
