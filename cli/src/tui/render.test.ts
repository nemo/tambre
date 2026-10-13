import { describe, it, expect } from 'vitest';
import { hitTest, layout, renderLines, tabSpans, type View } from './render.js';
import { FRAME_CELLS, VOICE_CELLS, paletteCells, RULER, type EditState } from './model.js';
import { DEFAULT_FRAME } from '../engine/types.js';
import { voiceByName } from '../palette.js';
import type { StatusReply } from '../ipc.js';

const edit: EditState = { voice: voiceByName('moss')!, texture: 'hush', frame: DEFAULT_FRAME, volume: 0.8, mute: false };

const STATUS: StatusReply = {
  ok: true, frame: DEFAULT_FRAME, volume: 0.8, mute: false,
  sessions: [
    { id: 's1', agent: 'claude-code', projectRoot: '/work/alpha', voice: 'brass', texture: 'rain', state: 'working', muted: false, pid: 1 },
    { id: 's2', agent: 'codex', projectRoot: '/work/beta', voice: 'glass', texture: 'hush', state: 'blocked', muted: true, pid: 2 },
  ],
};

const view = (over: Partial<View> = {}): View => ({
  page: 'voice', cells: VOICE_CELLS, focused: 0, edit, status: STATUS, daemon: 'ok', sessionIdx: 0,
  message: 'hello', prompt: null, firstRun: false, projectLabel: '~/work/alpha', patchPage: 0, patchPages: 1, ...over,
});

const text = (lines: ReturnType<typeof renderLines>) => lines.map((l) => l.map((s) => s.text).join(''));

describe('layout', () => {
  it('is four columns of 25 at 100 wide and two help rows at 30 tall', () => {
    const l = layout(100, 30, false);
    expect(l.columns).toBe(4);
    expect(l.cellWidth).toBe(25);
    expect(l.helpLines).toBe(2);
    expect(l.transportLines).toBe(8);
    expect(l.gridTop).toBe(3);
  });

  it('keeps four columns at 80 wide, one help row at 24 tall, and shrinks the transport', () => {
    const l = layout(80, 24, false);
    expect(l.columns).toBe(4);
    expect(l.helpLines).toBe(1);
    expect(l.transportLines).toBe(8);
    expect(layout(80, 20, false).transportLines).toBe(6);
  });

  it('drops to one column under 80 and makes room for the first-run note', () => {
    expect(layout(70, 30, false).columns).toBe(1);
    expect(layout(100, 30, true).gridTop).toBe(6);
  });
});

describe('renderLines', () => {
  it('draws no box borders, only hairline rules', () => {
    const lines = text(renderLines(view(), layout(100, 30, false)));
    expect(lines.some((l) => /[┌┐└┘│]/.test(l))).toBe(false);
    expect(lines.filter((l) => /^─+$/.test(l)).length).toBe(3);
  });

  it('puts the focused marker on the focused cell only and the ruler on one shared ramp', () => {
    const lines = text(renderLines(view({ focused: 2 }), layout(100, 30, false)));
    expect(lines[3]).toMatch(/^ {2}timbre.*▸ brightness/);
    const rulers = lines[5].match(/[━╌]{12}/g) ?? [];
    expect(rulers.length).toBe(3); // bell is a cycle cell
    for (const r of rulers) expect(r.length).toBe(RULER);
  });

  it('shows the three-line note on first run above the palette', () => {
    const v = view({ page: 'palette', cells: paletteCells(''), firstRun: true });
    const lines = text(renderLines(v, layout(100, 30, true)));
    expect(lines[3]).toBe('No voice for this project yet.');
    expect(lines[6]).toMatch(/^▸ moss/);
    expect(lines[7]).toContain('dark, soft');
  });

  it('marks frame cells locked while a session is live', () => {
    const v = view({ page: 'frame', cells: FRAME_CELLS, focused: 1 });
    const lines = text(renderLines(v, layout(100, 30, false)));
    expect(lines[4]).toContain('G2');
    expect(lines[5]).toContain('locked');
    const free = text(renderLines(view({ page: 'frame', cells: FRAME_CELLS, status: { ...STATUS, sessions: [] } }), layout(100, 30, false)));
    expect(free[5]).not.toContain('locked');
  });

  it('lists sessions with index, voice, project, state and a mute mark', () => {
    const lines = text(renderLines(view(), layout(100, 30, false)));
    const l = layout(100, 30, false);
    expect(lines[l.transportTop]).toMatch(/^▸ 01 brass {5}alpha.*working.*\[ \]/);
    expect(lines[l.transportTop + 1]).toMatch(/^ {2}02 glass {5}beta.*blocked.*\[x\]/);
    expect(lines[l.transportTop + 1].indexOf('[x]')).toBe(l.muteCol);
  });

  it('shows the prompt instead of the message while naming a patch', () => {
    const lines = text(renderLines(view({ prompt: 'warm' }), layout(100, 30, false)));
    expect(lines.find((l) => l.startsWith('patch name: warm'))).toBeTruthy();
  });
});

describe('hitTest', () => {
  const l = layout(100, 30, false);
  it('maps the tab row to pages', () => {
    const frame = tabSpans().find((t) => t.page === 'frame')!;
    expect(hitTest(view(), l, frame.start + 1, 2)).toEqual({ type: 'tab', page: 'frame' });
    expect(hitTest(view(), l, 90, 2)).toBeNull();
  });

  it('maps grid positions to cells, and ruler positions to fractions', () => {
    expect(hitTest(view(), l, 2, l.gridTop + 1)).toEqual({ type: 'cell', index: 0 });
    expect(hitTest(view(), l, 2 + 25 * 2, l.gridTop + 5)).toEqual({ type: 'cell', index: 6 });
    const onRuler = hitTest(view(), l, 25 + 2 + 6 + 1, l.gridTop + 2 + 1);
    expect(onRuler).toMatchObject({ type: 'cell', index: 1 });
    expect((onRuler as { fraction: number }).fraction).toBeCloseTo(6.5 / 12, 3);
    expect(hitTest(view(), l, 2, l.gridTop + 4)).toBeNull(); // the gap line (1-based y)
  });

  it('maps transport lines to sessions and the mute mark', () => {
    expect(hitTest(view(), l, 3, l.transportTop + 2)).toEqual({ type: 'session', index: 1, mute: false });
    expect(hitTest(view(), l, l.muteCol + 2, l.transportTop + 2)).toEqual({ type: 'session', index: 1, mute: true });
    expect(hitTest(view(), l, 3, l.transportTop + 5)).toBeNull();
  });
});
