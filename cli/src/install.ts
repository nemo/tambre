import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Adapter, HookGroup, HooksBlock, InstallScope } from './adapters/types.js';
import { isObj } from './adapters/types.js';
import {
  findProjectRoot, loadUserConfig, nextUnusedPaletteVoice, projectConfigPath, readProjectConfig,
  saveProjectConfig, saveUserConfig, validateTexture, validateVoiceRef, type ProjectConfig,
} from './config.js';
import type { TextureMode } from './engine/texture.js';
import { voiceByName } from './palette.js';

/**
 * `tambre install` / `tambre uninstall`.
 *
 * Project scope (the default inside a git repo): write <root>/tambre.json if
 * absent, record the palette assignment in the user config, and merge hook
 * entries into the agent's LOCAL settings file (never a committed one).
 * User scope: merge into the agent's user settings file.
 *
 * Merge means: read the existing JSON, drop any entries we wrote before
 * (they carry "tambre": true), add ours, keep everything else, write back
 * pretty-printed. A second install changes nothing on disk.
 */

export interface InstallOpts {
  adapters: Adapter[];
  scope?: InstallScope;
  cwd?: string;
  /** Palette voice name for the project file (or the user default). */
  voice?: string;
  texture?: string;
  /** The hook command line; defaults to this binary's absolute path. */
  command?: string;
  /** Path of the running CLI entry, for the default command. */
  binPath?: string;
}

export interface FileChange {
  agent: string;
  path: string;
  /** 'written' | 'unchanged' | 'removed' | 'skipped' */
  result: 'written' | 'unchanged' | 'removed' | 'skipped';
  reason?: string;
}

export interface InstallReport {
  scope: InstallScope;
  root: string;
  projectFile?: { path: string; result: 'written' | 'updated' | 'unchanged'; voice: string; texture?: TextureMode };
  files: FileChange[];
  notes: string[];
  warnings: string[];
}

export interface UninstallOpts {
  adapters: Adapter[];
  scope?: InstallScope;
  cwd?: string;
  /** Also delete tambre.json and the palette assignment. */
  purge?: boolean;
}

export interface UninstallReport {
  scope: InstallScope;
  root: string;
  files: FileChange[];
  projectFile?: { path: string; result: 'removed' | 'kept' | 'absent' };
  warnings: string[];
}

// ---- the command we write ----

/** Quote a path for a shell only when it needs it, so plain paths stay readable. */
function shellArg(p: string): string {
  return /^[A-Za-z0-9_./\\:-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * `node <absolute dist/tambre.js> hook <agent>`. Local settings files are
 * per machine, so an absolute path is right and survives PATH changes.
 */
export function hookCommand(agent: string, binPath: string = process.argv[1] ?? 'tambre'): string {
  const abs = path.resolve(binPath);
  return `node ${shellArg(abs)} hook ${agent}`;
}

// ---- scope and root ----

export function isInsideGitRepo(cwd: string): boolean {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, encoding: 'utf8',
    }).trim();
    return out === 'true';
  } catch {
    return false;
  }
}

/** --project inside a git repo (or a project that already has tambre.json), --user otherwise. */
export function defaultScope(cwd: string = process.cwd()): InstallScope {
  if (isInsideGitRepo(cwd)) return 'project';
  const root = findProjectRoot(cwd);
  return fs.existsSync(projectConfigPath(root)) ? 'project' : 'user';
}

// ---- JSON merge ----

export const isTambreEntry = (h: unknown): boolean => isObj(h) && h.tambre === true;

/**
 * Remove every hook entry marked tambre:true. Matcher groups left empty are
 * dropped; an event left with no groups is dropped; an empty `hooks` object
 * is dropped. Returns the new document (the input is not mutated).
 */
export function stripTambreHooks(doc: unknown): { doc: Record<string, unknown>; removed: number } {
  const base: Record<string, unknown> = isObj(doc) ? { ...doc } : {};
  let removed = 0;
  if (!isObj(base.hooks)) return { doc: base, removed };
  const hooks: Record<string, unknown> = { ...base.hooks };
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept: unknown[] = [];
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) { kept.push(g); continue; }
      const own = g.hooks.filter((h) => !isTambreEntry(h));
      removed += g.hooks.length - own.length;
      if (own.length === g.hooks.length) kept.push(g);
      else if (own.length > 0) kept.push({ ...g, hooks: own });
      // else: the group was entirely ours; drop it
    }
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  if (Object.keys(hooks).length) base.hooks = hooks;
  else delete base.hooks;
  return { doc: base, removed };
}

/** Strip our old entries, then append the block's groups under each event. */
export function mergeHooks(doc: unknown, block: HooksBlock): Record<string, unknown> {
  const { doc: base } = stripTambreHooks(doc);
  const hooks: Record<string, unknown> = isObj(base.hooks) ? { ...base.hooks } : {};
  for (const [event, groups] of Object.entries(block.hooks)) {
    const existing = Array.isArray(hooks[event]) ? [...(hooks[event] as unknown[])] : [];
    hooks[event] = [...existing, ...(groups as HookGroup[])];
  }
  base.hooks = hooks;
  return base;
}

/** True when the file carries at least one of our entries under every event in the block. */
export function hasTambreHooks(doc: unknown, events: string[]): { all: boolean; present: string[]; missing: string[] } {
  const present: string[] = [];
  const missing: string[] = [];
  const hooks = isObj(doc) && isObj(doc.hooks) ? doc.hooks : {};
  for (const ev of events) {
    const groups = hooks[ev];
    const found = Array.isArray(groups) && groups.some((g) => isObj(g) && Array.isArray(g.hooks) && g.hooks.some(isTambreEntry));
    (found ? present : missing).push(ev);
  }
  return { all: missing.length === 0, present, missing };
}

// ---- file IO ----

interface ReadResult { doc: unknown; text: string | null; error?: string }

function readSettings(file: string): ReadResult {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { doc: undefined, text: null }; }
  if (!text.trim()) return { doc: {}, text };
  try { return { doc: JSON.parse(text), text }; } catch (e) { return { doc: undefined, text, error: (e as Error).message }; }
}

const render = (doc: unknown) => JSON.stringify(doc, null, 2) + '\n';

function writeSettings(file: string, doc: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, render(doc));
  fs.renameSync(tmp, file);
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Keep a project-local file out of the repo without touching .gitignore:
 * .git/info/exclude is per clone and never committed. Idempotent, silent on failure.
 */
export function gitExclude(root: string, relPath: string): boolean {
  const gitDir = path.join(root, '.git');
  let infoDir: string;
  try {
    const st = fs.statSync(gitDir);
    if (st.isDirectory()) infoDir = path.join(gitDir, 'info');
    else {
      // a worktree: ".git" is a file pointing at the real dir
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, 'utf8'));
      if (!m) return false;
      const common = path.resolve(root, m[1].trim());
      const commonFile = path.join(common, 'commondir');
      const base = fs.existsSync(commonFile) ? path.resolve(common, fs.readFileSync(commonFile, 'utf8').trim()) : common;
      infoDir = path.join(base, 'info');
    }
  } catch {
    return false;
  }
  try {
    const file = path.join(infoDir, 'exclude');
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const lines = existing.split(/\r?\n/).map((l) => l.trim());
    const want = relPath.split(path.sep).join('/');
    if (lines.includes(want) || lines.includes('/' + want)) return false;
    fs.mkdirSync(infoDir, { recursive: true });
    fs.appendFileSync(file, (existing && !existing.endsWith('\n') ? '\n' : '') + want + '\n');
    return true;
  } catch {
    return false;
  }
}

// ---- install ----

export function install(opts: InstallOpts): InstallReport {
  const cwd = opts.cwd ?? process.cwd();
  const scope = opts.scope ?? defaultScope(cwd);
  const root = findProjectRoot(cwd);
  const report: InstallReport = { scope, root, files: [], notes: [], warnings: [] };

  const voiceArg = opts.voice;
  if (voiceArg !== undefined && !voiceByName(voiceArg)) {
    throw new Error(`unknown palette voice "${voiceArg}"; run \`tambre voices\``);
  }
  const textureArg = opts.texture;
  if (textureArg !== undefined) {
    const w: string[] = [];
    if (!validateTexture(textureArg, 'texture', w)) throw new Error(w[0] ?? `unknown texture "${textureArg}"`);
  }
  const texture = textureArg as TextureMode | undefined;

  if (scope === 'project') {
    report.projectFile = ensureProjectFile(root, voiceArg, texture, report.warnings);
  } else {
    const patch: { voice?: string; texture?: TextureMode } = {};
    if (voiceArg) patch.voice = voiceArg;
    if (texture) patch.texture = texture;
    if (Object.keys(patch).length) saveUserConfig(patch);
  }

  for (const adapter of opts.adapters) {
    const file = adapter.settingsPath(scope, root);
    const command = opts.command ?? hookCommand(adapter.agent, opts.binPath);
    const block = adapter.hooksBlock(command);
    const r = readSettings(file);
    if (r.error) {
      report.files.push({ agent: adapter.agent, path: file, result: 'skipped', reason: `not valid JSON (${r.error}); fix it and run install again` });
      continue;
    }
    const merged = mergeHooks(r.doc, block);
    if (r.text !== null && sameJson(r.doc, merged)) {
      report.files.push({ agent: adapter.agent, path: file, result: 'unchanged' });
    } else {
      writeSettings(file, merged);
      report.files.push({ agent: adapter.agent, path: file, result: 'written' });
    }
    if (scope === 'project') {
      const rel = path.relative(root, file);
      if (gitExclude(root, rel)) report.notes.push(`Added ${rel} to .git/info/exclude so it is never committed.`);
    }
    for (const n of adapter.postInstallNotes(scope)) if (!report.notes.includes(n)) report.notes.push(n);
  }
  return report;
}

function ensureProjectFile(
  root: string,
  voiceArg: string | undefined,
  texture: TextureMode | undefined,
  warnings: string[],
): NonNullable<InstallReport['projectFile']> {
  const file = projectConfigPath(root);
  const user = loadUserConfig();
  const existing = readProjectConfig(root);
  warnings.push(...existing.warnings);

  let result: 'written' | 'updated' | 'unchanged';
  let config: ProjectConfig;
  if (!existing.exists) {
    const voice = voiceArg ?? user.assignments[root] ?? nextUnusedPaletteVoice(user);
    config = { voice, texture: texture ?? user.texture };
    saveProjectConfig(root, config);
    result = 'written';
  } else {
    config = { ...existing.config };
    let changed = false;
    if (voiceArg && config.voice !== voiceArg) { config.voice = voiceArg; changed = true; }
    if (texture && config.texture !== texture) { config.texture = texture; changed = true; }
    if (changed) {
      // keep unknown keys the file already has
      const raw = readRaw(file);
      saveProjectConfig(root, { ...raw, ...config } as ProjectConfig);
      result = 'updated';
    } else {
      result = 'unchanged';
    }
  }

  // Record the palette assignment when the project voice is a palette name.
  const name = typeof config.voice === 'string' ? config.voice : isObj(config.voice) ? config.voice.name : undefined;
  if (name && voiceByName(name) && user.assignments[root] !== name) saveUserConfig({ assignments: { [root]: name } });
  const w: string[] = [];
  const ref = validateVoiceRef(config.voice, file, w);
  const voiceLabel = typeof ref === 'string' ? ref : isObj(ref) ? String(ref.name) : 'moss';
  return { path: file, result, voice: voiceLabel, texture: config.texture };
}

function readRaw(file: string): Record<string, unknown> {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isObj(v) ? v : {};
  } catch {
    return {};
  }
}

// ---- uninstall ----

export function uninstall(opts: UninstallOpts): UninstallReport {
  const cwd = opts.cwd ?? process.cwd();
  const scope = opts.scope ?? defaultScope(cwd);
  const root = findProjectRoot(cwd);
  const report: UninstallReport = { scope, root, files: [], warnings: [] };

  for (const adapter of opts.adapters) {
    const file = adapter.settingsPath(scope, root);
    const r = readSettings(file);
    if (r.text === null) { report.files.push({ agent: adapter.agent, path: file, result: 'unchanged', reason: 'no file' }); continue; }
    if (r.error) { report.files.push({ agent: adapter.agent, path: file, result: 'skipped', reason: `not valid JSON (${r.error})` }); continue; }
    const { doc, removed } = stripTambreHooks(r.doc);
    if (removed === 0) { report.files.push({ agent: adapter.agent, path: file, result: 'unchanged' }); continue; }
    if (Object.keys(doc).length === 0) {
      // Nothing but our hooks was ever in it; leave no empty file behind,
      // nor an empty directory we created for it (rmdir refuses a non-empty one).
      fs.unlinkSync(file);
      try { fs.rmdirSync(path.dirname(file)); } catch { /* not empty, or not ours */ }
      report.files.push({ agent: adapter.agent, path: file, result: 'removed' });
    } else {
      writeSettings(file, doc);
      report.files.push({ agent: adapter.agent, path: file, result: 'written' });
    }
  }

  if (scope === 'project') {
    const file = projectConfigPath(root);
    if (!fs.existsSync(file)) report.projectFile = { path: file, result: 'absent' };
    else if (opts.purge) {
      fs.unlinkSync(file);
      saveUserConfig({ assignments: { [root]: null } });
      report.projectFile = { path: file, result: 'removed' };
    } else {
      report.projectFile = { path: file, result: 'kept' };
    }
  }
  return report;
}
