import fs from 'node:fs';
import path from 'node:path';
import type { Voice } from '../engine/types.js';
import type { TextureMode } from '../engine/texture.js';
import {
  findProjectRoot, loadUserConfig, saveUserConfig, updateProjectConfig, userConfigPath,
  type Patch, type VoiceRef,
} from '../config.js';
import { voiceByName } from '../palette.js';
import type { PatchEntry } from './model.js';

/** What `s` writes: one voice and its texture. */
export interface Edit {
  voice: Voice;
  texture: TextureMode;
}

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

/**
 * First run: inside a project, no tambre.json yet; outside one, no user
 * config file yet. The PALETTE page opens with its note until the first save.
 */
export function isFirstRun(cwd: string = process.cwd()): boolean {
  const t = saveTarget(cwd);
  if (t.inProject) return !fs.existsSync(path.join(t.root, 'tambre.json'));
  return !fs.existsSync(userConfigPath());
}

/** `$HOME` shown as `~`, so a saved path fits the status line. */
export const shortHome = (p: string): string => {
  const home = process.env.HOME;
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
};

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

/**
 * Write the edit as the project voice (tambre.json) or the user default.
 * Only `voice` and `texture` are touched; whatever else the file holds stays,
 * and a file that is not JSON is left alone (the error reaches the status
 * line). The palette assignment follows the voice: a tweaked voice is no
 * longer a palette voice, so the project's claim on that name is released.
 * Returns a line for the status line.
 */
export function saveDefault(edit: Edit, cwd: string = process.cwd()): string {
  const ref = voiceRefFor(edit.voice);
  const target = saveTarget(cwd);
  if (target.inProject) {
    updateProjectConfig(target.root, { voice: ref, texture: edit.texture });
    saveUserConfig({ assignments: { [target.root]: typeof ref === 'string' ? ref : null } });
    return `saved ${shortHome(path.join(target.root, 'tambre.json'))}`;
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

/** The user's saved patches, name-sorted. */
export function listPatches(): PatchEntry[] {
  const user = loadUserConfig();
  return Object.entries(user.patches)
    .filter(([, p]) => p.voice)
    .map(([name, patch]) => ({ name, patch }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
