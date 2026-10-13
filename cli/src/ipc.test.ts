import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pidPath, socketPath } from './ipc.js';
import { daemonStdio, daemonLogPath } from './client.js';

const saved = { TAMBRE_HOME: process.env.TAMBRE_HOME, TAMBRE_SOCKET: process.env.TAMBRE_SOCKET, TAMBRE_DEBUG: process.env.TAMBRE_DEBUG };
const restore = (k: keyof typeof saved) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; };

afterEach(() => { restore('TAMBRE_HOME'); restore('TAMBRE_SOCKET'); restore('TAMBRE_DEBUG'); });

describe('socketPath', () => {
  it('is scoped by TAMBRE_HOME, so a scratch profile never shares the default daemon', () => {
    delete process.env.TAMBRE_SOCKET;
    delete process.env.TAMBRE_HOME;
    const plain = socketPath();
    process.env.TAMBRE_HOME = '/tmp/scratch-one';
    const one = socketPath();
    process.env.TAMBRE_HOME = '/tmp/scratch-two';
    const two = socketPath();
    expect(one).not.toBe(plain);
    expect(two).not.toBe(one);
    expect(path.dirname(one)).toBe(path.dirname(plain));
    expect(one.length - plain.length).toBeLessThanOrEqual(9); // a short tag, never a long path
    process.env.TAMBRE_HOME = '/tmp/scratch-one';
    expect(socketPath()).toBe(one); // stable
    expect(pidPath()).toBe(one.replace(/\.sock$/, '.pid'));
    process.env.TAMBRE_SOCKET = '/tmp/explicit.sock';
    expect(socketPath()).toBe('/tmp/explicit.sock'); // an explicit socket still wins
  });
});

describe('daemonStdio', () => {
  it('never hands the caller\'s stdio to the daemon; with TAMBRE_DEBUG it opens daemon.log', () => {
    delete process.env.TAMBRE_DEBUG;
    expect(daemonStdio()).toEqual({ stdio: 'ignore' });
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tambre-log-')));
    try {
      process.env.TAMBRE_HOME = home;
      process.env.TAMBRE_DEBUG = '1';
      const r = daemonStdio();
      expect(Array.isArray(r.stdio)).toBe(true);
      const [i, o, e] = r.stdio as unknown[];
      expect(i).toBe('ignore');
      expect(typeof o).toBe('number');
      expect(e).toBe(o);
      expect(o).not.toBe(1);
      expect(o).not.toBe(2);
      expect(fs.existsSync(daemonLogPath())).toBe(true);
      expect(daemonLogPath()).toBe(path.join(home, 'daemon.log'));
      fs.closeSync(r.fd!);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
