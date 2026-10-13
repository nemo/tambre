import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runDaemon, nextState, type DaemonHandle } from './daemon.js';
import { send, sendHook, status } from './client.js';
import { readPidFile, pidAlive, type HookMessage, type StatusReply } from './ipc.js';
import { loadUserConfig, saveUserConfig } from './config.js';
import { voiceByName } from './palette.js';
import { DEFAULT_FRAME } from './engine/types.js';
import { spawn } from 'node:child_process';

// vitest.config.ts sets TAMBRE_NO_AUDIO=1: the engine runs on a stub context.
// Each test gets its own socket, home directory and daemon so the lifecycle
// cases (exit, frame release, persistence) cannot bleed into each other.

let dir: string;
let socket: string;
let daemon: DaemonHandle | null = null;
const savedHome = process.env.TAMBRE_HOME;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opts = () => ({ socket, timeoutMs: 1000 });

const hook = (m: Partial<HookMessage> & { event: HookMessage['event']; sessionId: string }): Promise<boolean> =>
  sendHook({ agent: 'claude-code', cwd: dir, ...m }, opts());

const stat = async (): Promise<StatusReply> => {
  const s = await status(opts());
  if (!s) throw new Error('daemon did not answer status');
  return s;
};

const start = async (extra: Parameters<typeof runDaemon>[0] = {}) => {
  daemon = await runDaemon({ socket, exit: false, endTail: 0.1, emptyExitMs: 60_000, ...extra });
  return daemon;
};

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tambre-l-')));
  socket = path.join(dir, 'd.sock');
  process.env.TAMBRE_HOME = path.join(dir, 'home');
});

afterEach(async () => {
  await daemon?.close();
  daemon = null;
  process.env.TAMBRE_HOME = savedHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('blocked dedupe', () => {
  it('permission.request pings once per block; repeats while blocked are ignored', async () => {
    const d = await start();
    await hook({ event: 'session.start', sessionId: 'a', voiceSpec: voiceByName('moss')! });
    await sleep(30);
    const sv = d.engine.session('a')!;
    const after = sv.oneShots; // the start roll

    await hook({ event: 'permission.request', sessionId: 'a' });
    await sleep(30);
    expect(sv.state).toBe('blocked');
    expect(sv.oneShots).toBe(after + 1);

    // Same source again, and the Notification mirror of it: still blocked, no new ping.
    await hook({ event: 'permission.request', sessionId: 'a' });
    await hook({ event: 'permission.request', sessionId: 'a' });
    await sleep(30);
    expect(sv.oneShots).toBe(after + 1);
    expect((await stat()).sessions[0].state).toBe('blocked');

    // Leaving the block and asking again pings again.
    await hook({ event: 'activity', sessionId: 'a' });
    await sleep(30);
    expect(sv.state).toBe('working');
    await sleep(2100); // past the 2 s source dedupe window
    await hook({ event: 'permission.request', sessionId: 'a' });
    await sleep(30);
    expect(sv.state).toBe('blocked');
    expect(sv.oneShots).toBe(after + 2);
  });

  it('blocks are per session', async () => {
    const d = await start();
    await hook({ event: 'session.start', sessionId: 'a' });
    await hook({ event: 'session.start', sessionId: 'b' });
    await sleep(30);
    await hook({ event: 'permission.request', sessionId: 'a' });
    await sleep(30);
    expect(d.engine.session('a')!.state).toBe('blocked');
    expect(d.engine.session('b')!.state).toBe('working');
    const bBefore = d.engine.session('b')!.oneShots;
    await hook({ event: 'permission.request', sessionId: 'b' });
    await sleep(30);
    expect(d.engine.session('b')!.state).toBe('blocked');
    expect(d.engine.session('b')!.oneShots).toBe(bBefore + 1);
  });

  it('nextState mirrors the engine transitions', () => {
    expect(nextState('working', 'permission.request')).toBe('blocked');
    expect(nextState('blocked', 'activity')).toBe('working');
    expect(nextState('working', 'turn.end')).toBe('waiting');
    expect(nextState('blocked', 'compact')).toBe('blocked');
    expect(nextState('waiting', 'session.end')).toBe('ended');
  });
});

describe('preview sessions', () => {
  it('never keep an idle daemon alive', async () => {
    await start({ emptyExitMs: 300 });
    const voice = voiceByName('wire')!;
    expect(await send({ cmd: 'preview', what: 'event', name: 'turn.end', voice, texture: 'drone' }, opts())).toEqual({ ok: true });
    expect(daemon!.engine.sessionCount).toBe(1);
    expect(daemon!.engine.realSessionCount).toBe(0);
    expect(daemon!.engine.isPreview('__preview__')).toBe(true);
    expect((await stat()).sessions).toEqual([]);
    // The status poll re-armed the timer; from here nothing talks to it.
    await sleep(1200);
    expect(await status({ socket, timeoutMs: 200 })).toBeNull();
    expect(fs.existsSync(socket)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'd.pid'))).toBe(false);
  });

  it('sit on rung 6 or above every real session and never lock the frame', async () => {
    const d = await start();
    const voice = voiceByName('glass')!;
    await send({ cmd: 'preview', what: 'state', name: 'working', voice, texture: 'hush' }, opts());
    expect(d.engine.session('__preview__')!.rung).toBe(6);
    expect(d.engine.frameLocked).toBe(false);
    expect(d.engine.setFrame({ ...DEFAULT_FRAME, root: 45 })).toBe(true);

    for (const id of ['a', 'b', 'c', 'e']) await hook({ event: 'session.start', sessionId: id });
    await sleep(30);
    expect(d.engine.session('a')!.rung).toBe(0);
    expect(d.engine.session('c')!.rung).toBe(4);
    expect(d.engine.session('e')!.rung).toBe(8); // rungs are never shared: 6 is the live preview's
    expect(d.engine.frameLocked).toBe(true);
    // Re-auditioning after the 10 s cleanup lands above every real voice.
    d.engine.removeSession('__preview__');
    await send({ cmd: 'preview', what: 'state', name: 'working', voice, texture: 'hush' }, opts());
    expect(d.engine.session('__preview__')!.rung).toBe(10);
    expect(d.engine.realSessionCount).toBe(4);
  });
});

describe('frame lock and release', () => {
  const proposal = { ...DEFAULT_FRAME, root: 45, bpm: 72 };

  it('the first real session sets the frame, later ones cannot, the last end releases it', async () => {
    await start();
    expect((await stat()).frame.root).toBe(43);

    await hook({ event: 'session.start', sessionId: 'a', frame: proposal });
    await sleep(30);
    expect((await stat()).frame.root).toBe(45);

    await hook({ event: 'session.start', sessionId: 'b', frame: { ...DEFAULT_FRAME, root: 40 } });
    await sleep(30);
    expect((await stat()).frame.root).toBe(45);

    await hook({ event: 'session.end', sessionId: 'a' });
    await sleep(30);
    expect((await stat()).frame.root).toBe(45); // b still holds it
    expect(daemon!.engine.frameLocked).toBe(true);

    await hook({ event: 'session.end', sessionId: 'b' });
    await sleep(30);
    expect(daemon!.engine.frameLocked).toBe(false);

    // A new first session without a proposal falls back to the user frame.
    await hook({ event: 'session.start', sessionId: 'c' });
    await sleep(30);
    expect((await stat()).frame.root).toBe(43);
  });

  it('uses the user frame from config when the first session proposes none', async () => {
    saveUserConfig({ frame: { ...DEFAULT_FRAME, root: 41 } });
    await start();
    await hook({ event: 'session.start', sessionId: 'a' });
    await sleep(30);
    expect((await stat()).frame.root).toBe(41);
    // Config edits made while sessions run apply to the next first session.
    saveUserConfig({ frame: { ...DEFAULT_FRAME, root: 48 } });
    await hook({ event: 'session.end', sessionId: 'a' });
    await hook({ event: 'session.start', sessionId: 'b' });
    await sleep(30);
    expect((await stat()).frame.root).toBe(48);
  });

  it('releases the frame when the agent pid dies', async () => {
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    await start({ pidGraceMs: 0 });
    await hook({ event: 'session.start', sessionId: 'a', pid: dead, frame: proposal });
    await sleep(30);
    expect(daemon!.engine.frameLocked).toBe(true);
    await sleep(2200); // one pid poll
    expect((await stat()).sessions).toEqual([]);
    expect(daemon!.engine.frameLocked).toBe(false);
  });

  it('a pid that dies within the grace window was a wrapper shell: dropped, and the session lives on', async () => {
    const shell = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { stdio: 'ignore' });
    await start({ pidGraceMs: 5000 });
    await hook({ event: 'session.start', sessionId: 'a', pid: shell.pid });
    await sleep(30);
    expect((await stat()).sessions[0].pid).toBe(shell.pid);
    await sleep(2500); // the "shell" exited at 300 ms; one pid poll has run
    const s = await stat();
    expect(s.sessions.map((x) => x.id)).toEqual(['a']);
    expect(s.sessions[0].pid).toBeUndefined();
    // a later hook may supply the real pid, which is then watched normally
    await hook({ event: 'activity', sessionId: 'a', pid: process.pid });
    await sleep(30);
    expect((await stat()).sessions[0].pid).toBe(process.pid);
  });
});

describe('idle exit', () => {
  it('a session.end for a session the daemon never saw does not disarm the idle exit', async () => {
    await start({ emptyExitMs: 400 });
    await hook({ event: 'session.end', sessionId: 'ghost' });
    await sleep(1200);
    expect(await status({ socket, timeoutMs: 200 })).toBeNull();
    expect(fs.existsSync(socket)).toBe(false);
    daemon = null;
  });
});

describe('input validation at the socket', () => {
  it('a malformed frame in a hook message is ignored and the session still starts', async () => {
    const d = await start();
    await hook({ event: 'session.start', sessionId: 'x', frame: {} as never, pid: 'nope' as never, texture: 'loud' as never });
    await sleep(30);
    const s = await stat();
    expect(s.sessions.map((x) => x.id)).toEqual(['x']);
    expect(s.sessions[0].pid).toBeUndefined();
    expect(s.sessions[0].texture).toBe('hush');
    expect(s.frame).toEqual(DEFAULT_FRAME);
    expect(d.engine.harmony.chordSeconds()).toBe(16);
    // a partial frame fills from the user frame, never from built-in defaults
    await hook({ event: 'session.end', sessionId: 'x' });
    saveUserConfig({ frame: { ...DEFAULT_FRAME, bpm: 90 } });
    await hook({ event: 'session.start', sessionId: 'y', frame: { root: 45 } as never });
    await sleep(30);
    expect((await stat()).frame).toEqual({ ...DEFAULT_FRAME, root: 45, bpm: 90 });
    expect(await hook({ event: 'session.start', sessionId: '' })).toBe(true); // dropped silently
    expect((await stat()).sessions.map((x) => x.id)).toEqual(['y']);
  });

  it('set and preview reject an unknown texture and a malformed voice with ok:false', async () => {
    const d = await start();
    await hook({ event: 'session.start', sessionId: 'a' });
    await sleep(30);
    let r = await send({ cmd: 'set', session: 'a', texture: 'loud' as never }, opts());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/texture/);
    expect((await stat()).sessions[0].texture).toBe('hush');
    expect(d.engine.session('a')!.texture).toBe('hush');
    r = await send({ cmd: 'set', session: 'a', voice: { timbre: 1 } as never }, opts());
    expect(r.ok).toBe(false);
    // out-of-range fields on an otherwise valid voice are clamped, not passed through
    r = await send({ cmd: 'set', session: 'a', voice: { ...voiceByName('glass')!, timbre: 9, bell: 'purple' } as never }, opts());
    expect(r.ok).toBe(true);
    expect(d.engine.session('a')!.voice.timbre).toBe(1);
    expect(d.engine.session('a')!.voice.bell).toBe(voiceByName('glass')!.bell);

    r = await send({ cmd: 'preview', what: 'state', name: 'working', voice: voiceByName('wire')!, texture: 'bogus' as never }, opts());
    expect(r.ok).toBe(false);
    expect(d.engine.session('__preview__')).toBeUndefined();
    r = await send({ cmd: 'preview', what: 'state', name: 'working', voice: 'nope' as never, texture: 'hush' }, opts());
    expect(r.ok).toBe(false);
    r = await send({ cmd: 'preview', what: 'state', name: 'working', voice: { ...voiceByName('wire')!, timbre: 9 }, texture: 'hush' }, opts());
    expect(r.ok).toBe(true);
    expect(d.engine.session('__preview__')!.voice.timbre).toBe(1);
  });
});

describe('adopting a session from a later event', () => {
  it('resolves voice, texture, frame and root from the project when the start was never seen', async () => {
    const project = path.join(dir, 'proj');
    fs.mkdirSync(path.join(project, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(project, 'tambre.json'), JSON.stringify({ voice: 'glass', texture: 'rain', frame: { root: 45 } }));
    await start();
    // the hook sends a bare message for anything but a start: cwd and pid only
    await hook({ event: 'working', sessionId: 'late', cwd: path.join(project, 'sub'), pid: process.pid });
    await sleep(50);
    const s = await stat();
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]).toMatchObject({ id: 'late', voice: 'glass', texture: 'rain', projectRoot: project, pid: process.pid, state: 'working' });
    expect(s.frame.root).toBe(45);
    // mute --here from the root reaches it
    await send({ cmd: 'mute', scope: { project: project }, value: true }, opts());
    expect((await stat()).sessions[0].muted).toBe(true);
  });

  it('outside any project a late session still gets a free palette voice', async () => {
    await start();
    await hook({ event: 'session.start', sessionId: 'a', cwd: dir });
    await hook({ event: 'activity', sessionId: 'b', cwd: dir });
    await sleep(50);
    const s = await stat();
    expect(s.sessions.map((x) => x.voice)).toEqual(['moss', 'brass']);
  });
});

describe('mute scopes', () => {
  it('session, project and all each reach the engine with a fade', async () => {
    const d = await start();
    await hook({ event: 'session.start', sessionId: 'a', projectRoot: '/p/one' });
    await hook({ event: 'session.start', sessionId: 'b', projectRoot: '/p/one/' });
    await hook({ event: 'session.start', sessionId: 'c', projectRoot: '/p/two' });
    await sleep(30);
    const sv = (id: string) => d.engine.session(id)!;

    await send({ cmd: 'mute', scope: { session: 'a' }, value: true }, opts());
    expect(sv('a').muted).toBe(true);
    expect(sv('b').muted).toBe(false);

    await send({ cmd: 'mute', scope: { project: '/p/one' }, value: true }, opts());
    expect(sv('b').muted).toBe(true); // trailing slash normalised
    expect(sv('c').muted).toBe(false);
    await send({ cmd: 'mute', scope: { project: '/p/one' }, value: false }, opts());
    expect(sv('a').muted).toBe(false);
    expect(sv('b').muted).toBe(false);

    await send({ cmd: 'mute', scope: 'all', value: true }, opts());
    expect(d.engine.mute).toBe(true);
    const s = await stat();
    expect(s.mute).toBe(true);
    expect(s.sessions.every((x) => !x.muted)).toBe(true); // per-session flags untouched
    expect((await send({ cmd: 'mute', scope: { project: '' }, value: true }, opts())).ok).toBe(false);
  });

  it('global mute and volume persist to the user config and come back on restart', async () => {
    await start();
    await send({ cmd: 'mute', scope: 'all', value: true }, opts());
    await send({ cmd: 'volume', value: 0.25 }, opts());
    expect(loadUserConfig().mute).toBe(true);
    expect(loadUserConfig().volume).toBeCloseTo(0.25);
    await daemon!.close();

    await start();
    const s = await stat();
    expect(s.mute).toBe(true);
    expect(s.volume).toBeCloseTo(0.25);
  });
});

describe('frame control', () => {
  it('applies a frame while no real session is live, and refuses one while any is', async () => {
    const d = await start();
    const ok = await send({ cmd: 'frame', frame: { root: 45, bpm: 66 } }, opts());
    expect(ok).toEqual({ ok: true });
    expect(d.engine.frame.root).toBe(45);
    expect(d.engine.frame.bpm).toBe(66);
    expect((await stat()).frame.root).toBe(45);

    await hook({ event: 'session.start', sessionId: 'a', voiceSpec: voiceByName('moss')! });
    await sleep(30);
    const refused = await send({ cmd: 'frame', frame: { root: 40 } }, opts());
    expect(refused.ok).toBe(false);
    expect((refused as { error: string }).error).toContain('locked');
    expect(d.engine.frame.root).not.toBe(40);

    await hook({ event: 'session.end', sessionId: 'a' });
    await sleep(250);
    expect(await send({ cmd: 'frame', frame: { root: 40 } }, opts())).toEqual({ ok: true });
    expect(d.engine.frame.root).toBe(40);
  });

  it('rejects a frame that is not an object', async () => {
    await start();
    const r = await send({ cmd: 'frame', frame: 'nope' as never }, opts());
    expect(r.ok).toBe(false);
  });
});

describe('stale socket and pid recovery', () => {
  it('takes over a dead socket file and a pid file naming a dead process', async () => {
    const dead = spawnSync(process.execPath, ['-e', '0']).pid!;
    expect(pidAlive(dead)).toBe(false);
    fs.writeFileSync(socket, ''); // what a SIGKILLed daemon leaves behind
    fs.writeFileSync(path.join(dir, 'd.pid'), `${dead}\n`);
    expect(readPidFile(path.join(dir, 'd.pid'))).toBe(dead);

    await start();
    expect((await stat()).sessions).toEqual([]);
    expect(readPidFile(path.join(dir, 'd.pid'))).toBe(process.pid);
  });

  it('refuses to start beside a live daemon', async () => {
    await start();
    await expect(runDaemon({ socket, exit: false, endTail: 0.1 })).rejects.toThrow(/already listening/);
    expect((await stat()).ok).toBe(true);
  });

  it('close is idempotent', async () => {
    const d = await start();
    await d.close();
    await d.close();
    expect(await status({ socket, timeoutMs: 200 })).toBeNull();
  });
});
