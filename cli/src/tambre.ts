#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { runDaemon } from './daemon.js';
import { runHook } from './hook.js';
import { runDemo } from './demo.js';
import { hooksBlockFor } from './hooks-print.js';
import { PALETTE } from './palette.js';
import { PRESETS, presetByName } from './presets.js';
import { renderPreset } from './render-preset.js';
import { TEXTURE_MODES, type TextureMode } from './engine/texture.js';
import { debug, type Agent } from './ipc.js';
import { ADAPTERS, adaptersFor, getAdapter } from './adapters/index.js';
import { install, uninstall, type InstallReport, type UninstallReport } from './install.js';
import { doctor, formatCheck } from './doctor.js';
import { cmdFrame, cmdShow, cmdTexture, cmdVoice } from './commands/set.js';
import { send, status, DaemonError } from './client.js';
import { ConfigError, findProjectRoot, loadUserConfig, saveUserConfig } from './config.js';
import type { InstallScope } from './adapters/types.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(name);
const out = (s: string) => process.stdout.write(s);
const err = (s: string) => process.stderr.write(s);

const AGENT_LIST = ADAPTERS.map((a) => a.agent).join('|');

const HELP = `
  tambre ${version}

  Give your coding agent a distinct sound.

    tambre install [--agent ${AGENT_LIST}|all] [--user | --project]
    tambre uninstall [--agent ${AGENT_LIST}|all] [--user | --project] [--purge]
    tambre presets                                    list the 12 presets
    tambre play <preset> [--out file.wav]             render a preset to a WAV
    tambre preset <name> [--user]                    assign a preset to this project (or your default)
    tambre doctor                                     check hooks and config
    tambre hook <agent>                               hook entry point (used by installed hooks)

  --project is the default inside a git repo, --user elsewhere.
`;

const scopeFlag = (): InstallScope | undefined => (has('--user') ? 'user' : has('--project') ? 'project' : undefined);

function pickAdapters(): ReturnType<typeof adaptersFor> {
  const a = adaptersFor(flag('--agent'));
  if (!a) err(`unknown --agent "${flag('--agent')}"; one of ${AGENT_LIST}, all\n`);
  return a;
}

function printInstall(r: InstallReport): void {
  out(`Installed for ${r.scope === 'project' ? `project ${r.root}` : 'your user'}\n`);
  if (r.projectFile?.result === 'skipped') {
    out(`  skipped   ${r.projectFile.path}  ${r.projectFile.reason ?? ''}\n`);
  } else if (r.projectFile) {
    const verb = r.projectFile.result === 'written' ? 'wrote' : r.projectFile.result === 'updated' ? 'updated' : 'kept';
    out(`  ${verb.padEnd(9)} ${r.projectFile.path}  (voice ${r.projectFile.voice}${r.projectFile.texture ? `, texture ${r.projectFile.texture}` : ''})\n`);
  }
  for (const f of r.files) {
    const verb = f.result === 'written' ? 'wrote' : f.result === 'unchanged' ? 'kept' : f.result;
    out(`  ${verb.padEnd(9)} ${f.path}  [${f.agent}]${f.reason ? `  ${f.reason}` : ''}\n`);
  }
  for (const w of r.warnings) out(`  warning  ${w}\n`);
  for (const sk of r.skills) {
    const verb = sk.result === 'written' ? 'wrote' : sk.result === 'unchanged' ? 'kept' : sk.result;
    out(`  ${verb.padEnd(9)} ${sk.path}  [${sk.agent} skill]${sk.reason ? `  ${sk.reason}` : ''}\n`);
  }
  for (const n of r.notes) out(`  note     ${n}\n`);
  if (r.projectFile?.result === 'written') out(`  Commit ${path.basename(r.projectFile.path)}; teammates opt in with \`tambre install\`.\n`);
}

function printUninstall(r: UninstallReport): void {
  out(`Uninstalled for ${r.scope === 'project' ? `project ${r.root}` : 'your user'}\n`);
  for (const f of r.files) {
    const verb = f.result === 'written' ? 'cleaned' : f.result === 'removed' ? 'removed' : f.result === 'unchanged' ? 'kept' : f.result;
    out(`  ${verb.padEnd(9)} ${f.path}  [${f.agent}]${f.reason ? `  ${f.reason}` : ''}\n`);
  }
  for (const sk of r.skills) out(`  ${sk.result.padEnd(9)} ${sk.path}  [${sk.agent} skill]${sk.reason ? `  ${sk.reason}` : ''}\n`);
  if (r.projectFile) out(`  ${r.projectFile.result.padEnd(9)} ${r.projectFile.path}${r.projectFile.result === 'kept' ? '  (pass --purge to delete it)' : ''}\n`);
}

async function daemonStatus() {
  try { return await status(); } catch (e) {
    if (e instanceof DaemonError) { err(`daemon: ${e.message}\n`); return null; }
    throw e;
  }
}

async function cmdStatus(): Promise<number> {
  const s = await daemonStatus();
  if (has('--json')) {
    out(JSON.stringify(s ?? { ok: false, running: false, error: 'daemon not running' }, null, 2) + '\n');
    return 0;
  }
  if (!s) { out('daemon not running\n'); return 0; }
  out(`frame  root ${s.frame.root}  ${s.frame.bpm} bpm  ${s.frame.chordBars} bars/chord   volume ${s.volume.toFixed(2)}${s.mute ? '   MUTED' : ''}\n`);
  if (!s.sessions.length) { out('no live sessions\n'); return 0; }
  out(`${'session'.padEnd(10)} ${'agent'.padEnd(12)} ${'voice'.padEnd(8)} ${'texture'.padEnd(8)} ${'state'.padEnd(8)} ${'muted'.padEnd(6)} project\n`);
  for (const x of s.sessions) {
    out(`${x.id.slice(0, 10).padEnd(10)} ${x.agent.padEnd(12)} ${x.voice.padEnd(8)} ${x.texture.padEnd(8)} ${x.state.padEnd(8)} ${(x.muted ? 'yes' : 'no').padEnd(6)} ${path.basename(x.projectRoot) || x.projectRoot}\n`);
  }
  return 0;
}

async function cmdMute(value: boolean): Promise<number> {
  const word = value ? 'muted' : 'unmuted';
  if (has('--here')) {
    const root = findProjectRoot(process.cwd());
    const s = await daemonStatus();
    if (!s) { out(`daemon not running; nothing to ${value ? 'mute' : 'unmute'} in ${root}\n`); return 0; }
    await send({ cmd: 'mute', scope: { project: root }, value });
    const n = s.sessions.filter((x) => x.projectRoot === root).length;
    out(`${word} ${n} session${n === 1 ? '' : 's'} in ${root}\n`);
    return 0;
  }
  saveUserConfig({ mute: value });
  const s = await daemonStatus();
  if (s) await send({ cmd: 'mute', scope: 'all', value });
  out(`${word} everything${s ? '' : ' (saved; daemon not running)'}\n`);
  return 0;
}

async function cmdVolume(): Promise<number> {
  const raw = argv[1];
  const v = Number(raw);
  if (raw === undefined || !Number.isFinite(v) || v < 0 || v > 1) { err('usage: tambre volume <0..1>\n'); return 1; }
  saveUserConfig({ volume: v });
  const s = await daemonStatus();
  if (s) await send({ cmd: 'volume', value: v });
  out(`volume ${v.toFixed(2)}${s ? '' : ' (saved; daemon not running)'}\n`);
  return 0;
}

function cmdVoices(): number {
  out('palette\n');
  for (const v of PALETTE) {
    out(`  ${v.name.padEnd(7)} timbre ${v.timbre.toFixed(2)}  reg ${String(v.register).padStart(2)}  bright ${v.brightness.toFixed(2)}  pan ${v.width.pan.toFixed(2).padStart(5)}  bell ${v.bell}\n`);
  }
  const user = loadUserConfig();
  const names = Object.keys(user.patches);
  if (names.length) {
    out('patches\n');
    for (const n of names) {
      const p = user.patches[n];
      const parts = [p.voice ? `voice ${p.voice.name}` : null, p.texture ? `texture ${p.texture}` : null, p.frame ? `frame root ${p.frame.root}` : null].filter(Boolean);
      out(`  ${n.padEnd(12)} ${parts.join('  ')}\n`);
    }
  }
  const assigned = Object.entries(user.assignments);
  if (assigned.length) {
    out('assigned\n');
    for (const [root, name] of assigned) out(`  ${name.padEnd(7)} ${root}\n`);
  }
  return 0;
}

async function cmdTui(): Promise<number> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    err('tambre: the TUI needs a terminal. Try `tambre status` or `tambre --help`.\n');
    return 1;
  }
  const spec = './tui/index.js';
  let mod: { runTui?: () => Promise<number | void> | number | void; default?: () => Promise<number | void> | number | void };
  try {
    mod = await import(spec);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') { err('TUI not built\n'); return 1; }
    throw e;
  }
  const run = mod.runTui ?? mod.default;
  if (typeof run !== 'function') { err('TUI not built\n'); return 1; }
  // runTui returns 1 when the daemon could not be started; pass that on.
  const code = await run();
  return typeof code === 'number' ? code : 0;
}

async function main(): Promise<number> {
  switch (cmd) {
    case '--version': case '-v':
      out(version + '\n');
      return 0;
    case undefined:
      out(HELP);
      return 0;
    case '--help': case '-h': case 'help':
      out(HELP);
      return 0;

    case 'install': {
      const adapters = pickAdapters();
      if (!adapters) return 1;
      const r = install({ adapters, scope: scopeFlag(), voice: flag('--voice'), texture: flag('--texture'), command: flag('--command') });
      printInstall(r);
      return r.files.some((f) => f.result === 'skipped') || r.projectFile?.result === 'skipped' ? 1 : 0;
    }
    case 'uninstall': {
      const adapters = pickAdapters();
      if (!adapters) return 1;
      const r = uninstall({ adapters, scope: scopeFlag(), purge: has('--purge') });
      printUninstall(r);
      return r.files.some((f) => f.result === 'skipped') ? 1 : 0;
    }
    case 'doctor': {
      const checks = await doctor();
      for (const c of checks) out(formatCheck(c) + '\n');
      return checks.some((c) => c.status === 'fail') ? 1 : 0;
    }

    case 'presets': {
      for (const p of PRESETS) out(`${p.name.padEnd(16)} ${p.description}\n`);
      return 0;
    }
    case 'play': {
      const name = argv[1];
      const p = name ? presetByName(name) : undefined;
      if (!p) { err(`unknown preset "${name}"; run tambre presets\n`); return 1; }
      const outPath = flag('--out') ?? `/tmp/tambre-${p.name}.wav`;
      await renderPreset(p, outPath);
      out(`rendered ${outPath}\n`);
      return 0;
    }
    case 'preset': {
      const name = argv[1];
      const p = name ? presetByName(name) : undefined;
      if (!p) { err(`unknown preset "${name}"; run tambre presets\n`); return 1; }
      const root = findProjectRoot();
      if (has('--user')) { saveUserConfig({ preset: p.name } as any); out(`set your default preset to ${p.name}\n`); }
      else { const { saveProjectConfig } = await import('./config.js'); saveProjectConfig(root, { preset: p.name } as any); out(`set this project's preset to ${p.name}\n`); }
      return 0;
    }

    // hook entry point (used by installed hooks; not a user command).
    case 'hook': {
      const agent = argv[1] as Agent | undefined;
      if (!agent) return 0;
      try { await runHook(agent, { voice: flag('--voice') }); } catch { /* never fail the agent */ }
      // Nothing left to do; an inherited handle (a stdin pipe the launcher
      // keeps open) must not hold the agent's hook slot any longer.
      process.exit(0);
    }

    default:
      err(`tambre: unknown command "${cmd}"\n`);
      out(HELP);
      return 1;
  }
}

main().then((code) => { process.exitCode = code; }, (e) => {
  // hook and daemon never print; hooks never fail the agent either.
  if (cmd === 'hook') { process.exitCode = 0; return; }
  if (cmd === 'daemon') { debug('daemon failed:', String(e?.stack ?? e)); process.exitCode = 1; return; }
  if (e instanceof DaemonError) { err(`daemon: ${e.message}\n`); process.exitCode = 1; return; }
  if (e instanceof ConfigError) { err(`tambre: ${e.message}\n`); process.exitCode = 1; return; }
  err(String(e?.stack ?? e) + '\n');
  process.exitCode = 1;
});
