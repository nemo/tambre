import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  findProjectRoot, loadProjectConfig, loadUserConfig, nextUnusedPaletteVoice, readProjectConfig, readUserConfig,
  resolveSession, resolveVoice, saveUserConfig, updateProjectConfig, userConfigPath, validateUserConfig, validateFrame,
  ConfigError, DEFAULT_TEXTURE, DEFAULT_VOLUME,
} from './config.js';
import { DEFAULT_FRAME } from './engine/types.js';
import { PALETTE, voiceByName } from './palette.js';

let home: string;
let project: string;
const savedEnv = { TAMBRE_HOME: process.env.TAMBRE_HOME };

const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const writeUser = (v: unknown) => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(userConfigPath(), typeof v === 'string' ? v : JSON.stringify(v));
};
const writeProject = (dir: string, v: unknown) =>
  fs.writeFileSync(path.join(dir, 'tambre.json'), typeof v === 'string' ? v : JSON.stringify(v));

beforeEach(() => {
  home = tmp('tambre-home-');
  project = tmp('tambre-proj-');
  process.env.TAMBRE_HOME = home;
});

afterEach(() => {
  process.env.TAMBRE_HOME = savedEnv.TAMBRE_HOME;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

describe('defaults', () => {
  it('user config is all defaults when no file exists', () => {
    const r = readUserConfig();
    expect(r.exists).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(r.config).toEqual({
      frame: DEFAULT_FRAME,
      voice: 'moss',
      texture: DEFAULT_TEXTURE,
      volume: DEFAULT_VOLUME,
      mute: false,
      assignments: {},
      patches: {},
      createdFiles: [],
    });
    expect(r.path).toBe(path.join(home, 'config.json'));
  });

  it('project config is null when no tambre.json exists', () => {
    expect(loadProjectConfig(project)).toBeNull();
    expect(readProjectConfig(project).exists).toBe(false);
  });

  it('resolveSession falls back to the user default voice and texture', () => {
    const r = resolveSession(project);
    expect(r.voice).toEqual(voiceByName('moss'));
    expect(r.texture).toBe(DEFAULT_TEXTURE);
    expect(r.frame).toBeUndefined();
    expect(r.projectRoot).toBe(project);
  });
});

describe('project overrides user', () => {
  it('project voice, texture and frame win over user settings', () => {
    writeUser({ voice: 'felt', texture: 'drone', frame: { root: 45 } });
    writeProject(project, { voice: 'glass', texture: 'rain', frame: { root: 40, bpm: 64 } });
    const r = resolveSession(project);
    expect(r.voice.name).toBe('glass');
    expect(r.texture).toBe('rain');
    expect(r.frame).toEqual({ ...DEFAULT_FRAME, root: 40, bpm: 64 });
    expect(r.projectRoot).toBe(project);
  });

  it('a partial project frame overrides the user frame per field, not the built-in defaults', () => {
    writeUser({ frame: { bpm: 70, chordBars: 8 } });
    writeProject(project, { voice: 'glass', frame: { root: 45 } });
    const r = resolveSession(project);
    expect(r.frame).toEqual({ ...DEFAULT_FRAME, root: 45, bpm: 70, chordBars: 8 });
    expect(readProjectConfig(project).config.frame).toEqual({ root: 45 }); // stored partial
    // validateFrame fills from the base it is given
    expect(validateFrame({ root: 40 }, 'x', [], { ...DEFAULT_FRAME, bpm: 99 })).toEqual({ ...DEFAULT_FRAME, root: 40, bpm: 99 });
  });

  it('a project without a texture inherits the user texture', () => {
    writeUser({ texture: 'pulse' });
    writeProject(project, { voice: 'reed' });
    expect(resolveSession(project).texture).toBe('pulse');
  });

  it('a palette assignment is used when the project file has no voice', () => {
    writeUser({ assignments: { [project]: 'tide' } });
    writeProject(project, {});
    expect(resolveSession(project).voice.name).toBe('tide');
  });

  it('the project voice beats the assignment', () => {
    writeUser({ assignments: { [project]: 'tide' } });
    writeProject(project, { voice: 'wire' });
    expect(resolveSession(project).voice.name).toBe('wire');
  });
});

describe('resolveVoice', () => {
  it('a palette name', () => {
    const v = resolveVoice('brass');
    expect(v).toEqual(voiceByName('brass'));
    expect(v).not.toBe(voiceByName('brass')); // a copy, not the palette entry
  });

  it('an unknown name falls back to the default voice', () => {
    expect(resolveVoice('nope').name).toBe('moss');
    expect(resolveVoice(undefined).name).toBe('moss');
  });

  it('a full voice object passes through', () => {
    const custom = {
      name: 'mine', timbre: 0.3, register: 1, brightness: 0.9,
      movement: { depth: 0.1, rate: 0.2 }, width: { detune: 2, pan: 0.1 }, bell: 'wood' as const,
    };
    expect(resolveVoice(custom)).toEqual(custom);
  });

  it('a name plus overrides merges onto the palette voice, deep for movement and width', () => {
    const v = resolveVoice({ name: 'cedar', brightness: 0.8, width: { pan: 0.2 }, advanced: { reverb: 0.4 } } as never);
    const base = voiceByName('cedar')!;
    expect(v.name).toBe('cedar');
    expect(v.brightness).toBe(0.8);
    expect(v.width).toEqual({ detune: base.width.detune, pan: 0.2 });
    expect(v.movement).toEqual(base.movement);
    expect(v.register).toBe(base.register);
    expect(v.advanced).toEqual({ reverb: 0.4 });
  });

  it('a custom name with missing fields is filled from the default voice', () => {
    const v = resolveVoice({ name: 'custom', timbre: 0.7 });
    expect(v.name).toBe('custom');
    expect(v.timbre).toBe(0.7);
    expect(v.bell).toBe(voiceByName('moss')!.bell);
  });
});

describe('findProjectRoot', () => {
  it('tambre.json in an ancestor beats the git root', () => {
    execFileSync('git', ['init', '-q'], { cwd: project });
    const sub = path.join(project, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    writeProject(path.join(project, 'packages'), {});
    expect(findProjectRoot(sub)).toBe(path.join(project, 'packages'));
  });

  it('git root when there is no tambre.json', () => {
    execFileSync('git', ['init', '-q'], { cwd: project });
    const sub = path.join(project, 'a', 'b');
    fs.mkdirSync(sub, { recursive: true });
    expect(findProjectRoot(sub)).toBe(project);
  });

  it('stops at the git toplevel: a tambre.json above the repo does not capture it', () => {
    // outer/ is a checkout with tambre.json (think: a dotfiles $HOME); outer/code/app is its own repo
    const outer = project;
    writeProject(outer, { voice: 'moss' });
    execFileSync('git', ['init', '-q'], { cwd: outer });
    const inner = path.join(outer, 'code', 'app');
    fs.mkdirSync(path.join(inner, 'src'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: inner });
    expect(findProjectRoot(path.join(inner, 'src'))).toBe(inner);
    expect(findProjectRoot(inner)).toBe(inner);
    // a tambre.json inside the inner repo still wins over its toplevel
    writeProject(path.join(inner, 'src'), {});
    expect(findProjectRoot(path.join(inner, 'src'))).toBe(path.join(inner, 'src'));
    // and the outer repo itself still resolves to its own file
    expect(findProjectRoot(path.join(outer, 'code'))).toBe(outer);
  });

  it('cwd when there is neither', () => {
    const sub = path.join(project, 'plain');
    fs.mkdirSync(sub, { recursive: true });
    // os.tmpdir() is not inside a git repo on any sane machine; guard anyway.
    const root = findProjectRoot(sub);
    expect([sub, project].includes(root) || root === findProjectRoot(project)).toBe(true);
    if (!fs.existsSync(path.join(root, '.git'))) expect(root).toBe(sub);
  });
});

describe('nextUnusedPaletteVoice', () => {
  it('skips assigned names in palette order', () => {
    const user = loadUserConfig();
    expect(nextUnusedPaletteVoice(user)).toBe('moss');
    user.assignments = { '/a': 'moss', '/b': 'brass' };
    expect(nextUnusedPaletteVoice(user)).toBe('cedar');
    user.assignments['/c'] = 'cedar';
    user.assignments['/d'] = 'reed'; // out of order: glass is still free
    expect(nextUnusedPaletteVoice(user)).toBe('glass');
  });

  it('wraps once every palette voice is taken', () => {
    const user = loadUserConfig();
    user.assignments = Object.fromEntries(PALETTE.map((v, i) => [`/p${i}`, v.name]));
    expect(nextUnusedPaletteVoice(user)).toBe(PALETTE[0].name);
    user.assignments['/p8'] = PALETTE[0].name;
    expect(nextUnusedPaletteVoice(user)).toBe(PALETTE[1].name);
  });
});

describe('malformed input', () => {
  it('unparseable user JSON gives defaults plus a warning and never throws', () => {
    writeUser('{ this is not json');
    const r = readUserConfig();
    expect(r.exists).toBe(true);
    expect(r.config.voice).toBe('moss');
    expect(r.config.volume).toBe(DEFAULT_VOLUME);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toMatch(/not valid JSON/);
    expect(() => loadUserConfig()).not.toThrow();
  });

  it('bad field types fall back individually with one warning each', () => {
    const { config, warnings } = validateUserConfig({
      frame: { root: 'G2', bpm: -1 },
      voice: 42,
      texture: 'loud',
      volume: 'high',
      mute: 'yes',
      assignments: { '/x': 'nope', '/y': 'moss' },
      patches: { good: { voice: 'brass', texture: 'rain' }, bad: 'x' },
    });
    expect(config.frame).toEqual(DEFAULT_FRAME);
    expect(config.voice).toBe('moss');
    expect(config.texture).toBe(DEFAULT_TEXTURE);
    expect(config.volume).toBe(DEFAULT_VOLUME);
    expect(config.mute).toBe(false);
    expect(config.assignments).toEqual({ '/y': 'moss' });
    expect(Object.keys(config.patches)).toEqual(['good']);
    expect(config.patches.good.voice?.name).toBe('brass');
    expect(config.patches.good.texture).toBe('rain');
    expect(warnings.length).toBeGreaterThanOrEqual(7);
  });

  it('frame root is clamped and volume is clamped', () => {
    const { config, warnings } = validateUserConfig({ frame: { root: 70 }, volume: 3 });
    expect(config.frame.root).toBe(50);
    expect(config.volume).toBe(1);
    expect(warnings.some((w) => /clamped/.test(w))).toBe(true);
  });

  it('unparseable project JSON is treated as an empty project file', () => {
    writeProject(project, 'nope');
    const r = readProjectConfig(project);
    expect(r.exists).toBe(true);
    expect(r.config).toEqual({});
    expect(r.warnings.length).toBe(1);
    expect(resolveSession(project).voice.name).toBe('moss');
  });

  it('a non-object top level is ignored', () => {
    expect(validateUserConfig([1, 2]).config.voice).toBe('moss');
    expect(validateUserConfig('str').warnings.length).toBe(1);
  });
});

describe('saveUserConfig', () => {
  it('creates the file and merges assignments and patches without losing other keys', () => {
    saveUserConfig({ volume: 0.5, assignments: { '/a': 'moss' } });
    saveUserConfig({ assignments: { '/b': 'brass' }, patches: { warm: { texture: 'hum' } } });
    const onDisk = JSON.parse(fs.readFileSync(userConfigPath(), 'utf8'));
    expect(onDisk.volume).toBe(0.5);
    expect(onDisk.assignments).toEqual({ '/a': 'moss', '/b': 'brass' });
    expect(onDisk.patches).toEqual({ warm: { texture: 'hum' } });
    saveUserConfig({ assignments: { '/a': null } });
    expect(loadUserConfig().assignments).toEqual({ '/b': 'brass' });
  });

  it('keeps unknown keys already in the file', () => {
    writeUser({ future: { x: 1 }, voice: 'tide' });
    saveUserConfig({ mute: true });
    const onDisk = JSON.parse(fs.readFileSync(userConfigPath(), 'utf8'));
    expect(onDisk.future).toEqual({ x: 1 });
    expect(onDisk.voice).toBe('tide');
    expect(onDisk.mute).toBe(true);
  });

  it('refuses to overwrite a file that is not JSON, so a syntax slip never loses patches and assignments', () => {
    const broken = '{ "voice": "tide", "assignments": { "/a": "moss" }, "patches": { "warm": { "texture": "hum" } }, }';
    writeUser(broken);
    expect(() => saveUserConfig({ mute: true })).toThrow(ConfigError);
    expect(() => saveUserConfig({ mute: true })).toThrow(/not valid JSON/);
    expect(fs.readFileSync(userConfigPath(), 'utf8')).toBe(broken);
  });
});

describe('updateProjectConfig', () => {
  it('merges into the file, keeping unknown keys and invalid user-authored values', () => {
    writeProject(project, { $schema: 'x', voice: 'tide', frame: { root: 'G2' } });
    updateProjectConfig(project, { voice: 'glass', texture: 'rain' });
    expect(JSON.parse(fs.readFileSync(path.join(project, 'tambre.json'), 'utf8')))
      .toEqual({ $schema: 'x', voice: 'glass', frame: { root: 'G2' }, texture: 'rain' });
    updateProjectConfig(project, { texture: null });
    expect(loadProjectConfig(project)).toEqual({ voice: 'glass' });
  });

  it('refuses a file that is not JSON', () => {
    writeProject(project, '{ "voice": "glass", // comment');
    expect(() => updateProjectConfig(project, { voice: 'wire' })).toThrow(ConfigError);
    expect(fs.readFileSync(path.join(project, 'tambre.json'), 'utf8')).toBe('{ "voice": "glass", // comment');
  });
});
