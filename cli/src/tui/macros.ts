import type { Voice } from '../engine/types.js';
import { TEXTURE_MODES, type TextureMode } from '../engine/texture.js';
import { BELL_COLOURS, cloneVoice } from '../config.js';

/**
 * What the TUI edits: one voice plus the texture it works in. Pure data; the
 * sliders below are the only way the TUI changes it.
 */
export interface Edit {
  voice: Voice;
  texture: TextureMode;
}

export type Page = 'main' | 'advanced';

export interface RangeMacro {
  id: string;
  label: string;
  kind: 'range';
  page: Page;
  min: number;
  max: number;
  step: number;
  /** Digits after the point when shown. */
  digits: number;
  /** Used when the field is unset (advanced fields are optional on a voice). */
  fallback: number;
  get(e: Edit): number | undefined;
  set(e: Edit, v: number): Edit;
  note?: string;
}

export interface CycleMacro {
  id: string;
  label: string;
  kind: 'cycle';
  page: Page;
  options: readonly string[];
  get(e: Edit): string;
  set(e: Edit, v: string): Edit;
  note?: string;
}

export type Macro = RangeMacro | CycleMacro;

const withVoice = (e: Edit, f: (v: Voice) => void): Edit => {
  const voice = cloneVoice(e.voice);
  f(voice);
  return { ...e, voice };
};

const advanced = (
  id: 'attack' | 'release' | 'resonance' | 'fmRatio' | 'reverb',
  label: string, min: number, max: number, step: number, fallback: number, note?: string,
): RangeMacro => ({
  id, label, kind: 'range', page: 'advanced', min, max, step, digits: 2, fallback, note,
  get: (e) => e.voice.advanced?.[id],
  set: (e, v) => withVoice(e, (voice) => { voice.advanced = { ...(voice.advanced ?? {}), [id]: v }; }),
});

/**
 * The sliders, in focus order. Main page first, then the advanced page. The
 * engine renders attack, release and resonance; fmRatio and reverb are kept on
 * the voice for a later engine and the TUI says so.
 */
export const MACROS: Macro[] = [
  { id: 'timbre', label: 'timbre', kind: 'range', page: 'main', min: 0, max: 1, step: 0.05, digits: 2, fallback: 0,
    get: (e) => e.voice.timbre, set: (e, v) => withVoice(e, (voice) => { voice.timbre = v; }) },
  { id: 'register', label: 'register', kind: 'range', page: 'main', min: -1, max: 1, step: 1, digits: 0, fallback: 0,
    get: (e) => e.voice.register, set: (e, v) => withVoice(e, (voice) => { voice.register = v; }) },
  { id: 'brightness', label: 'brightness', kind: 'range', page: 'main', min: 0, max: 1, step: 0.05, digits: 2, fallback: 0,
    get: (e) => e.voice.brightness, set: (e, v) => withVoice(e, (voice) => { voice.brightness = v; }) },
  { id: 'movement.depth', label: 'move depth', kind: 'range', page: 'main', min: 0, max: 1, step: 0.05, digits: 2, fallback: 0,
    get: (e) => e.voice.movement.depth, set: (e, v) => withVoice(e, (voice) => { voice.movement.depth = v; }) },
  { id: 'movement.rate', label: 'move rate', kind: 'range', page: 'main', min: 0, max: 0.5, step: 0.01, digits: 2, fallback: 0,
    get: (e) => e.voice.movement.rate, set: (e, v) => withVoice(e, (voice) => { voice.movement.rate = v; }) },
  { id: 'width.detune', label: 'detune', kind: 'range', page: 'main', min: 0, max: 30, step: 1, digits: 0, fallback: 0,
    get: (e) => e.voice.width.detune, set: (e, v) => withVoice(e, (voice) => { voice.width.detune = v; }) },
  { id: 'width.pan', label: 'pan', kind: 'range', page: 'main', min: -1, max: 1, step: 0.05, digits: 2, fallback: 0,
    get: (e) => e.voice.width.pan, set: (e, v) => withVoice(e, (voice) => { voice.width.pan = v; }) },
  { id: 'bell', label: 'bell', kind: 'cycle', page: 'main', options: BELL_COLOURS,
    get: (e) => e.voice.bell, set: (e, v) => withVoice(e, (voice) => { voice.bell = v as Voice['bell']; }) },
  { id: 'texture', label: 'texture', kind: 'cycle', page: 'main', options: TEXTURE_MODES,
    get: (e) => e.texture, set: (e, v) => ({ ...e, texture: v as TextureMode }) },
  advanced('attack', 'attack', 0.05, 5, 0.05, 0.35, 'seconds; entrance on session.start'),
  advanced('release', 'release', 0.05, 10, 0.05, 0.7, 'seconds; fade on waiting'),
  advanced('resonance', 'resonance', 0, 1, 0.05, 0.7, 'filter Q'),
  advanced('fmRatio', 'fm ratio', 0, 8, 0.5, 1, 'stored; the engine does not render it yet'),
  advanced('reverb', 'reverb', 0, 1, 0.05, 0, 'stored; the engine does not render it yet'),
];

export const macrosFor = (page: Page): Macro[] => MACROS.filter((m) => m.page === page);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Move one macro by one step in `dir` (-1 or 1). Cycles wrap. */
export function adjust(e: Edit, m: Macro, dir: -1 | 1): Edit {
  if (m.kind === 'cycle') {
    const i = m.options.indexOf(m.get(e));
    const n = m.options.length;
    return m.set(e, m.options[((i < 0 ? 0 : i) + dir + n) % n]);
  }
  const cur = m.get(e) ?? m.fallback;
  const next = clamp(cur + dir * m.step, m.min, m.max);
  const scale = Math.pow(10, Math.max(m.digits, 2));
  return m.set(e, Math.round(next * scale) / scale);
}

/** Value as shown next to the slider. */
export function formatValue(e: Edit, m: Macro): string {
  if (m.kind === 'cycle') return m.get(e);
  const v = m.get(e);
  if (v === undefined) return `(${m.fallback.toFixed(m.digits)})`;
  return v.toFixed(m.digits);
}

/** Position 0..1 along a range slider. */
export function fraction(e: Edit, m: RangeMacro): number {
  const v = m.get(e) ?? m.fallback;
  return clamp((v - m.min) / (m.max - m.min), 0, 1);
}
