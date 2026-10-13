import type { AudioContext, DynamicsCompressorNode, GainNode, OscillatorNode } from 'node-web-audio-api';
import { writeWav } from './wav.js';
import { createAudioContext } from './context.js';
import { Harmony } from './harmony.js';
import { SessionVoice } from './voice.js';
import { bell } from './bell.js';
import { DEFAULT_FRAME, type CanonicalEvent, type Frame, type SessionState, type Voice } from './types.js';
import type { TextureMode } from './texture.js';

export interface EngineOpts {
  frame?: Frame;
  /** 0..1 master level. */
  volume?: number;
  /** Seconds the session.end tail lasts before the voice's graph is dropped. */
  endTail?: number;
  /** Start muted. */
  mute?: boolean;
}

const SUB_DRONE = 0.045;
const SUB_WHISPER = 0.03;

/**
 * Owns the one AudioContext. Master chain: bed floor (two incommensurate
 * LFOs) -> master gain -> compressor(-18 dB, 6:1) -> destination. A sub sine
 * holds the pedal an octave below the root and the shared chord bed carries
 * the colour cycle; both come up only while a session that wants them is live.
 *
 * Texture is per session: the chord bed is up while any live session is in
 * `drone`, the sub while any is in `drone`, `hum` or `hush`.
 */
export class Engine {
  /** Set by start(). */
  ctx!: AudioContext;
  readonly harmony: Harmony;
  private master!: GainNode;
  private recChunks: [Float32Array, Float32Array][] = [];
  private recPath?: string;
  private recNode?: ScriptProcessorNode;
  private bed!: GainNode;
  private comp!: DynamicsCompressorNode;
  private sub!: { osc: OscillatorNode; gain: GainNode };
  private chordBed!: { oscs: { osc: OscillatorNode; tone: number }[]; gain: GainNode };
  private lfos: OscillatorNode[] = [];
  private sessions = new Map<string, SessionVoice>();
  private chordTimer: NodeJS.Timeout | null = null;
  private nextRung = 0;
  private frameLocked = false;
  private endTail: number;
  private started = false;
  private _volume: number;
  private _mute: boolean;

  constructor(opts: EngineOpts = {}) {
    this.harmony = new Harmony(opts.frame ?? DEFAULT_FRAME);
    this.endTail = opts.endTail ?? 5;
    this._volume = clamp01(opts.volume ?? 0.8);
    this._mute = opts.mute ?? false;
  }

  /** Replace the frame. Only honoured while no session is live. */
  setFrame(frame: Frame): boolean {
    if (this.frameLocked) return false;
    this.harmony.frame = frame;
    this.harmony.index = 0;
    if (this.started) {
      const t = this.ctx.currentTime;
      this.sub.osc.frequency.setTargetAtTime(this.harmony.rootFreq(-1), t, 0.06);
      for (const o of this.chordBed.oscs) o.osc.frequency.setTargetAtTime(this.harmony.chordFreq(o.tone, 1), t, 0.06);
    }
    return true;
  }

  get frame(): Frame {
    return this.harmony.frame;
  }

  get volume(): number {
    return this._volume;
  }

  get mute(): boolean {
    return this._mute;
  }

  get isStarted(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.ctx = await createAudioContext();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const now = this.ctx.currentTime;

    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 6;
    this.comp.attack.value = 0.01;
    this.comp.release.value = 0.25;
    this.comp.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = this._mute ? 0 : this._volume;
    this.master.connect(this.comp);

    this.bed = this.ctx.createGain();
    this.bed.gain.value = 0.82;
    this.bed.connect(this.master);

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
        if (this.anyTexture((m) => m === 'drone')) this.chordRoll();
      }
      this.scheduleChord();
    }, this.harmony.chordSeconds() * 1000);
    this.chordTimer.unref();
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

  private anyTexture(pred: (m: TextureMode) => boolean): boolean {
    for (const sv of this.sessions.values()) if (pred(sv.texture)) return true;
    return false;
  }

  /**
   * Chord bed and sub follow the live sessions' textures: bed up if any is
   * `drone`; sub full for `drone`, a whisper for `hum`/`hush`, else off.
   */
  private recomputeBed(tc = 0.8): void {
    if (!this.started) return;
    const drone = this.anyTexture((m) => m === 'drone');
    const whisper = this.anyTexture((m) => m === 'hum' || m === 'hush');
    const t = this.ctx.currentTime;
    this.sub.gain.gain.setTargetAtTime(drone ? SUB_DRONE : whisper ? SUB_WHISPER : 0, t, tc);
    this.chordBed.gain.gain.setTargetAtTime(drone ? 1 : 0, t, tc);
  }

  // ---- sessions ----

  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  session(id: string): SessionVoice | undefined {
    return this.sessions.get(id);
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  sessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  addSession(id: string, voice: Voice, texture: TextureMode = 'drone'): SessionVoice {
    if (!this.started) throw new Error('engine not started');
    const existing = this.sessions.get(id);
    if (existing) return existing;
    this.frameLocked = true;
    const rung = this.nextRung;
    this.nextRung += 2;
    const sv = new SessionVoice(this.ctx, this.bed, this.harmony, voice, rung, texture);
    this.sessions.set(id, sv);
    this.recomputeBed();
    return sv;
  }

  /** Drop a session without its end roll (previews). The tail still rings out. */
  removeSession(id: string): boolean {
    const sv = this.sessions.get(id);
    if (!sv) return false;
    sv.end(this.endTail);
    this.sessions.delete(id);
    this.afterRemoval();
    return true;
  }

  private afterRemoval(): void {
    if (this.sessions.size === 0) {
      this.frameLocked = false;
      this.recomputeBed(1.2);
    } else {
      this.recomputeBed();
    }
  }

  setSessionTexture(id: string, texture: TextureMode): boolean {
    const sv = this.sessions.get(id);
    if (!sv) return false;
    sv.setTexture(texture);
    this.recomputeBed();
    return true;
  }

  setSessionVoice(id: string, voice: Voice): boolean {
    const sv = this.sessions.get(id);
    if (!sv) return false;
    sv.setVoice(voice);
    return true;
  }

  muteSession(id: string, muted: boolean): boolean {
    const sv = this.sessions.get(id);
    if (!sv) return false;
    sv.setMuted(muted);
    return true;
  }

  /** Put a session straight into a state, no one-shot. */
  setState(id: string, state: SessionState): boolean {
    const sv = this.sessions.get(id);
    if (!sv) return false;
    switch (state) {
      case 'working': sv.working(); break;
      case 'blocked': sv.blocked(); break;
      case 'waiting': sv.waiting(); break;
      case 'ended': this.event(id, 'session.end'); break;
    }
    return true;
  }

  setVolume(v: number): void {
    this._volume = clamp01(v);
    this.applyMaster();
  }

  setMute(mute: boolean): void {
    this._mute = mute;
    this.applyMaster();
  }

  private applyMaster(): void {
    if (!this.started) return;
    this.master.gain.setTargetAtTime(this._mute ? 0 : this._volume, this.ctx.currentTime, 0.05);
  }

  event(id: string, evt: CanonicalEvent, voice?: Voice, texture?: TextureMode): void {
    let sv = this.sessions.get(id);
    if (!sv) {
      if (evt === 'session.end') return;
      if (!voice) throw new Error(`unknown session ${id} and no voice given`);
      sv = this.addSession(id, voice, texture);
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
        this.afterRemoval();
        break;
    }
  }

  /** Tap the compressor output and write it to a WAV on close(). */
  record(path: string): void {
    if (!this.started) throw new Error('engine not started');
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

  /** Resolves once the last tail has rung out, then releases the device. */
  async close(): Promise<void> {
    if (this.chordTimer) clearTimeout(this.chordTimer);
    if (!this.started) return;
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

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
