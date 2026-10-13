import fs from 'node:fs';
import { DaemonError, send, status } from '../client.js';
import {
  findProjectRoot, mergeFrame, readProjectConfig, readUserConfig, resolveSession, resolveVoice,
  saveUserConfig, updateProjectConfig, userConfigPath, validatePartialFrame, validateTexture, validateVoiceRef,
  voicingSetName, VOICING_SET_NAMES, DEFAULT_TEXTURE, DEFAULT_VOLUME, type VoiceRef,
} from '../config.js';
import { TEXTURE_MODES, type TextureMode } from '../engine/texture.js';
import { DEFAULT_FRAME, type Frame, type Voice } from '../engine/types.js';
import { defaultScope } from '../install.js';
import { voiceByName } from '../palette.js';
import type { InstallScope } from '../adapters/types.js';

/**
 * `tambre voice`, `tambre texture`, `tambre frame`, `tambre show`: the
 * commands an agent skill runs on the user's behalf. Each one writes the
 * config the way the TUI would, then pushes the change to the daemon so it
 * is audible at once where that is possible, and says in one line when it
 * will apply otherwise.
 */

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi: number): string => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** "G2", "f#3", "Bb2" or a bare MIDI number. Returns null when it is neither. */
export function parseNote(s: string): number | null {
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(t);
  if (!m) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()]!;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + base + acc;
}

const flagOf = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const hasFlag = (argv: string[], name: string): boolean => argv.includes(name);

function scopeOf(argv: string[], cwd: string, fallback: InstallScope | 'auto'): InstallScope {
  if (hasFlag(argv, '--user')) return 'user';
  if (hasFlag(argv, '--project')) return 'project';
  return fallback === 'auto' ? defaultScope(cwd) : fallback;
}

async function liveStatus() {
  try { return await status(); } catch (e) {
    if (e instanceof DaemonError) return null;
    throw e;
  }
}

/** Push a voice and/or texture to every live session of `root`; returns how many took it. */
async function pushToSessions(root: string, patch: { voice?: Voice; texture?: TextureMode }): Promise<number | null> {
  const s = await liveStatus();
  if (!s) return null;
  let n = 0;
  for (const sess of s.sessions) {
    if (sess.projectRoot !== root) continue;
    try {
      const r = await send({ cmd: 'set', session: sess.id, ...patch });
      if (r.ok) n++;
    } catch { /* a session that vanished mid-push is not an error */ }
  }
  return n;
}

const voiceLabel = (ref: VoiceRef): string => (typeof ref === 'string' ? ref : ref.name);

const describeVoice = (v: Voice): string =>
  `${v.name}  timbre ${v.timbre.toFixed(2)}  reg ${v.register}  bright ${v.brightness.toFixed(2)}  move ${v.movement.depth.toFixed(2)}/${v.movement.rate.toFixed(2)}  detune ${v.width.detune}  pan ${v.width.pan.toFixed(2)}  bell ${v.bell}`;

const pushNote = (n: number | null): string =>
  n === null ? '; applies at the next session start (daemon not running)'
    : n === 0 ? '; no live session here, applies at the next session start'
      : `; pushed to ${n} live session${n === 1 ? '' : 's'}`;

// ---- voice ----

export async function cmdVoice(argv: string[], io: Io, cwd = process.cwd()): Promise<number> {
  const raw = argv[1];
  if (!raw || raw.startsWith('--')) {
    io.err('usage: tambre voice <palette-name | json> [--project | --user]\n');
    return 1;
  }
  let parsed: unknown = raw;
  if (raw.trim().startsWith('{')) {
    try { parsed = JSON.parse(raw); } catch (e) { io.err(`voice: not valid JSON (${(e as Error).message})\n`); return 1; }
  }
  const warnings: string[] = [];
  const ref = validateVoiceRef(parsed, 'voice', warnings);
  if (ref === undefined) {
    io.err(`voice: ${warnings[0] ?? 'not a voice'}\n  palette: ${['moss', 'brass', 'cedar', 'glass', 'reed', 'tide', 'wire', 'felt'].join(', ')} (see \`tambre voices\`)\n`);
    return 1;
  }
  for (const w of warnings) io.err(`warning: ${w}\n`);

  const scope = scopeOf(argv, cwd, 'auto');
  const root = findProjectRoot(cwd);
  const voice = resolveVoice(ref);
  if (scope === 'project') {
    updateProjectConfig(root, { voice: ref });
    const name = voiceLabel(ref);
    if (voiceByName(name)) saveUserConfig({ assignments: { [root]: name } });
    const n = await pushToSessions(root, { voice });
    io.out(`voice ${name} for project ${root}${pushNote(n)}\n`);
  } else {
    saveUserConfig({ voice: ref });
    io.out(`voice ${voiceLabel(ref)} as your user default; projects with their own voice keep it\n`);
  }
  return 0;
}

// ---- texture ----

export async function cmdTexture(argv: string[], io: Io, cwd = process.cwd()): Promise<number> {
  const raw = argv[1];
  const warnings: string[] = [];
  const texture = raw && !raw.startsWith('--') ? validateTexture(raw, 'texture', warnings) : undefined;
  if (!texture) {
    io.err(`usage: tambre texture <${TEXTURE_MODES.join('|')}> [--project | --user]\n`);
    return 1;
  }
  const scope = scopeOf(argv, cwd, 'auto');
  const root = findProjectRoot(cwd);
  if (scope === 'project') {
    updateProjectConfig(root, { texture });
    const n = await pushToSessions(root, { texture });
    io.out(`texture ${texture} for project ${root}${pushNote(n)}\n`);
  } else {
    saveUserConfig({ texture });
    io.out(`texture ${texture} as your user default; projects with their own texture keep it\n`);
  }
  return 0;
}

// ---- frame ----

export async function cmdFrame(argv: string[], io: Io, cwd = process.cwd()): Promise<number> {
  const rootArg = flagOf(argv, '--root');
  const voicingsArg = flagOf(argv, '--voicings');
  const bpmArg = flagOf(argv, '--bpm');
  const barsArg = flagOf(argv, '--chord-bars');
  const volumeArg = flagOf(argv, '--volume');
  const scope = scopeOf(argv, cwd, 'user');

  const rawFrame: Record<string, unknown> = {};
  if (rootArg !== undefined) {
    const midi = parseNote(rootArg);
    if (midi === null) { io.err(`frame: --root wants a note like G2 or D#3, or a MIDI number; got "${rootArg}"\n`); return 1; }
    rawFrame.root = midi;
  }
  if (voicingsArg !== undefined) {
    if (!VOICING_SET_NAMES.includes(voicingsArg)) { io.err(`frame: --voicings is one of ${VOICING_SET_NAMES.join(', ')}; got "${voicingsArg}"\n`); return 1; }
    rawFrame.voicings = voicingsArg;
  }
  if (bpmArg !== undefined) rawFrame.bpm = Number(bpmArg);
  if (barsArg !== undefined) rawFrame.chordBars = Number(barsArg);

  let volume: number | undefined;
  if (volumeArg !== undefined) {
    volume = Number(volumeArg);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) { io.err('frame: --volume is 0..1\n'); return 1; }
    if (scope === 'project') { io.err('frame: volume is a user setting; drop --project or use `tambre volume`\n'); return 1; }
  }

  const warnings: string[] = [];
  const partial = Object.keys(rawFrame).length ? validatePartialFrame(rawFrame, 'frame', warnings) : {};
  if (!partial || warnings.length) {
    io.err(`frame: ${warnings[0] ?? 'nothing to set'}\n`);
    return 1;
  }
  if (!Object.keys(partial).length && volume === undefined) {
    io.err('usage: tambre frame [--root <note>] [--voicings <name>] [--bpm <n>] [--chord-bars <n>] [--volume <0..1>] [--user | --project]\n');
    return 1;
  }

  const changed: string[] = [];
  if (partial.root !== undefined) changed.push(`root ${noteName(partial.root)}`);
  if (partial.voicings !== undefined) changed.push(`voicings ${voicingsArg}`);
  if (partial.bpm !== undefined) changed.push(`${partial.bpm} bpm`);
  if (partial.chordBars !== undefined) changed.push(`${partial.chordBars} bars per chord`);

  if (scope === 'project') {
    const root = findProjectRoot(cwd);
    const existing = readProjectConfig(root).config.frame ?? {};
    updateProjectConfig(root, { frame: { ...existing, ...partial } });
    io.out(`frame proposal ${changed.join(', ')} for project ${root}; applies when a session of this project is the first one live\n`);
    return 0;
  }

  const user = readUserConfig().config;
  const patch: { frame?: Frame; volume?: number } = {};
  if (Object.keys(partial).length) patch.frame = mergeFrame(user.frame, partial);
  if (volume !== undefined) patch.volume = volume;
  saveUserConfig(patch);

  const notes: string[] = [];
  if (volume !== undefined) changed.push(`volume ${volume.toFixed(2)}`);
  const s = await liveStatus();
  if (!s) {
    notes.push('applies at the next session start (daemon not running)');
  } else {
    if (volume !== undefined) await send({ cmd: 'volume', value: volume });
    if (Object.keys(partial).length) {
      try {
        const r = await send({ cmd: 'frame', frame: partial });
        notes.push(r.ok ? 'applied now' : `${r.error}; applies when the last session ends`);
      } catch (e) {
        notes.push(`${e instanceof DaemonError ? e.message : String(e)}; applies at the next session start`);
      }
    } else {
      notes.push('applied now');
    }
  }
  io.out(`frame ${changed.join(', ')} for your user; ${notes.join('; ')}\n`);
  return 0;
}

// ---- show ----

export interface ShowReport {
  projectRoot: string;
  projectFile: string | null;
  voice: Voice;
  voiceSource: 'project' | 'assignment' | 'user' | 'default';
  texture: TextureMode;
  textureSource: 'project' | 'user' | 'default';
  frame: Frame;
  frameSource: 'project proposal over user' | 'user' | 'default';
  volume: number;
  volumeSource: 'user' | 'default';
  mute: boolean;
  muteSource: 'user' | 'default';
  daemon: { running: boolean; sessionsHere: number; sessions: number };
}

function userFileKeys(): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(userConfigPath(), 'utf8'));
    return new Set(raw && typeof raw === 'object' ? Object.keys(raw) : []);
  } catch {
    return new Set();
  }
}

export async function showReport(cwd = process.cwd()): Promise<ShowReport> {
  const root = findProjectRoot(cwd);
  const user = readUserConfig();
  const project = readProjectConfig(root);
  const keys = userFileKeys();
  const r = resolveSession(cwd, { user: user.config, root });
  const s = await liveStatus();
  const frameSource: ShowReport['frameSource'] =
    project.exists && project.config.frame ? 'project proposal over user' : keys.has('frame') ? 'user' : 'default';
  return {
    projectRoot: root,
    projectFile: project.exists ? project.path : null,
    voice: r.voice,
    voiceSource: r.voiceSource === 'user' && !keys.has('voice') ? 'default' : r.voiceSource,
    texture: r.texture,
    textureSource: project.exists && project.config.texture ? 'project' : keys.has('texture') ? 'user' : 'default',
    frame: r.frame ?? user.config.frame,
    frameSource,
    volume: user.config.volume,
    volumeSource: keys.has('volume') ? 'user' : 'default',
    mute: user.config.mute,
    muteSource: keys.has('mute') ? 'user' : 'default',
    daemon: {
      running: s !== null,
      sessionsHere: s ? s.sessions.filter((x) => x.projectRoot === root).length : 0,
      sessions: s ? s.sessions.length : 0,
    },
  };
}

export function formatShow(r: ShowReport): string {
  const voicings = voicingSetName(r.frame.voicings) ?? 'custom';
  const lines = [
    `project   ${r.projectRoot}${r.projectFile ? '' : '  (no tambre.json)'}`,
    `voice     ${describeVoice(r.voice)}  [${r.voiceSource}]`,
    `texture   ${r.texture}  [${r.textureSource}]`,
    `frame     ${noteName(r.frame.root)} · ${voicings} · ${r.frame.bpm} bpm · ${r.frame.chordBars} bars  [${r.frameSource}]`,
    `volume    ${r.volume.toFixed(2)}  [${r.volumeSource}]`,
    `mute      ${r.mute ? 'on' : 'off'}  [${r.muteSource}]`,
    `daemon    ${r.daemon.running ? `running, ${r.daemon.sessionsHere} live session${r.daemon.sessionsHere === 1 ? '' : 's'} here (${r.daemon.sessions} total)` : 'not running'}`,
  ];
  return lines.join('\n') + '\n';
}

export async function cmdShow(argv: string[], io: Io, cwd = process.cwd()): Promise<number> {
  const r = await showReport(cwd);
  io.out(hasFlag(argv, '--json') ? JSON.stringify(r, null, 2) + '\n' : formatShow(r));
  return 0;
}

// Referenced so the defaults stay the single source of truth for the help text.
export const SET_DEFAULTS = { texture: DEFAULT_TEXTURE, volume: DEFAULT_VOLUME, root: DEFAULT_FRAME.root };
