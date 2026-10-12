#!/usr/bin/env node
import { createRequire } from 'node:module';
import { runDaemon } from './daemon.js';
import { runHook } from './hook.js';
import { runDemo } from './demo.js';
import { claudeCodeHooks } from './hooks-print.js';
import { PALETTE } from './palette.js';
import type { Agent } from './ipc.js';

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

    tambre demo [--volume 0.8] [--voices moss,brass] [--out demo.wav]   40 s audition
    tambre daemon                                     run the resident synth (hooks start it for you)
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
      await runDemo({ volume: Number(flag("--volume") ?? 0.8), voices: v, out: flag("--out") });
      return 0;
    }
    case 'daemon':
      await runDaemon();
      return 0; // never reached; daemon exits itself
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
  if (cmd === 'hook') { process.exitCode = 0; return; }
  process.stderr.write(String(e?.stack ?? e) + '\n');
  process.exitCode = 1;
});
