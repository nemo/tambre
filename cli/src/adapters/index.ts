import type { Agent } from '../ipc.js';
import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';
import type { Adapter } from './types.js';

export type { Adapter, HookEntry, HookGroup, HooksBlock, InstallScope, ParsedHook } from './types.js';

/** Adapters that exist today, in the order `--agent all` installs them. */
export const ADAPTERS: Adapter[] = [claudeCode, codex];

export const INSTALLABLE_AGENTS = ADAPTERS.map((a) => a.agent) as Agent[];

export function getAdapter(agent: string | undefined): Adapter | undefined {
  return ADAPTERS.find((a) => a.agent === agent);
}

/** `--agent` value -> adapters. `all` or nothing means every adapter; undefined for an unknown name. */
export function adaptersFor(arg: string | undefined): Adapter[] | undefined {
  if (arg === undefined || arg === 'all') return [...ADAPTERS];
  const a = getAdapter(arg);
  return a ? [a] : undefined;
}
