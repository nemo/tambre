import type { Frame, Voice } from '../engine/types.js';
import { TEXTURE_MODES, type TextureMode } from '../engine/texture.js';
import { BELL_COLOURS, VOICING_SETS, VOICING_SET_NAMES, cloneFrame, cloneVoice, voicingSetName, type Patch } from '../config.js';
import { PALETTE } from '../palette.js';

/**
 * What the TUI edits: one voice and the texture it works in, plus the user
 * frame and the daemon-wide volume and mute. Pure data; the cells below are
 * the only way the TUI changes it.
 */
export interface EditState {
  voice: Voice;
  texture: TextureMode;
  frame: Frame;
  volume: number;
  mute: boolean;
}

export type Page = 'palette' | 'voice' | 'frame' | 'advanced' | 'patches';
export const PAGES: Page[] = ['palette', 'voice', 'frame', 'advanced', 'patches'];
export const PAGE_TITLES: Record<Page, string> = {
  palette: 'PALETTE', voice: 'VOICE', frame: 'FRAME', advanced: 'ADVANCED', patches: 'PATCHES',
};

/** The one ramp every range cell shares. */
export const RULER = 12;

export interface RangeCell {
  kind: 'range';
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  /** Used when the field is unset (advanced fields are optional on a voice). */
  fallback: number;
  get(s: EditState): number | undefined;
  set(s: EditState, v: number): EditState;
  /** Shown instead of the number, e.g. a note name for a MIDI root. */
  format?(v: number): string;
  /** Part of the user frame: locked while real sessions are live. */
  frame?: boolean;
  /** A short word on the label line, e.g. `stored` for fields the engine ignores. */
  tag?: string;
  note?: string;
}

export interface CycleCell {
  kind: 'cycle';
  id: string;
  label: string;
  options: readonly string[];
  get(s: EditState): string;
  set(s: EditState, v: string): EditState;
  frame?: boolean;
  tag?: string;
  note?: string;
}

/** A palette voice or a saved patch: Enter loads it, space auditions it. */
export interface PickCell {
  kind: 'pick';
  id: string;
  label: string;
  /** The large line: a two-word character for a palette voice, the voice name for a patch. */
  value: string;
  /** The small third line. */
  sub: string;
  voice: Voice;
  texture?: TextureMode;
  /** True when this is the voice in the editor. */
  loaded: boolean;
}

export interface BlankCell { kind: 'blank'; id: string }

export type Cell = RangeCell | CycleCell | PickCell | BlankCell;

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi: number): string => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** Two words per palette voice, from the listening notes. */
export const CHARACTER: Record<string, string> = {
  moss: 'dark, soft',
  brass: 'bright, glassy',
  cedar: 'low, wooden',
  glass: 'high, bright',
  reed: 'reedy, wooden',
  tide: 'low, moving',
  wire: 'high, brightest',
  felt: 'pure, darkest',
};

const withVoice = (s: EditState, f: (v: Voice) => void): EditState => {
  const voice = cloneVoice(s.voice);
  f(voice);
  return { ...s, voice };
};

const withFrame = (s: EditState, f: (fr: Frame) => void): EditState => {
  const frame = cloneFrame(s.frame);
  f(frame);
  return { ...s, frame };
};

const range = (
  id: string, label: string, min: number, max: number, step: number, digits: number,
  get: RangeCell['get'], set: RangeCell['set'], extra: Partial<RangeCell> = {},
): RangeCell => ({ kind: 'range', id, label, min, max, step, digits, fallback: 0, get, set, ...extra });

const advanced = (
  id: 'attack' | 'release' | 'resonance' | 'fmRatio' | 'reverb',
  label: string, min: number, max: number, step: number, fallback: number, extra: Partial<RangeCell> = {},
): RangeCell => range(id, label, min, max, step, 2,
  (s) => s.voice.advanced?.[id],
  (s, v) => withVoice(s, (voice) => { voice.advanced = { ...(voice.advanced ?? {}), [id]: v }; }),
  { fallback, ...extra });

const blank = (n: number): BlankCell => ({ kind: 'blank', id: `blank-${n}` });

/** The VOICE page: timbre, register, brightness, bell · move depth, move rate, detune, pan. */
export const VOICE_CELLS: Cell[] = [
  range('timbre', 'timbre', 0, 1, 0.05, 2, (s) => s.voice.timbre, (s, v) => withVoice(s, (x) => { x.timbre = v; }),
    { note: '0 triangle, 1 saw' }),
  range('register', 'register', -1, 1, 1, 0, (s) => s.voice.register, (s, v) => withVoice(s, (x) => { x.register = v; }),
    { format: (v) => (v > 0 ? `+${v}` : String(v)), note: 'octave offset' }),
  range('brightness', 'brightness', 0, 1, 0.05, 2, (s) => s.voice.brightness, (s, v) => withVoice(s, (x) => { x.brightness = v; }),
    { note: 'filter cutoff' }),
  { kind: 'cycle', id: 'bell', label: 'bell', options: BELL_COLOURS,
    get: (s) => s.voice.bell, set: (s, v) => withVoice(s, (x) => { x.bell = v as Voice['bell']; }), note: 'one-shot colour' },
  range('movement.depth', 'move depth', 0, 1, 0.05, 2, (s) => s.voice.movement.depth, (s, v) => withVoice(s, (x) => { x.movement.depth = v; })),
  range('movement.rate', 'move rate', 0, 0.5, 0.01, 2, (s) => s.voice.movement.rate, (s, v) => withVoice(s, (x) => { x.movement.rate = v; }),
    { note: 'Hz' }),
  range('width.detune', 'detune', 0, 30, 1, 0, (s) => s.voice.width.detune, (s, v) => withVoice(s, (x) => { x.width.detune = v; }),
    { note: 'cents between the pair' }),
  range('width.pan', 'pan', -1, 1, 0.05, 2, (s) => s.voice.width.pan, (s, v) => withVoice(s, (x) => { x.width.pan = v; }),
    { format: (v) => (v === 0 ? 'centre' : v < 0 ? `L ${Math.abs(v).toFixed(2)}` : `R ${v.toFixed(2)}`) }),
];

/** FRAME: texture, root, voicing set, tempo · chord bars, volume, mute all, blank. */
export const FRAME_CELLS: Cell[] = [
  { kind: 'cycle', id: 'texture', label: 'texture', options: TEXTURE_MODES,
    get: (s) => s.texture, set: (s, v) => ({ ...s, texture: v as TextureMode }), note: 'what this voice does while working' },
  range('frame.root', 'root', 38, 50, 1, 0, (s) => s.frame.root, (s, v) => withFrame(s, (f) => { f.root = v; }),
    { format: noteName, frame: true, note: 'the pedal every session shares' }),
  { kind: 'cycle', id: 'frame.voicings', label: 'voicings', options: VOICING_SET_NAMES,
    get: (s) => voicingSetName(s.frame.voicings) ?? 'custom',
    set: (s, v) => withFrame(s, (f) => { const set = VOICING_SETS[v]; if (set) f.voicings = set.map((x) => [...x]); }),
    frame: true, note: 'four chords that cycle over the root' },
  range('frame.bpm', 'tempo', 40, 90, 2, 0, (s) => s.frame.bpm, (s, v) => withFrame(s, (f) => { f.bpm = v; }),
    { format: (v) => `${v} bpm`, frame: true }),
  range('frame.chordBars', 'chord bars', 1, 8, 1, 0, (s) => s.frame.chordBars, (s, v) => withFrame(s, (f) => { f.chordBars = v; }),
    { frame: true, note: 'bars per chord' }),
  range('volume', 'volume', 0, 1, 0.05, 2, (s) => s.volume, (s, v) => ({ ...s, volume: v })),
  { kind: 'cycle', id: 'mute', label: 'mute all', options: ['off', 'on'],
    get: (s) => (s.mute ? 'on' : 'off'), set: (s, v) => ({ ...s, mute: v === 'on' }) },
  blank(0),
];

/** ADVANCED: attack, release, resonance, fm ratio · reverb, blank ×3. */
export const ADVANCED_CELLS: Cell[] = [
  advanced('attack', 'attack', 0.05, 5, 0.05, 0.35, { note: 'seconds, on session.start' }),
  advanced('release', 'release', 0.05, 10, 0.05, 0.7, { note: 'seconds, on waiting' }),
  advanced('resonance', 'resonance', 0, 1, 0.05, 0.7, { note: 'filter Q' }),
  advanced('fmRatio', 'fm ratio', 0, 8, 0.5, 1, { tag: 'stored', note: 'kept on the voice; the engine does not render it yet' }),
  advanced('reverb', 'reverb', 0, 1, 0.05, 0, { tag: 'stored', note: 'kept on the voice; the engine does not render it yet' }),
  blank(1), blank(2), blank(3),
];

export const paletteCells = (loaded: string): Cell[] =>
  PALETTE.map((v): PickCell => ({
    kind: 'pick', id: `palette.${v.name}`, label: v.name, value: CHARACTER[v.name] ?? '',
    sub: `${v.bell} bell`, voice: v, loaded: v.name === loaded,
  }));

export interface PatchEntry { name: string; patch: Patch }

export const PATCHES_PER_PAGE = 8;

export function patchCells(patches: PatchEntry[], page: number, loaded: string): Cell[] {
  const start = page * PATCHES_PER_PAGE;
  const slice = patches.slice(start, start + PATCHES_PER_PAGE);
  const cells: Cell[] = slice
    .filter((p) => p.patch.voice)
    .map((p): PickCell => ({
      kind: 'pick', id: `patch.${p.name}`, label: p.name,
      value: p.patch.voice!.name, sub: p.patch.texture ?? '',
      voice: p.patch.voice as Voice, texture: p.patch.texture, loaded: p.name === loaded,
    }));
  while (cells.length < PATCHES_PER_PAGE) cells.push(blank(cells.length + 10));
  return cells;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Move a cell one step in `dir`. Cycles wrap. */
export function adjust(s: EditState, c: Cell, dir: -1 | 1): EditState {
  if (c.kind === 'cycle') {
    const i = c.options.indexOf(c.get(s));
    const n = c.options.length;
    return c.set(s, c.options[((i < 0 ? 0 : i) + dir + n) % n]);
  }
  if (c.kind !== 'range') return s;
  const cur = c.get(s) ?? c.fallback;
  return setRange(s, c, cur + dir * c.step);
}

/** Set a range cell to an exact value, snapped to its step and clamped. */
export function setRange(s: EditState, c: RangeCell, v: number): EditState {
  const snapped = Math.round((v - c.min) / c.step) * c.step + c.min;
  const scale = Math.pow(10, Math.max(c.digits, 2));
  return c.set(s, Math.round(clamp(snapped, c.min, c.max) * scale) / scale);
}

/** Set a range cell from a 0..1 position along its ruler. */
export const setFraction = (s: EditState, c: RangeCell, f: number): EditState =>
  setRange(s, c, c.min + clamp(f, 0, 1) * (c.max - c.min));

export function formatValue(s: EditState, c: Cell): string {
  if (c.kind === 'cycle') return c.get(s);
  if (c.kind === 'pick') return c.value;
  if (c.kind !== 'range') return '';
  const v = c.get(s);
  if (v === undefined) return c.format ? c.format(c.fallback) : c.fallback.toFixed(c.digits);
  return c.format ? c.format(v) : v.toFixed(c.digits);
}

/** Position 0..1 along a range cell's ruler. */
export function fraction(s: EditState, c: RangeCell): number {
  const v = c.get(s) ?? c.fallback;
  return clamp((v - c.min) / (c.max - c.min), 0, 1);
}
