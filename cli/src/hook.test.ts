import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { agentPid, buildHookMessage, readStdin } from './hook.js';
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

  it('other events are lean (no voice spec) but still carry the agent pid, so an adopted session can be reaped', () => {
    const parsed = getAdapter('claude-code')!.parse({ session_id: 's', cwd: project, hook_event_name: 'Stop' })!;
    const m = buildHookMessage('claude-code', parsed);
    expect(m).toEqual({ event: 'turn.end', sessionId: 's', agent: 'claude-code', cwd: project, pid: process.ppid });
    expect(buildHookMessage('claude-code', parsed, { ppid: 77 }).pid).toBe(77);
  });
});

describe('agentPid', () => {
  it('walks up past wrapper shells to the process that launched the hook command', () => {
    const tree: Record<number, { ppid: number; comm: string }> = {
      50: { ppid: 40, comm: 'sh' },        // `sh -c 'cd x && node …'` did not exec
      40: { ppid: 30, comm: '/bin/zsh' },  // an outer login shell wrapper
      30: { ppid: 1, comm: 'claude' },     // the agent
    };
    const lookup = (pid: number) => tree[pid] ?? null;
    expect(agentPid(50, lookup)).toBe(30);
    expect(agentPid(30, lookup)).toBe(30);
    expect(agentPid(999, lookup)).toBe(999); // unknown: keep what we have
  });

  it('never walks past init or beyond a few hops', () => {
    const lookup = (pid: number) => ({ ppid: pid - 1, comm: 'bash' });
    expect(agentPid(3, lookup)).toBe(2);
    expect(agentPid(100, lookup)).toBe(96);
  });
});

describe('readStdin', () => {
  it('resolves what arrived and destroys a stream the writer never closes, so the hook can exit', async () => {
    const stream = new PassThrough();
    stream.write('{"a":1}');
    const t0 = Date.now();
    const text = await readStdin(stream, 100);
    expect(text).toBe('{"a":1}');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(stream.destroyed).toBe(true);
  });

  it('returns promptly when the stream ends', async () => {
    const stream = new PassThrough();
    const p = readStdin(stream, 5000);
    stream.end('{"b":2}');
    expect(await p).toBe('{"b":2}');
  });
});
