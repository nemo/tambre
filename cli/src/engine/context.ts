import type { AudioContext } from 'node-web-audio-api';

/**
 * Opens the one AudioContext. With TAMBRE_NO_AUDIO set (anything but "" or
 * "0") it returns an inert stub instead: every node and AudioParam exists
 * and accepts calls, nothing is heard, and the native addon is never loaded.
 * That is what lets the daemon and engine run in tests and on headless hosts.
 */
export async function createAudioContext(): Promise<AudioContext> {
  if (noAudio()) return new StubAudioContext() as unknown as AudioContext;
  const { AudioContext } = await import('node-web-audio-api');
  return new AudioContext({ latencyHint: 'playback' });
}

export function noAudio(): boolean {
  const v = process.env.TAMBRE_NO_AUDIO;
  return v !== undefined && v !== '' && v !== '0';
}

// ---- stub ----

class StubParam {
  constructor(public value: number) {}
  setValueAtTime(v: number): this { this.value = v; return this; }
  linearRampToValueAtTime(v: number): this { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number): this { this.value = v; return this; }
  setTargetAtTime(v: number): this { this.value = v; return this; }
  cancelScheduledValues(): this { return this; }
}

class StubNode {
  connect<T>(dest: T): T { return dest; }
  disconnect(): void { /* nothing to undo */ }
}

class StubGain extends StubNode { gain = new StubParam(1); }
class StubPanner extends StubNode { pan = new StubParam(0); }
class StubOscillator extends StubNode {
  type = 'sine';
  frequency = new StubParam(440);
  detune = new StubParam(0);
  start(): void { /* silent */ }
  stop(): void { /* silent */ }
}
class StubBiquad extends StubNode {
  type = 'lowpass';
  frequency = new StubParam(350);
  Q = new StubParam(1);
  gain = new StubParam(0);
}
class StubCompressor extends StubNode {
  threshold = new StubParam(-24);
  knee = new StubParam(30);
  ratio = new StubParam(12);
  attack = new StubParam(0.003);
  release = new StubParam(0.25);
}
class StubBufferSource extends StubNode {
  buffer: StubBuffer | null = null;
  loop = false;
  start(): void { /* silent */ }
  stop(): void { /* silent */ }
}
class StubBuffer {
  private data: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(c: number): Float32Array { return this.data[c]; }
}
class StubScriptProcessor extends StubNode { onaudioprocess: unknown = null; }

class StubAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'running';
  readonly sampleRate = 48000;
  readonly destination = new StubNode();
  private t0 = performance.now();

  get currentTime(): number { return (performance.now() - this.t0) / 1000; }
  async resume(): Promise<void> { if (this.state !== 'closed') this.state = 'running'; }
  async suspend(): Promise<void> { if (this.state !== 'closed') this.state = 'suspended'; }
  async close(): Promise<void> { this.state = 'closed'; }

  createGain(): StubGain { return new StubGain(); }
  createStereoPanner(): StubPanner { return new StubPanner(); }
  createOscillator(): StubOscillator { return new StubOscillator(); }
  createBiquadFilter(): StubBiquad { return new StubBiquad(); }
  createDynamicsCompressor(): StubCompressor { return new StubCompressor(); }
  createBufferSource(): StubBufferSource { return new StubBufferSource(); }
  createBuffer(channels: number, length: number, sampleRate: number): StubBuffer {
    return new StubBuffer(channels, length, sampleRate);
  }
  createScriptProcessor(): StubScriptProcessor { return new StubScriptProcessor(); }
}
