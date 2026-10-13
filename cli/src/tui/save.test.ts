import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveDefault } from './save.js';
import { loadUserConfig, saveUserConfig } from '../config.js';
import { voiceByName } from '../palette.js';

let home: string;
let cwd: string;
const savedHome = process.env.TAMBRE_HOME;
const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const file = () => path.join(cwd, 'tambre.json');

beforeEach(() => {
  home = tmp('tambre-save-home-');
  cwd = tmp('tambre-save-cwd-');
  process.env.TAMBRE_HOME = home;
});

afterEach(() => {
  process.env.TAMBRE_HOME = savedHome;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("TUI 's' into a project", () => {
  it('reports the filename and a left-truncated path, never a right-truncated one', () => {
    const deep = path.join(cwd, 'a-very-long-directory-name-that-goes-on', 'and-on-and-on', 'until-it-would-not-fit');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, 'tambre.json'), '{}');
    const msg = saveDefault({ voice: voiceByName('tide')!, texture: 'hush' }, deep);
    expect(msg).toMatch(/^saved tambre\.json · /);
    expect(msg).toContain('until-it-would-not-fit');
    expect(msg.length).toBeLessThanOrEqual('saved tambre.json · '.length + 56);
    expect(msg).toContain('…');
  });

  it('keeps unknown keys and user-authored invalid values in tambre.json', () => {
    fs.writeFileSync(file(), JSON.stringify({ $schema: 'https://x/schema.json', voice: 'tide', frame: { root: 'G2' } }));
    saveDefault({ voice: voiceByName('tide')!, texture: 'hush' }, cwd);
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ $schema: 'https://x/schema.json', voice: 'tide', frame: { root: 'G2' }, texture: 'hush' });
  });

  it('refuses to overwrite a tambre.json that is not JSON', () => {
    fs.writeFileSync(file(), '{ "voice": "tide", }');
    expect(() => saveDefault({ voice: voiceByName('tide')!, texture: 'hush' }, cwd)).toThrow(/not valid JSON/);
    expect(fs.readFileSync(file(), 'utf8')).toBe('{ "voice": "tide", }');
  });

  it('releases the palette assignment when the saved voice is no longer a palette voice, and records it when it is', () => {
    fs.writeFileSync(file(), JSON.stringify({ voice: 'tide' }));
    saveUserConfig({ assignments: { [cwd]: 'tide' } });
    saveDefault({ voice: { ...voiceByName('tide')!, brightness: 0.99 }, texture: 'hush' }, cwd);
    expect(loadUserConfig().assignments).toEqual({});
    expect(JSON.parse(fs.readFileSync(file(), 'utf8')).voice).toMatchObject({ name: 'tide', brightness: 0.99 });
    saveDefault({ voice: voiceByName('glass')!, texture: 'rain' }, cwd);
    expect(loadUserConfig().assignments).toEqual({ [cwd]: 'glass' });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ voice: 'glass', texture: 'rain' });
  });
});
