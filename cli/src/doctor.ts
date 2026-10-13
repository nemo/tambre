import fs from 'node:fs';
import { ADAPTERS, type Adapter } from './adapters/index.js';
import { status, type ClientOpts } from './client.js';
import { findProjectRoot, readProjectConfig, readUserConfig } from './config.js';
import { noAudio } from './engine/context.js';
import { defaultScope, hasTambreHooks, hookCommand, isTambreEntry, scriptPathFromCommand } from './install.js';
import { pidPath, socketPath } from './ipc.js';
import type { InstallScope } from './adapters/types.js';

/**
 * `tambre doctor`: one line per check, ok / warn / fail. Never throws; a
 * check that blows up is reported as a fail with the error text.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorOpts {
  cwd?: string;
  scope?: InstallScope;
  adapters?: Adapter[];
  client?: ClientOpts;
  /** Skip opening the audio device (tests, headless). Defaults to TAMBRE_NO_AUDIO. */
  skipAudio?: boolean;
  /** Milliseconds to wait for the device to open. */
  audioTimeoutMs?: number;
  /** The binary hooks should point at; defaults to this one. Tests pass what they installed. */
  binPath?: string;
}

/** Every command carried by our entries in a settings document. */
export function tambreCommands(doc: unknown): string[] {
  const out: string[] = [];
  const hooks = typeof doc === 'object' && doc !== null && typeof (doc as { hooks?: unknown }).hooks === 'object' ? (doc as { hooks: Record<string, unknown> }).hooks : {};
  for (const groups of Object.values(hooks ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      const list = typeof g === 'object' && g !== null ? (g as { hooks?: unknown }).hooks : undefined;
      if (!Array.isArray(list)) continue;
      for (const h of list) if (isTambreEntry(h) && typeof (h as { command?: unknown }).command === 'string') out.push((h as { command: string }).command);
    }
  }
  return [...new Set(out)];
}

const MIN_NODE_MAJOR = 22;

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(`${what} did not finish in ${ms} ms`)), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t!); }
}

async function run(name: string, fn: () => Promise<Check> | Check): Promise<Check> {
  try { return await fn(); } catch (e) { return { name, status: 'fail', detail: String((e as Error)?.message ?? e) }; }
}

export async function doctor(opts: DoctorOpts = {}): Promise<Check[]> {
  const cwd = opts.cwd ?? process.cwd();
  const root = findProjectRoot(cwd);
  const scope = opts.scope ?? defaultScope(cwd);
  const adapters = opts.adapters ?? ADAPTERS;
  const skipAudio = opts.skipAudio ?? noAudio();
  const checks: Check[] = [];

  checks.push(await run('node', () => {
    const major = Number(process.versions.node.split('.')[0]);
    return major >= MIN_NODE_MAJOR
      ? { name: 'node', status: 'ok', detail: `v${process.versions.node}` }
      : { name: 'node', status: 'fail', detail: `v${process.versions.node}; tambre needs ${MIN_NODE_MAJOR} or newer` };
  }));

  checks.push(await run('audio addon', async () => {
    if (skipAudio) return { name: 'audio addon', status: 'warn', detail: 'skipped (TAMBRE_NO_AUDIO is set)' };
    const mod = await withTimeout(import('node-web-audio-api'), 5000, 'loading node-web-audio-api');
    return typeof mod.AudioContext === 'function'
      ? { name: 'audio addon', status: 'ok', detail: 'node-web-audio-api loads' }
      : { name: 'audio addon', status: 'fail', detail: 'node-web-audio-api loaded but exports no AudioContext' };
  }));

  checks.push(await run('audio device', async () => {
    if (skipAudio) return { name: 'audio device', status: 'warn', detail: 'skipped (TAMBRE_NO_AUDIO is set)' };
    if (checks[1].status === 'fail') return { name: 'audio device', status: 'fail', detail: 'addon did not load' };
    const { AudioContext } = await import('node-web-audio-api');
    const ctx = new AudioContext({ latencyHint: 'playback' });
    try {
      const rate = ctx.sampleRate;
      return { name: 'audio device', status: 'ok', detail: `opened at ${rate} Hz` };
    } finally {
      await withTimeout(ctx.close(), opts.audioTimeoutMs ?? 3000, 'closing the AudioContext').catch(() => undefined);
    }
  }));

  let daemonUp = false;
  checks.push(await run('daemon', async () => {
    const s = await status({ timeoutMs: 500, ...(opts.client ?? {}) });
    if (!s) return { name: 'daemon', status: 'ok', detail: `not running (${opts.client?.socket ?? socketPath()})` };
    daemonUp = true;
    const n = s.sessions.length;
    return { name: 'daemon', status: 'ok', detail: `running, ${n} session${n === 1 ? '' : 's'}, volume ${s.volume.toFixed(2)}${s.mute ? ', muted' : ''}` };
  }));

  const user = readUserConfig();
  checks.push(await run('user config', () => {
    if (user.warnings.length) return { name: 'user config', status: 'warn', detail: `${user.path}: ${user.warnings.join('; ')}` };
    return { name: 'user config', status: 'ok', detail: user.exists ? user.path : `${user.path} (absent; defaults)` };
  }));

  checks.push(await run('project config', () => {
    const p = readProjectConfig(root);
    if (p.warnings.length) return { name: 'project config', status: 'warn', detail: `${p.path}: ${p.warnings.join('; ')}` };
    if (!p.exists) return { name: 'project config', status: 'ok', detail: `no tambre.json in ${root} (user defaults)` };
    const v = typeof p.config.voice === 'string' ? p.config.voice : p.config.voice?.name ?? 'default';
    return { name: 'project config', status: 'ok', detail: `${p.path}: voice ${v}${p.config.texture ? `, texture ${p.config.texture}` : ''}${p.config.frame ? ', frame proposal' : ''}` };
  }));

  for (const a of adapters) {
    checks.push(await run(`hooks ${a.agent}`, () => {
      const file = a.settingsPath(scope, root);
      let text: string;
      try { text = fs.readFileSync(file, 'utf8'); } catch {
        return { name: `hooks ${a.agent}`, status: 'warn', detail: `not installed (${scope}); run \`tambre install --agent ${a.agent} --${scope}\`` };
      }
      let doc: unknown;
      try { doc = JSON.parse(text || '{}'); } catch (e) {
        return { name: `hooks ${a.agent}`, status: 'fail', detail: `${file} is not valid JSON (${(e as Error).message})` };
      }
      const r = hasTambreHooks(doc, a.events());
      if (r.present.length === 0) return { name: `hooks ${a.agent}`, status: 'warn', detail: `not installed in ${file}; run \`tambre install --agent ${a.agent} --${scope}\`` };
      if (!r.all) return { name: `hooks ${a.agent}`, status: 'warn', detail: `${file} is missing ${r.missing.join(', ')}; run install again` };
      // The entries exist; do they still run anything, and is it this binary?
      // Hooks never print, so a stale path is otherwise invisible.
      const expected = hookCommand(a.agent, opts.binPath);
      for (const cmd of tambreCommands(doc)) {
        if (cmd === expected) continue;
        const script = scriptPathFromCommand(cmd);
        if (script && !fs.existsSync(script)) {
          return { name: `hooks ${a.agent}`, status: 'fail', detail: `${file} runs ${script}, which no longer exists; run \`tambre install --agent ${a.agent} --${scope}\` again` };
        }
        return { name: `hooks ${a.agent}`, status: 'warn', detail: `${file} runs "${cmd}", not this binary ("${expected}"); run install again to update it` };
      }
      return { name: `hooks ${a.agent}`, status: 'ok', detail: `${file} (${scope})` };
    }));
  }

  checks.push(await run('palette', () => {
    const byVoice = new Map<string, string[]>();
    for (const [p, v] of Object.entries(user.config.assignments)) byVoice.set(v, [...(byVoice.get(v) ?? []), p]);
    const clashes = [...byVoice.entries()].filter(([, roots]) => roots.length > 1);
    if (!clashes.length) return { name: 'palette', status: 'ok', detail: `${Object.keys(user.config.assignments).length} project(s) assigned, no collisions` };
    return { name: 'palette', status: 'warn', detail: clashes.map(([v, roots]) => `"${v}" is assigned to ${roots.join(' and ')}`).join('; ') };
  }));

  checks.push(await run('pid file', () => {
    const file = opts.client?.socket ? opts.client.socket.replace(/\.sock$/, '') + '.pid' : pidPath();
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return { name: 'pid file', status: 'ok', detail: 'none' }; }
    const pid = Number(text.trim());
    if (!Number.isInteger(pid) || pid <= 0) return { name: 'pid file', status: 'warn', detail: `${file} holds "${text.trim()}", not a pid; delete it` };
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (!alive) return { name: 'pid file', status: 'warn', detail: `${file} names pid ${pid}, which is not running; stale, safe to delete` };
    if (!daemonUp) return { name: 'pid file', status: 'warn', detail: `pid ${pid} is alive but the socket does not answer; the daemon may be wedged` };
    return { name: 'pid file', status: 'ok', detail: `${file} -> pid ${pid}` };
  }));

  return checks;
}

export const formatCheck = (c: Check): string => `${c.status.padEnd(4)} ${c.name.padEnd(18)} ${c.detail}`;
