import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cmdFrame, cmdShow, cmdTexture, cmdVoice, noteName, parseNote, showReport, type Io } from './set.js';
import { loadUserConfig } from '../config.js';

/**
 * TAMBRE_HOME points at a scratch dir so the socket name is scoped to it and
 * no real daemon answers; every command then takes its "daemon not running"
 * branch, which is what we assert.
 */

let home: string;
let repo: string;
const saved = { HOME: process.env.HOME, TAMBRE_HOME: process.env.TAMBRE_HOME };
const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const json = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

function io(): Io & { stdout: string; stderr: string } {
  const o = { stdout: '', stderr: '', out(s: string) { o.stdout += s; }, err(s: string) { o.stderr += s; } };
  return o;
}

beforeEach(() => {
  home = tmp('tambre-set-home-');
  repo = tmp('tambre-set-repo-');
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

describe('notes', () => {
  it('parses note names and MIDI numbers', () => {
    expect(parseNote('G2')).toBe(43);
    expect(parseNote('g2')).toBe(43);
    expect(parseNote('D2')).toBe(38);
    expect(parseNote('F#2')).toBe(42);
    expect(parseNote('Bb2')).toBe(46);
    expect(parseNote('43')).toBe(43);
    expect(parseNote('H2')).toBeNull();
    expect(noteName(43)).toBe('G2');
    expect(noteName(38)).toBe('D2');
  });
});

describe('tambre voice', () => {
  it('writes the project voice, records the assignment, keeps unknown keys', async () => {
    fs.writeFileSync(path.join(repo, 'tambre.json'), JSON.stringify({ voice: 'moss', texture: 'hush', note: 'keep me' }));
    const o = io();
    expect(await cmdVoice(['voice', 'cedar'], o, repo)).toBe(0);
    expect(json(path.join(repo, 'tambre.json'))).toMatchObject({ voice: 'cedar', texture: 'hush', note: 'keep me' });
    expect(loadUserConfig().assignments[repo]).toBe('cedar');
    expect(o.stdout).toMatch(/^voice cedar for project .*; applies at the next session start \(daemon not running\)\n$/);
  });

  it('accepts a JSON voice object', async () => {
    const o = io();
    expect(await cmdVoice(['voice', '{"name":"mine","timbre":0.4,"bell":"wood"}'], o, repo)).toBe(0);
    expect(json(path.join(repo, 'tambre.json')).voice).toEqual({ name: 'mine', timbre: 0.4, bell: 'wood' });
    expect(loadUserConfig().assignments[repo]).toBeUndefined(); // not a palette voice
  });

  it('sets the user default with --user and leaves the project alone', async () => {
    const o = io();
    expect(await cmdVoice(['voice', 'brass', '--user'], o, repo)).toBe(0);
    expect(loadUserConfig().voice).toBe('brass');
    expect(fs.existsSync(path.join(repo, 'tambre.json'))).toBe(false);
  });

  it('rejects an unknown name and bad JSON', async () => {
    const o = io();
    expect(await cmdVoice(['voice', 'nope'], o, repo)).toBe(1);
    expect(o.stderr).toContain('unknown palette voice');
    expect(await cmdVoice(['voice', '{bad'], io(), repo)).toBe(1);
    expect(await cmdVoice(['voice'], io(), repo)).toBe(1);
  });
});

describe('tambre texture', () => {
  it('writes the project texture', async () => {
    const o = io();
    expect(await cmdTexture(['texture', 'rain'], o, repo)).toBe(0);
    expect(json(path.join(repo, 'tambre.json')).texture).toBe('rain');
    expect(o.stdout).toContain('texture rain for project');
  });
  it('writes the user texture with --user and rejects unknown modes', async () => {
    expect(await cmdTexture(['texture', 'hum', '--user'], io(), repo)).toBe(0);
    expect(loadUserConfig().texture).toBe('hum');
    const o = io();
    expect(await cmdTexture(['texture', 'loud'], o, repo)).toBe(1);
    expect(o.stderr).toContain('usage');
  });
});

describe('tambre frame', () => {
  it('updates the user frame from note names and reports when it applies', async () => {
    const o = io();
    expect(await cmdFrame(['frame', '--root', 'D2', '--bpm', '56', '--voicings', 'dawn'], o, repo)).toBe(0);
    const f = loadUserConfig().frame;
    expect(f.root).toBe(38);
    expect(f.bpm).toBe(56);
    expect(f.chordBars).toBe(4); // untouched
    expect(o.stdout).toBe('frame root D2, voicings dawn, 56 bpm for your user; applies at the next session start (daemon not running)\n');
  });

  it('writes a project proposal with --project, merging with what is there', async () => {
    fs.writeFileSync(path.join(repo, 'tambre.json'), JSON.stringify({ voice: 'moss', frame: { bpm: 72 } }));
    const o = io();
    expect(await cmdFrame(['frame', '--root', 'A2', '--project'], o, repo)).toBe(0);
    expect(json(path.join(repo, 'tambre.json')).frame).toEqual({ bpm: 72, root: 45 });
    expect(o.stdout).toContain('frame proposal root A2 for project');
  });

  it('sets volume as a user setting and refuses it for a project', async () => {
    expect(await cmdFrame(['frame', '--volume', '0.5'], io(), repo)).toBe(0);
    expect(loadUserConfig().volume).toBe(0.5);
    const o = io();
    expect(await cmdFrame(['frame', '--volume', '0.5', '--project'], o, repo)).toBe(1);
    expect(o.stderr).toContain('volume is a user setting');
  });

  it('rejects bad notes, unknown voicings, and an empty call', async () => {
    expect(await cmdFrame(['frame', '--root', 'X9'], io(), repo)).toBe(1);
    expect(await cmdFrame(['frame', '--voicings', 'jazz'], io(), repo)).toBe(1);
    expect(await cmdFrame(['frame'], io(), repo)).toBe(1);
  });
});

describe('tambre show', () => {
  it('reports defaults and their sources with no config anywhere', async () => {
    const r = await showReport(repo);
    expect(r).toMatchObject({
      projectRoot: repo, projectFile: null, voiceSource: 'default', textureSource: 'default',
      frameSource: 'default', volumeSource: 'default', muteSource: 'default', daemon: { running: false },
    });
    expect(r.voice.name).toBe('moss');
    const o = io();
    await cmdShow(['show'], o, repo);
    expect(o.stdout).toContain('voice     moss');
    expect(o.stdout).toContain('[default]');
    expect(o.stdout).toContain('daemon    not running');
  });

  it('tracks where each value came from after changes', async () => {
    await cmdVoice(['voice', 'cedar'], io(), repo);
    await cmdTexture(['texture', 'rain'], io(), repo);
    await cmdFrame(['frame', '--root', 'D2', '--bpm', '56'], io(), repo);
    await cmdFrame(['frame', '--volume', '0.3'], io(), repo);
    const r = await showReport(repo);
    expect(r).toMatchObject({ voiceSource: 'project', textureSource: 'project', frameSource: 'user', volumeSource: 'user' });
    expect(r.voice.name).toBe('cedar');
    expect(r.texture).toBe('rain');
    expect(r.frame.root).toBe(38);
    const o = io();
    await cmdShow(['show', '--json'], o, repo);
    expect(JSON.parse(o.stdout).frame.bpm).toBe(56);
  });
});
