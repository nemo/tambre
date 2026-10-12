import { Engine } from './engine/index.js';
import { PALETTE } from './palette.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A scripted 40 s scene, in-process, no daemon. Two sessions in two voices:
 * A works, B joins, A gets blocked on permission, A finishes and goes quiet,
 * B keeps going, B finishes and leaves.
 */
export async function runDemo(opts: { volume?: number; voices?: [string, string]; out?: string } = {}): Promise<void> {
  const [aName, bName] = opts.voices ?? ['moss', 'brass'];
  const A = PALETTE.find((v) => v.name === aName) ?? PALETTE[0];
  const B = PALETTE.find((v) => v.name === bName) ?? PALETTE[1];
  const engine = new Engine({ volume: opts.volume ?? 0.8, endTail: 5 });
  const t0 = Date.now();
  const log = (s: string) => process.stdout.write(`${String(((Date.now() - t0) / 1000).toFixed(1)).padStart(5)}s  ${s}\n`);

  await engine.start();
  if (opts.out) engine.record(opts.out);
  log(`context running, latency ${(engine.ctx.baseLatency * 1000).toFixed(1)} ms base, root ${engine.frame.root}`);

  engine.addSession('A', A);
  engine.event('A', 'session.start');   log(`A (${A.name}) session.start`);
  await sleep(3000);
  for (let i = 0; i < 4; i++) { engine.event('A', 'activity'); log('A activity'); await sleep(1500); }

  engine.addSession('B', B);
  engine.event('B', 'session.start');   log(`B (${B.name}) session.start`);
  await sleep(2500);
  engine.event('B', 'activity');        log('B activity');
  await sleep(2000);

  engine.event('A', 'permission.request'); log('A permission.request -> blocked');
  await sleep(5000);
  engine.event('A', 'activity');        log('A permission resolved (activity)');
  await sleep(2500);
  engine.event('A', 'turn.end');        log('A turn.end -> waiting (fades)');
  await sleep(4000);

  for (let i = 0; i < 3; i++) { engine.event('B', 'activity'); log('B activity'); await sleep(1800); }
  engine.event('B', 'turn.end');        log('B turn.end -> waiting');
  await sleep(3000);
  engine.event('B', 'session.end');     log('B session.end');
  await sleep(2000);
  engine.event('A', 'session.end');     log('A session.end');

  log('closing');
  await engine.close();
  log('done');
}
