const ASYNC_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'PreCompact',
];

/** The hooks block to merge into ~/.claude/settings.json. */
export function claudeCodeHooks(command = 'tambre hook claude-code'): Record<string, unknown> {
  const hooks: Record<string, unknown> = {};
  for (const ev of ASYNC_EVENTS) {
    hooks[ev] = [{ hooks: [{ type: 'command', command, async: true }] }];
  }
  hooks.SessionEnd = [{ hooks: [{ type: 'command', command, timeout: 5 }] }];
  return { hooks };
}
