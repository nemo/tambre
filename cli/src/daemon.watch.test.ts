import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDaemon, type DaemonHandle } from './daemon.js';
import { sendHook, status } from './client.js';
import { saveUserConfig, userConfigPath, projectConfigPath } from './config.js';
import { voiceByName } from './palette.js';
import type { HookMessage, StatusReply } from './ipc.js';

// The daemon watches each live session's tambre.json and the user config and
// applies voice, texture, volume and mute changes to the running session.
// Debounce and poll intervals are shortened so a change lands in well under
// a second; waitFor polls status rather than sleeping a fixed time.

let dir: string;
let project: string;
let socket: string;
let daemon: DaemonHandle | null = null;
const savedEnv = { home: process.env.TAMBRE_HOME, debounce: process.env.TAMBRE_WATCH_DEBOUNCE_MS, poll: process.env.TAMBRE_WATCH_POLL_MS };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opts = () => ({ socket, timeoutMs: 1000 });

const hook = (m: Partial<HookMessage> & { event: HookMessage['event']; sessionId: string }): Promise<boolean> =>
  sendHook({ agent: 'claude-code', cwd: project, projectRoot: project, ...m }, opts());

const stat = async (): Promise<StatusReply> => {
  const s = await status(opts());
  if (!s) throw new Error('daemon did not answer status');
  return s;
};

/** Poll status until `pred` holds, or fail after ~3 s with the last reply. */
const waitFor = async (pred: (s: StatusReply) => boolean, what: string): Promise<StatusReply> => {
  let last: StatusReply | null = null;
  for (let i = 0; i < 60; i++) {
    last = await stat();
    if (pred(last)) return last;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what}; last status ${JSON.stringify(last)}`);
};

const writeProject = (obj: unknown) => fs.writeFileSync(projectConfigPath(project), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));

beforeEach(async () => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tambre-w-')));
  project = path.join(dir, 'proj');
  fs.mkdirSync(project);
  socket = path.join(dir, 'd.sock');
  process.env.TAMBRE_HOME = path.join(dir, 'home');
  process.env.TAMBRE_WATCH_DEBOUNCE_MS = '20';
  process.env.TAMBRE_WATCH_POLL_MS = '50';
  daemon = await runDaemon({ socket, exit: false, endTail: 0.1, emptyExitMs: 60_000 });
});

afterEach(async () => {
  await daemon?.close();
  daemon = null;
  process.env.TAMBRE_HOME = savedEnv.home;
  process.env.TAMBRE_WATCH_DEBOUNCE_MS = savedEnv.debounce;
  process.env.TAMBRE_WATCH_POLL_MS = savedEnv.poll;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('hot reload of project config', () => {
  it('applies a new voice and texture written to tambre.json while the session is live', async () => {
    writeProject({ voice: 'moss', texture: 'hush' });
    await hook({ event: 'session.start', sessionId: 'a', voiceSpec: voiceByName('moss')!, texture: 'hush' });
    const before = await waitFor((s) => s.sessions.length === 1, 'session');
    expect(before.sessions[0].voice).toBe('moss');
    expect(daemon!.watched()).toEqual([projectConfigPath(project), userConfigPath()].sort());

    writeProject({ voice: 'brass', texture: 'rain' });
    const after = await waitFor((s) => s.sessions[0]?.voice === 'brass' && s.sessions[0]?.texture === 'rain', 'brass/rain');
    expect(after.sessions[0].state).toBe('working');
    expect(daemon!.engine.session('a')!.voice.name).toBe('brass');
    expect(daemon!.engine.session('a')!.texture).toBe('rain');
  });

  it('falls back to the user default voice when tambre.json is deleted', async () => {
    saveUserConfig({ voice: 'felt' });
    writeProject({ voice: 'cedar' });
    await hook({ event: 'session.start', sessionId: 'a', voiceSpec: voiceByName('cedar')! });
    await waitFor((s) => s.sessions[0]?.voice === 'cedar', 'cedar');

    fs.unlinkSync(projectConfigPath(project));
    await waitFor((s) => s.sessions[0]?.voice === 'felt', 'fallback to felt');
  });

  it('does not steal a voice another live session is playing when falling back', async () => {
    saveUserConfig({ voice: 'moss' });
    const other = path.join(dir, 'other');
    fs.mkdirSync(other);
    fs.writeFileSync(projectConfigPath(other), JSON.stringify({ voice: 'moss' }));
    writeProject({ voice: 'cedar' });
    await hook({ event: 'session.start', sessionId: 'b', cwd: other, projectRoot: other, voiceSpec: voiceByName('moss')! });
    await hook({ event: 'session.start', sessionId: 'a', voiceSpec: voiceByName('cedar')! });
    await waitFor((s) => s.sessions.length === 2, 'two sessions');

    fs.unlinkSync(projectConfigPath(project));
    // The user default (moss) is taken by b, so a keeps cedar: a free voice it already plays.
    await sleep(400);
    const s = await stat();
    expect(s.sessions.find((x) => x.id === 'a')!.voice).toBe('cedar');
    expect(s.sessions.find((x) => x.id === 'b')!.voice).toBe('moss');
  });

  it('leaves the session unchanged on a malformed tambre.json and keeps the daemon alive', async () => {
    writeProject({ voice: 'brass', texture: 'rain' });
    await hook({ event: 'session.start', sessionId: 'a', voiceSpec: voiceByName('brass')!, texture: 'rain' });
    await waitFor((s) => s.sessions[0]?.voice === 'brass', 'brass');

    writeProject('{ "voice": "cedar", ');
    await sleep(400);
    const s = await stat();
    expect(s.sessions[0].voice).toBe('brass');
    expect(s.sessions[0].texture).toBe('rain');

    // A valid write after the broken one applies.
    writeProject({ voice: 'cedar', texture: 'pulse' });
    await waitFor((x) => x.sessions[0]?.voice === 'cedar' && x.sessions[0]?.texture === 'pulse', 'cedar/pulse');
  });

  it('stops watching when the last session of a project ends', async () => {
    writeProject({ voice: 'moss' });
    await hook({ event: 'session.start', sessionId: 'a', voiceSpec: voiceByName('moss')! });
    await waitFor((s) => s.sessions.length === 1, 'session');
    expect(daemon!.watched().length).toBe(2);
    await hook({ event: 'session.end', sessionId: 'a' });
    await waitFor((s) => s.sessions.length === 0, 'no sessions');
    expect(daemon!.watched()).toEqual([]);
  });
});

describe('hot reload of user config', () => {
  it('applies volume and mute changes from config.json', async () => {
    writeProject({ voice: 'moss' });
    await hook({ event: 'session.start', sessionId: 'a', voiceSpec: voiceByName('moss')! });
    await waitFor((s) => s.sessions.length === 1, 'session');

    saveUserConfig({ volume: 0.35 });
    await waitFor((s) => Math.abs(s.volume - 0.35) < 1e-9, 'volume 0.35');
    saveUserConfig({ mute: true });
    await waitFor((s) => s.mute === true, 'mute');
    expect(daemon!.engine.mute).toBe(true);
  });

  it('ignores a changed frame proposal while sessions are live', async () => {
    writeProject({ voice: 'moss', frame: { root: 43 } });
    await hook({ event: 'session.start', sessionId: 'a', voiceSpec: voiceByName('moss')!, frame: { root: 43 } });
    await waitFor((s) => s.sessions.length === 1, 'session');
    const rootBefore = (await stat()).frame.root;

    writeProject({ voice: 'moss', frame: { root: 38 } });
    await sleep(400);
    expect((await stat()).frame.root).toBe(rootBefore);
  });
});
