import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The device is mocked here: one test holds the open until a hook has
 * arrived (the cold-start race), the other makes it fail outright.
 */
let gate: { resolve: () => void; reject: (e: Error) => void } | null = null;
let mode: 'gate' | 'fail' = 'gate';

vi.mock('./engine/context.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./engine/context.js')>();
  return {
    ...real,
    createAudioContext: async () => {
      if (mode === 'fail') throw new Error('no audio addon on this host');
      await new Promise<void>((resolve, reject) => { gate = { resolve, reject }; });
      // after the gate opens, build the usual stub
      process.env.TAMBRE_NO_AUDIO = '1';
      return real.createAudioContext();
    },
  };
});

const { runDaemon } = await import('./daemon.js');
const { send, sendHook, status } = await import('./client.js');

let dir: string;
let socket: string;
const savedHome = process.env.TAMBRE_HOME;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const opts = () => ({ socket, timeoutMs: 1000 });

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tambre-s-')));
  socket = path.join(dir, 'd.sock');
  process.env.TAMBRE_HOME = path.join(dir, 'home');
  gate = null;
});

afterEach(() => {
  process.env.TAMBRE_HOME = savedHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('daemon start', () => {
  it('a session.start that arrives while the device is still opening is kept, with its project frame', async () => {
    mode = 'gate';
    const starting = runDaemon({ socket, exit: false, endTail: 0.1, emptyExitMs: 60_000 });
    // the socket is bound before the device opens; wait for it
    for (let i = 0; i < 100 && !(await status({ socket, timeoutMs: 100 })); i++) await sleep(20);
    expect(gate).not.toBeNull();
    const s0 = await status(opts());
    expect(s0?.sessions).toEqual([]);
    await sendHook({ event: 'session.start', sessionId: 'first', agent: 'claude-code', cwd: dir, pid: process.pid, frame: { root: 45, voicings: [[0, 7]], bpm: 60, chordBars: 4 } }, opts());
    await sendHook({ event: 'activity', sessionId: 'first', agent: 'claude-code', cwd: dir }, opts());
    await sleep(50);
    gate!.resolve();
    const d = await starting;
    await sleep(50);
    const s = await status(opts());
    expect(s?.sessions.map((x) => x.id)).toEqual(['first']);
    expect(s?.sessions[0].pid).toBe(process.pid);
    expect(s?.frame.root).toBe(45);
    expect(d.engine.isStarted).toBe(true);
    expect(d.engine.session('first')?.state).toBe('working');
    await d.close();
  });

  it('when the device cannot open, the table still works, preview says so, and close resolves', async () => {
    mode = 'fail';
    const d = await runDaemon({ socket, exit: false, endTail: 0.1, emptyExitMs: 60_000 });
    expect(d.engine.isStarted).toBe(false);
    await sendHook({ event: 'session.start', sessionId: 'a', agent: 'claude-code', cwd: dir, pid: process.pid, frame: { root: 45, voicings: [[0, 7]], bpm: 60, chordBars: 4 } }, opts());
    await sendHook({ event: 'permission.request', sessionId: 'a', agent: 'claude-code', cwd: dir }, opts());
    await sleep(50);
    const s = await status(opts());
    expect(s?.sessions).toHaveLength(1);
    expect(s?.sessions[0]).toMatchObject({ id: 'a', state: 'blocked', pid: process.pid });
    expect(s?.frame.root).toBe(45);
    const r = await send({ cmd: 'preview', what: 'state', name: 'working', voice: 'moss' as never, texture: 'hush' }, opts());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/audio device/);
    await sendHook({ event: 'session.end', sessionId: 'a', agent: 'claude-code', cwd: dir }, opts());
    await sleep(30);
    expect((await status(opts()))?.sessions).toEqual([]);
    await expect(d.close()).resolves.toBeUndefined();
    expect(await status({ socket, timeoutMs: 200 })).toBeNull();
  });
});
