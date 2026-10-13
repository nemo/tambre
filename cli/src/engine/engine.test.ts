import { describe, it, expect } from 'vitest';
import { Engine } from './engine.js';
import { PALETTE } from '../palette.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs against the TAMBRE_NO_AUDIO stub context (set in vitest.config.ts). */
describe('engine with per-session textures', () => {
  it('starts, takes sessions in different textures, swaps them live, and closes', async () => {
    const e = new Engine({ endTail: 0.1, volume: 0.5 });
    expect(e.isStarted).toBe(false);
    expect(() => e.addSession('x', PALETTE[0])).toThrow(/not started/);
    await e.start();
    expect(e.isStarted).toBe(true);

    const a = e.addSession('a', PALETTE[0], 'hush');
    const b = e.addSession('b', PALETTE[1], 'drone');
    expect(a.texture).toBe('hush');
    expect(b.texture).toBe('drone');
    expect(e.sessionCount).toBe(2);
    expect(e.addSession('a', PALETTE[2])).toBe(a); // idempotent

    e.event('a', 'session.start');
    e.event('b', 'activity');
    e.event('a', 'permission.request');
    expect(a.state).toBe('blocked');
    e.event('a', 'turn.end');
    expect(a.state).toBe('waiting');

    expect(e.setSessionTexture('a', 'rain')).toBe(true);
    expect(a.texture).toBe('rain');
    expect(e.setSessionVoice('b', PALETTE[3])).toBe(true);
    expect(b.voice.name).toBe(PALETTE[3].name);
    await sleep(350); // the rebuilt graph restores state after the fade
    expect(a.state).toBe('waiting');
    expect(b.state).toBe('working');

    expect(e.muteSession('a', true)).toBe(true);
    expect(a.muted).toBe(true);
    expect(e.muteSession('zzz', true)).toBe(false);
    e.setVolume(2);
    expect(e.volume).toBe(1);
    e.setMute(true);
    expect(e.mute).toBe(true);

    expect(e.setState('b', 'blocked')).toBe(true);
    expect(b.state).toBe('blocked');

    // Frame is locked while sessions are live, free again after the last one ends.
    expect(e.setFrame({ ...e.frame, root: 45 })).toBe(false);
    e.event('a', 'session.end');
    expect(e.removeSession('b')).toBe(true);
    expect(e.removeSession('b')).toBe(false);
    expect(e.sessionCount).toBe(0);
    expect(e.setFrame({ ...e.frame, root: 45 })).toBe(true);
    expect(e.frame.root).toBe(45);

    await e.close();
    expect(e.ctx.state).toBe('closed');
  });

  it('is not started until the whole graph exists; calls that race the device open are harmless', async () => {
    const e = new Engine({ endTail: 0.1 });
    const p = e.start();
    expect(e.isStarted).toBe(false);
    expect(e.setFrame({ ...e.frame, root: 45 })).toBe(true); // no graph yet: only the harmony moves
    expect(() => e.addSession('x', PALETTE[0])).toThrow(/not started/);
    const p2 = e.start(); // a second start while opening shares the first
    await Promise.all([p, p2]);
    expect(e.isStarted).toBe(true);
    expect(e.frame.root).toBe(45);
    e.addSession('x', PALETTE[0], 'drone');
    await e.close();
  });

  it('close drops a live preview without its end roll and without waiting for the tail', async () => {
    const e = new Engine({ endTail: 1.0 });
    await e.start();
    const pv = e.addSession('__preview__', PALETTE[0], 'hush', { preview: true });
    e.event('__preview__', 'turn.end');
    const shots = pv.oneShots;
    const t0 = Date.now();
    await e.close();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(pv.oneShots).toBe(shots);
    expect(e.sessionCount).toBe(0);
  });

  it('an event for an unknown session with a voice creates it; without one it throws', async () => {
    const e = new Engine({ endTail: 0.1 });
    await e.start();
    expect(() => e.event('n', 'activity')).toThrow(/unknown session/);
    e.event('n', 'activity', PALETTE[4], 'pulse');
    expect(e.session('n')?.texture).toBe('pulse');
    expect(e.session('n')?.state).toBe('working');
    e.event('ghost', 'session.end'); // ignored
    await e.close();
  });
});
