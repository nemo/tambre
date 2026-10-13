/**
 * SGR (1006) mouse reporting. Ink has no mouse layer, so the TUI turns the
 * terminal's reporting on, reads the raw input Ink forwards, and parses the
 * escape sequences here. Keyboard stays complete without any of this.
 */

/** Written to stdout to start / stop reporting. 1000 = button events, 1002 = drag motion, 1006 = SGR encoding. */
export const MOUSE_ON = '\u001b[?1000h\u001b[?1002h\u001b[?1006h';
export const MOUSE_OFF = '\u001b[?1006l\u001b[?1002l\u001b[?1000l';

export type MouseKind = 'press' | 'release' | 'motion' | 'wheel';

export interface MouseEvent {
  kind: MouseKind;
  /** 0 left, 1 middle, 2 right; for wheel: -1 up, +1 down. */
  button: number;
  /** 1-based terminal column. */
  x: number;
  /** 1-based terminal row. */
  y: number;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
}

const SGR = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** True when a chunk of raw input is (or contains) an SGR mouse report. */
export const looksLikeMouse = (chunk: string): boolean => chunk.includes('\u001b[<');

/** Every mouse event in a raw input chunk, in order. Anything else is ignored. */
export function parseMouse(chunk: string): MouseEvent[] {
  const out: MouseEvent[] = [];
  for (const m of chunk.matchAll(SGR)) {
    const code = Number(m[1]);
    const x = Number(m[2]);
    const y = Number(m[3]);
    const released = m[4] === 'm';
    const shift = (code & 4) !== 0;
    const meta = (code & 8) !== 0;
    const ctrl = (code & 16) !== 0;
    const base = code & ~(4 | 8 | 16);
    if (base >= 64) {
      out.push({ kind: 'wheel', button: base === 64 ? -1 : 1, x, y, shift, meta, ctrl });
      continue;
    }
    if (base >= 32) {
      out.push({ kind: 'motion', button: base - 32, x, y, shift, meta, ctrl });
      continue;
    }
    out.push({ kind: released ? 'release' : 'press', button: base, x, y, shift, meta, ctrl });
  }
  return out;
}
