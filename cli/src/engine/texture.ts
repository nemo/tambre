import type { AudioBuffer, AudioContext, AudioNode } from 'node-web-audio-api';
import type { Harmony } from './harmony.js';
import type { Voice } from './types.js';
import { bell } from './bell.js';

/**
 * How a session sounds while it is *working*. `drone` is the sustained bed;
 * the others are sparse textures meant to sit under a phone call.
 */
export type TextureMode = 'drone' | 'breath' | 'pulse' | 'rain' | 'hum' | 'hush' | 'none';

export const TEXTURE_MODES: TextureMode[] = ['drone', 'breath', 'pulse', 'rain', 'hum', 'hush', 'none'];

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

export interface TextureHost {
  ctx: AudioContext;
  out: AudioNode;          // the voice's pan node
  harmony: Harmony;
  voice: Voice;
  rung: number;
  /** Swell the sustained pad pair to `level` with time constant `tc`. */
  pad(level: number, tc: number): void;
  isWorking(): boolean;
  /** Seconds since the last tool event, Infinity if none. */
  sinceActivity(): number;
}

/** A scheduler loop that stops itself when the host is no longer working. */
export class Texture {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private h: TextureHost, public mode: TextureMode) {}

  start(): void {
    if (this.running || this.mode === 'drone' || this.mode === 'none' || this.mode === 'hum') return;
    this.running = true;
    this.timer = setTimeout(() => this.tick(), this.mode === 'breath' || this.mode === 'hush' ? rnd(800, 2000) : 300);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.mode === 'breath' || this.mode === 'hush') this.h.pad(0, 0.6);
  }

  private tick(): void {
    if (!this.running) return;
    if (!this.h.isWorking()) { this.stop(); return; }
    const busy = this.h.sinceActivity() < 4;
    let next: number;
    switch (this.mode) {
      case 'breath': case 'hush': next = this.breath(busy); break;
      case 'pulse':  next = this.pulse(busy);  break;
      case 'rain':   next = this.rain(busy);   break;
      default:       next = 1;
    }
    this.timer = setTimeout(() => this.tick(), next * 1000);
  }

  /** One swell of the pad: in over ~1.5 s, out over ~3 s, then silence. */
  private breath(busy: boolean): number {
    this.h.pad(busy ? 0.7 : 0.45, 0.5);
    setTimeout(() => this.h.pad(0, 1.0), 1800);
    return busy ? rnd(5, 8) : rnd(8, 14);
  }

  /** One soft tap on the ladder. */
  private pulse(busy: boolean): number {
    const r = this.h.rung + (busy && Math.random() < 0.5 ? 2 : 0);
    bell(this.h.ctx, this.h.out, {
      midi: this.h.harmony.chordTone(r, this.h.voice.register + 1),
      when: this.h.ctx.currentTime,
      dur: 0.5,
      gain: busy ? 0.06 : 0.045,
      colour: 'soft',
    });
    return busy ? rnd(1.2, 2.2) : rnd(2.5, 5);
  }

  /** One grain of band-passed noise, 60-140 ms. */
  private rain(busy: boolean): number {
    const ctx = this.h.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rnd(900, 2600) * (this.h.voice.brightness + 0.6);
    bp.Q.value = 2.5;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const dur = rnd(0.06, 0.14);
    const peak = (busy ? 0.30 : 0.20) * (0.6 + Math.random() * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.setTargetAtTime(0, t + 0.012, dur / 3);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.h.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur * 2);
    return busy ? rnd(0.12, 0.3) : rnd(0.3, 0.8);
  }
}
