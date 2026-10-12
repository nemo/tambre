import type { Frame } from './types.js';

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/**
 * The chord ladder. Any integer maps to an in-chord pitch: the index wraps
 * across the current voicing and climbs an octave each time it wraps.
 */
export class Harmony {
  index = 0;
  private listeners = new Set<(index: number) => void>();

  constructor(public frame: Frame) {}

  chord(): number[] {
    return this.frame.voicings[this.index % this.frame.voicings.length];
  }

  chordTone(i: number, oct = 0): number {
    const c = this.chord();
    const n = c.length;
    const wrapped = ((i % n) + n) % n;
    const climb = Math.floor(i / n);
    return this.frame.root + c[wrapped] + 12 * (climb + oct);
  }

  chordFreq(i: number, oct = 0): number {
    return mtof(this.chordTone(i, oct));
  }

  rootFreq(oct = 0): number {
    return mtof(this.frame.root + 12 * oct);
  }

  /** Seconds per chord: chordBars bars of 4 beats. */
  chordSeconds(): number {
    return (this.frame.chordBars * 4 * 60) / this.frame.bpm;
  }

  advance(): void {
    this.index = (this.index + 1) % this.frame.voicings.length;
    for (const l of this.listeners) l(this.index);
  }

  onChord(cb: (index: number) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
