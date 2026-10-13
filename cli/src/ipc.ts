import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CanonicalEvent, Frame, SessionState, Voice } from './engine/types.js';
import type { TextureMode } from './engine/texture.js';

export type Agent = 'claude-code' | 'codex' | 'opencode' | 'pi' | 'amp' | 'demo';

/** One newline-delimited JSON message from a hook to the daemon. No reply. */
export interface HookMessage {
  event: CanonicalEvent;
  sessionId: string;
  agent: Agent;
  cwd: string;
  /** PID of the agent process, so the daemon can notice it die. */
  pid?: number;
  /** Palette voice name the project asked for. Ignored when voiceSpec is present. */
  voice?: string;
  /** A fully resolved voice. The daemon uses it as-is and looks nothing up. */
  voiceSpec?: Voice;
  /** What this session sounds like while working. Defaults to the daemon's user default. */
  texture?: TextureMode;
  /** A frame the project proposes; honoured only for the first session. */
  frame?: Frame;
  /** The project root the session runs in, for `mute --here` and status. */
  projectRoot?: string;
}

// ---- control messages: one JSON line in, one JSON line out, then the daemon closes ----

export type MuteScope = 'all' | { project: string } | { session: string };

export type ControlMessage =
  | { cmd: 'status' }
  | { cmd: 'mute'; scope: MuteScope; value: boolean }
  | { cmd: 'volume'; value: number }
  | { cmd: 'preview'; what: 'event' | 'state'; name: CanonicalEvent | SessionState; voice: Voice; texture: TextureMode }
  | { cmd: 'set'; session: string; voice?: Voice; texture?: TextureMode }
  | { cmd: 'shutdown' };

export type ControlCmd = ControlMessage['cmd'];

export interface SessionStatus {
  id: string;
  agent: Agent;
  projectRoot: string;
  /** Voice name. */
  voice: string;
  texture: TextureMode;
  state: SessionState;
  muted: boolean;
  pid?: number;
}

export interface StatusReply {
  ok: true;
  frame: Frame;
  sessions: SessionStatus[];
  volume: number;
  mute: boolean;
}

export interface OkReply { ok: true }
export interface ErrorReply { ok: false; error: string }

export type ControlReply = StatusReply | OkReply | ErrorReply;

export type Message = HookMessage | ControlMessage;

export const isControlMessage = (m: unknown): m is ControlMessage =>
  typeof m === 'object' && m !== null && typeof (m as { cmd?: unknown }).cmd === 'string';

export const isStatusReply = (r: ControlReply): r is StatusReply => r.ok && 'sessions' in r;

// ---- paths ----

export function socketPath(): string {
  if (process.env.TAMBRE_SOCKET) return process.env.TAMBRE_SOCKET;
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\tambre-${os.userInfo().username}`;
  }
  const runtime = process.env.XDG_RUNTIME_DIR;
  if (runtime) return path.join(runtime, 'tambre.sock');
  const uid = typeof process.getuid === 'function' ? process.getuid() : os.userInfo().uid;
  return path.join(process.env.TMPDIR || os.tmpdir(), `tambre-${uid}.sock`);
}

export function pidPath(): string {
  if (process.env.TAMBRE_SOCKET) return process.env.TAMBRE_SOCKET.replace(/\.sock$/, '') + '.pid';
  if (process.platform === 'win32') {
    return path.join(process.env.TEMP || os.tmpdir(), `tambre-${os.userInfo().username}.pid`);
  }
  return socketPath().replace(/\.sock$/, '.pid');
}

/** The pid recorded in a daemon pid file, or null when there is none or it is garbage. */
export function readPidFile(file: string = pidPath()): number | null {
  try {
    const n = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** True when a process with this pid exists (it may belong to someone else). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists but is not ours to signal, which still means alive.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export const debug = (...args: unknown[]): void => {
  if (process.env.TAMBRE_DEBUG) process.stderr.write(`[tambre] ${args.map(String).join(' ')}\n`);
};
