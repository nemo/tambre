import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashDir, installSkill, uninstallSkill, MARKER, shippedSkillDir } from './index.js';

let root: string;
const tmp = (p: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

beforeEach(() => { root = tmp('tambre-skill-'); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('shipped skill', () => {
  it('exists in the package with a SKILL.md that names the skill', () => {
    const dir = shippedSkillDir();
    expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(true);
    const md = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    expect(md.startsWith('---\nname: tambre\n')).toBe(true);
    expect(md.split('\n').length).toBeLessThanOrEqual(120);
    for (const cmd of ['tambre presets', 'tambre play <preset>', 'tambre preset snap', 'tambre doctor']) {
      expect(md).toContain(cmd);
    }
  });
});

describe('installSkill / uninstallSkill', () => {
  it('writes the skill for Claude Code and Codex in their own directories', () => {
    const a = installSkill('claude-code', root);
    const b = installSkill('codex', root);
    expect(a).toMatchObject({ result: 'written', path: path.join(root, '.claude', 'skills', 'tambre') });
    expect(b).toMatchObject({ result: 'written', path: path.join(root, '.agents', 'skills', 'tambre') });
    expect(fs.existsSync(path.join(a.path, 'SKILL.md'))).toBe(true);
    expect(fs.readFileSync(path.join(a.path, MARKER), 'utf8').trim()).toBe(hashDir(shippedSkillDir()));
  });

  it('is a no-op the second time', () => {
    installSkill('claude-code', root);
    const before = fs.statSync(path.join(root, '.claude', 'skills', 'tambre', 'SKILL.md')).mtimeMs;
    const again = installSkill('claude-code', root);
    expect(again.result).toBe('unchanged');
    expect(fs.statSync(path.join(root, '.claude', 'skills', 'tambre', 'SKILL.md')).mtimeMs).toBe(before);
  });

  it('upgrades an unmodified older copy', () => {
    const c = installSkill('claude-code', root);
    // Simulate an older shipped version: different content, marker matching that content.
    fs.writeFileSync(path.join(c.path, 'SKILL.md'), '---\nname: tambre\n---\nold\n');
    fs.writeFileSync(path.join(c.path, MARKER), hashDir(c.path) + '\n');
    const r = installSkill('claude-code', root);
    expect(r.result).toBe('updated');
    expect(fs.readFileSync(path.join(c.path, 'SKILL.md'), 'utf8')).toBe(fs.readFileSync(path.join(shippedSkillDir(), 'SKILL.md'), 'utf8'));
  });

  it('leaves an edited copy alone on install and uninstall', () => {
    const c = installSkill('claude-code', root);
    fs.appendFileSync(path.join(c.path, 'SKILL.md'), '\nmy own rule\n');
    expect(installSkill('claude-code', root).result).toBe('skipped');
    expect(uninstallSkill('claude-code', root).result).toBe('skipped');
    expect(fs.readFileSync(path.join(c.path, 'SKILL.md'), 'utf8')).toContain('my own rule');
  });

  it('leaves a foreign skill of the same name alone', () => {
    const dir = path.join(root, '.claude', 'skills', 'tambre');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'theirs');
    expect(installSkill('claude-code', root).result).toBe('skipped');
    expect(uninstallSkill('claude-code', root).result).toBe('skipped');
    expect(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toBe('theirs');
  });

  it('removes its own copy and the skills directory when that is empty', () => {
    installSkill('codex', root);
    const r = uninstallSkill('codex', root);
    expect(r.result).toBe('removed');
    expect(fs.existsSync(path.join(root, '.agents', 'skills'))).toBe(false);
    expect(uninstallSkill('codex', root).result).toBe('absent');
  });

  it('is unknown for agents without a skill directory', () => {
    expect(installSkill('amp', root)).toMatchObject({ result: 'skipped', path: '' });
  });
});
