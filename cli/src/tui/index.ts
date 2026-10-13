import React from 'react';
import { render } from 'ink';
import { ensureDaemon, send, status } from '../client.js';
import { App } from './App.js';
import { MOUSE_OFF, MOUSE_ON } from './mouse.js';

const ALT_ON = '\u001b[?1049h\u001b[H\u001b[2J';
const ALT_OFF = '\u001b[?1049l';

/**
 * Bare `tambre`: the one-screen editor. Needs a TTY on both ends; otherwise
 * prints a hint and returns 1. The daemon is started if needed and keeps
 * running after the TUI quits. The screen is the alternate buffer so the
 * page starts at row 1 (which is what makes mouse positions mean anything),
 * and mouse reporting is on for the TUI's lifetime only.
 */
export async function runTui(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('tambre: the TUI needs a terminal. Try `tambre status`, or `tambre --help` for the commands.\n');
    return 1;
  }
  const first = await ensureDaemon();
  process.stdout.write(ALT_ON + MOUSE_ON);
  const restore = () => process.stdout.write(MOUSE_OFF + ALT_OFF);
  process.on('exit', restore);
  try {
    const app = render(React.createElement(App, { client: { status, send }, cwd: process.cwd(), initialStatus: first }), { exitOnCtrlC: false });
    await app.waitUntilExit();
  } finally {
    process.off('exit', restore);
    restore();
  }
  if (!first) {
    process.stderr.write('tambre: the daemon could not be reached while the TUI was open. `tambre doctor` explains; TAMBRE_DEBUG=1 shows its log.\n');
  }
  return 0;
}
