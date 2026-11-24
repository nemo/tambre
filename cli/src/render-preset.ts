import { OfflineAudioContext } from 'node-web-audio-api';
import { bell } from './engine/bell.js';
import { writeWav } from './engine/wav.js';
import type { Preset } from './presets.js';

const SR = 44100;
const DURATION = 2;

export async function renderPreset(preset: Preset, outPath: string): Promise<void> {
  const ctx = new OfflineAudioContext(1, SR * DURATION, SR);
  for (const n of preset.notes) {
    bell(ctx as any, ctx.destination, { midi: n.midi, when: n.when, dur: n.dur, gain: n.gain * 0.4, colour: n.colour });
  }
  for (const h of preset.hits ?? []) {
    const len = Math.floor(h.dur * SR);
    const buf = ctx.createBuffer(1, len, SR);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = h.gain * 0.4;
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 1200;
    lp.Q.value = 0.8;
    src.connect(lp);
    lp.connect(g);
    g.connect(ctx.destination);
    src.start(h.when);
    src.stop(h.when + h.dur);
  }
  const rendered = await ctx.startRendering();
  const ch = rendered.getChannelData(0);
  writeWav(outPath, [new Float32Array(ch)], SR);
}