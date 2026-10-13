import fs from 'node:fs';
import path from 'node:path';

/**
 * Watches config files for the daemon. One watcher per directory, shared by
 * every file in it and reference-counted, so a session's tambre.json and the
 * user config each cost one OS watch no matter how many sessions use them.
 *
 * fs.watch is pointed at the directory, not the file: editors and our own
 * saveUserConfig write by rename, which orphans a watch on the file itself.
 * Where fs.watch throws (a directory that does not exist yet, some network
 * filesystems), fs.watchFile polls the file instead. Change events are
 * debounced and coalesced into one callback.
 */
export class ConfigWatcher {
  private dirs = new Map<string, { watcher: fs.FSWatcher | null; files: Map<string, number>; polled: Set<string> }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private onChange: () => void,
    private debounceMs = Number(process.env.TAMBRE_WATCH_DEBOUNCE_MS) || 150,
    private pollMs = Number(process.env.TAMBRE_WATCH_POLL_MS) || 1000,
  ) {}

  /** Start watching `file` (one more reference to it). */
  acquire(file: string): void {
    const dir = path.dirname(file);
    const base = path.basename(file);
    let entry = this.dirs.get(dir);
    if (!entry) {
      const e = { watcher: null as fs.FSWatcher | null, files: new Map<string, number>(), polled: new Set<string>() };
      try {
        e.watcher = fs.watch(dir, { persistent: false }, (_event, name) => {
          // Only the files we care about; a busy project root sees many others.
          if (name === null || name === undefined || e.files.has(String(name))) this.schedule();
        });
        e.watcher.on('error', () => {
          // The directory went away or the watch broke: poll every file instead.
          e.watcher?.close();
          e.watcher = null;
          for (const f of e.files.keys()) this.poll(e, dir, f);
        });
      } catch {
        e.watcher = null;
      }
      entry = e;
      this.dirs.set(dir, entry);
    }
    entry.files.set(base, (entry.files.get(base) ?? 0) + 1);
    if (!entry.watcher) this.poll(entry, dir, base);
  }

  /** Drop one reference; the OS watch closes with the last one. */
  release(file: string): void {
    const dir = path.dirname(file);
    const base = path.basename(file);
    const entry = this.dirs.get(dir);
    if (!entry) return;
    const n = (entry.files.get(base) ?? 1) - 1;
    if (n > 0) { entry.files.set(base, n); return; }
    entry.files.delete(base);
    if (entry.polled.has(base)) { fs.unwatchFile(path.join(dir, base)); entry.polled.delete(base); }
    if (entry.files.size === 0) {
      entry.watcher?.close();
      this.dirs.delete(dir);
    }
  }

  /** Close everything. */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const [dir, entry] of this.dirs) {
      entry.watcher?.close();
      for (const f of entry.polled) fs.unwatchFile(path.join(dir, f));
    }
    this.dirs.clear();
  }

  /** Files currently watched, for tests and doctor. */
  get watched(): string[] {
    const out: string[] = [];
    for (const [dir, entry] of this.dirs) for (const f of entry.files.keys()) out.push(path.join(dir, f));
    return out.sort();
  }

  private poll(entry: { polled: Set<string> }, dir: string, base: string): void {
    if (entry.polled.has(base)) return;
    entry.polled.add(base);
    fs.watchFile(path.join(dir, base), { interval: this.pollMs, persistent: false }, () => this.schedule());
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      try { this.onChange(); } catch { /* the daemon logs on its side */ }
    }, this.debounceMs);
    this.timer.unref();
  }
}
