import { AudioContext } from 'node-web-audio-api';
import { writeWav } from './wav.js';
import type { DynamicsCompressorNode, GainNode, OscillatorNode } from 'node-web-audio-api';
import { Harmony } from './harmony.js';
import { SessionVoice } from './voice.js';
import { bell } from './bell.js';
import { DEFAULT_FRAME, type CanonicalEvent, type Frame, type Voice } from './types.js';

export interface EngineOpts {
  frame?: Frame;
  /** 0..1 master level. */
  volume?: number;
  /** Seconds the session.end tail lasts before the voice's graph is dropped. */
  endTail?: number;
}

/**
 * Owns the one AudioContext. Master chain: bed floor (two incommensurate
 * LFOs) -> master gain -> compressor(-18 dB, 6:1) -> destination. A sub sine
 * holds the pedal an octave below the root the whole time any session is up.
 */
export class Engine {
  readonly ctx: AudioContext;
  readonly harmony: Harmony;
  private master: GainNode;
  private recChunks: [Float32Array, Float32Array][] = [];
  private recPath?: string;
  private recNode?: ScriptProcessorNode;
  private bed: GainNode;
  private comp: DynamicsCompressorNode;
  private sub!: { osc: OscillatorNode; gain: GainNode };
  private chordBed!: { oscs: { osc: OscillatorNode; tone: number }[]; gain: GainNode };
  private lfos: OscillatorNode[] = [];
  private sessions = new Map<string, SessionVoice>();
  private chordTimer: NodeJS.Timeout | null = null;
  private nextRung = 0;
  private frameLocked = false;
  private endTail: number;
  private started = false;

  constructor(opts: EngineOpts = {}) {
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.harmony = new Harmony(opts.frame ?? DEFAULT_FRAME);
    this.endTail = opts.endTail ?? 5;

    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.25;
    this.comp.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = opts.volume ?? 0.8;
    this.master.connect(this.comp);

    this.bed = this.ctx.createGain();
    this.bed.gain.value = 0.82;
    this.bed.connect(this.master);
  }

  /** Replace the frame. Only honoured before the first session starts. */
  setFrame(frame: Frame): boolean {
    if (this.frameLocked) return false;
    this.harmony.frame = frame;
    this.harmony.index = 0;
    return true;
  }

  get frame(): Frame {
    return this.harmony.frame;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const now = this.ctx.currentTime;

    // Floor: 0.82 + 0.1*sin(t*0.031) + 0.07*sin(t*0.017+1.7). Two rates that
    // never line up, so the bed never visibly repeats.
    for (const [rate, depth] of [[0.031 / (2 * Math.PI), 0.1], [0.017 / (2 * Math.PI), 0.07]] as const) {
      const lfo = this.ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = rate;
      const g = this.ctx.createGain();
      g.gain.value = depth;
      lfo.connect(g);
      g.connect(this.bed.gain);
      lfo.start(now);
      this.lfos.push(lfo);
    }

    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = this.harmony.rootFreq(-1);
    const sg = this.ctx.createGain();
    sg.gain.value = 0;
    sub.connect(sg);
    sg.connect(this.bed);
    sub.start(now);
    this.sub = { osc: sub, gain: sg };

    this.makeChordBed(now);
    this.scheduleChord();
  }

  /**
   * The shared pad: chord tones 1..4 one octave up (250-450 Hz, where warmth lives), triangle pairs
   * detuned +/-4 cents through a dark lowpass. Quiet, but it is what makes
   * the colour cycle audible and gives the session voices something to sit in.
   */
  private makeChordBed(now: number): void {
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.Q.value = 0.7;
    lp.connect(gain);
    gain.connect(this.bed);
    const oscs: { osc: OscillatorNode; tone: number }[] = [];
    for (let tone = 1; tone <= 4; tone++) {
      for (const d of [-3 - tone * 0.5, 3 + tone * 0.6]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.detune.value = d;
        osc.frequency.value = this.harmony.chordFreq(tone, 1);
        const g = this.ctx.createGain();
        g.gain.value = 0.03;
        osc.connect(g);
        g.connect(lp);
        osc.start(now);
        oscs.push({ osc, tone });
      }
    }
    this.chordBed = { oscs, gain };
    this.harmony.onChord(() => {
      const t = this.ctx.currentTime;
      for (const o of this.chordBed.oscs) o.osc.frequency.setTargetAtTime(this.harmony.chordFreq(o.tone, 1), t, 0.06);
    });
  }

  private scheduleChord(): void {
    this.chordTimer = setTimeout(() => {
      if (this.sessions.size > 0) {
        this.harmony.advance();
        this.chordRoll();
      }
      this.scheduleChord();
    }, this.harmony.chordSeconds() * 1000);
  }

  /** Three soft bells, staggered 90 ms, mark the colour change. */
  private chordRoll(): void {
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      bell(this.ctx, this.bed, {
        midi: this.harmony.chordTone(i * 2, 1),
        when: now + i * 0.09,
        dur: 1.2,
        gain: 0.045,
        colour: 'soft',
      });
    }
  }

  private subTo(level: number, tc = 0.8): void {
    this.sub.gain.gain.setTargetAtTime(level, this.ctx.currentTime, tc);
    this.chordBed.gain.gain.setTargetAtTime(level > 0 ? 1 : 0, this.ctx.currentTime, tc);
  }

  // ---- sessions ----

  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  addSession(id: string, voice: Voice): SessionVoice {
    const existing = this.sessions.get(id);
    if (existing) return existing;
    this.frameLocked = true;
    const rung = this.nextRung;
    this.nextRung += 2;
    const sv = new SessionVoice(this.ctx, this.bed, this.harmony, voice, rung);
    this.sessions.set(id, sv);
    this.subTo(0.045);
    return sv;
  }

  event(id: string, evt: CanonicalEvent, voice?: Voice): void {
    let sv = this.sessions.get(id);
    if (!sv) {
      if (evt === 'session.end') return;
      if (!voice) throw new Error(`unknown session ${id} and no voice given`);
      sv = this.addSession(id, voice);
      if (evt !== 'session.start') sv.sessionStart();
    }
    switch (evt) {
      case 'session.start':
        sv.sessionStart();
        sv.working();
        break;
      case 'working':
        sv.working();
        break;
      case 'activity':
        sv.activity();
        break;
      case 'permission.request':
        sv.permissionRequest();
        break;
      case 'turn.end':
        sv.turnEnd();
        sv.waiting();
        break;
      case 'turn.fail':
        sv.turnFail();
        sv.waiting();
        break;
      case 'waiting':
        sv.waiting();
        break;
      case 'compact':
        sv.compact();
        break;
      case 'session.end':
        sv.sessionEnd();
        sv.end(this.endTail);
        this.sessions.delete(id);
        if (this.sessions.size === 0) this.subTo(0, 1.2);
        break;
    }
  }

  /** Resolves once the last tail has rung out, then releases the device. */
  /** Tap the compressor output and write it to a WAV on close(). */
  record(path: string): void {
    this.recPath = path;
    const sp = this.ctx.createScriptProcessor(4096, 2, 2);
    sp.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0);
      const r = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l;
      this.recChunks.push([Float32Array.from(l), Float32Array.from(r)]);
      e.outputBuffer.getChannelData(0).set(l);
      e.outputBuffer.getChannelData(1).set(r);
    };
    this.comp.disconnect();
    this.comp.connect(sp);
    sp.connect(this.ctx.destination);
    this.recNode = sp;
  }

  async close(): Promise<void> {
    if (this.chordTimer) clearTimeout(this.chordTimer);
    for (const [id] of this.sessions) this.event(id, 'session.end');
    await new Promise((r) => setTimeout(r, (this.endTail + 0.6) * 1000));
    await this.ctx.close();
    if (this.recPath) {
      const n = this.recChunks.reduce((a, c) => a + c[0].length, 0);
      const L = new Float32Array(n), R = new Float32Array(n);
      let o = 0;
      for (const [l, r] of this.recChunks) { L.set(l, o); R.set(r, o); o += l.length; }
      writeWav(this.recPath, [L, R], this.ctx.sampleRate);
    }
  }
}
