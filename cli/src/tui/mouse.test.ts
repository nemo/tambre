import { describe, it, expect } from 'vitest';
import { looksLikeMouse, parseMouse, MOUSE_ON, MOUSE_OFF } from './mouse.js';

describe('SGR mouse parsing', () => {
  it('parses a left press and release with 1-based coordinates', () => {
    expect(parseMouse('\u001b[<0;12;5M')).toEqual([
      { kind: 'press', button: 0, x: 12, y: 5, shift: false, meta: false, ctrl: false },
    ]);
    expect(parseMouse('\u001b[<0;12;5m')[0].kind).toBe('release');
  });

  it('parses wheel up and down', () => {
    expect(parseMouse('\u001b[<64;3;3M')[0]).toMatchObject({ kind: 'wheel', button: -1 });
    expect(parseMouse('\u001b[<65;3;3M')[0]).toMatchObject({ kind: 'wheel', button: 1 });
  });

  it('parses drag motion with the left button held', () => {
    expect(parseMouse('\u001b[<32;40;7M')[0]).toMatchObject({ kind: 'motion', button: 0, x: 40, y: 7 });
  });

  it('reads modifier bits and strips them from the button', () => {
    expect(parseMouse('\u001b[<4;1;1M')[0]).toMatchObject({ button: 0, shift: true });
    expect(parseMouse('\u001b[<24;1;1M')[0]).toMatchObject({ button: 0, meta: true, ctrl: true });
    expect(parseMouse('\u001b[<2;1;1M')[0]).toMatchObject({ button: 2 });
  });

  it('returns every event in a chunk, in order, and nothing for plain keys', () => {
    const events = parseMouse('\u001b[<0;1;1M\u001b[<0;1;1m\u001b[<65;2;2M');
    expect(events.map((e) => e.kind)).toEqual(['press', 'release', 'wheel']);
    expect(parseMouse('q')).toEqual([]);
    expect(parseMouse('\u001b[A')).toEqual([]);
  });

  it('recognises chunks that carry a report', () => {
    expect(looksLikeMouse('\u001b[<0;1;1M')).toBe(true);
    expect(looksLikeMouse('j')).toBe(false);
  });

  it('enable and disable sequences are inverses', () => {
    expect(MOUSE_ON).toContain('?1006h');
    expect(MOUSE_OFF).toContain('?1006l');
    expect(MOUSE_OFF).toContain('?1000l');
  });
});
