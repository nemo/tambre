import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DEFAULT_FRAME, type BellColour, type Frame, type Voice, type VoiceAdvanced } from './engine/types.js';
import { TEXTURE_MODES, type TextureMode } from './engine/texture.js';
import { PALETTE, voiceByName } from './palette.js';

export type { VoiceAdvanced } from './engine/types.js';

/**
 * Configuration model.
 *
 *   ~/.tambre/config.json   (TAMBRE_HOME overrides the directory)  user frame,
 *                           default voice, texture, volume, mute, palette
 *                           assignments per project, saved patches.
 *   <project>/tambre.json   project voice, optional frame proposal, optional
 *                           texture. Pure data, safe to commit.
 *
 * Nothing here throws on bad input: every loader returns defaults plus a list
 * of warnings, so hooks stay silent and `doctor` can explain.
 */

export type VoiceRef = string | Voice | ({ name: string } & Partial<Voice>);

export interface Patch {
  voice?: Voice;
  frame?: Frame;
  texture?: TextureMode;
}

export interface UserConfig {
  frame: Frame;
  voice: VoiceRef;
  texture: TextureMode;
  volume: number;
  mute: boolean;
  /** absolute project root -> palette voice name */
  assignments: Record<string, string>;
  patches: Record<string, Patch>;
  /** Settings files and directories `tambre install` created from nothing, so uninstall may remove them. */
  createdFiles: string[];
}

/**
 * tambre.json. A frame proposal may be partial: only the fields it names
 * override the user frame (project > user > built-in defaults, per field).
 */
export interface ProjectConfig {
  voice?: VoiceRef;
  frame?: Partial<Frame>;
  texture?: TextureMode;
}

export interface Loaded<T> {
  config: T;
  warnings: string[];
  /** Where it was (or would be) read from. */
  path: string;
  exists: boolean;
  /** Set when the file exists but is not JSON; `config` is then all defaults. */
  error?: string;
}

export interface ResolvedSession {
  voice: Voice;
  /** Where the voice came from, so a daemon adopting a session knows whether it is project-specific. */
  voiceSource: 'project' | 'assignment' | 'user';
  texture: TextureMode;
  /** The project's frame proposal over the user frame, if tambre.json carries one. */
  frame?: Frame;
  projectRoot: string;
}

export const DEFAULT_VOICE_NAME = 'moss';
export const DEFAULT_TEXTURE: TextureMode = 'hush';
export const DEFAULT_VOLUME = 0.8;
export const PROJECT_FILE = 'tambre.json';

export const BELL_COLOURS: BellColour[] = ['glass', 'wood', 'soft'];

/** Named voicing sets a frame may refer to by string. */
export const VOICING_SETS: Record<string, number[][]> = {
  default: DEFAULT_FRAME.voicings,
  dusk: DEFAULT_FRAME.voicings,
};

export function defaultUserConfig(): UserConfig {
  return {
    frame: cloneFrame(DEFAULT_FRAME),
    voice: DEFAULT_VOICE_NAME,
    texture: DEFAULT_TEXTURE,
    volume: DEFAULT_VOLUME,
    mute: false,
    assignments: {},
    patches: {},
    createdFiles: [],
  };
}

// ---- paths ----

export function tambreHome(): string {
  return process.env.TAMBRE_HOME || path.join(os.homedir(), '.tambre');
}

export function userConfigPath(): string {
  return path.join(tambreHome(), 'config.json');
}

export function projectConfigPath(root: string): string {
  return path.join(root, PROJECT_FILE);
}

// ---- small helpers ----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const cloneFrame = (f: Frame): Frame => ({ ...f, voicings: f.voicings.map((v) => [...v]) });

/** `over` wins per field; `base` fills the rest. Always a fresh object. */
export function mergeFrame(base: Frame, over: Partial<Frame> | undefined): Frame {
  const f = cloneFrame(base);
  if (!over) return f;
  if (over.root !== undefined) f.root = over.root;
  if (over.bpm !== undefined) f.bpm = over.bpm;
  if (over.chordBars !== undefined) f.chordBars = over.chordBars;
  if (over.voicings !== undefined) f.voicings = over.voicings.map((v) => [...v]);
  return f;
}
export const cloneVoice = (v: Voice): Voice => ({
  ...v,
  movement: { ...v.movement },
  width: { ...v.width },
  ...(v.advanced ? { advanced: { ...v.advanced } } : {}),
});

function readJson(file: string): { raw: unknown; exists: boolean; warning?: string } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { raw: undefined, exists: false };
  }
  if (!text.trim()) return { raw: {}, exists: true };
  try {
    return { raw: JSON.parse(text), exists: true };
  } catch (e) {
    return { raw: undefined, exists: true, warning: `${file}: not valid JSON (${(e as Error).message}); using defaults` };
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// ---- validation ----

export function validateTexture(raw: unknown, where: string, warnings: string[]): TextureMode | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && (TEXTURE_MODES as string[]).includes(raw)) return raw as TextureMode;
  warnings.push(`${where}: texture must be one of ${TEXTURE_MODES.join(', ')}; got ${JSON.stringify(raw)}`);
  return undefined;
}

/** A frame with every field checked; missing or bad fields fall back to `base` (DEFAULT_FRAME). */
export function validateFrame(raw: unknown, where: string, warnings: string[], base: Frame = DEFAULT_FRAME): Frame | undefined {
  const partial = validatePartialFrame(raw, where, warnings);
  return partial ? mergeFrame(base, partial) : undefined;
}

/** Only the frame fields present and valid in `raw`; the rest are left for the caller to fill. */
export function validatePartialFrame(raw: unknown, where: string, warnings: string[]): Partial<Frame> | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) {
    warnings.push(`${where}: frame must be an object; ignored`);
    return undefined;
  }
  const f: Partial<Frame> = {};
  if (raw.root !== undefined) {
    if (isNum(raw.root)) {
      const r = Math.round(raw.root);
      const c = clamp(r, 38, 50);
      if (c !== r) warnings.push(`${where}: frame.root ${r} clamped to ${c}`);
      f.root = c;
    } else warnings.push(`${where}: frame.root must be a MIDI note number`);
  }
  if (raw.voicings !== undefined) {
    if (typeof raw.voicings === 'string') {
      const set = VOICING_SETS[raw.voicings];
      if (set) f.voicings = set.map((v) => [...v]);
      else warnings.push(`${where}: unknown voicing set "${raw.voicings}"`);
    } else if (
      Array.isArray(raw.voicings) && raw.voicings.length > 0 &&
      raw.voicings.every((v) => Array.isArray(v) && v.length > 0 && v.every(isNum))
    ) {
      f.voicings = (raw.voicings as number[][]).map((v) => v.map(Math.round));
    } else warnings.push(`${where}: frame.voicings must be a named set or an array of semitone arrays`);
  }
  if (raw.bpm !== undefined) {
    if (isNum(raw.bpm) && raw.bpm > 0) f.bpm = clamp(raw.bpm, 20, 200);
    else warnings.push(`${where}: frame.bpm must be a positive number`);
  }
  if (raw.chordBars !== undefined) {
    if (isNum(raw.chordBars) && raw.chordBars > 0) f.chordBars = clamp(Math.round(raw.chordBars), 1, 32);
    else warnings.push(`${where}: frame.chordBars must be a positive number`);
  }
  return f;
}

function validateAdvanced(raw: unknown, where: string, warnings: string[]): VoiceAdvanced | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) { warnings.push(`${where}: voice.advanced must be an object; ignored`); return undefined; }
  const out: VoiceAdvanced = {};
  for (const k of ['attack', 'release', 'resonance', 'fmRatio', 'reverb'] as const) {
    if (raw[k] === undefined) continue;
    if (isNum(raw[k])) out[k] = raw[k] as number;
    else warnings.push(`${where}: voice.advanced.${k} must be a number`);
  }
  return out;
}

/**
 * Checks a VoiceRef shape. Returns undefined (with a warning) when it is not
 * usable at all; otherwise the ref with obviously bad fields dropped.
 */
export function validateVoiceRef(raw: unknown, where: string, warnings: string[]): VoiceRef | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string') {
    if (voiceByName(raw)) return raw;
    warnings.push(`${where}: unknown palette voice "${raw}"`);
    return undefined;
  }
  if (!isObj(raw)) {
    warnings.push(`${where}: voice must be a palette name or an object`);
    return undefined;
  }
  if (typeof raw.name !== 'string' || !raw.name) {
    warnings.push(`${where}: voice object needs a "name"`);
    return undefined;
  }
  const out: { name: string } & Partial<Voice> = { name: raw.name };
  const num = (k: 'timbre' | 'brightness', lo: number, hi: number) => {
    if (raw[k] === undefined) return;
    if (isNum(raw[k])) out[k] = clamp(raw[k] as number, lo, hi);
    else warnings.push(`${where}: voice.${k} must be a number`);
  };
  num('timbre', 0, 1);
  num('brightness', 0, 1);
  if (raw.register !== undefined) {
    if (isNum(raw.register)) out.register = clamp(Math.round(raw.register), -1, 1);
    else warnings.push(`${where}: voice.register must be -1, 0 or 1`);
  }
  if (raw.movement !== undefined) {
    if (isObj(raw.movement) && isNum(raw.movement.depth) && isNum(raw.movement.rate)) {
      out.movement = { depth: clamp(raw.movement.depth, 0, 1), rate: clamp(raw.movement.rate, 0, 2) };
    } else warnings.push(`${where}: voice.movement needs numeric depth and rate`);
  }
  if (raw.width !== undefined) {
    if (isObj(raw.width) && isNum(raw.width.detune) && isNum(raw.width.pan)) {
      out.width = { detune: clamp(raw.width.detune, 0, 30), pan: clamp(raw.width.pan, -1, 1) };
    } else warnings.push(`${where}: voice.width needs numeric detune and pan`);
  }
  if (raw.bell !== undefined) {
    if (typeof raw.bell === 'string' && (BELL_COLOURS as string[]).includes(raw.bell)) out.bell = raw.bell as BellColour;
    else warnings.push(`${where}: voice.bell must be one of ${BELL_COLOURS.join(', ')}`);
  }
  const adv = validateAdvanced(raw.advanced, where, warnings);
  if (adv) out.advanced = adv;
  return out;
}

function validateVolume(raw: unknown, where: string, warnings: string[]): number | undefined {
  if (raw === undefined) return undefined;
  if (isNum(raw)) return clamp(raw, 0, 1);
  warnings.push(`${where}: volume must be a number 0..1`);
  return undefined;
}

export function validateUserConfig(raw: unknown, where = 'config.json'): { config: UserConfig; warnings: string[] } {
  const warnings: string[] = [];
  const c = defaultUserConfig();
  if (raw === undefined || raw === null) return { config: c, warnings };
  if (!isObj(raw)) {
    warnings.push(`${where}: top level must be an object; using defaults`);
    return { config: c, warnings };
  }
  c.frame = validateFrame(raw.frame, where, warnings) ?? c.frame;
  c.voice = validateVoiceRef(raw.voice, where, warnings) ?? c.voice;
  c.texture = validateTexture(raw.texture, where, warnings) ?? c.texture;
  c.volume = validateVolume(raw.volume, where, warnings) ?? c.volume;
  if (raw.mute !== undefined) {
    if (typeof raw.mute === 'boolean') c.mute = raw.mute;
    else warnings.push(`${where}: mute must be true or false`);
  }
  if (raw.assignments !== undefined) {
    if (isObj(raw.assignments)) {
      for (const [root, name] of Object.entries(raw.assignments)) {
        if (typeof name === 'string' && voiceByName(name)) c.assignments[root] = name;
        else warnings.push(`${where}: assignments[${JSON.stringify(root)}] is not a palette voice name`);
      }
    } else warnings.push(`${where}: assignments must be an object`);
  }
  if (raw.createdFiles !== undefined) {
    if (Array.isArray(raw.createdFiles) && raw.createdFiles.every((f) => typeof f === 'string')) c.createdFiles = [...(raw.createdFiles as string[])];
    else warnings.push(`${where}: createdFiles must be a list of paths`);
  }
  if (raw.patches !== undefined) {
    if (isObj(raw.patches)) {
      for (const [name, p] of Object.entries(raw.patches)) {
        if (!isObj(p)) { warnings.push(`${where}: patches.${name} must be an object`); continue; }
        const w = `${where}: patches.${name}`;
        const patch: Patch = {};
        const ref = validateVoiceRef(p.voice, w, warnings);
        if (ref !== undefined) patch.voice = resolveVoice(ref);
        const frame = validateFrame(p.frame, w, warnings);
        if (frame) patch.frame = frame;
        const texture = validateTexture(p.texture, w, warnings);
        if (texture) patch.texture = texture;
        c.patches[name] = patch;
      }
    } else warnings.push(`${where}: patches must be an object`);
  }
  return { config: c, warnings };
}

export function validateProjectConfig(raw: unknown, where = PROJECT_FILE): { config: ProjectConfig; warnings: string[] } {
  const warnings: string[] = [];
  const c: ProjectConfig = {};
  if (raw === undefined || raw === null) return { config: c, warnings };
  if (!isObj(raw)) {
    warnings.push(`${where}: top level must be an object; ignored`);
    return { config: c, warnings };
  }
  const voice = validateVoiceRef(raw.voice, where, warnings);
  if (voice !== undefined) c.voice = voice;
  const frame = validatePartialFrame(raw.frame, where, warnings);
  if (frame && Object.keys(frame).length) c.frame = frame;
  const texture = validateTexture(raw.texture, where, warnings);
  if (texture) c.texture = texture;
  return { config: c, warnings };
}

// ---- loading and saving ----

/** The user config with warnings and provenance. Never throws. */
export function readUserConfig(): Loaded<UserConfig> {
  const file = userConfigPath();
  const { raw, exists, warning } = readJson(file);
  const { config, warnings } = validateUserConfig(raw, file);
  if (warning) warnings.unshift(warning);
  return { config, warnings, path: file, exists, ...(warning ? { error: warning } : {}) };
}

/** The user config, defaults filled in, warnings dropped. Never throws. */
export function loadUserConfig(): UserConfig {
  return readUserConfig().config;
}

/**
 * Merge `partial` into the user config file and write it back pretty-printed.
 * `assignments` and `patches` merge one level deep; a `null` entry removes a key.
 * Unknown keys already in the file are kept. Returns what is now on disk.
 *
 * Throws a ConfigError when the file exists but is not JSON: a hand-edited
 * file with a syntax slip must never be replaced by just the patch.
 */
export type UserConfigPatch = Omit<Partial<UserConfig>, 'assignments' | 'patches'> & {
  assignments?: Record<string, string | null>;
  patches?: Record<string, Patch | null>;
};

export class ConfigError extends Error {
  constructor(message: string, public readonly file: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function saveUserConfig(partial: UserConfigPatch): UserConfig {
  const file = userConfigPath();
  const { raw, warning } = readJson(file);
  if (warning) throw new ConfigError(`${file} is not valid JSON; fix it before saving`, file);
  const base: Record<string, unknown> = isObj(raw) ? { ...raw } : {};
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    if ((k === 'assignments' || k === 'patches') && isObj(v)) {
      const existing = isObj(base[k]) ? { ...(base[k] as Record<string, unknown>) } : {};
      for (const [name, entry] of Object.entries(v)) {
        if (entry === null) delete existing[name];
        else existing[name] = entry;
      }
      base[k] = existing;
    } else {
      base[k] = v;
    }
  }
  writeJson(file, base);
  return validateUserConfig(base, file).config;
}

export function readProjectConfig(root: string): Loaded<ProjectConfig> {
  const file = projectConfigPath(root);
  const { raw, exists, warning } = readJson(file);
  const { config, warnings } = validateProjectConfig(raw, file);
  if (warning) warnings.unshift(warning);
  return { config, warnings, path: file, exists, ...(warning ? { error: warning } : {}) };
}

/** The project's tambre.json, or null when the project has none. Never throws. */
export function loadProjectConfig(root: string): ProjectConfig | null {
  const r = readProjectConfig(root);
  return r.exists ? r.config : null;
}

/** Overwrite tambre.json with exactly `config`. Prefer updateProjectConfig to keep what else is in the file. */
export function saveProjectConfig(root: string, config: ProjectConfig): void {
  writeJson(projectConfigPath(root), config);
}

/**
 * Merge `patch` into tambre.json as it is on disk: keys the file already has
 * (known or not) are kept, `undefined` leaves a key alone, `null` removes it.
 * Throws a ConfigError rather than overwrite a file that is not JSON.
 */
export function updateProjectConfig(root: string, patch: { [K in keyof ProjectConfig]?: ProjectConfig[K] | null }): void {
  const file = projectConfigPath(root);
  const { raw, warning } = readJson(file);
  if (warning) throw new ConfigError(`${file} is not valid JSON; fix it before saving`, file);
  const base: Record<string, unknown> = isObj(raw) ? { ...raw } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete base[k];
    else base[k] = v;
  }
  writeJson(file, base);
}

// ---- project root ----

function gitToplevel(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
      encoding: 'utf8',
    }).trim();
    return out ? out : null;
  } catch {
    return null;
  }
}

/**
 * Nearest ancestor of cwd (inclusive) holding tambre.json, else the git
 * toplevel, else cwd itself. Inside a git checkout the search for tambre.json
 * stops at that checkout's toplevel: a tambre.json in $HOME (or any other
 * ancestor) must not capture every repo beneath it. Always absolute, with
 * symlinks resolved so that a root recorded by a hook (given the agent's cwd)
 * compares equal to one resolved from process.cwd() (which macOS reports
 * under /private/tmp, etc.).
 */
export function findProjectRoot(cwd: string = process.cwd()): string {
  const real = (p: string) => { try { return fs.realpathSync(p); } catch { return p; } };
  const start = real(path.resolve(cwd));
  const top = gitToplevel(cwd);
  const bound = top ? real(top) : null;
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, PROJECT_FILE))) return dir;
    if (bound !== null && dir === bound) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return bound ?? start;
}

// ---- resolution ----

const DEFAULT_VOICE = (): Voice => cloneVoice(voiceByName(DEFAULT_VOICE_NAME) ?? PALETTE[0]);

/**
 * Turn a VoiceRef into a full Voice: a palette name, a full voice object, or a
 * palette name plus overrides. A custom name with missing fields is filled from
 * the default voice.
 */
export function resolveVoice(ref: VoiceRef | undefined): Voice {
  if (ref === undefined) return DEFAULT_VOICE();
  if (typeof ref === 'string') return cloneVoice(voiceByName(ref) ?? DEFAULT_VOICE());
  if (!isObj(ref) || typeof ref.name !== 'string') return DEFAULT_VOICE();
  const base = cloneVoice(voiceByName(ref.name) ?? DEFAULT_VOICE());
  const out: Voice = { ...base, name: ref.name };
  if (isNum(ref.timbre)) out.timbre = ref.timbre;
  if (isNum(ref.register)) out.register = ref.register;
  if (isNum(ref.brightness)) out.brightness = ref.brightness;
  if (isObj(ref.movement)) out.movement = { ...base.movement, ...ref.movement };
  if (isObj(ref.width)) out.width = { ...base.width, ...ref.width };
  if (typeof ref.bell === 'string') out.bell = ref.bell;
  if (isObj(ref.advanced)) out.advanced = { ...(base.advanced ?? {}), ...ref.advanced };
  return out;
}

/**
 * Everything a session needs to announce itself: project voice if tambre.json
 * has one, else the palette voice assigned to this project, else the user
 * default. Texture: project, else user. Frame: the project's proposal only.
 */
export function resolveSession(cwd: string = process.cwd(), opts: { user?: UserConfig; root?: string } = {}): ResolvedSession {
  const projectRoot = opts.root ?? findProjectRoot(cwd);
  const user = opts.user ?? loadUserConfig();
  const project = loadProjectConfig(projectRoot);
  const [ref, voiceSource]: [VoiceRef, ResolvedSession['voiceSource']] =
    project?.voice !== undefined ? [project.voice, 'project']
      : user.assignments[projectRoot] !== undefined ? [user.assignments[projectRoot], 'assignment']
        : [user.voice, 'user'];
  return {
    voice: resolveVoice(ref),
    voiceSource,
    texture: project?.texture ?? user.texture,
    frame: project?.frame ? mergeFrame(user.frame, project.frame) : undefined,
    projectRoot,
  };
}

/** The first palette voice no project is assigned to; wraps once all eight are taken. */
export function nextUnusedPaletteVoice(user: UserConfig): string {
  const taken = new Set(Object.values(user.assignments));
  const free = PALETTE.find((v) => !taken.has(v.name));
  if (free) return free.name;
  return PALETTE[Object.keys(user.assignments).length % PALETTE.length].name;
}
