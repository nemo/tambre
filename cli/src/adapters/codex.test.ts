import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { codex, CODEX_EVENT_MAP } from './codex.js';

/**
 * Payloads follow https://learn.chatgpt.com/docs/hooks (fetched 2026-10-12):
 * common fields session_id, transcript_path, cwd, hook_event_name, model;
 * event-specific extras as documented there.
 */
const common = { session_id: 'thr_123', transcript_path: '/workspace/.codex/rollout.jsonl', cwd: '/workspace', model: 'gpt-5-codex' };

const DOCUMENTED: Array<[Record<string, unknown>, string | null]> = [
  [{ ...common, hook_event_name: 'SessionStart', source: 'startup' }, 'session.start'],
  [{ ...common, hook_event_name: 'SessionStart', source: 'resume' }, 'session.start'],
  // the one full example on the docs page
  [{ session_id: 'thr_123', transcript_path: '/workspace/.codex/rollout.jsonl', cwd: '/workspace', hook_event_name: 'SessionEnd', reason: 'other' }, 'session.end'],
  [{ ...common, hook_event_name: 'UserPromptSubmit', turn_id: 't1', prompt: 'fix the tests' }, 'working'],
  [{ ...common, hook_event_name: 'PreToolUse', turn_id: 't1', tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'ls' } }, 'activity'],
  [{ ...common, hook_event_name: 'PostToolUse', turn_id: 't1', tool_name: 'Bash', tool_use_id: 'u1', tool_input: {}, tool_response: {} }, 'activity'],
  [{ ...common, hook_event_name: 'PermissionRequest', turn_id: 't1', tool_name: 'Bash', tool_input: { command: 'rm -rf x' } }, 'permission.request'],
  [{ ...common, hook_event_name: 'PreCompact', turn_id: 't1', trigger: 'auto' }, 'compact'],
  [{ ...common, hook_event_name: 'PostCompact', turn_id: 't1', trigger: 'auto' }, null],
  [{ ...common, hook_event_name: 'SubagentStart', turn_id: 't1', agent_id: 'a1', agent_type: 'explorer' }, 'activity'],
  [{ ...common, hook_event_name: 'SubagentStop', turn_id: 't1', agent_id: 'a1', agent_type: 'explorer', agent_transcript_path: '/x', stop_hook_active: false, last_assistant_message: 'done' }, 'activity'],
  [{ ...common, hook_event_name: 'Stop', turn_id: 't1', stop_hook_active: false, last_assistant_message: 'done' }, 'turn.end'],
  [{ ...common, hook_event_name: 'Interrupt', turn_id: 't1', permission_mode: 'default' }, 'waiting'],
];

describe('codex adapter: parse', () => {
  it('maps each documented payload', () => {
    for (const [p, expected] of DOCUMENTED) {
      const r = codex.parse(p);
      if (expected === null) { expect(r, String(p.hook_event_name)).toBeNull(); continue; }
      expect(r, String(p.hook_event_name)).not.toBeNull();
      expect(r!.event).toBe(expected);
      expect(r!.sessionId).toBe('thr_123');
      expect(r!.cwd).toBe('/workspace');
      if (typeof p.tool_name === 'string') expect(r!.toolName).toBe(p.tool_name);
    }
  });

  it('every registered event is in the parse table', () => {
    for (const ev of codex.events()) expect(CODEX_EVENT_MAP[ev], ev).toBeDefined();
  });

  it('Codex has no Notification or StopFailure events, so those are not registered or parsed', () => {
    expect(codex.events()).not.toContain('Notification');
    expect(codex.events()).not.toContain('StopFailure');
    expect(codex.parse({ ...common, hook_event_name: 'Notification', notification_type: 'permission_prompt' })).toBeNull();
    expect(codex.parse({ ...common, hook_event_name: 'StopFailure' })).toBeNull();
  });

  it('rejects malformed payloads', () => {
    expect(codex.parse({ hook_event_name: 'Stop' })).toBeNull();
    expect(codex.parse({ session_id: '', hook_event_name: 'Stop' })).toBeNull();
    expect(codex.parse(undefined)).toBeNull();
    expect(codex.parse(42)).toBeNull();
  });
});

describe('codex adapter: hooks block and paths', () => {
  it('uses the documented handler fields; SessionEnd is sync with a timeout of at most 3 s', () => {
    const block = codex.hooksBlock('node /x/tambre.js hook codex');
    expect(Object.keys(block)).toEqual(['hooks']);
    expect(Object.keys(block.hooks).sort()).toEqual([...codex.events()].sort());
    for (const [ev, groups] of Object.entries(block.hooks)) {
      expect(groups).toHaveLength(1);
      expect(groups[0].matcher).toBeUndefined();
      const h = groups[0].hooks[0];
      expect(Object.keys(h).sort()).toEqual(ev === 'SessionEnd' ? ['command', 'tambre', 'timeout', 'type'] : ['async', 'command', 'tambre', 'type']);
      expect(h.type).toBe('command');
      expect(h.command).toBe('node /x/tambre.js hook codex');
      if (ev === 'SessionEnd') { expect(h.timeout).toBeLessThanOrEqual(3); expect(h.timeout).toBeGreaterThan(0); }
      else expect(h.async).toBe(true);
    }
  });

  it('settings paths: ~/.codex/hooks.json and <root>/.codex/hooks.json', () => {
    expect(codex.settingsPath('user', '/p')).toBe(path.join(os.homedir(), '.codex', 'hooks.json'));
    expect(codex.settingsPath('project', '/p')).toBe(path.join('/p', '.codex', 'hooks.json'));
  });

  it('honours CODEX_HOME for the user scope', () => {
    const saved = process.env.CODEX_HOME;
    process.env.CODEX_HOME = '/profiles/codex';
    try {
      expect(codex.settingsPath('user', '/p')).toBe(path.join('/profiles/codex', 'hooks.json'));
      expect(codex.settingsPath('project', '/p')).toBe(path.join('/p', '.codex', 'hooks.json'));
    } finally {
      if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
    }
  });

  it('tells the user about the trust step', () => {
    expect(codex.postInstallNotes('project').join(' ')).toMatch(/\/hooks/);
    expect(codex.postInstallNotes('user').join(' ')).toMatch(/\/hooks/);
  });
});
