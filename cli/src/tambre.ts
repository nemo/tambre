#!/usr/bin/env node
import { createRequire } from 'node:module';
import { runDaemon } from './daemon.js';
import { runHook } from './hook.js';
import { runDemo } from './demo.js';
import { claudeCodeHooks } from './hooks-print.js';
import { PALETTE } from './palette.js';
import { TEXTURE_MODES, type TextureMode } from './engine/texture.js';
import { debug, type Agent } from './ipc.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const HELP = `
  tambre ${version}

  Hear what your coding agent is doing.

    tambre demo [--mode drone|breath|pulse|rain|hum|hush|none] [--voices moss,brass] [--out demo.wav]
    tambre daemon [--foreground]                      run the resident synth (hooks start it for you);
                                                      --foreground logs to stderr and never idles out
    tambre hook claude-code [--voice <name>]          hook entry point; reads the agent's JSON on stdin
    tambre hooks print claude-code [--command <cmd>]  JSON hooks block for ~/.claude/settings.json
    tambre voices                                     list the built-in voice palette

  Set TAMBRE_DEBUG=1 to see daemon and hook logs on stderr.
`;

async function main(): Promise<number> {
  switch (cmd) {
    case '--version': case '-v':
      process.stdout.write(version + '\n');
      return 0;
    case 'demo': {
      const v = flag('--voices')?.split(',') as [string, string] | undefined;
      const mode = flag('--mode') as TextureMode | undefined;
      if (mode && !TEXTURE_MODES.includes(mode)) {
        process.stderr.write(`unknown --mode "${mode}"; one of ${TEXTURE_MODES.join(', ')}\n`);
        return 1;
      }
      await runDemo({ volume: Number(flag('--volume') ?? 0.8), voices: v, out: flag('--out'), mode });
      return 0;
    }
    case 'daemon': {
      // --foreground: log to stderr and stay up with no sessions, for debugging.
      const foreground = argv.includes('--foreground');
      if (foreground) process.env.TAMBRE_DEBUG = process.env.TAMBRE_DEBUG || '1';
      await runDaemon({ foreground });
      return 0; // never reached; daemon exits itself
    }
    case 'hook': {
      const agent = (argv[1] ?? 'claude-code') as Agent;
      try { await runHook(agent, { voice: flag('--voice') }); } catch { /* never fail the agent */ }
      return 0;
    }
    case 'hooks': {
      if (argv[1] === 'print' && (argv[2] ?? 'claude-code') === 'claude-code') {
        process.stdout.write(JSON.stringify(claudeCodeHooks(flag('--command')), null, 2) + '\n');
        return 0;
      }
      process.stdout.write(HELP);
      return 1;
    }
    case 'voices':
      for (const v of PALETTE) {
        process.stdout.write(`${v.name.padEnd(7)} timbre ${v.timbre.toFixed(2)}  reg ${String(v.register).padStart(2)}  bright ${v.brightness.toFixed(2)}  pan ${v.width.pan.toFixed(2).padStart(5)}  bell ${v.bell}\n`);
      }
      return 0;
    case undefined: case '--help': case '-h':
      process.stdout.write(HELP);
      return cmd ? 0 : 1;
    default:
      process.stdout.write(HELP);
      return 1;
  }
}

main().then((code) => { process.exitCode = code; }, (e) => {
  // hook and daemon never print; hooks never fail the agent either.
  if (cmd === 'hook') { process.exitCode = 0; return; }
  if (cmd === 'daemon') { debug('daemon failed:', String(e?.stack ?? e)); process.exitCode = 1; return; }
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exitCode = 1;
});
