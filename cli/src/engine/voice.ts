import type { AudioContext, AudioNode, BiquadFilterNode, GainNode, OscillatorNode, StereoPannerNode } from 'node-web-audio-api';
import type { Harmony } from './harmony.js';
import type { SessionState, Voice } from './types.js';
import { bell } from './bell.js';
import { Texture, type TextureMode } from './texture.js';
import { fadeTo, MUTE_FADE_S } from './fade.js';

const GLIDE = 0.06; // time constant; ~0.2 s to settle
const PAIR_GAIN = 0.11; // per pad pair at full, before the filter
const TEETH_GAIN = 0.06;
/** Time constant of the fade-out before a graph rebuild; ~0.3 s to silence. */
const SWAP_FADE_TC = 0.08;
const SWAP_FADE_MS = 300;

const cutoffFor = (brightness: number) => 320 + brightness * 1200;
const qFor = (v: Voice) => {
  const r = v.advanced?.resonance;
  return typeof r === 'number' ? 0.5 + Math.min(1, Math.max(0, r)) * 3.5 : 0.7;
};

interface PadPair {
  oscs: { osc: OscillatorNode; g: GainNode; rung: number }[];
  gain: GainNode;
}

/** The part of the graph that is rebuilt when the voice or texture changes. */
interface Graph {
  gain: GainNode;
  filter: BiquadFilterNode;
  lfo: OscillatorNode;
  lfoDepth: GainNode;
  pairs: PadPair[];
  teeth: { oscs: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode };
  texture: Texture;
  mode: TextureMode;
}

/**
 * One session's sound inside the frame: two detunable pad pairs, a saw
 * "teeth" layer for tension, a filter, a pan, and its own bell colour.
 *
 *   pairs -> filter -> gain (state) -> pan -> mute -> out
 *   teeth ------------^                 ^
 *   bells, texture grains ---------------'
 *
 * Everything from `gain` down is a Graph that setVoice/setTexture rebuild in
 * place: the old graph fades out over 0.3 s, the new one fades in after it.
 */
export class SessionVoice {
  state: SessionState = 'working';
  muted = false;
  /** How many one-shots this voice has struck; lets tests prove a dedupe. */
  oneShots = 0;
  private g!: Graph;
  private pan: StereoPannerNode;
  private muteGain: GainNode;
  private activityTimer: NodeJS.Timeout | null = null;
  private swapTimer: NodeJS.Timeout | null = null;
  private unsubChord: () => void;
  private stopped = false;
  private lastActivity = -Infinity;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private harmony: Harmony,
    public voice: Voice,
    /** Which rung of the ladder this session sits on. */
    readonly rung: number,
    public texture: TextureMode = 'drone',
  ) {
    const now = ctx.currentTime;

    this.muteGain = ctx.createGain();
    this.muteGain.gain.value = 1;
    this.muteGain.connect(out);

    this.pan = ctx.createStereoPanner();
    this.pan.pan.value = voice.width.pan;
    this.pan.connect(this.muteGain);

    this.g = this.build(texture);
    this.unsubChord = harmony.onChord(() => this.retune());
    this.g.gain.gain.setTargetAtTime(1, now, this.voice.advanced?.attack ?? 0.35);
  }

  get mode(): TextureMode {
    return this.texture;
  }

  // ---- graph ----

  private build(mode: TextureMode): Graph {
    const ctx = this.ctx;
    const voice = this.voice;
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.pan);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = qFor(voice);
    filter.frequency.value = cutoffFor(voice.brightness);
    filter.connect(gain);

    // Movement: one slow LFO on the cutoff, scaled by depth.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = voice.movement.rate;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = voice.movement.depth * 300;
    lfo.connect(lfoDepth);
    lfoDepth.connect(filter.frequency);
    lfo.start(now);

    const pairs = [this.makePair(0, this.rung, filter), this.makePair(1, this.rung + 1, filter)];
    // drone: pair 0 always up. hum/hush: pair 0 at a whisper. others: pads only swell on demand.
    pairs[0].gain.gain.value = mode === 'drone' ? 1 : mode === 'hum' || mode === 'hush' ? 0.25 : 0;
    pairs[1].gain.gain.value = 0; // second pair rises with activity (drone only)
    if (mode === 'hum' || mode === 'hush') filter.frequency.value = 400;

    // The texture loop drives *this* build's pad only, so a swell that is
    // still decaying when the graph is swapped cannot touch the new one.
    const pad0 = pairs[0].gain.gain;
    const texture: Texture = new Texture({
      ctx, out: this.pan, harmony: this.harmony, voice, rung: this.rung,
      pad: (level, tc) => pad0.setTargetAtTime(mode === 'hush' ? Math.max(level, 0.25) : level, this.ctx.currentTime, tc),
      isWorking: (): boolean => this.state === 'working' && !this.stopped && this.g?.texture === texture,
      sinceActivity: () => this.ctx.currentTime - this.lastActivity,
    }, mode);

    const teeth = this.makeTeeth(gain);
    return { gain, filter, lfo, lfoDepth, pairs, teeth, texture, mode };
  }

  private makePair(i: number, rung: number, filter: BiquadFilterNode): PadPair {
    const ctx = this.ctx;
    const pairGain = ctx.createGain();
    pairGain.connect(filter);
    const base = this.voice.width.detune;
    const detunes = [-(base - 1) - i * 1.8, base + i * 2.4];
    const oscs: PadPair['oscs'] = [];
    for (const d of detunes) {
      for (const type of ['triangle', 'sawtooth'] as const) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.detune.value = d;
        osc.frequency.value = this.harmony.chordFreq(rung, this.voice.register);
        const g = ctx.createGain();
        const blend = type === 'triangle' ? 1 - this.voice.timbre : this.voice.timbre * 0.55;
        g.gain.value = (PAIR_GAIN / 2) * blend;
        osc.connect(g);
        g.connect(pairGain);
        osc.start();
        oscs.push({ osc, g, rung });
      }
    }
    return { oscs, gain: pairGain };
  }

  private makeTeeth(into: GainNode): Graph['teeth'] {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.2;
    filter.frequency.value = 170;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(into);
    const oscs: OscillatorNode[] = [];
    for (const d of [-6, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = d;
      osc.frequency.value = this.harmony.chordFreq(this.rung, this.voice.register - 1);
      const g = ctx.createGain();
      g.gain.value = TEETH_GAIN;
      osc.connect(g);
      g.connect(filter);
      osc.start();
      oscs.push(osc);
    }
    return { oscs, filter, gain };
  }

  /** Stop every source of a graph at `at` and drop it from the pan shortly after. */
  private release(g: Graph, at: number): void {
    g.texture.stop();
    for (const p of g.pairs) for (const o of p.oscs) o.osc.stop(at);
    for (const o of g.teeth.oscs) o.stop(at);
    g.lfo.stop(at);
    const ms = Math.max(0, (at - this.ctx.currentTime) * 1000) + 100;
    setTimeout(() => { try { g.gain.disconnect(); } catch { /* already gone */ } }, ms).unref();
  }

  /** Move every sustained source onto the current chord (or a new frame). */
  retune(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    for (const p of this.g.pairs) {
      for (const o of p.oscs) {
        o.osc.frequency.setTargetAtTime(this.harmony.chordFreq(o.rung, this.voice.register), now, GLIDE);
      }
    }
    for (const o of this.g.teeth.oscs) {
      o.frequency.setTargetAtTime(this.harmony.chordFreq(this.rung, this.voice.register - 1), now, GLIDE);
    }
  }

  // ---- live changes ----

  /** Swap the voice without a click: fade out 0.3 s, rebuild, fade back into the current state. */
  setVoice(voice: Voice): void {
    this.voice = voice;
    if (this.stopped) return;
    this.pan.pan.setTargetAtTime(voice.width.pan, this.ctx.currentTime, 0.1);
    this.rebuild(this.texture);
  }

  /** Change how the working state sounds, same fade. */
  setTexture(mode: TextureMode): void {
    if (mode === this.texture) return;
    this.texture = mode;
    if (this.stopped) return;
    this.rebuild(mode);
  }

  /** Mute or unmute with a MUTE_FADE_S linear fade, never a click. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    fadeTo(this.muteGain.gain, muted ? 0 : 1, this.ctx.currentTime, MUTE_FADE_S);
  }

  private rebuild(mode: TextureMode): void {
    const now = this.ctx.currentTime;
    const old = this.g;
    if (this.activityTimer) { clearTimeout(this.activityTimer); this.activityTimer = null; }
    if (this.swapTimer) { clearTimeout(this.swapTimer); this.swapTimer = null; }
    old.gain.gain.setTargetAtTime(0, now, SWAP_FADE_TC);
    this.release(old, now + SWAP_FADE_MS / 1000 + 0.1);
    this.g = this.build(mode);
    this.swapTimer = setTimeout(() => {
      this.swapTimer = null;
      if (this.stopped) return;
      this.restoreState();
    }, SWAP_FADE_MS);
  }

  /** Bring a freshly built graph up to whatever state the session is in. */
  private restoreState(): void {
    switch (this.state) {
      case 'working': this.working(); if (this.ctx.currentTime - this.lastActivity < 4) this.activity(); break;
      case 'blocked': this.blocked(); break;
      case 'waiting': this.waiting(); break;
      case 'ended': break;
    }
  }

  // ---- states ----

  working(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    this.state = 'working';
    this.g.gain.gain.setTargetAtTime(1, now, 0.3);
    this.g.teeth.gain.gain.setTargetAtTime(0, now, 0.25);
    if (this.g.mode === 'drone') this.g.filter.frequency.setTargetAtTime(cutoffFor(this.voice.brightness), now, 0.4);
    this.g.texture.start();
  }

  /** A tool ran. Thicken: second pair up, cutoff up, decays after 4 s of quiet. */
  activity(): void {
    if (this.stopped) return;
    if (this.state === 'blocked' || this.state === 'waiting') this.working();
    const now = this.ctx.currentTime;
    this.lastActivity = now;
    if (this.g.mode !== 'drone') return;
    const g = this.g;
    g.pairs[1].gain.gain.setTargetAtTime(1, now, 0.25);
    g.filter.frequency.setTargetAtTime(cutoffFor(Math.min(1, this.voice.brightness + 0.3)), now, 0.3);
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => {
      this.activityTimer = null;
      if (this.stopped || this.g !== g) return;
      const t = this.ctx.currentTime;
      g.pairs[1].gain.gain.setTargetAtTime(0, t, 0.6);
      if (this.state === 'working') g.filter.frequency.setTargetAtTime(cutoffFor(this.voice.brightness), t, 0.6);
    }, 4000);
  }

  blocked(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    this.state = 'blocked';
    this.g.texture.stop();
    this.g.gain.gain.setTargetAtTime(1, now, 0.3);
    this.g.teeth.gain.gain.setTargetAtTime(1, now, 0.4);
    this.g.teeth.filter.frequency.setTargetAtTime(240 + this.voice.brightness * 780, now, 0.5);
    this.g.filter.frequency.setTargetAtTime(cutoffFor(Math.min(1, this.voice.brightness + 0.2)), now, 0.5);
  }

  /** Settle to silence within ~3 s. */
  waiting(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    this.state = 'waiting';
    this.g.texture.stop();
    this.g.teeth.gain.gain.setTargetAtTime(0, now, 0.3);
    this.g.gain.gain.setTargetAtTime(0, now, this.voice.advanced?.release ?? 0.7);
  }

  /** Stop all sources after the tail and drop the graph. */
  end(tailSeconds: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.state = 'ended';
    const now = this.ctx.currentTime;
    this.unsubChord();
    if (this.activityTimer) clearTimeout(this.activityTimer);
    if (this.swapTimer) clearTimeout(this.swapTimer);
    this.g.gain.gain.setTargetAtTime(0, now, 0.5);
    this.release(this.g, now + tailSeconds);
    setTimeout(() => { try { this.muteGain.disconnect(); } catch { /* gone */ } }, (tailSeconds + 0.5) * 1000).unref();
  }

  // ---- one-shots, all on the ladder, all in this voice's bell colour ----

  private strike(rungOffset: number, oct: number, delay: number, dur: number, gain: number): void {
    if (delay === 0) this.oneShots++;
    bell(this.ctx, this.pan, {
      midi: this.harmony.chordTone(this.rung + rungOffset, this.voice.register + oct),
      when: this.ctx.currentTime + delay,
      dur,
      gain,
      colour: this.voice.bell,
    });
  }

  sessionStart(): void {
    this.strike(0, 1, 0.0, 1.2, 0.18);
    this.strike(2, 1, 0.09, 1.2, 0.16);
    this.strike(4, 1, 0.18, 1.6, 0.14);
  }

  sessionEnd(): void {
    this.strike(4, 1, 0.0, 1.2, 0.16);
    this.strike(2, 1, 0.09, 1.4, 0.15);
    this.strike(0, 0, 0.18, 4.0, 0.2);
  }

  turnEnd(): void {
    this.strike(2, 1, 0, 1.4, 0.2);
  }

  turnFail(): void {
    this.oneShots++;
    const now = this.ctx.currentTime;
    bell(this.ctx, this.pan, { midi: this.harmony.frame.root - 12, when: now, dur: 2.5, gain: 0.24, colour: 'wood' });
    bell(this.ctx, this.pan, { midi: this.harmony.frame.root + 1, when: now + 0.03, dur: 1.6, gain: 0.08, colour: 'wood' });
  }

  permissionRequest(): void {
    this.strike(0, 1, 0.0, 0.9, 0.18);
    this.strike(3, 1, 0.18, 1.6, 0.2);
    this.blocked();
  }

  compact(): void {
    this.oneShots++;
    bell(this.ctx, this.pan, {
      midi: this.harmony.chordTone(this.rung, this.voice.register),
      when: this.ctx.currentTime,
      dur: 0.15,
      gain: 0.1,
      colour: 'wood',
    });
  }
}
