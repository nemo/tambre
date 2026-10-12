import type { AudioContext, AudioNode, BiquadFilterNode, GainNode, OscillatorNode, StereoPannerNode } from 'node-web-audio-api';
import type { Harmony } from './harmony.js';
import type { SessionState, Voice } from './types.js';
import { bell } from './bell.js';

const GLIDE = 0.06; // time constant; ~0.2 s to settle
const PAIR_GAIN = 0.11; // per pad pair at full, before the filter
const TEETH_GAIN = 0.06;

const cutoffFor = (brightness: number) => 240 + brightness * 1100;

interface PadPair {
  oscs: { osc: OscillatorNode; g: GainNode; rung: number }[];
  gain: GainNode;
}

/**
 * One session's sound inside the frame: two detunable pad pairs, a saw
 * "teeth" layer for tension, a filter, a pan, and its own bell colour.
 */
export class SessionVoice {
  state: SessionState = 'working';
  private pairs: PadPair[] = [];
  private teeth!: { oscs: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode };
  private filter: BiquadFilterNode;
  private gain: GainNode; // voice level (state)
  private pan: StereoPannerNode;
  private lfo: OscillatorNode;
  private lfoDepth: GainNode;
  private activityTimer: NodeJS.Timeout | null = null;
  private unsubChord: () => void;
  private stopped = false;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private harmony: Harmony,
    public voice: Voice,
    /** Which rung of the ladder this session sits on. */
    private rung: number,
  ) {
    const now = ctx.currentTime;

    this.pan = ctx.createStereoPanner();
    this.pan.pan.value = voice.width.pan;
    this.pan.connect(out);

    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.pan);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 0.7;
    this.filter.frequency.value = cutoffFor(voice.brightness);
    this.filter.connect(this.gain);

    // Movement: one slow LFO on the cutoff, scaled by depth.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = voice.movement.rate;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = voice.movement.depth * 300;
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.filter.frequency);
    this.lfo.start(now);

    this.pairs.push(this.makePair(0, this.rung));
    this.pairs.push(this.makePair(1, this.rung + 1));
    this.pairs[0].gain.gain.value = 1;
    this.pairs[1].gain.gain.value = 0; // second pair rises with activity

    this.makeTeeth();

    this.unsubChord = harmony.onChord(() => this.retune());
    this.gain.gain.setTargetAtTime(1, now, 0.35);
  }

  private makePair(i: number, rung: number): PadPair {
    const ctx = this.ctx;
    const pairGain = ctx.createGain();
    pairGain.connect(this.filter);
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
        const blend = type === 'triangle' ? 1 - this.voice.timbre : this.voice.timbre;
        g.gain.value = (PAIR_GAIN / 2) * blend;
        osc.connect(g);
        g.connect(pairGain);
        osc.start();
        oscs.push({ osc, g, rung });
      }
    }
    return { oscs, gain: pairGain };
  }

  private makeTeeth(): void {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2.2;
    filter.frequency.value = 170;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(this.gain);
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
    this.teeth = { oscs, filter, gain };
  }

  private retune(): void {
    const now = this.ctx.currentTime;
    for (const p of this.pairs) {
      for (const o of p.oscs) {
        o.osc.frequency.setTargetAtTime(this.harmony.chordFreq(o.rung, this.voice.register), now, GLIDE);
      }
    }
    for (const o of this.teeth.oscs) {
      o.frequency.setTargetAtTime(this.harmony.chordFreq(this.rung, this.voice.register - 1), now, GLIDE);
    }
  }

  // ---- states ----

  working(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    this.state = 'working';
    this.gain.gain.setTargetAtTime(1, now, 0.3);
    this.teeth.gain.gain.setTargetAtTime(0, now, 0.25);
    this.filter.frequency.setTargetAtTime(cutoffFor(this.voice.brightness), now, 0.4);
  }

  /** A tool ran. Thicken: second pair up, cutoff up, decays after 4 s of quiet. */
  activity(): void {
    if (this.stopped) return;
    if (this.state === 'blocked' || this.state === 'waiting') this.working();
    const now = this.ctx.currentTime;
    this.pairs[1].gain.gain.setTargetAtTime(1, now, 0.25);
    this.filter.frequency.setTargetAtTime(cutoffFor(Math.min(1, this.voice.brightness + 0.3)), now, 0.3);
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.activityTimer = setTimeout(() => {
      if (this.stopped) return;
      const t = this.ctx.currentTime;
      this.pairs[1].gain.gain.setTargetAtTime(0, t, 0.6);
      if (this.state === 'working') this.filter.frequency.setTargetAtTime(cutoffFor(this.voice.brightness), t, 0.6);
    }, 4000);
  }

  blocked(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    this.state = 'blocked';
    this.gain.gain.setTargetAtTime(1, now, 0.3);
    this.teeth.gain.gain.setTargetAtTime(1, now, 0.4);
    this.teeth.filter.frequency.setTargetAtTime(240 + this.voice.brightness * 780, now, 0.5);
    this.filter.frequency.setTargetAtTime(cutoffFor(Math.min(1, this.voice.brightness + 0.2)), now, 0.5);
  }

  /** Settle to silence within ~3 s. */
  waiting(): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    this.state = 'waiting';
    this.teeth.gain.gain.setTargetAtTime(0, now, 0.3);
    this.gain.gain.setTargetAtTime(0, now, 0.7);
  }

  /** Stop all sources after the tail and drop the graph. */
  end(tailSeconds: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.state = 'ended';
    const now = this.ctx.currentTime;
    this.unsubChord();
    if (this.activityTimer) clearTimeout(this.activityTimer);
    this.gain.gain.setTargetAtTime(0, now, 0.5);
    const stopAt = now + tailSeconds;
    for (const p of this.pairs) for (const o of p.oscs) o.osc.stop(stopAt);
    for (const o of this.teeth.oscs) o.stop(stopAt);
    this.lfo.stop(stopAt);
    setTimeout(() => this.pan.disconnect(), (tailSeconds + 0.5) * 1000);
  }

  // ---- one-shots, all on the ladder, all in this voice's bell colour ----

  private strike(rungOffset: number, oct: number, delay: number, dur: number, gain: number): void {
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
    this.strike(2, 1, 0, 1.8, 0.22);
  }

  turnFail(): void {
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
    bell(this.ctx, this.pan, {
      midi: this.harmony.chordTone(this.rung, this.voice.register),
      when: this.ctx.currentTime,
      dur: 0.15,
      gain: 0.1,
      colour: 'wood',
    });
  }
}
