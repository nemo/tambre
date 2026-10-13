import React from 'react';
import { render } from 'ink';
import { ensureDaemon, send, status } from '../client.js';
import { App } from './App.js';

/**
 * Bare `tambre`: the one-screen editor. Needs a TTY on both ends; otherwise
 * prints a hint and returns 1. The daemon is started if needed and keeps
 * running after the TUI quits.
 */
export async function runTui(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('tambre: the TUI needs a terminal. Try `tambre status`, or `tambre --help` for the commands.\n');
    return 1;
  }
  const first = await ensureDaemon();
  if (!first) {
    process.stderr.write('tambre: could not start the daemon. `tambre doctor` explains; TAMBRE_DEBUG=1 shows its log.\n');
    return 1;
  }
  const app = render(React.createElement(App, { client: { status, send }, cwd: process.cwd(), initialStatus: first }));
  await app.waitUntilExit();
  return 0;
}
