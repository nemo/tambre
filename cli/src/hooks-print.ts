import { getAdapter } from './adapters/index.js';
import type { HooksBlock } from './adapters/types.js';
import { hookCommand } from './install.js';

/**
 * The hooks block `install` would merge for an agent. With no command given,
 * the command is the absolute path of this binary, exactly as install writes it.
 */
export function hooksBlockFor(agent: string, command?: string): HooksBlock | undefined {
  const adapter = getAdapter(agent);
  if (!adapter) return undefined;
  return adapter.hooksBlock(command ?? hookCommand(adapter.agent));
}

/** Kept for callers of the spike API. */
export function claudeCodeHooks(command = 'tambre hook claude-code'): HooksBlock {
  return hooksBlockFor('claude-code', command)!;
}
