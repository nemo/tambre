import os from 'node:os';
import path from 'node:path';
import type { CanonicalEvent } from '../engine/types.js';
import { buildHooksBlock, isObj, readCommonFields, type Adapter, type InstallScope, type ParsedHook } from './types.js';

/**
 * Claude Code. Hooks live in JSON settings: ~/.claude/settings.json for the
 * user, <root>/.claude/settings.local.json for a project (gitignored by Claude
 * Code itself). <root>/.claude/settings.json is committed and never touched.
 * Payload fields: hook_event_name, session_id, cwd, notification_type, tool_name.
 */

const EVENT_MAP: Record<string, CanonicalEvent> = {
  SessionStart: 'session.start',
  SessionEnd: 'session.end',
  UserPromptSubmit: 'working',
  PreToolUse: 'activity',
  PostToolUse: 'activity',
  PostToolUseFailure: 'activity',
  SubagentStart: 'activity',
  SubagentStop: 'activity',
  PermissionRequest: 'permission.request',
  Stop: 'turn.end',
  StopFailure: 'turn.fail',
  PreCompact: 'compact',
};

const NOTIFICATION_MAP: Record<string, CanonicalEvent> = {
  permission_prompt: 'permission.request',
  idle_prompt: 'waiting',
  agent_completed: 'waiting',
};

/** Every event except SessionEnd runs async; SessionEnd gets a short timeout. */
const ASYNC_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'SubagentStart', 'SubagentStop', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'PreCompact',
];
const SESSION_END_TIMEOUT_S = 5;

export const claudeCode: Adapter = {
  agent: 'claude-code',
  label: 'Claude Code',

  events: () => [...ASYNC_EVENTS, 'SessionEnd'],

  hooksBlock: (command) => buildHooksBlock(command, ASYNC_EVENTS, { SessionEnd: SESSION_END_TIMEOUT_S }),

  settingsPath: (scope: InstallScope, root: string) =>
    scope === 'user'
      ? path.join(os.homedir(), '.claude', 'settings.json')
      : path.join(root, '.claude', 'settings.local.json'),

  parse(input: unknown): ParsedHook | null {
    const f = readCommonFields(input);
    if (!f) return null;
    let event: CanonicalEvent | undefined;
    let notificationType: string | undefined;
    if (f.name === 'Notification') {
      const nt = isObj(input) && typeof input.notification_type === 'string' ? input.notification_type : undefined;
      notificationType = nt;
      event = nt ? NOTIFICATION_MAP[nt] : undefined;
    } else {
      event = EVENT_MAP[f.name];
    }
    if (!event) return null;
    return { event, sessionId: f.sessionId, cwd: f.cwd, nativeEvent: f.name, notificationType, toolName: f.toolName };
  },

  postInstallNotes: () => [],
};

/** The native events this adapter maps, with their canonical targets (for tests and doctor). */
export const CLAUDE_CODE_EVENT_MAP = EVENT_MAP;
export const CLAUDE_CODE_NOTIFICATION_MAP = NOTIFICATION_MAP;
