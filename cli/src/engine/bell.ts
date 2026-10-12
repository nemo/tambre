import type { AudioContext, AudioNode } from 'node-web-audio-api';
import type { BellColour } from './types.js';
import { mtof } from './harmony.js';

export interface BellOpts {
  midi: number;
  when: number;
  dur: number;
  gain: number;
  colour: BellColour;
}

/**
 * One struck note. Glass is a sine with an inharmonic partial and a long
 * tail; wood is a damped triangle; soft is a slow sine swell.
 */
export function bell(ctx: AudioContext, out: AudioNode, o: BellOpts): void {
  const f = mtof(o.midi);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, o.when);
  env.connect(out);

  const attack = o.colour === 'soft' ? 0.04 : 0.004;
  env.gain.linearRampToValueAtTime(o.gain, o.when + attack);
  env.gain.setTargetAtTime(0, o.when + attack, o.dur / 4);

  const voices: [number, number, OscillatorType][] =
    o.colour === 'glass'
      ? [[1, 1, 'sine'], [2.76, 0.18, 'sine'], [5.4, 0.05, 'sine']]
      : o.colour === 'wood'
        ? [[1, 1, 'triangle'], [2, 0.2, 'sine']]
        : [[1, 1, 'sine'], [2, 0.12, 'sine']];

  let last: AudioNode = env;
  if (o.colour === 'wood') {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(1400, f * 4);
    lp.Q.value = 0.8;
    env.disconnect();
    env.connect(lp);
    lp.connect(out);
    last = env;
  }

  const stop = o.when + o.dur * 1.5;
  for (const [ratio, g, type] of voices) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f * ratio;
    const pg = ctx.createGain();
    pg.gain.value = g;
    osc.connect(pg);
    pg.connect(last);
    osc.start(o.when);
    osc.stop(stop);
  }
}

type OscillatorType = 'sine' | 'triangle' | 'sawtooth' | 'square';
