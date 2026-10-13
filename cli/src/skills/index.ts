import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * The agent skill we ship (skills/tambre/ in the package): a thin wrapper
 * that tells Claude Code or Codex which `tambre` command answers "mute
 * tambre", "switch this project to brass", and so on.
 *
 * `tambre install --project` copies it into the agent's project skill
 * directory; uninstall removes it only when the copy is still ours. A marker
 * file inside the copy records the hash we shipped, so an edited copy is
 * recognised and left alone.
 */

export const SKILL_NAME = 'tambre';
export const MARKER = '.tambre-skill';

/** Where each agent looks for project skills, relative to the project root. */
export const SKILL_DIRS: Record<string, string> = {
  'claude-code': path.join('.claude', 'skills'),
  codex: path.join('.agents', 'skills'),
};

/** The shipped skill directory: <package>/skills/tambre, next to dist/ and src/. */
export function shippedSkillDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'skills', SKILL_NAME);
}

/** Every regular file under `dir`, relative, sorted, marker excluded. */
function listFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else if (e.isFile() && e.name !== MARKER) out.push(r);
  }
  return out.sort();
}

/** sha256 over relative paths and contents, so a copy can be compared to what we shipped. */
export function hashDir(dir: string): string {
  const h = createHash('sha256');
  for (const rel of listFiles(dir)) {
    h.update(rel.split(path.sep).join('/') + '\0');
    h.update(fs.readFileSync(path.join(dir, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

export type SkillResult = 'written' | 'updated' | 'unchanged' | 'removed' | 'skipped' | 'absent';

export interface SkillChange {
  agent: string;
  path: string;
  result: SkillResult;
  reason?: string;
}

function readMarker(dir: string): string | null {
  try { return fs.readFileSync(path.join(dir, MARKER), 'utf8').trim() || null; } catch { return null; }
}

function copyDir(src: string, dst: string): void {
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const rel of listFiles(src)) {
    const to = path.join(dst, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(src, rel), to);
  }
}

/**
 * Install the skill for `agent` under `root`. Unchanged when an identical
 * copy is there; updated when an unmodified older copy is there; skipped
 * when a copy exists that is not ours or was edited.
 */
export function installSkill(agent: string, root: string, source = shippedSkillDir()): SkillChange {
  const base = SKILL_DIRS[agent];
  if (!base) return { agent, path: '', result: 'skipped', reason: 'no skill directory for this agent' };
  const target = path.join(root, base, SKILL_NAME);
  if (!fs.existsSync(source)) return { agent, path: target, result: 'skipped', reason: `shipped skill missing at ${source}` };
  const shipped = hashDir(source);
  if (fs.existsSync(target)) {
    const marker = readMarker(target);
    const current = hashDir(target);
    if (marker === null) return { agent, path: target, result: 'skipped', reason: 'a skill of that name already exists and is not ours' };
    if (current === shipped) {
      if (marker !== shipped) fs.writeFileSync(path.join(target, MARKER), shipped + '\n');
      return { agent, path: target, result: 'unchanged' };
    }
    if (current !== marker) return { agent, path: target, result: 'skipped', reason: 'the copy was edited; leaving it alone' };
    copyDir(source, target);
    fs.writeFileSync(path.join(target, MARKER), shipped + '\n');
    return { agent, path: target, result: 'updated' };
  }
  copyDir(source, target);
  fs.writeFileSync(path.join(target, MARKER), shipped + '\n');
  return { agent, path: target, result: 'written' };
}

/** Remove our copy; a copy without our marker, or edited since, is kept. */
export function uninstallSkill(agent: string, root: string): SkillChange {
  const base = SKILL_DIRS[agent];
  if (!base) return { agent, path: '', result: 'skipped', reason: 'no skill directory for this agent' };
  const target = path.join(root, base, SKILL_NAME);
  if (!fs.existsSync(target)) return { agent, path: target, result: 'absent' };
  const marker = readMarker(target);
  if (marker === null) return { agent, path: target, result: 'skipped', reason: 'not installed by tambre' };
  if (hashDir(target) !== marker) return { agent, path: target, result: 'skipped', reason: 'the copy was edited; leaving it alone' };
  fs.rmSync(target, { recursive: true, force: true });
  // Leave no empty skills directory behind when it was only ours.
  const parent = path.dirname(target);
  try { if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent); } catch { /* keep it */ }
  return { agent, path: target, result: 'removed' };
}
