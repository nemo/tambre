import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'ink-testing-library';
import { App, type TuiClient } from './App.js';
import type { ControlMessage, StatusReply } from '../ipc.js';
import { DEFAULT_FRAME } from '../engine/types.js';
import { readUserConfig, readProjectConfig } from '../config.js';
import { voiceByName } from '../palette.js';

// vitest.config.ts sets TAMBRE_NO_AUDIO=1; the TUI never touches the engine anyway.

let home: string;
let cwd: string;
const savedHome = process.env.TAMBRE_HOME;

const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

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

/** A client that records what the TUI sends and answers ok. */
function fakeClient(status: StatusReply | null = STATUS): TuiClient & { sent: ControlMessage[] } {
  const sent: ControlMessage[] = [];
  return {
    sent,
    status: async () => status,
    send: async (msg) => { sent.push(msg); return { ok: true }; },
  };
}

const mount = (client: TuiClient, dir = cwd) =>
  render(<App client={client} cwd={dir} initialStatus={STATUS} pollMs={60_000} />);

beforeEach(() => {
  home = tmp('tambre-tui-home-');
  cwd = tmp('tambre-tui-cwd-');
  process.env.TAMBRE_HOME = home;
});

afterEach(() => {
  process.env.TAMBRE_HOME = savedHome;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe('initial render', () => {
  it('shows the palette, the default voice sliders and the live sessions', async () => {
    const r = mount(fakeClient());
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('tambre');
    expect(frame).toContain('daemon ok');
    for (const name of ['moss', 'brass', 'cedar', 'glass', 'reed', 'tide', 'wire', 'felt']) expect(frame).toContain(name);
    // the user default voice (moss) is loaded and its timbre is shown
    expect(frame).toContain('> timbre');
    expect(frame).toContain('0.05');
    expect(frame).toContain('texture');
    expect(frame).toContain('hush');
    // sessions: voice, project basename, state, muted
    expect(frame).toContain('alpha');
    expect(frame).toContain('beta');
    expect(frame).toContain('working');
    expect(frame).toContain('blocked');
    expect(frame).toContain('muted');
    r.unmount();
  });

  it('starts from the project voice when cwd has a tambre.json', async () => {
    fs.writeFileSync(path.join(cwd, 'tambre.json'), JSON.stringify({ voice: 'wire', texture: 'pulse' }));
    const r = mount(fakeClient());
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('*wire');
    expect(frame).toContain('pulse');
    r.unmount();
  });
});

describe('sliders', () => {
  it('l raises the focused slider by one step and h lowers it', async () => {
    const r = mount(fakeClient());
    await tick();
    r.stdin.write('l');
    await tick();
    expect(r.lastFrame()).toContain('0.10');
    r.stdin.write('h');
    await tick();
    expect(r.lastFrame()).toContain('0.05');
    r.unmount();
  });

  it('Tab moves focus and the texture slider cycles through the modes', async () => {
    const r = mount(fakeClient());
    await tick();
    // texture is the 9th main macro; Shift-Tab from the first wraps to it
    r.stdin.write('\u001B[Z');
    await tick();
    expect(r.lastFrame()).toContain('> texture');
    r.stdin.write('l');
    await tick();
    expect(r.lastFrame()).toMatch(/texture\s+< none/);
    r.stdin.write('l');
    await tick();
    expect(r.lastFrame()).toMatch(/texture\s+< drone/);
    r.unmount();
  });

  it('a toggles the advanced page', async () => {
    const r = mount(fakeClient());
    await tick();
    r.stdin.write('a');
    await tick();
    const frame = r.lastFrame() ?? '';
    expect(frame).toContain('> attack');
    expect(frame).toContain('fm ratio');
    expect(frame).toContain('stored only');
    r.stdin.write('l');
    await tick();
    expect(r.lastFrame()).toContain('0.40'); // attack fallback 0.35 + 0.05
    r.unmount();
  });
});

describe('daemon commands', () => {
  it('2 previews turn.end with the edited voice and texture', async () => {
    const client = fakeClient();
    const r = mount(client);
    await tick();
    r.stdin.write('l'); // timbre 0.05 -> 0.10 so the preview carries an edit
    await tick();
    r.stdin.write('2');
    await tick();
    expect(client.sent).toHaveLength(1);
    const msg = client.sent[0];
    expect(msg.cmd).toBe('preview');
    if (msg.cmd !== 'preview') throw new Error('unreachable');
    expect(msg.what).toBe('event');
    expect(msg.name).toBe('turn.end');
    expect(msg.texture).toBe('hush');
    expect(msg.voice.name).toBe('moss');
    expect(msg.voice.timbre).toBeCloseTo(0.10);
    expect(r.lastFrame()).toContain('preview turn.end');
    r.unmount();
  });

  it('w previews the working state', async () => {
    const client = fakeClient();
    const r = mount(client);
    await tick();
    r.stdin.write('w');
    await tick();
    expect(client.sent[0]).toMatchObject({ cmd: 'preview', what: 'state', name: 'working' });
    r.unmount();
  });

  it('m mutes the highlighted session, M mutes all, + raises the volume', async () => {
    const client = fakeClient();
    const r = mount(client);
    await tick();
    r.stdin.write('m');
    await tick();
    expect(client.sent[0]).toEqual({ cmd: 'mute', scope: { session: 's1' }, value: true });
    r.stdin.write('J');
    await tick();
    r.stdin.write('m');
    await tick();
    expect(client.sent[1]).toEqual({ cmd: 'mute', scope: { session: 's2' }, value: false });
    r.stdin.write('M');
    await tick();
    expect(client.sent[2]).toEqual({ cmd: 'mute', scope: 'all', value: true });
    r.stdin.write('+');
    await tick();
    expect(client.sent[3]).toEqual({ cmd: 'volume', value: 0.85 });
    r.unmount();
  });

  it('p pushes the edited voice and texture to the highlighted session', async () => {
    const client = fakeClient();
    const r = mount(client);
    await tick();
    r.stdin.write('p');
    await tick();
    expect(client.sent[0]).toMatchObject({ cmd: 'set', session: 's1', texture: 'hush' });
    r.unmount();
  });
});

describe('saving', () => {
  it('s outside a project writes the user default voice and texture', async () => {
    const r = mount(fakeClient());
    await tick();
    r.stdin.write('\u001B[Z'); // focus texture
    await tick();
    r.stdin.write('h'); // hush -> hum
    await tick();
    r.stdin.write('s');
    await tick();
    expect(r.lastFrame()).toContain('saved as user default');
    const user = readUserConfig();
    expect(user.warnings).toEqual([]);
    expect(user.config.voice).toBe('moss'); // untouched palette voice is saved by name
    expect(user.config.texture).toBe('hum');
    r.unmount();
  });

  it('s inside a project writes tambre.json and records the assignment', async () => {
    fs.writeFileSync(path.join(cwd, 'tambre.json'), JSON.stringify({ voice: 'cedar', frame: { root: 45 } }));
    const r = mount(fakeClient());
    await tick();
    r.stdin.write('l'); // cedar timbre 0.20 -> 0.25: now a custom voice
    await tick();
    r.stdin.write('s');
    await tick();
    expect(r.lastFrame()).toContain('saved');
    const proj = readProjectConfig(cwd);
    expect(proj.warnings).toEqual([]);
    expect(proj.config.frame?.root).toBe(45); // kept
    expect(proj.config.texture).toBe('hush');
    expect(proj.config.voice).toMatchObject({ name: 'cedar', timbre: 0.25 });
    r.unmount();
  });

  it('Enter loads a palette voice; S prompts for a name and saves a patch that then appears in the list', async () => {
    const r = mount(fakeClient());
    await tick();
    r.stdin.write('j'); // moss -> brass
    await tick();
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame()).toContain('loaded palette brass');
    r.stdin.write('S');
    await tick();
    expect(r.lastFrame()).toContain('patch name:');
    for (const ch of 'warm') { r.stdin.write(ch); await tick(5); }
    r.stdin.write('\r');
    await tick();
    expect(r.lastFrame()).toContain('saved patch "warm"');
    expect(r.lastFrame()).toContain('warm');
    const user = readUserConfig();
    expect(user.warnings).toEqual([]);
    expect(user.config.patches.warm?.voice).toEqual(voiceByName('brass'));
    expect(user.config.patches.warm?.texture).toBe('hush');
    r.unmount();
  });
});
