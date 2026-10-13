import fs from 'node:fs';
import path from 'node:path';
import type { Voice } from '../engine/types.js';
import {
  findProjectRoot, loadUserConfig, readProjectConfig, saveProjectConfig, saveUserConfig,
  type Patch, type VoiceRef,
} from '../config.js';
import { PALETTE, voiceByName } from '../palette.js';
import type { Edit } from './macros.js';

/**
 * Where 's' writes: the project's tambre.json when the TUI runs inside a
 * project (a tambre.json ancestor or a git checkout), else the user default
 * in ~/.tambre/config.json. 'S' always writes a named patch to the user config.
 */
export interface SaveTarget {
  root: string;
  inProject: boolean;
}

export function saveTarget(cwd: string = process.cwd()): SaveTarget {
  const root = findProjectRoot(cwd);
  const inProject = fs.existsSync(path.join(root, 'tambre.json')) || fs.existsSync(path.join(root, '.git'));
  return { root, inProject };
}

const sameVoice = (a: Voice, b: Voice): boolean =>
  a.timbre === b.timbre && a.register === b.register && a.brightness === b.brightness &&
  a.movement.depth === b.movement.depth && a.movement.rate === b.movement.rate &&
  a.width.detune === b.width.detune && a.width.pan === b.width.pan && a.bell === b.bell &&
  JSON.stringify(a.advanced ?? {}) === JSON.stringify(b.advanced ?? {});

/** A palette name when the voice is an untouched palette voice, else the full object. */
export function voiceRefFor(voice: Voice): VoiceRef {
  const base = voiceByName(voice.name);
  if (base && sameVoice(base, voice)) return voice.name;
  return voice;
}

/** Write the edit as the project voice (tambre.json) or the user default. Returns a line for the status bar. */
export function saveDefault(edit: Edit, cwd: string = process.cwd()): string {
  const ref = voiceRefFor(edit.voice);
  const target = saveTarget(cwd);
  if (target.inProject) {
    const existing = readProjectConfig(target.root).config;
    saveProjectConfig(target.root, { ...existing, voice: ref, texture: edit.texture });
    if (typeof ref === 'string') saveUserConfig({ assignments: { [target.root]: ref } });
    return `saved ${path.join(target.root, 'tambre.json')}`;
  }
  saveUserConfig({ voice: ref, texture: edit.texture });
  return 'saved as user default';
}

/** Write the edit as a named patch in the user config. */
export function savePatch(name: string, edit: Edit): string {
  const trimmed = name.trim();
  if (!trimmed) return 'patch name is empty; nothing saved';
  const patch: Patch = { voice: { ...edit.voice }, texture: edit.texture };
  saveUserConfig({ patches: { [trimmed]: patch } });
  return `saved patch "${trimmed}"`;
}

/** What the left column lists: the palette, then the saved patches. */
export interface Preset {
  kind: 'palette' | 'patch';
  name: string;
  voice: Voice;
  /** Patches may carry a texture; palette voices never do. */
  texture?: Edit['texture'];
}

export function listPresets(): Preset[] {
  const user = loadUserConfig();
  const palette: Preset[] = PALETTE.map((v) => ({ kind: 'palette', name: v.name, voice: v }));
  const patches: Preset[] = Object.entries(user.patches)
    .filter(([, p]) => p.voice)
    .map(([name, p]) => ({ kind: 'patch', name, voice: p.voice as Voice, texture: p.texture }));
  return [...palette, ...patches];
}
