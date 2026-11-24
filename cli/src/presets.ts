/**
 * The twelve tambre presets. Every preset is a short, organic one-shot
 * (or tiny phrase) built on the shared synth engine (oscillators + bell
 * colours + a noise burst). All are rendered at a comparable loudness so
 * that playing several on the same machine does not surprise the ear.
 *
 * A preset is data only: a list of struck notes (and optional noise hits).
 * Nothing here executes; the engine renders it.
 */

export interface PresetNote {
  /** MIDI note. */
  midi: number;
  /** Seconds after the preset starts. */
  when: number;
  /** Note duration in seconds. */
  dur: number;
  /** Relative gain, 0..1, before global normalisation. */
  gain: number;
  /** Bell colour from the engine. */
  colour: 'glass' | 'wood' | 'soft';
}

export interface PresetHit {
  /** Seconds after the preset starts. */
  when: number;
  /** Duration in seconds. */
  dur: number;
  /** Relative gain, 0..1. */
  gain: number;
  /** 'noise' = filtered white noise burst. */
  kind: 'noise';
}

export interface Preset {
  name: string;
  /** One-line character description for the picker. */
  description: string;
  notes: PresetNote[];
  hits?: PresetHit[];
}

export const PRESETS: Preset[] = [
  {
    name: 'guitar-pluck',
    description: 'A single gentle nylon-string pluck, low and warm.',
    notes: [{ midi: 55, when: 0, dur: 0.6, gain: 0.7, colour: 'wood' }],
  },
  {
    name: 'piano-arpeggio',
    description: 'A soft two-note piano arpeggio rising a fifth.',
    notes: [
      { midi: 60, when: 0, dur: 0.5, gain: 0.6, colour: 'glass' },
      { midi: 67, when: 0.18, dur: 0.5, gain: 0.55, colour: 'glass' },
    ],
  },
  {
    name: 'violin-rise',
    description: 'A violin-like tone swelling and rising a whole step.',
    notes: [
      { midi: 62, when: 0, dur: 0.9, gain: 0.5, colour: 'soft' },
      { midi: 64, when: 0.45, dur: 0.6, gain: 0.45, colour: 'soft' },
    ],
  },
  {
    name: 'marimba-tap',
    description: 'A single dry wooden marimba tap.',
    notes: [{ midi: 72, when: 0, dur: 0.35, gain: 0.65, colour: 'wood' }],
  },
  {
    name: 'glass-chime',
    description: 'A bright glass chime with a long tail.',
    notes: [{ midi: 84, when: 0, dur: 1.2, gain: 0.45, colour: 'glass' }],
  },
  {
    name: 'bell-chime',
    description: 'A soft bell, two notes a fourth apart.',
    notes: [
      { midi: 69, when: 0, dur: 1.0, gain: 0.5, colour: 'glass' },
      { midi: 74, when: 0.12, dur: 0.9, gain: 0.35, colour: 'glass' },
    ],
  },
  {
    name: 'flute-breath',
    description: 'A breathy flute-like swell, airy and quiet.',
    notes: [{ midi: 76, when: 0, dur: 0.8, gain: 0.4, colour: 'soft' }],
  },
  {
    name: 'snap',
    description: 'A tiny successive snap, like a finger click.',
    notes: [{ midi: 90, when: 0, dur: 0.12, gain: 0.55, colour: 'wood' }],
    hits: [{ when: 0.06, dur: 0.06, gain: 0.4, kind: 'noise' }],
  },
  {
    name: 'clap',
    description: 'A short soft clap.',
    notes: [],
    hits: [{ when: 0, dur: 0.12, gain: 0.6, kind: 'noise' }],
  },
  {
    name: 'drum-tap',
    description: 'A muted low drum tap.',
    notes: [{ midi: 45, when: 0, dur: 0.25, gain: 0.6, colour: 'wood' }],
    hits: [{ when: 0, dur: 0.08, gain: 0.35, kind: 'noise' }],
  },
  {
    name: 'whistle',
    description: 'A quick high whistle up a minor third.',
    notes: [
      { midi: 88, when: 0, dur: 0.25, gain: 0.4, colour: 'glass' },
      { midi: 91, when: 0.15, dur: 0.25, gain: 0.4, colour: 'glass' },
    ],
  },
  {
    name: 'pop',
    description: 'A small bright pop.',
    notes: [{ midi: 79, when: 0, dur: 0.18, gain: 0.5, colour: 'glass' }],
    hits: [{ when: 0, dur: 0.05, gain: 0.3, kind: 'noise' }],
  },
];

export const presetByName = (name: string): Preset | undefined =>
  PRESETS.find((p) => p.name === name);
