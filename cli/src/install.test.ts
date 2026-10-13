import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ADAPTERS, getAdapter } from './adapters/index.js';
import { defaultScope, hasTambreHooks, hookCommand, install, mergeHooks, scriptPathFromCommand, stripTambreHooks, uninstall } from './install.js';
import { loadUserConfig, userConfigPath } from './config.js';

/**
 * Everything runs in a throwaway HOME (os.homedir() follows $HOME on POSIX)
 * with TAMBRE_HOME inside it and a fresh git repo as the project.
 */

let home: string;
let repo: string;
const saved = { HOME: process.env.HOME, TAMBRE_HOME: process.env.TAMBRE_HOME };
const BIN = '/opt/tambre/dist/tambre.js';

const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const read = (p: string) => fs.readFileSync(p, 'utf8');
const json = (p: string) => JSON.parse(read(p));
const claude = getAdapter('claude-code')!;
const codex = getAdapter('codex')!;

beforeEach(() => {
  home = tmp('tambre-home-');
  repo = tmp('tambre-repo-');
  process.env.HOME = home;
  process.env.TAMBRE_HOME = path.join(home, '.tambre');
  execFileSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.TAMBRE_HOME = saved.TAMBRE_HOME;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('hookCommand', () => {
  it('is node plus the absolute binary path plus the agent', () => {
    expect(hookCommand('codex', BIN)).toBe(`node ${BIN} hook codex`);
    expect(hookCommand('claude-code', 'rel/tambre.js')).toBe(`node ${path.resolve('rel/tambre.js')} hook claude-code`);
  });
  it('quotes a path with spaces', () => {
    expect(hookCommand('codex', '/My Apps/tambre.js')).toBe(`node '/My Apps/tambre.js' hook codex`);
  });
  it('resolves a symlinked bin (npm global, npx cache) to the real script', () => {
    const real = path.join(home, 'lib', 'dist', 'tambre.js');
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.writeFileSync(real, '');
    const link = path.join(home, 'bin', 'tambre');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link);
    expect(hookCommand('codex', link)).toBe(`node ${real} hook codex`);
    expect(hookCommand('codex')).toMatch(/^node \S+ hook codex$/); // the default is this checkout's entry
  });
  it('scriptPathFromCommand reads back what hookCommand writes', () => {
    expect(scriptPathFromCommand(`node ${BIN} hook codex`)).toBe(BIN);
    expect(scriptPathFromCommand(hookCommand('claude-code', "/it's here/tambre.js"))).toBe("/it's here/tambre.js");
    expect(scriptPathFromCommand('tambre hook codex')).toBeNull();
    expect(scriptPathFromCommand('node x.js serve')).toBeNull();
  });
});

describe('defaultScope', () => {
  it('project inside a git repo, user elsewhere', () => {
    expect(defaultScope(repo)).toBe('project');
    const plain = tmp('tambre-plain-');
    try { expect(defaultScope(plain)).toBe('user'); } finally { fs.rmSync(plain, { recursive: true, force: true }); }
  });
});

describe('project install for both agents', () => {
  it('writes tambre.json, records the assignment, merges hooks into the local files, and never touches committed settings', () => {
    const r = install({ adapters: ADAPTERS, cwd: repo, binPath: BIN });
    expect(r.scope).toBe('project');
    expect(r.root).toBe(repo);
    expect(r.projectFile?.result).toBe('written');
    expect(json(path.join(repo, 'tambre.json'))).toEqual({ voice: 'moss', texture: 'hush' });
    expect(loadUserConfig().assignments).toEqual({ [repo]: 'moss' });

    const claudeFile = path.join(repo, '.claude', 'settings.local.json');
    const codexFile = path.join(repo, '.codex', 'hooks.json');
    expect(r.files.map((f) => [f.path, f.result])).toEqual([[claudeFile, 'written'], [codexFile, 'written']]);
    expect(fs.existsSync(path.join(repo, '.claude', 'settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.codex'))).toBe(false);

    const c = json(claudeFile);
    expect(hasTambreHooks(c, claude.events()).all).toBe(true);
    expect(c.hooks.SessionStart[0].hooks[0].command).toBe(`node ${BIN} hook claude-code`);
    expect(c.hooks.SessionStart[0].hooks[0].async).toBe(true);
    expect(c.hooks.SessionEnd[0].hooks[0].timeout).toBe(5);
    const x = json(codexFile);
    expect(hasTambreHooks(x, codex.events()).all).toBe(true);
    expect(x.hooks.Stop[0].hooks[0].command).toBe(`node ${BIN} hook codex`);
    expect(x.hooks.SessionEnd[0].hooks[0].timeout).toBeLessThanOrEqual(3);
    expect(read(claudeFile).endsWith('\n')).toBe(true);

    // local files are excluded from the repo without touching .gitignore
    const exclude = read(path.join(repo, '.git', 'info', 'exclude'));
    expect(exclude).toContain('.claude/settings.local.json');
    expect(exclude).toContain('.codex/hooks.json');
    expect(fs.existsSync(path.join(repo, '.gitignore'))).toBe(false);
    expect(r.notes.join(' ')).toMatch(/\/hooks/); // the Codex trust step
  });

  it('is idempotent: a second install leaves every file byte-for-byte identical', () => {
    install({ adapters: ADAPTERS, cwd: repo, binPath: BIN });
    const files = [
      path.join(repo, 'tambre.json'),
      path.join(repo, '.claude', 'settings.local.json'),
      path.join(repo, '.codex', 'hooks.json'),
      userConfigPath(),
      path.join(repo, '.git', 'info', 'exclude'),
    ];
    const before = files.map(read);
    const r = install({ adapters: ADAPTERS, cwd: repo, binPath: BIN });
    expect(r.projectFile?.result).toBe('unchanged');
    expect(r.files.map((f) => f.result)).toEqual(['unchanged', 'unchanged']);
    expect(files.map(read)).toEqual(before);
    expect(r.notes.some((n) => /exclude/.test(n))).toBe(false);
  });

  it('merges into existing settings, keeps foreign entries, and uninstall restores the original', () => {
    const claudeFile = path.join(repo, '.claude', 'settings.local.json');
    const codexFile = path.join(repo, '.codex', 'hooks.json');
    const originalClaude = {
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo pre' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
      },
      model: 'opus',
    };
    const originalCodex = { description: 'mine', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify-send done', timeout: 10 }] }] } };
    fs.mkdirSync(path.dirname(claudeFile), { recursive: true });
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(claudeFile, JSON.stringify(originalClaude));
    fs.writeFileSync(codexFile, JSON.stringify(originalCodex, null, 4));

    install({ adapters: ADAPTERS, cwd: repo, binPath: BIN });
    const c = json(claudeFile);
    expect(c.permissions).toEqual(originalClaude.permissions);
    expect(c.model).toBe('opus');
    expect(c.hooks.PreToolUse[0]).toEqual(originalClaude.hooks.PreToolUse[0]);
    expect(c.hooks.PreToolUse[1].hooks[0].tambre).toBe(true);
    expect(c.hooks.Stop).toHaveLength(2);
    expect(c.hooks.Stop[0]).toEqual(originalClaude.hooks.Stop[0]);
    const x = json(codexFile);
    expect(x.description).toBe('mine');
    expect(x.hooks.Stop[0]).toEqual(originalCodex.hooks.Stop[0]);
    expect(x.hooks.Stop[1].hooks[0].tambre).toBe(true);

    // a second install on top of the merged file is still a no-op
    const before = [read(claudeFile), read(codexFile)];
    install({ adapters: ADAPTERS, cwd: repo, binPath: BIN });
    expect([read(claudeFile), read(codexFile)]).toEqual(before);

    const u = uninstall({ adapters: ADAPTERS, cwd: repo });
    expect(u.files.map((f) => f.result)).toEqual(['written', 'written']);
    expect(json(claudeFile)).toEqual(originalClaude);
    expect(json(codexFile)).toEqual(originalCodex);
    expect(u.projectFile?.result).toBe('kept');
    expect(fs.existsSync(path.join(repo, 'tambre.json'))).toBe(true);
  });

  it('uninstall removes a settings file that held nothing but our hooks, and --purge drops tambre.json and the assignment', () => {
    install({ adapters: ADAPTERS, cwd: repo, binPath: BIN });
    expect(loadUserConfig().createdFiles.sort()).toEqual([
      path.join(repo, '.claude'), path.join(repo, '.claude', 'settings.local.json'),
      path.join(repo, '.codex'), path.join(repo, '.codex', 'hooks.json'),
    ].sort());
    const u = uninstall({ adapters: ADAPTERS, cwd: repo, purge: true });
    expect(u.files.map((f) => f.result)).toEqual(['removed', 'removed']);
    expect(fs.existsSync(path.join(repo, '.claude'))).toBe(false);
    expect(loadUserConfig().createdFiles).toEqual([]);
    expect(fs.existsSync(path.join(repo, '.claude', 'settings.local.json'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.codex', 'hooks.json'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'tambre.json'))).toBe(false);
    expect(loadUserConfig().assignments).toEqual({});
    // uninstalling again is harmless
    const again = uninstall({ adapters: ADAPTERS, cwd: repo });
    expect(again.files.map((f) => f.result)).toEqual(['unchanged', 'unchanged']);
    expect(again.projectFile?.result).toBe('absent');
  });

  it('a second project gets the next palette voice; --voice and --texture are honoured', () => {
    install({ adapters: [claude], cwd: repo, binPath: BIN });
    const repo2 = tmp('tambre-repo2-');
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo2 });
      const r = install({ adapters: [claude], cwd: repo2, binPath: BIN });
      expect(r.projectFile?.voice).toBe('brass');
      expect(json(path.join(repo2, 'tambre.json'))).toEqual({ voice: 'brass', texture: 'hush' });
      expect(loadUserConfig().assignments).toEqual({ [repo]: 'moss', [repo2]: 'brass' });

      const r2 = install({ adapters: [claude], cwd: repo2, binPath: BIN, voice: 'wire', texture: 'rain' });
      expect(r2.projectFile?.result).toBe('updated');
      expect(json(path.join(repo2, 'tambre.json'))).toEqual({ voice: 'wire', texture: 'rain' });
      expect(loadUserConfig().assignments[repo2]).toBe('wire');
    } finally {
      fs.rmSync(repo2, { recursive: true, force: true });
    }
    expect(() => install({ adapters: [claude], cwd: repo, binPath: BIN, voice: 'kazoo' })).toThrow(/unknown palette voice/);
    expect(() => install({ adapters: [claude], cwd: repo, binPath: BIN, texture: 'loud' })).toThrow(/texture/);
  });

  it('an existing tambre.json is left alone and its palette voice is recorded', () => {
    fs.writeFileSync(path.join(repo, 'tambre.json'), JSON.stringify({ voice: 'tide', frame: { root: 45 }, extra: 1 }, null, 2) + '\n');
    const before = read(path.join(repo, 'tambre.json'));
    const r = install({ adapters: [codex], cwd: repo, binPath: BIN });
    expect(r.projectFile?.result).toBe('unchanged');
    expect(r.projectFile?.voice).toBe('tide');
    expect(read(path.join(repo, 'tambre.json'))).toBe(before);
    expect(loadUserConfig().assignments).toEqual({ [repo]: 'tide' });
  });

  it('a tambre.json that is not JSON is skipped even with --voice, and no assignment is recorded', () => {
    const file = path.join(repo, 'tambre.json');
    fs.writeFileSync(file, '{ "voice": "glass", // my note\n}');
    const r = install({ adapters: [claude], cwd: repo, binPath: BIN, voice: 'wire' });
    expect(r.projectFile?.result).toBe('skipped');
    expect(r.projectFile?.reason).toMatch(/not valid JSON/);
    expect(read(file)).toBe('{ "voice": "glass", // my note\n}');
    expect(loadUserConfig().assignments).toEqual({});
    expect(r.files[0].result).toBe('written'); // hooks still go in
  });

  it('uninstall leaves a settings file that existed before install, even an empty one, and its directory', () => {
    const claudeFile = path.join(repo, '.claude', 'settings.local.json');
    fs.mkdirSync(path.dirname(claudeFile), { recursive: true });
    fs.writeFileSync(claudeFile, '{}\n');
    install({ adapters: [claude], cwd: repo, binPath: BIN });
    expect(loadUserConfig().createdFiles).toEqual([]);
    const u = uninstall({ adapters: [claude], cwd: repo });
    expect(u.files[0].result).toBe('written');
    expect(fs.existsSync(claudeFile)).toBe(true);
    expect(json(claudeFile)).toEqual({});
  });

  it('a settings file that is not JSON is skipped, not clobbered', () => {
    const codexFile = path.join(repo, '.codex', 'hooks.json');
    fs.mkdirSync(path.dirname(codexFile), { recursive: true });
    fs.writeFileSync(codexFile, '{ not json');
    const r = install({ adapters: [codex], cwd: repo, binPath: BIN });
    expect(r.files[0].result).toBe('skipped');
    expect(read(codexFile)).toBe('{ not json');
  });
});

describe('user install for both agents', () => {
  it('writes ~/.claude/settings.json and ~/.codex/hooks.json, twice identically, and uninstall removes them', () => {
    const plain = tmp('tambre-plain-');
    try {
      const r = install({ adapters: ADAPTERS, cwd: plain, binPath: BIN, voice: 'felt', texture: 'pulse' });
      expect(r.scope).toBe('user');
      expect(r.projectFile).toBeUndefined();
      const claudeFile = path.join(home, '.claude', 'settings.json');
      const codexFile = path.join(home, '.codex', 'hooks.json');
      expect(r.files.map((f) => [f.path, f.result])).toEqual([[claudeFile, 'written'], [codexFile, 'written']]);
      expect(hasTambreHooks(json(claudeFile), claude.events()).all).toBe(true);
      expect(hasTambreHooks(json(codexFile), codex.events()).all).toBe(true);
      expect(fs.existsSync(path.join(plain, 'tambre.json'))).toBe(false);
      const user = loadUserConfig();
      expect(user.voice).toBe('felt');
      expect(user.texture).toBe('pulse');

      const before = [read(claudeFile), read(codexFile)];
      const r2 = install({ adapters: ADAPTERS, cwd: plain, binPath: BIN });
      expect(r2.files.map((f) => f.result)).toEqual(['unchanged', 'unchanged']);
      expect([read(claudeFile), read(codexFile)]).toEqual(before);

      const u = uninstall({ adapters: ADAPTERS, cwd: plain });
      expect(u.scope).toBe('user');
      expect(u.files.map((f) => f.result)).toEqual(['removed', 'removed']);
      expect(u.projectFile).toBeUndefined();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('explicit --user inside a repo writes user files and no tambre.json', () => {
    const r = install({ adapters: [claude], cwd: repo, scope: 'user', binPath: BIN });
    expect(r.files[0].path).toBe(path.join(home, '.claude', 'settings.json'));
    expect(fs.existsSync(path.join(repo, 'tambre.json'))).toBe(false);
  });
});

describe('merge primitives', () => {
  const block = claude.hooksBlock('node /x hook claude-code');

  it('mergeHooks replaces stale tambre entries (e.g. an old binary path) instead of duplicating them', () => {
    const old = mergeHooks({}, claude.hooksBlock('node /old hook claude-code'));
    const merged = mergeHooks(old, block);
    for (const groups of Object.values(merged.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>)) {
      expect(groups).toHaveLength(1);
      expect(groups[0].hooks).toHaveLength(1);
      expect(groups[0].hooks[0].command).toBe('node /x hook claude-code');
    }
  });

  it('stripTambreHooks drops empty groups, events and the hooks key, and leaves foreign entries', () => {
    const doc = mergeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }, { type: 'command', command: 'ours', tambre: true }] }] } }, block);
    // mergeHooks already replaced the stale "ours" entry, so exactly one marked entry per event remains
    const { doc: stripped, removed } = stripTambreHooks(doc);
    expect(removed).toBe(claude.events().length);
    expect(stripped).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } });
    expect(stripTambreHooks(mergeHooks({}, block)).doc).toEqual({});
    expect(stripTambreHooks({ other: 1 })).toEqual({ doc: { other: 1 }, removed: 0 });
    expect(stripTambreHooks('junk').doc).toEqual({});
  });

  it('hasTambreHooks reports partial installs', () => {
    const doc = mergeHooks({}, block);
    delete (doc.hooks as Record<string, unknown>).Stop;
    const r = hasTambreHooks(doc, claude.events());
    expect(r.all).toBe(false);
    expect(r.missing).toEqual(['Stop']);
  });
});
