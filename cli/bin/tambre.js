#!/usr/bin/env node
'use strict';

/* Placeholder binary. The tambre CLI described in the spec is not built yet.
   This exists so `npx tambre` reports the real state of things instead of a
   404, and so the name is held while the CLI is implemented.

   Spec: https://github.com/nemo/tambre/blob/main/spec/tambre-spec.md */

const { name, version } = require('../package.json');

const argv = process.argv.slice(2);
const asked = a => argv.includes(a);

if (asked('--version') || asked('-v')) {
  process.stdout.write(version + '\n');
  process.exit(0);
}

process.stdout.write([
  '',
  '  ' + name + ' ' + version + ' — namespace reserved, CLI not implemented yet.',
  '',
  '  Tambre is a registry for sound packs that bind to AI coding agent',
  '  lifecycle events (turn.end, tool.pre, permission.request, and 13 more),',
  '  so you can hear what your agent is doing instead of watching it.',
  '',
  '  Nothing installs through this command yet. What exists today:',
  '',
  '    Spec       https://github.com/nemo/tambre/blob/main/spec/tambre-spec.md',
  '    Library    https://nemo.github.io/tambre/',
  '    Installing https://github.com/nemo/tambre/blob/main/INSTALL.md',
  '',
  '  To install a pack right now, copy a pack\'s install line from the library',
  '  and paste it into Claude Code. It reads INSTALL.md and does the work',
  '  itself — no CLI required.',
  '',
  ''
].join('\n'));

/* --help is a successful request for help; anything else is a command we
   cannot honour yet, and scripts should be able to tell the difference. */
process.exit(asked('--help') || asked('-h') ? 0 : 1);
