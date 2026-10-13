#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { runDaemon } from './daemon.js';
import { runHook } from './hook.js';
import { runDemo } from './demo.js';
import { hooksBlockFor } from './hooks-print.js';
import { PALETTE } from './palette.js';
import { TEXTURE_MODES, type TextureMode } from './engine/texture.js';
import { debug, type Agent } from './ipc.js';
import { ADAPTERS, adaptersFor, getAdapter } from './adapters/index.js';
import { install, uninstall, type InstallReport, type UninstallReport } from './install.js';
import { doctor, formatCheck } from './doctor.js';
import { send, status, DaemonError } from './client.js';
import { findProjectRoot, loadUserConfig, saveUserConfig } from './config.js';
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

  Hear what your coding agent is doing.

    tambre                                            open the TUI
    tambre install [--agent ${AGENT_LIST}|all] [--user | --project] [--voice <name>] [--texture <mode>]
    tambre uninstall [--agent ${AGENT_LIST}|all] [--user | --project] [--purge]
    tambre status [--json]                            live sessions, states, voices, frame
    tambre mute [--here] / tambre unmute [--here]     everything, or this project's sessions
    tambre volume <0..1>
    tambre doctor                                     device, daemon, config, hooks, palette
    tambre voices                                     the built-in palette and your saved patches
    tambre hooks print <agent> [--command <cmd>]      the JSON block install would write
    tambre demo [--mode ${TEXTURE_MODES.join('|')}] [--voices moss,brass] [--out demo.wav]
    tambre hook <agent>                               hook entry point; reads the agent's JSON on stdin
    tambre daemon                                     run the resident synth (hooks start it for you)

  --project is the default inside a git repo, --user elsewhere. Textures: ${TEXTURE_MODES.join(', ')}.
  Set TAMBRE_DEBUG=1 to see daemon and hook logs on stderr.
`;

const scopeFlag = (): InstallScope | undefined => (has('--user') ? 'user' : has('--project') ? 'project' : undefined);

function pickAdapters(): ReturnType<typeof adaptersFor> {
  const a = adaptersFor(flag('--agent'));
  if (!a) err(`unknown --agent "${flag('--agent')}"; one of ${AGENT_LIST}, all\n`);
  return a;
}

function printInstall(r: InstallReport): void {
  out(`Installed for ${r.scope === 'project' ? `project ${r.root}` : 'your user'}\n`);
  if (r.projectFile) {
    const verb = r.projectFile.result === 'written' ? 'wrote' : r.projectFile.result === 'updated' ? 'updated' : 'kept';
    out(`  ${verb.padEnd(9)} ${r.projectFile.path}  (voice ${r.projectFile.voice}${r.projectFile.texture ? `, texture ${r.projectFile.texture}` : ''})\n`);
  }
  for (const f of r.files) {
    const verb = f.result === 'written' ? 'wrote' : f.result === 'unchanged' ? 'kept' : f.result;
    out(`  ${verb.padEnd(9)} ${f.path}  [${f.agent}]${f.reason ? `  ${f.reason}` : ''}\n`);
  }
  for (const w of r.warnings) out(`  warning  ${w}\n`);
  for (const n of r.notes) out(`  note     ${n}\n`);
  if (r.projectFile?.result === 'written') out(`  Commit ${path.basename(r.projectFile.path)}; teammates opt in with \`tambre install\`.\n`);
}

function printUninstall(r: UninstallReport): void {
  out(`Uninstalled for ${r.scope === 'project' ? `project ${r.root}` : 'your user'}\n`);
  for (const f of r.files) {
    const verb = f.result === 'written' ? 'cleaned' : f.result === 'removed' ? 'removed' : f.result === 'unchanged' ? 'kept' : f.result;
    out(`  ${verb.padEnd(9)} ${f.path}  [${f.agent}]${f.reason ? `  ${f.reason}` : ''}\n`);
  }
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
  let mod: { runTui?: () => Promise<void> | void; default?: () => Promise<void> | void };
  try {
    mod = await import(spec);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') { err('TUI not built\n'); return 1; }
    throw e;
  }
  const run = mod.runTui ?? mod.default;
  if (typeof run !== 'function') { err('TUI not built\n'); return 1; }
  await run();
  return 0;
}

async function main(): Promise<number> {
  switch (cmd) {
    case '--version': case '-v':
      out(version + '\n');
      return 0;
    case undefined:
      return cmdTui();
    case '--help': case '-h': case 'help':
      out(HELP);
      return 0;

    case 'install': {
      const adapters = pickAdapters();
      if (!adapters) return 1;
      const r = install({ adapters, scope: scopeFlag(), voice: flag('--voice'), texture: flag('--texture'), command: flag('--command') });
      printInstall(r);
      return r.files.some((f) => f.result === 'skipped') ? 1 : 0;
    }
    case 'uninstall': {
      const adapters = pickAdapters();
      if (!adapters) return 1;
      const r = uninstall({ adapters, scope: scopeFlag(), purge: has('--purge') });
      printUninstall(r);
      return r.files.some((f) => f.result === 'skipped') ? 1 : 0;
    }
    case 'status':
      return cmdStatus();
    case 'mute':
      return cmdMute(true);
    case 'unmute':
      return cmdMute(false);
    case 'volume':
      return cmdVolume();
    case 'doctor': {
      const checks = await doctor();
      for (const c of checks) out(formatCheck(c) + '\n');
      return checks.some((c) => c.status === 'fail') ? 1 : 0;
    }
    case 'voices':
      return cmdVoices();

    case 'hooks': {
      const agent = argv[2];
      if (argv[1] === 'print' && agent && getAdapter(agent)) {
        out(JSON.stringify(hooksBlockFor(agent, flag('--command')), null, 2) + '\n');
        return 0;
      }
      err(`usage: tambre hooks print <${AGENT_LIST}> [--command <cmd>]\n`);
      return 1;
    }
    case 'demo': {
      const v = flag('--voices')?.split(',') as [string, string] | undefined;
      const mode = flag('--mode') as TextureMode | undefined;
      if (mode && !TEXTURE_MODES.includes(mode)) {
        err(`unknown --mode "${mode}"; one of ${TEXTURE_MODES.join(', ')}\n`);
        return 1;
      }
      await runDemo({ volume: Number(flag('--volume') ?? 0.8), voices: v, out: flag('--out'), mode });
      return 0;
    }

    // hook and daemon never print.
    case 'daemon':
      await runDaemon();
      return 0; // never reached; daemon exits itself
    case 'hook': {
      const agent = argv[1] as Agent | undefined;
      if (!agent) return 0;
      try { await runHook(agent, { voice: flag('--voice') }); } catch { /* never fail the agent */ }
      return 0;
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
  err(String(e?.stack ?? e) + '\n');
  process.exitCode = 1;
});
