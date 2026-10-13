import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { doctor, formatCheck } from './doctor.js';
import { ADAPTERS } from './adapters/index.js';
import { install } from './install.js';
import { saveUserConfig } from './config.js';

let home: string;
let repo: string;
let socket: string;
const saved = { HOME: process.env.HOME, TAMBRE_HOME: process.env.TAMBRE_HOME };
const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const byName = (checks: Awaited<ReturnType<typeof doctor>>, name: string) => checks.find((c) => c.name === name)!;

beforeEach(() => {
  home = tmp('tambre-dhome-');
  repo = tmp('tambre-drepo-');
  socket = path.join(home, 'd.sock');
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

describe('doctor', () => {
  it('runs every check without a device and never throws; nothing installed is a warn, not a fail', async () => {
    const checks = await doctor({ cwd: repo, client: { socket, timeoutMs: 200 } });
    expect(checks.map((c) => c.name)).toEqual([
      'node', 'audio addon', 'audio device', 'daemon', 'user config', 'project config',
      ...ADAPTERS.map((a) => `hooks ${a.agent}`), 'palette', 'pid file',
    ]);
    expect(byName(checks, 'node').status).toBe('ok');
    expect(byName(checks, 'audio addon').detail).toMatch(/skipped/);
    expect(byName(checks, 'daemon')).toMatchObject({ status: 'ok' });
    expect(byName(checks, 'daemon').detail).toMatch(/not running/);
    expect(byName(checks, 'user config').status).toBe('ok');
    expect(byName(checks, 'project config').status).toBe('ok');
    for (const a of ADAPTERS) expect(byName(checks, `hooks ${a.agent}`).status).toBe('warn');
    expect(byName(checks, 'palette').status).toBe('ok');
    expect(byName(checks, 'pid file').status).toBe('ok');
    expect(checks.every((c) => ['ok', 'warn', 'fail'].includes(c.status))).toBe(true);
    for (const c of checks) expect(formatCheck(c)).toMatch(new RegExp(`^${c.status}\\s+${c.name}`));
  });

  it('reports hooks ok after install, flags bad config, palette collisions and a stale pid file', async () => {
    const bin = path.join(home, 'tambre.js');
    fs.writeFileSync(bin, '');
    install({ adapters: ADAPTERS, cwd: repo, binPath: bin });
    fs.writeFileSync(path.join(repo, 'tambre.json'), '{ "voice": "kazoo" }');
    saveUserConfig({ assignments: { '/a': 'moss', '/b': 'moss' }, volume: 'loud' as never });
    fs.writeFileSync(path.join(home, 'd.pid'), '999999999');

    const checks = await doctor({ cwd: repo, client: { socket, timeoutMs: 200 }, binPath: bin });
    for (const a of ADAPTERS) expect(byName(checks, `hooks ${a.agent}`).status).toBe('ok');
    expect(byName(checks, 'project config').status).toBe('warn');
    expect(byName(checks, 'project config').detail).toMatch(/kazoo/);
    expect(byName(checks, 'user config').status).toBe('warn');
    expect(byName(checks, 'palette').status).toBe('warn');
    expect(byName(checks, 'palette').detail).toMatch(/"moss" is assigned to/);
    expect(byName(checks, 'pid file').status).toBe('warn');
    expect(byName(checks, 'pid file').detail).toMatch(/stale/);
  });

  it('hooks whose command points at a binary that no longer exists are a fail; another binary is a warn', async () => {
    const bin = path.join(home, 'tambre.js');
    fs.writeFileSync(bin, '');
    install({ adapters: ADAPTERS, cwd: repo, binPath: bin });

    const other = path.join(home, 'other.js');
    fs.writeFileSync(other, '');
    let checks = await doctor({ cwd: repo, client: { socket, timeoutMs: 200 }, binPath: other });
    for (const a of ADAPTERS) {
      expect(byName(checks, `hooks ${a.agent}`).status).toBe('warn');
      expect(byName(checks, `hooks ${a.agent}`).detail).toMatch(/not this binary/);
    }

    fs.unlinkSync(bin); // npx cache purged, nvm version removed, checkout moved
    checks = await doctor({ cwd: repo, client: { socket, timeoutMs: 200 }, binPath: other });
    for (const a of ADAPTERS) {
      expect(byName(checks, `hooks ${a.agent}`).status).toBe('fail');
      expect(byName(checks, `hooks ${a.agent}`).detail).toMatch(/no longer exists/);
    }
  });

  it('a settings file that is not JSON is a fail', async () => {
    const file = ADAPTERS[0].settingsPath('project', repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'nope');
    const checks = await doctor({ cwd: repo, client: { socket, timeoutMs: 200 } });
    expect(byName(checks, `hooks ${ADAPTERS[0].agent}`).status).toBe('fail');
  });
});
