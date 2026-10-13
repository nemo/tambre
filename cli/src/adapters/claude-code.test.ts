import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { claudeCode, CLAUDE_CODE_EVENT_MAP, CLAUDE_CODE_NOTIFICATION_MAP } from './claude-code.js';

const payload = (hook_event_name: string, extra: Record<string, unknown> = {}) => ({
  session_id: 'abc-123',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/work/proj',
  hook_event_name,
  ...extra,
});

describe('claude-code adapter: parse', () => {
  it('maps every native event in the table to its canonical event', () => {
    for (const [native, canonical] of Object.entries(CLAUDE_CODE_EVENT_MAP)) {
      const r = claudeCode.parse(payload(native, { tool_name: 'Bash' }));
      expect(r, native).not.toBeNull();
      expect(r!.event, native).toBe(canonical);
      expect(r!.sessionId).toBe('abc-123');
      expect(r!.cwd).toBe('/work/proj');
      expect(r!.nativeEvent).toBe(native);
      expect(r!.toolName).toBe('Bash');
    }
  });

  it('every registered event except Notification is in the parse table', () => {
    for (const ev of claudeCode.events()) {
      if (ev === 'Notification') continue;
      expect(CLAUDE_CODE_EVENT_MAP[ev], ev).toBeDefined();
    }
  });

  it('maps Notification by notification_type', () => {
    for (const [nt, canonical] of Object.entries(CLAUDE_CODE_NOTIFICATION_MAP)) {
      const r = claudeCode.parse(payload('Notification', { notification_type: nt, message: 'x' }));
      expect(r?.event, nt).toBe(canonical);
      expect(r?.notificationType).toBe(nt);
    }
    expect(claudeCode.parse(payload('Notification', { notification_type: 'auth_success' }))).toBeNull();
    expect(claudeCode.parse(payload('Notification'))).toBeNull();
  });

  it('ignores events we do not play and malformed payloads', () => {
    expect(claudeCode.parse(payload('PostCompact'))).toBeNull();
    expect(claudeCode.parse(payload('Elicitation'))).toBeNull();
    expect(claudeCode.parse({ hook_event_name: 'Stop' })).toBeNull();            // no session_id
    expect(claudeCode.parse({ session_id: 's', hook_event_name: 7 })).toBeNull(); // wrong type
    expect(claudeCode.parse(null)).toBeNull();
    expect(claudeCode.parse('Stop')).toBeNull();
    expect(claudeCode.parse([])).toBeNull();
  });

  it('cwd is optional', () => {
    const r = claudeCode.parse({ session_id: 's', hook_event_name: 'Stop' });
    expect(r?.event).toBe('turn.end');
    expect(r?.cwd).toBeUndefined();
  });
});

describe('claude-code adapter: hooks block and paths', () => {
  it('registers every event async except SessionEnd, with a tambre marker on each entry', () => {
    const block = claudeCode.hooksBlock('node /x/tambre.js hook claude-code');
    expect(Object.keys(block.hooks).sort()).toEqual([...claudeCode.events()].sort());
    for (const [ev, groups] of Object.entries(block.hooks)) {
      expect(groups).toHaveLength(1);
      expect(groups[0].hooks).toHaveLength(1);
      const h = groups[0].hooks[0];
      expect(h.type).toBe('command');
      expect(h.command).toBe('node /x/tambre.js hook claude-code');
      expect(h.tambre).toBe(true);
      if (ev === 'SessionEnd') {
        expect(h.async).toBeUndefined();
        expect(h.timeout).toBe(5);
      } else {
        expect(h.async).toBe(true);
        expect(h.timeout).toBeUndefined();
      }
    }
  });

  it('settings paths: user settings.json, project settings.local.json, never project settings.json', () => {
    expect(claudeCode.settingsPath('user', '/p')).toBe(path.join(os.homedir(), '.claude', 'settings.json'));
    expect(claudeCode.settingsPath('project', '/p')).toBe(path.join('/p', '.claude', 'settings.local.json'));
  });

  it('honours CLAUDE_CONFIG_DIR for the user scope', () => {
    const saved = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = '/profiles/work';
    try {
      expect(claudeCode.settingsPath('user', '/p')).toBe(path.join('/profiles/work', 'settings.json'));
      expect(claudeCode.settingsPath('project', '/p')).toBe(path.join('/p', '.claude', 'settings.local.json'));
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
    }
  });
});
