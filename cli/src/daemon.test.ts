import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDaemon, type DaemonHandle } from './daemon.js';
import { send, sendHook, status } from './client.js';
import { isStatusReply, type HookMessage, type StatusReply } from './ipc.js';
import { voiceByName } from './palette.js';

// vitest.config.ts sets TAMBRE_NO_AUDIO=1, so the engine opens a stub context
// and the native addon is never loaded.

let dir: string;
let socket: string;
let daemon: DaemonHandle;
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

beforeAll(async () => {
  expect(process.env.TAMBRE_NO_AUDIO).toBe('1');
  // Unix socket paths are short (104 bytes on macOS); keep this one in os.tmpdir().
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tambre-d-')));
  socket = path.join(dir, 'd.sock');
  process.env.TAMBRE_HOME = path.join(dir, 'home');
  daemon = await runDaemon({ socket, exit: false, endTail: 0.1, emptyExitMs: 60_000 });
});

afterAll(async () => {
  await daemon?.close();
  process.env.TAMBRE_HOME = savedHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('daemon control protocol', () => {
  it('answers status with no sessions and config defaults', async () => {
    const s = await stat();
    expect(s.ok).toBe(true);
    expect(s.sessions).toEqual([]);
    expect(s.frame.root).toBe(43);
    expect(s.volume).toBe(0.8);
    expect(s.mute).toBe(false);
    expect(fs.existsSync(path.join(dir, 'd.pid'))).toBe(true);
  });

  it('session.start with a voiceSpec and texture shows up in status with the right shape', async () => {
    const voice = { ...voiceByName('glass')!, name: 'custom-glass' };
    await hook({ event: 'session.start', sessionId: 's1', pid: process.pid, voiceSpec: voice, texture: 'rain', projectRoot: '/proj/one' });
    await sleep(50);
    const s = await stat();
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]).toEqual({
      id: 's1',
      agent: 'claude-code',
      projectRoot: '/proj/one',
      voice: 'custom-glass',
      texture: 'rain',
      state: 'working',
      muted: false,
      pid: process.pid,
    });
  });

  it('a second session without a voiceSpec gets an unused palette voice and the default texture', async () => {
    await hook({ event: 'session.start', sessionId: 's2', projectRoot: '/proj/two' });
    await sleep(50);
    const s = await stat();
    const s2 = s.sessions.find((x) => x.id === 's2');
    expect(s2?.voice).toBe('moss');
    expect(s2?.texture).toBe('hush');
    expect(s2?.pid).toBeUndefined();
  });

  it('events move the session state', async () => {
    await hook({ event: 'permission.request', sessionId: 's1' });
    await sleep(50);
    expect((await stat()).sessions.find((x) => x.id === 's1')?.state).toBe('blocked');
    await hook({ event: 'turn.end', sessionId: 's1' });
    await sleep(50);
    expect((await stat()).sessions.find((x) => x.id === 's1')?.state).toBe('waiting');
    await hook({ event: 'activity', sessionId: 's1' });
    await sleep(50);
    expect((await stat()).sessions.find((x) => x.id === 's1')?.state).toBe('working');
  });

  it('mute by session, by project, and globally', async () => {
    expect(await send({ cmd: 'mute', scope: { session: 's1' }, value: true }, opts())).toEqual({ ok: true });
    let s = await stat();
    expect(s.sessions.find((x) => x.id === 's1')?.muted).toBe(true);
    expect(s.sessions.find((x) => x.id === 's2')?.muted).toBe(false);

    expect(await send({ cmd: 'mute', scope: { project: '/proj/two' }, value: true }, opts())).toEqual({ ok: true });
    s = await stat();
    expect(s.sessions.find((x) => x.id === 's2')?.muted).toBe(true);

    expect(await send({ cmd: 'mute', scope: { session: 's1' }, value: false }, opts())).toEqual({ ok: true });
    expect(await send({ cmd: 'mute', scope: 'all', value: true }, opts())).toEqual({ ok: true });
    s = await stat();
    expect(s.mute).toBe(true);
    expect(s.sessions.find((x) => x.id === 's1')?.muted).toBe(false);
    expect(await send({ cmd: 'mute', scope: 'all', value: false }, opts())).toEqual({ ok: true });
    expect((await stat()).mute).toBe(false);

    const bad = await send({ cmd: 'mute', scope: { session: 'nope' }, value: true }, opts());
    expect(bad.ok).toBe(false);
  });

  it('volume is clamped and reported', async () => {
    expect(await send({ cmd: 'volume', value: 0.3 }, opts())).toEqual({ ok: true });
    expect((await stat()).volume).toBeCloseTo(0.3);
    expect(await send({ cmd: 'volume', value: 7 }, opts())).toEqual({ ok: true });
    expect((await stat()).volume).toBe(1);
    expect((await send({ cmd: 'volume', value: 'loud' as never }, opts())).ok).toBe(false);
  });

  it('set swaps a live session voice and texture', async () => {
    const reed = voiceByName('reed')!;
    expect(await send({ cmd: 'set', session: 's2', voice: reed, texture: 'pulse' }, opts())).toEqual({ ok: true });
    const s2 = (await stat()).sessions.find((x) => x.id === 's2');
    expect(s2?.voice).toBe('reed');
    expect(s2?.texture).toBe('pulse');
    expect((await send({ cmd: 'set', session: 'ghost', texture: 'drone' }, opts())).ok).toBe(false);
  });

  it('preview plays on a synthetic session that never appears in status', async () => {
    const voice = voiceByName('wire')!;
    expect(await send({ cmd: 'preview', what: 'event', name: 'turn.end', voice, texture: 'drone' }, opts())).toEqual({ ok: true });
    expect(await send({ cmd: 'preview', what: 'state', name: 'blocked', voice, texture: 'breath' }, opts())).toEqual({ ok: true });
    expect(await send({ cmd: 'preview', what: 'event', name: 'session.end', voice, texture: 'breath' }, opts())).toEqual({ ok: true });
    const s = await stat();
    expect(s.sessions.map((x) => x.id).sort()).toEqual(['s1', 's2']);
    expect((await send({ cmd: 'preview', what: 'event', name: 'explode' as never, voice, texture: 'drone' }, opts())).ok).toBe(false);
  });

  it('unknown commands get an error reply', async () => {
    const r = await send({ cmd: 'dance' } as never, opts());
    expect(r.ok).toBe(false);
    expect(isStatusReply(r)).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown cmd/);
  });

  it('session.end removes the session; a stray end for an unknown session is ignored', async () => {
    await hook({ event: 'session.end', sessionId: 's1' });
    await hook({ event: 'session.end', sessionId: 'never-started' });
    await sleep(50);
    expect((await stat()).sessions.map((x) => x.id)).toEqual(['s2']);
    await hook({ event: 'session.end', sessionId: 's2' });
    await sleep(50);
    expect((await stat()).sessions).toEqual([]);
  });

  it('status returns null when nothing listens', async () => {
    expect(await status({ socket: path.join(dir, 'nothing.sock'), timeoutMs: 200 })).toBeNull();
  });
});
