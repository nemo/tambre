import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { App, type TuiClient } from './App.js';
import type { ControlMessage, StatusReply } from '../ipc.js';
import { DEFAULT_FRAME } from '../engine/types.js';
import { readUserConfig, readProjectConfig, VOICING_SETS } from '../config.js';
import { voiceByName } from '../palette.js';

// vitest.config.ts sets TAMBRE_NO_AUDIO=1; the TUI never touches the engine anyway.

let home: string;
let cwd: string;
const savedHome = process.env.TAMBRE_HOME;

const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const TAB = '\t';
const ENTER = '\r';
const RIGHT = '\u001b[C';
const DOWN = '\u001b[B';

const STATUS: StatusReply = {
  ok: true,
  frame: DEFAULT_FRAME,
  volume: 0.8,
  mute: false,
  sessions: [
    { id: 's1', agent: 'claude-code', projectRoot: '/work/alpha', voice: 'brass', texture: 'rain', state: 'working', muted: false, pid: 1 },
    { id: 's2', agent: 'codex', projectRoot: '/work/beta', voice: 'glass', texture: 'hush', state: 'blocked', muted: true, pid: 2 },
  ],
};
const QUIET: StatusReply = { ...STATUS, sessions: [] };

/** A client that records what the TUI sends and answers ok. */
function fakeClient(status: StatusReply | null = STATUS): TuiClient & { sent: ControlMessage[] } {
  const sent: ControlMessage[] = [];
  return {
    sent,
    status: async () => status,
    send: async (msg) => { sent.push(msg); return { ok: true }; },
  };
}

const mount = (client: TuiClient, status: StatusReply | null = STATUS, dir = cwd) =>
  render(<App client={client} cwd={dir} initialStatus={status} pollMs={60_000} cols={100} rows={30} />);

/** A git checkout: a project without a tambre.json, so the TUI is on its first run. */
const makeProject = (dir: string) => fs.mkdirSync(path.join(dir, '.git'));

/** Press keys one per tick, so each handler sees the state the previous one left. */
async function keys(r: { stdin: { write(s: string): void } }, ...ks: string[]): Promise<void> {
  for (const k of ks) { r.stdin.write(k); await tick(); }
}

beforeEach(() => {
  home = tmp('tambre-tui-home-');
  cwd = tmp('tambre-tui-cwd-');
  process.env.TAMBRE_HOME = home;
  // A user config exists: outside a project this is a returning user, not a first run.
  fs.writeFileSync(path.join(home, 'config.json'), '{}');
});

afterEach(() => {
  process.env.TAMBRE_HOME = savedHome;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('first run', () => {
  it('opens on the palette with the note, and the note leaves after the first save', async () => {
    makeProject(cwd);
    const r = mount(fakeClient(QUIET), QUIET);
    await tick();
    const f = r.lastFrame()!;
    expect(f).toContain('No voice for this project yet.');
    expect(f).toContain('PALETTE');
    expect(f).toMatch(/▸ moss/);
    expect(f).toContain('dark, soft');
    expect(f).not.toContain('moss •');
    await keys(r, RIGHT, ENTER);
    expect(r.lastFrame()).toContain('loaded brass');
    r.stdin.write('s'); await tick();
    expect(r.lastFrame()).not.toContain('No voice for this project yet.');
    expect(readProjectConfig(cwd).config.voice).toBe('brass');
    expect(r.lastFrame()).toContain('brass •');
  });

  it('opens on VOICE when the project already has a voice', async () => {
    makeProject(cwd);
    fs.writeFileSync(path.join(cwd, 'tambre.json'), JSON.stringify({ voice: 'cedar', texture: 'rain' }));
    const r = mount(fakeClient(QUIET), QUIET);
    await tick();
    expect(r.lastFrame()).not.toContain('No voice for this project yet.');
    expect(r.lastFrame()).toMatch(/▸ timbre/);
    expect(r.lastFrame()).toContain('0.20'); // cedar's timbre
  });
});

describe('pages and cells', () => {
  it('Tab cycles the five pages forward and Shift-Tab back', async () => {
    const r = mount(fakeClient());
    await tick();
    expect(r.lastFrame()).toMatch(/▸ timbre/);
    r.stdin.write(TAB); await tick();
    expect(r.lastFrame()).toMatch(/▸ texture/);
    r.stdin.write(TAB); await tick();
    expect(r.lastFrame()).toMatch(/▸ attack/);
    r.stdin.write(TAB); await tick();
    expect(r.lastFrame()).toContain('PATCHES');
    r.stdin.write(TAB); await tick();
    expect(r.lastFrame()).toMatch(/▸ moss/);
    r.stdin.write('\u001b[Z'); await tick(); // shift-tab
    expect(r.lastFrame()).toContain('PATCHES');
  });

  it('arrows move in two dimensions and h/l adjust the focused value', async () => {
    const r = mount(fakeClient());
    await tick();
    await keys(r, RIGHT, DOWN);
    expect(r.lastFrame()).toMatch(/▸ move rate/);
    r.stdin.write('l'); await tick();
    expect(r.lastFrame()).toContain('0.06');
    await keys(r, 'h', 'h');
    expect(r.lastFrame()).toContain('0.04');
    expect(r.lastFrame()).toContain('move rate 0.04');
  });

  it('l on a cycle cell advances it and wraps', async () => {
    const r = mount(fakeClient());
    await tick();
    await keys(r, RIGHT, RIGHT, RIGHT);
    expect(r.lastFrame()).toMatch(/▸ bell/);
    r.stdin.write('l'); await tick();
    expect(r.lastFrame()).toContain('‹ glass ›');
  });
});

describe('auditions', () => {
  it('space previews the working state of the edited voice', async () => {
    const client = fakeClient();
    const r = mount(client);
    await tick();
    r.stdin.write(' '); await tick();
    expect(client.sent[0]).toMatchObject({ cmd: 'preview', what: 'state', name: 'working', texture: 'hush' });
    expect((client.sent[0] as { voice: { name: string } }).voice.name).toBe('moss');
    expect(r.lastFrame()).toContain('hear working');
  });

  it('on the palette, space plays the focused voice and 2 plays its turn.end', async () => {
    makeProject(cwd);
    const client = fakeClient(QUIET);
    const r = mount(client, QUIET);
    await tick();
    await keys(r, RIGHT, ' ', '2');
    expect((client.sent[0] as { voice: { name: string } }).voice.name).toBe('brass');
    expect(client.sent[1]).toMatchObject({ cmd: 'preview', what: 'event', name: 'turn.end' });
  });
});

describe('frame page', () => {
  it('shows locked while sessions are live and refuses the edit', async () => {
    const client = fakeClient();
    const r = mount(client);
    await tick();
    await keys(r, TAB, RIGHT);
    expect(r.lastFrame()).toMatch(/▸ root/);
    expect(r.lastFrame()).toContain('locked');
    r.stdin.write('l'); await tick();
    expect(r.lastFrame()).toContain('root is locked while 2 sessions are live');
    expect(client.sent.find((m) => m.cmd === 'frame')).toBeUndefined();
  });

  it('with no sessions, a root change saves the user frame and tells the daemon', async () => {
    const client = fakeClient(QUIET);
    const r = mount(client, QUIET);
    await tick();
    await keys(r, TAB, RIGHT);
    r.stdin.write('l'); await tick();
    expect(r.lastFrame()).toContain('G#2');
    expect(readUserConfig().config.frame.root).toBe(44);
    expect(client.sent.find((m) => m.cmd === 'frame')).toMatchObject({ cmd: 'frame', frame: { root: 44 } });
  });

  it('cycles named voicing sets and writes their chords', async () => {
    const client = fakeClient(QUIET);
    const r = mount(client, QUIET);
    await tick();
    await keys(r, TAB, RIGHT, RIGHT);
    r.stdin.write('l'); await tick();
    expect(r.lastFrame()).toContain('‹ dawn ›');
    expect(readUserConfig().config.frame.voicings).toEqual(VOICING_SETS.dawn);
  });

  it('volume and mute all go to the daemon, not the config', async () => {
    const client = fakeClient(QUIET);
    const r = mount(client, QUIET);
    await tick();
    await keys(r, TAB, DOWN, RIGHT);
    expect(r.lastFrame()).toMatch(/▸ volume/);
    r.stdin.write('h'); await tick();
    expect(client.sent.at(-1)).toEqual({ cmd: 'volume', value: 0.75 });
    await keys(r, RIGHT, 'l');
    expect(client.sent.at(-1)).toEqual({ cmd: 'mute', scope: 'all', value: true });
  });
});

describe('sessions', () => {
  it('lists live sessions and m mutes the highlighted one', async () => {
    const client = fakeClient();
    const r = mount(client);
    await tick();
    expect(r.lastFrame()).toMatch(/01 brass.*alpha.*working.*\[ \]/);
    expect(r.lastFrame()).toMatch(/02 glass.*beta.*blocked.*\[x\]/);
    await keys(r, 'J', 'm');
    expect(client.sent.at(-1)).toEqual({ cmd: 'mute', scope: { session: 's2' }, value: false });
    r.stdin.write('p'); await tick();
    expect(client.sent.at(-1)).toMatchObject({ cmd: 'set', session: 's2', texture: 'hush' });
  });

  it('says so when the daemon is down', async () => {
    const r = mount(fakeClient(null), null);
    await tick();
    expect(r.lastFrame()).toContain('daemon unreachable');
  });
});

describe('saving', () => {
  it('s writes tambre.json in a project and the texture goes with it', async () => {
    makeProject(cwd);
    fs.writeFileSync(path.join(cwd, 'tambre.json'), JSON.stringify({ voice: 'moss', texture: 'hush', keep: 1 }));
    const r = mount(fakeClient(QUIET), QUIET);
    await tick();
    await keys(r, TAB, 'l'); // texture hush -> next
    r.stdin.write('s'); await tick();
    expect(r.lastFrame()).toContain('saved');
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, 'tambre.json'), 'utf8'));
    expect(raw.keep).toBe(1);
    expect(raw.voice).toBe('moss');
    expect(raw.texture).not.toBe('hush');
  });

  it('S prompts for a name and saves a patch that then shows on PATCHES', async () => {
    const r = mount(fakeClient(QUIET), QUIET);
    await tick();
    r.stdin.write('S'); await tick();
    expect(r.lastFrame()).toContain('patch name:');
    r.stdin.write('warm'); await tick();
    r.stdin.write(ENTER); await tick();
    expect(r.lastFrame()).toContain('saved patch "warm"');
    expect(readUserConfig().config.patches.warm?.voice?.name).toBe('moss');
    await keys(r, TAB, TAB, TAB);
    expect(r.lastFrame()).toMatch(/▸ warm/);
  });

  it('outside a project, s saves the user default', async () => {
    const r = mount(fakeClient(QUIET), QUIET);
    await tick();
    r.stdin.write('s'); await tick();
    expect(r.lastFrame()).toContain('saved as user default');
    expect(readUserConfig().config.voice).toBe('moss');
    expect(voiceByName('moss')).toBeTruthy();
  });
});
