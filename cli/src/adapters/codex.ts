import os from 'node:os';
import path from 'node:path';
import type { CanonicalEvent } from '../engine/types.js';
import { buildHooksBlock, readCommonFields, type Adapter, type InstallScope, type ParsedHook } from './types.js';

/**
 * OpenAI Codex CLI. Hooks live in ~/.codex/hooks.json (user) or
 * <root>/.codex/hooks.json (project; loaded only once the project's .codex
 * layer is trusted in Codex). Shape verified against
 * https://learn.chatgpt.com/docs/hooks on 2026-10-12:
 *
 *   { "hooks": { "<Event>": [ { "matcher"?: string, "hooks": [ { "type": "command",
 *     "command": string, "timeout"?: seconds, "async"?: boolean } ] } ] } }
 *
 * Events: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse,
 * PermissionRequest, PreCompact, PostCompact, SubagentStart, SubagentStop,
 * Stop, Interrupt. There is no Notification and no StopFailure. SessionEnd
 * always runs synchronously with a timeout of at most 3 s.
 *
 * Stdin payload, common fields: session_id, transcript_path, cwd,
 * hook_event_name, model. PreToolUse/PostToolUse/PermissionRequest add
 * tool_name; SessionStart adds source; SessionEnd adds reason.
 */

const EVENT_MAP: Record<string, CanonicalEvent> = {
  SessionStart: 'session.start',
  SessionEnd: 'session.end',
  UserPromptSubmit: 'working',
  PreToolUse: 'activity',
  PostToolUse: 'activity',
  SubagentStart: 'activity',
  SubagentStop: 'activity',
  PermissionRequest: 'permission.request',
  Stop: 'turn.end',
  PreCompact: 'compact',
  /** The user cut the turn short; the agent is now waiting on them. */
  Interrupt: 'waiting',
};

const ASYNC_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'SubagentStart', 'SubagentStop', 'PermissionRequest', 'Stop', 'PreCompact', 'Interrupt',
];
/** Codex caps SessionEnd at 3 s. */
const SESSION_END_TIMEOUT_S = 3;

export const codex: Adapter = {
  agent: 'codex',
  label: 'Codex',

  events: () => [...ASYNC_EVENTS, 'SessionEnd'],

  hooksBlock: (command) => buildHooksBlock(command, ASYNC_EVENTS, { SessionEnd: SESSION_END_TIMEOUT_S }),

  settingsPath: (scope: InstallScope, root: string) =>
    scope === 'user'
      ? path.join(os.homedir(), '.codex', 'hooks.json')
      : path.join(root, '.codex', 'hooks.json'),

  parse(input: unknown): ParsedHook | null {
    const f = readCommonFields(input);
    if (!f) return null;
    const event = EVENT_MAP[f.name];
    if (!event) return null;
    return { event, sessionId: f.sessionId, cwd: f.cwd, nativeEvent: f.name, toolName: f.toolName };
  },

  postInstallNotes: (scope) => [
    scope === 'project'
      ? 'Codex loads a project\'s .codex/hooks.json only once that layer is trusted: open Codex in this project and run /hooks to review and trust the tambre entries.'
      : 'Codex asks you to trust new hooks before they run: open Codex and run /hooks to review and trust the tambre entries.',
  ],
};

export const CODEX_EVENT_MAP = EVENT_MAP;
