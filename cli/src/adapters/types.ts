import type { CanonicalEvent } from '../engine/types.js';
import type { Agent } from '../ipc.js';

export type InstallScope = 'user' | 'project';

/** What an adapter gets out of one native hook payload. */
export interface ParsedHook {
  event: CanonicalEvent;
  sessionId: string;
  cwd?: string;
  /** The native event name, for debugging. */
  nativeEvent: string;
  notificationType?: string;
  toolName?: string;
}

/** One hook entry as written into an agent's settings file. */
export interface HookEntry {
  type: 'command';
  command: string;
  async?: boolean;
  timeout?: number;
  /** Marks the entry as ours so uninstall can find it. */
  tambre: true;
}

/** A matcher group: the agent's unit under each event key. */
export interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

export interface HooksBlock {
  hooks: Record<string, HookGroup[]>;
}

/**
 * Per-agent translation: which native events to register, the JSON hook
 * block to merge into the agent's settings, where that file lives, and how
 * a native stdin payload maps to a canonical event.
 */
export interface Adapter {
  readonly agent: Agent;
  readonly label: string;
  /** Native events the install registers. */
  events(): string[];
  /** The block to merge into the settings file; `command` is the full hook command line. */
  hooksBlock(command: string): HooksBlock;
  /** Where the hooks go. `root` is the project root for the project scope. */
  settingsPath(scope: InstallScope, root: string): string;
  /** Map a parsed stdin payload to a canonical event, or null when it is not one we play. */
  parse(input: unknown): ParsedHook | null;
  /** Anything the user must do after install that the CLI cannot (trust steps). */
  postInstallNotes(scope: InstallScope): string[];
}

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Shared field reading for the two JSON-hook agents, whose payloads share names. */
export function readCommonFields(input: unknown): { name: string; sessionId: string; cwd?: string; toolName?: string } | null {
  if (!isObj(input)) return null;
  const name = input.hook_event_name;
  const sessionId = input.session_id;
  if (typeof name !== 'string' || typeof sessionId !== 'string' || !sessionId) return null;
  return {
    name,
    sessionId,
    cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
    toolName: typeof input.tool_name === 'string' ? input.tool_name : undefined,
  };
}

/** Build a hooks block from an event table; `syncEvents` get a timeout instead of async. */
export function buildHooksBlock(
  command: string,
  asyncEvents: string[],
  syncEvents: Record<string, number>,
): HooksBlock {
  const hooks: Record<string, HookGroup[]> = {};
  for (const ev of asyncEvents) {
    hooks[ev] = [{ hooks: [{ type: 'command', command, async: true, tambre: true }] }];
  }
  for (const [ev, timeout] of Object.entries(syncEvents)) {
    hooks[ev] = [{ hooks: [{ type: 'command', command, timeout, tambre: true }] }];
  }
  return { hooks };
}
