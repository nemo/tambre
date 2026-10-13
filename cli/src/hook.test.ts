import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHookMessage } from './hook.js';
import { getAdapter } from './adapters/index.js';

let home: string;
let project: string;
const saved = process.env.TAMBRE_HOME;
const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

beforeEach(() => {
  home = tmp('tambre-hhome-');
  project = tmp('tambre-hproj-');
  process.env.TAMBRE_HOME = home;
});

afterEach(() => {
  process.env.TAMBRE_HOME = saved;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

describe('buildHookMessage', () => {
  it('a session.start carries the resolved voice, texture, root and the agent pid', () => {
    fs.writeFileSync(path.join(project, 'tambre.json'), JSON.stringify({ voice: 'glass', texture: 'rain', frame: { root: 45 } }));
    const parsed = getAdapter('codex')!.parse({ session_id: 'thr_1', cwd: project, hook_event_name: 'SessionStart', source: 'startup' })!;
    const m = buildHookMessage('codex', parsed, { ppid: 4242 });
    expect(m).toMatchObject({ event: 'session.start', sessionId: 'thr_1', agent: 'codex', cwd: project, pid: 4242, projectRoot: project, texture: 'rain' });
    expect(m.voiceSpec?.name).toBe('glass');
    expect(m.frame?.root).toBe(45);
  });

  it('a --voice override wins over the project voice', () => {
    fs.writeFileSync(path.join(project, 'tambre.json'), JSON.stringify({ voice: 'glass' }));
    const parsed = getAdapter('claude-code')!.parse({ session_id: 's', cwd: project, hook_event_name: 'SessionStart' })!;
    expect(buildHookMessage('claude-code', parsed, { voice: 'reed', ppid: 1 }).voiceSpec?.name).toBe('reed');
  });

  it('other events are lean: no pid, no voice spec', () => {
    const parsed = getAdapter('claude-code')!.parse({ session_id: 's', cwd: project, hook_event_name: 'Stop' })!;
    const m = buildHookMessage('claude-code', parsed);
    expect(m).toEqual({ event: 'turn.end', sessionId: 's', agent: 'claude-code', cwd: project, pid: undefined });
  });
});
