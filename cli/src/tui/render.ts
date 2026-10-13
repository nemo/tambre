import path from 'node:path';
import type { StatusReply } from '../ipc.js';
import {
  PAGES, PAGE_TITLES, RULER, formatValue, fraction, noteName,
  type Cell, type EditState, type Page,
} from './model.js';
import { voicingSetName } from '../config.js';

/**
 * The screen as data. `layout` decides where every region sits for a given
 * terminal size, `renderLines` turns a view into styled lines, and `hitTest`
 * maps a mouse position back to what is under it. All three share one
 * geometry, so what is drawn is what is clickable.
 */

export interface Span {
  text: string;
  color?: 'yellow' | 'red' | 'green';
  dim?: boolean;
  bold?: boolean;
  inverse?: boolean;
}
export type Line = Span[];

export interface View {
  page: Page;
  cells: Cell[];
  focused: number;
  edit: EditState;
  status: StatusReply | null;
  /** 'ok' | 'starting' | 'down' */
  daemon: 'ok' | 'starting' | 'down';
  sessionIdx: number;
  message: string;
  /** Non-null while the patch-name prompt is open. */
  prompt: string | null;
  /** Three-line note on first run. */
  firstRun: boolean;
  projectLabel: string;
  patchPage: number;
  patchPages: number;
}

export interface Layout {
  cols: number;
  rows: number;
  /** 4 columns of cells, or 1 when the terminal is narrow. */
  columns: 4 | 1;
  cellWidth: number;
  /** 0-based line of the tab row. */
  tabsLine: number;
  noteLines: number;
  /** 1 when the daemon-unreachable banner is shown under the tab rule. */
  bannerLines: number;
  gridTop: number;
  gridLines: number;
  transportTop: number;
  transportLines: number;
  statusLine: number;
  helpLines: number;
  /** Column where a cell's ruler starts, relative to the cell's left edge. */
  rulerIndent: number;
  /** Column where the mute mark sits on a transport line. */
  muteCol: number;
}

export const TRANSPORT_MAX = 8;
const TRANSPORT_FIXED = 1 + 1 + 1 + 1 + 1 + 1; // header, tabs, rule, rule, rule, status

export function layout(cols: number, rows: number, firstRun: boolean, banner = false): Layout {
  const columns: 4 | 1 = cols >= 80 ? 4 : 1;
  const cellWidth = columns === 4 ? Math.floor(cols / 4) : cols;
  const helpLines = rows >= 26 ? 2 : 1;
  const noteLines = firstRun ? 3 : 0;
  const bannerLines = banner ? 1 : 0;
  const gridLines = columns === 4 ? 7 : 8;
  const tabsLine = 1;
  const gridTop = 3 + bannerLines + noteLines;
  const transportTop = gridTop + gridLines + 1;
  const fixed = TRANSPORT_FIXED + bannerLines + noteLines + gridLines + helpLines;
  const transportLines = Math.max(1, Math.min(TRANSPORT_MAX, rows - fixed));
  const statusLine = transportTop + transportLines + 1;
  return {
    cols, rows, columns, cellWidth, tabsLine, noteLines, bannerLines, gridTop, gridLines,
    transportTop, transportLines, statusLine, helpLines, rulerIndent: 2, muteCol: 2 + 3 + 9 + 19 + 10,
  };
}

/** Width of the narrow-mode label column and value column; shared by render and hit-test. */
const COMPACT_LABEL_W = 12;
const compactValueW = (cols: number): number => Math.max(8, cols - 2 - COMPACT_LABEL_W - 1 - RULER - 2);

/** 0-based column where cell `index`'s ruler starts, in either column mode. */
export function rulerStart(l: Layout, index: number): number {
  if (l.columns === 4) return (index % 4) * l.cellWidth + l.rulerIndent;
  return 2 + COMPACT_LABEL_W + 1 + compactValueW(l.cols) + 1;
}

export const BANNER = 'daemon unreachable · no audio · editing and saving still work · tambre doctor explains';

const pad = (s: string, w: number): string => (s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length));
const rule = (cols: number): Line => [{ text: '─'.repeat(cols), dim: true }];
const ruler = (f: number): Span[] => {
  const filled = Math.round(f * RULER);
  return [{ text: '━'.repeat(filled) }, { text: '╌'.repeat(RULER - filled), dim: true }];
};
/** Position of a cycle cell's value among its options, 0..1. */
const cycleFraction = (c: Extract<Cell, { kind: 'cycle' }>, v: View): number => {
  const i = c.options.indexOf(c.get(v.edit));
  const n = c.options.length;
  return n > 1 ? Math.max(0, i) / (n - 1) : 0;
};
const cycleRuler = (f: number): Span[] => [{ text: '‹', dim: true }, ...ruler(f), { text: '›', dim: true }];

export const TAB_GAP = 2;

/** Column spans of each tab word on the tab line. */
export function tabSpans(): { page: Page; start: number; end: number }[] {
  let col = 0;
  return PAGES.map((page) => {
    const start = col;
    const end = start + PAGE_TITLES[page].length;
    col = end + TAB_GAP;
    return { page, start, end };
  });
}

function headerLine(v: View, cols: number): Line {
  const left = 'tambre';
  const f = v.edit.frame;
  const parts = [v.projectLabel, noteName(f.root), voicingSetName(f.voicings) ?? 'custom', `${f.bpm} bpm`];
  const right = parts.filter(Boolean).join(' · ');
  const gap = Math.max(1, cols - left.length - right.length);
  return [{ text: left, bold: true }, { text: ' '.repeat(gap) + right, dim: true }];
}

function tabsLine(v: View): Line {
  const out: Line = [];
  for (const t of tabSpans()) {
    const active = t.page === v.page;
    out.push({ text: PAGE_TITLES[t.page], color: active ? 'yellow' : undefined, bold: active, dim: !active });
    out.push({ text: ' '.repeat(TAB_GAP) });
  }
  if (v.page === 'patches' && v.patchPages > 1) out.push({ text: `${v.patchPage + 1}/${v.patchPages}`, dim: true });
  return out;
}

const NOTE = [
  'No voice for this project yet.',
  'Pick one below: space to hear it, Enter to take it, Tab to tune it.',
  'Press s when it sounds right; it is written to tambre.json.',
];

/** The three lines of one cell at `width` columns. */
function cellLines(v: View, c: Cell, focused: boolean, width: number, locked: boolean): [Span[], Span[], Span[]] {
  const inner = width - 2;
  const mark: Span = focused ? { text: '▸ ', color: 'yellow' } : { text: '  ' };
  if (c.kind === 'blank') return [[mark, { text: ' '.repeat(inner) }], [{ text: ' '.repeat(width) }], [{ text: ' '.repeat(width) }]];

  const labelText = c.kind === 'pick' ? c.label + (c.loaded ? ' •' : '') : c.label + (c.tag ? ` · ${c.tag}` : '');
  const label: Span = { text: pad(labelText, inner), color: focused ? 'yellow' : undefined, dim: !focused };
  const value: Span = { text: '  ' + pad(formatValue(v.edit, c), inner), bold: true };

  let third: Span[];
  if (c.kind === 'pick') third = [{ text: '  ' + pad(c.sub, inner), dim: true }];
  else if (locked && (c as { frame?: boolean }).frame) third = [{ text: '  ' + pad('locked', inner), dim: true }];
  else if (c.kind === 'cycle') third = [{ text: ' ' }, ...cycleRuler(cycleFraction(c, v)), { text: ' '.repeat(Math.max(0, inner - RULER - 1)) }];
  else third = [{ text: '  ' }, ...ruler(fraction(v.edit, c)), { text: ' '.repeat(Math.max(0, inner - RULER)) }];
  return [[mark, label], [value], third];
}

/** One line per cell for narrow terminals: marker, label, value, ruler. */
function cellCompact(v: View, c: Cell, focused: boolean, width: number, locked: boolean): Line {
  const mark: Span = focused ? { text: '▸ ', color: 'yellow' } : { text: '  ' };
  if (c.kind === 'blank') return [mark, { text: ' '.repeat(Math.max(0, width - 2)) }];
  const valueW = compactValueW(width);
  const label: Span = { text: pad(c.kind === 'pick' ? c.label + (c.loaded ? ' •' : '') : c.label, COMPACT_LABEL_W), color: focused ? 'yellow' : undefined, dim: !focused };
  const value: Span = { text: ' ' + pad(formatValue(v.edit, c), valueW) + ' ', bold: true };
  if (c.kind === 'pick') return [mark, label, value, { text: pad(c.sub, RULER), dim: true }];
  if (locked && (c as { frame?: boolean }).frame) return [mark, label, value, { text: 'locked', dim: true }];
  if (c.kind === 'cycle') return [mark, label, value, ...cycleRuler(cycleFraction(c, v))];
  return [mark, label, value, ...ruler(fraction(v.edit, c))];
}

function transportLines(v: View, l: Layout): Line[] {
  const out: Line[] = [];
  const sessions = v.status?.sessions ?? [];
  if (sessions.length === 0) {
    const text = v.daemon === 'ok' ? 'no sessions · daemon ok' : v.daemon === 'starting' ? 'starting daemon…' : 'no sessions';
    out.push([{ text: '  ' + text, dim: true }]);
  } else {
    const shown = sessions.slice(0, l.transportLines - (sessions.length > l.transportLines ? 1 : 0));
    shown.forEach((s, i) => {
      const hi = i === v.sessionIdx;
      const project = path.basename(s.projectRoot || '') || '?';
      const mark: Span = hi ? { text: '▸ ', bold: true } : { text: '  ' };
      out.push([
        mark,
        { text: `${String(i + 1).padStart(2, '0')} `, dim: true },
        { text: pad(s.voice, 9), bold: hi },
        { text: ' ' + pad(project, 18) },
        { text: ' ' + pad(s.state, 9), dim: s.state === 'waiting' || s.state === 'ended', bold: s.state === 'blocked' },
        s.muted ? { text: '[x]', color: 'red' } : { text: '[ ]', dim: true },
        { text: '  ' + s.texture, dim: true },
      ]);
    });
    if (sessions.length > shown.length) out.push([{ text: `  +${sessions.length - shown.length} more`, dim: true }]);
  }
  while (out.length < l.transportLines) out.push([{ text: ' ' }]);
  return out;
}

const HELP_ROWS: string[][] = [
  ['tab page', '↑↓←→ cell', 'h/l adjust', 'space hear', '1-6 b i events', 'enter load'],
  ['J/K session', 'm mute', 'p push', 'M mute all', '+/- volume', 's save', 'S patch', '[ ] patches', 'q quit'],
];
/** The one-row help, in priority order; items drop from the end until the row fits. */
const HELP_ONE_ROW = ['tab page', 'arrows cell', 'h/l adjust', 'space hear', 's save', 'q quit', 'enter load', 'm mute', 'p push'];
export function helpRows(l: Layout): string[] {
  if (l.helpLines === 2) return HELP_ROWS.map((r) => r.join('  '));
  const items = [...HELP_ONE_ROW];
  while (items.length > 1 && items.join('  ').length > l.cols) items.pop();
  return [items.join('  ')];
}

export function renderLines(v: View, l: Layout): Line[] {
  const lines: Line[] = [];
  lines.push(headerLine(v, l.cols));
  lines.push(tabsLine(v));
  lines.push(rule(l.cols));
  if (l.bannerLines) lines.push([{ text: BANNER, bold: true }]);
  if (l.noteLines) for (const n of NOTE) lines.push([{ text: n }]);

  const locked = (v.status?.sessions.length ?? 0) > 0;
  if (l.columns === 4) {
    for (let row = 0; row < 2; row++) {
      const trio: [Line, Line, Line] = [[], [], []];
      for (let col = 0; col < 4; col++) {
        const i = row * 4 + col;
        const c = v.cells[i];
        const parts = c ? cellLines(v, c, i === v.focused, l.cellWidth, locked) : [[{ text: ' '.repeat(l.cellWidth) }], [{ text: ' ' }], [{ text: ' ' }]];
        for (let k = 0; k < 3; k++) trio[k].push(...parts[k]);
      }
      lines.push(...trio);
      if (row === 0) lines.push([{ text: ' ' }]);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const c = v.cells[i];
      lines.push(c ? cellCompact(v, c, i === v.focused, l.cols, locked) : [{ text: ' ' }]);
    }
  }
  lines.push(rule(l.cols));
  lines.push(...transportLines(v, l));
  lines.push(rule(l.cols));

  if (v.prompt !== null) {
    lines.push([{ text: 'patch name: ', color: 'yellow' }, { text: v.prompt }, { text: ' ', inverse: true }, { text: '  Enter saves, Esc cancels', dim: true }]);
  } else {
    lines.push([{ text: v.message || ' ' }]);
  }
  for (const row of helpRows(l)) lines.push([{ text: row, dim: true }]);
  return lines;
}

export type Hit =
  | { type: 'tab'; page: Page }
  | { type: 'cell'; index: number; fraction?: number }
  | { type: 'session'; index: number; mute: boolean }
  | null;

/** What sits under a 1-based terminal (x, y). */
export function hitTest(v: View, l: Layout, x: number, y: number): Hit {
  const line = y - 1;
  const col = x - 1;
  if (line === l.tabsLine) {
    for (const t of tabSpans()) if (col >= t.start && col < t.end) return { type: 'tab', page: t.page };
    return null;
  }
  if (line >= l.gridTop && line < l.gridTop + l.gridLines) {
    const rel = line - l.gridTop;
    if (l.columns === 4) {
      if (rel === 3) return null; // the gap line
      const row = rel < 3 ? 0 : 1;
      const within = rel < 3 ? rel : rel - 4;
      const c = Math.min(3, Math.floor(col / l.cellWidth));
      const index = row * 4 + c;
      const cell = v.cells[index];
      if (!cell || cell.kind === 'blank') return null;
      if (within === 2 && cell.kind === 'range') {
        const start = rulerStart(l, index);
        if (col >= start && col < start + RULER) return { type: 'cell', index, fraction: (col - start + 0.5) / RULER };
      }
      return { type: 'cell', index };
    }
    const index = rel;
    const cell = v.cells[index];
    if (!cell || cell.kind === 'blank') return null;
    if (cell.kind === 'range') {
      const start = rulerStart(l, index);
      if (col >= start && col < start + RULER) return { type: 'cell', index, fraction: (col - start + 0.5) / RULER };
    }
    return { type: 'cell', index };
  }
  if (line >= l.transportTop && line < l.transportTop + l.transportLines) {
    const index = line - l.transportTop;
    const sessions = v.status?.sessions ?? [];
    if (index >= sessions.length) return null;
    return { type: 'session', index, mute: col >= l.muteCol && col < l.muteCol + 3 };
  }
  return null;
}
