import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdin, useStdout, type Key } from 'ink';
import path from 'node:path';
import type { ControlMessage, ControlReply, StatusReply } from '../ipc.js';
import { cloneVoice, loadUserConfig, resolveSession, saveUserConfig } from '../config.js';
import {
  ADVANCED_CELLS, FRAME_CELLS, PAGES, PATCHES_PER_PAGE, VOICE_CELLS, adjust, clamp, paletteCells, patchCells, setFraction,
  type Cell, type EditState, type Page, type PickCell,
} from './model.js';
import { auditionFor, VOLUME_STEP } from './keys.js';
import { isFirstRun, listPatches, saveDefault, savePatch, saveTarget, shortPath } from './save.js';
import { hitTest, layout, renderLines, rulerStart, type Line, type View } from './render.js';
import { looksLikeMouse, parseMouse, type MouseEvent } from './mouse.js';

/** The slice of src/client.ts the TUI needs; tests pass a fake. */
export interface TuiClient {
  status(): Promise<StatusReply | null>;
  send(msg: ControlMessage): Promise<ControlReply>;
}

export interface AppProps {
  client: TuiClient;
  /** Where the TUI was launched; decides what 's' writes and the initial voice. */
  cwd?: string;
  initialStatus?: StatusReply | null;
  pollMs?: number;
  /** Terminal size; defaults to stdout's. Tests pass fixed values. */
  cols?: number;
  rows?: number;
}

export function App({ client, cwd = process.cwd(), initialStatus = null, pollMs = 1000, cols, rows }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { internal_eventEmitter } = useStdin() as unknown as { internal_eventEmitter?: NodeJS.EventEmitter };
  const width = cols ?? stdout?.columns ?? 100;
  const height = rows ?? stdout?.rows ?? 30;

  const target = useMemo(() => saveTarget(cwd), [cwd]);
  const initial = useMemo(() => resolveSession(cwd), [cwd]);
  const user = useMemo(() => loadUserConfig(), []);

  const [firstRun, setFirstRun] = useState(() => isFirstRun(cwd));
  const [page, setPage] = useState<Page>(() => (isFirstRun(cwd) ? 'palette' : 'voice'));
  const [focused, setFocused] = useState(0);
  const [edit, setEdit] = useState<EditState>(() => ({
    voice: initial.voice, texture: initial.texture, frame: user.frame,
    volume: initialStatus?.volume ?? user.volume, mute: initialStatus?.mute ?? user.mute,
  }));
  /** Name of the palette voice or patch the editor was loaded from. */
  const [loadedFrom, setLoadedFrom] = useState<string>(() => (isFirstRun(cwd) ? '' : initial.voice.name));
  const [patches, setPatches] = useState(() => listPatches());
  const [patchPage, setPatchPage] = useState(0);
  const [status, setStatus] = useState<StatusReply | null>(initialStatus);
  const [daemon, setDaemon] = useState<View['daemon']>(initialStatus ? 'ok' : 'starting');
  const [sessionIdx, setSessionIdx] = useState(0);
  const [message, setMessage] = useState<string>(() =>
    (target.inProject ? `project ${shortPath(target.root, 60)}` : 'no project here; s saves the user default'));
  const [prompt, setPrompt] = useState<string | null>(null);

  const editRef = useRef(edit);
  editRef.current = edit;

  const patchPages = Math.max(1, Math.ceil(patches.length / PATCHES_PER_PAGE));
  const cells: Cell[] = useMemo(() => {
    switch (page) {
      case 'palette': return paletteCells(loadedFrom);
      case 'voice': return VOICE_CELLS;
      case 'frame': return FRAME_CELLS;
      case 'advanced': return ADVANCED_CELLS;
      case 'patches': return patchCells(patches, patchPage, loadedFrom);
    }
  }, [page, loadedFrom, patches, patchPage]);

  const lay = useMemo(() => layout(width, height, firstRun && page === 'palette', daemon === 'down'), [width, height, firstRun, page, daemon]);

  // ---- daemon ----

  const refresh = useCallback(async () => {
    try {
      const s = await client.status();
      setStatus(s);
      setDaemon(s ? 'ok' : 'down');
      if (s) setEdit((e) => (e.volume === s.volume && e.mute === s.mute ? e : { ...e, volume: s.volume, mute: s.mute }));
    } catch {
      setStatus(null);
      setDaemon('down');
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  /** Send one control message, report the outcome on the status line, then re-poll. */
  const control = useCallback(async (label: string, msg: ControlMessage) => {
    try {
      const r = await client.send(msg);
      setMessage(r.ok ? label : `${label}: ${(r as { error: string }).error}`);
    } catch (e) {
      setMessage(`${label}: ${(e as Error).message}`);
    }
    void refresh();
  }, [client, refresh]);

  const locked = (status?.sessions.length ?? 0) > 0;

  /** Apply an edit to a cell: local state first, then whatever the daemon or config needs to hear. */
  const applyChange = useCallback((cell: Cell, next: EditState) => {
    const prev = editRef.current;
    if (cell.kind === 'range' || cell.kind === 'cycle') {
      if (cell.frame) {
        if (locked) {
          const n = status?.sessions.length ?? 0;
          setEdit(next);
          try { saveUserConfig({ frame: next.frame }); } catch (e) { setMessage(`could not save frame: ${(e as Error).message}`); return; }
          setMessage(`${cell.label} locked while ${n} session${n === 1 ? ' is' : 's are'} live · saved to your user config · applies at the next daemon start`);
          return;
        }
        setEdit(next);
        try { saveUserConfig({ frame: next.frame }); } catch (e) { setMessage(`could not save frame: ${(e as Error).message}`); return; }
        void control(`${cell.label} ${cell.kind === 'range' ? (cell.format ? cell.format(cell.get(next) ?? 0) : String(cell.get(next))) : cell.get(next)}`,
          { cmd: 'frame', frame: next.frame });
        return;
      }
      if (cell.id === 'volume') {
        setEdit(next);
        void control(`volume ${next.volume.toFixed(2)}`, { cmd: 'volume', value: Math.round(next.volume * 100) / 100 });
        return;
      }
      if (cell.id === 'mute') {
        setEdit(next);
        void control(next.mute ? 'muted all' : 'unmuted all', { cmd: 'mute', scope: 'all', value: next.mute });
        return;
      }
    }
    if (next !== prev) {
      setEdit(next);
      setMessage(`${cell.kind === 'blank' || cell.kind === 'pick' ? '' : cell.label} ${cell.kind === 'range' ? (cell.format ? cell.format(cell.get(next) ?? cell.fallback) : String(cell.get(next))) : cell.kind === 'cycle' ? cell.get(next) : ''}`.trim());
    }
  }, [control, locked, status]);

  // Keyed on the session count, not the status object: status is replaced
  // every poll and would otherwise overwrite other feedback each second.
  const liveCount = status?.sessions.length ?? 0;
  useEffect(() => {
    const cell = cells[focused];
    if (!locked || page !== 'frame' || !cell || cell.kind === 'blank' || cell.kind === 'pick' || !cell.frame) return;
    setMessage(`${cell.label} is locked while ${liveCount} session${liveCount === 1 ? ' is' : 's are'} live · edits save to your user config and apply at the next daemon start`);
  }, [cells, focused, locked, page, liveCount]);

  const nudge = useCallback((dir: -1 | 1) => {
    const cell = cells[focused];
    if (!cell || cell.kind === 'blank' || cell.kind === 'pick') return;
    applyChange(cell, adjust(editRef.current, cell, dir));
  }, [cells, focused, applyChange]);

  const load = useCallback((cell: PickCell) => {
    setEdit((e) => ({ ...e, voice: cloneVoice(cell.voice), texture: cell.texture ?? e.texture }));
    setLoadedFrom(cell.label);
    setMessage(cell.id.startsWith('palette.') ? `loaded ${cell.label}; Tab to VOICE to tune it` : `loaded patch ${cell.label}`);
  }, []);

  const preview = useCallback((what: 'event' | 'state', name: string) => {
    if (daemon === 'down') { setMessage('no audio · daemon unreachable'); return; }
    const cell = cells[focused];
    const e = editRef.current;
    // On a pick page the focused voice is the one that plays; elsewhere the edited one.
    const voice = cell?.kind === 'pick' ? cell.voice : e.voice;
    const texture = cell?.kind === 'pick' ? (cell.texture ?? e.texture) : e.texture;
    void control(`hear ${name} · ${voice.name} · ${texture}`, { cmd: 'preview', what, name: name as never, voice, texture });
  }, [cells, focused, control, daemon]);

  const save = useCallback(() => {
    try {
      setMessage(saveDefault({ voice: editRef.current.voice, texture: editRef.current.texture }, cwd));
      setFirstRun(false);
    } catch (e) {
      setMessage(`save failed: ${(e as Error).message}`);
    }
  }, [cwd]);

  const gotoPage = useCallback((p: Page) => { setPage(p); setFocused(0); }, []);
  const nextPage = useCallback((dir: -1 | 1) => {
    const i = PAGES.indexOf(page);
    gotoPage(PAGES[(i + dir + PAGES.length) % PAGES.length]);
  }, [page, gotoPage]);

  /** Move focus in two dimensions over the 2×4 grid (or the single column). */
  const move = useCallback((dx: number, dy: number) => {
    setFocused((f) => {
      if (lay.columns === 1) return clamp(f + dy + dx, 0, 7);
      const row = Math.floor(f / 4);
      const col = f % 4;
      return clamp(row + dy, 0, 1) * 4 + clamp(col + dx, 0, 3);
    });
  }, [lay.columns]);

  // ---- sessions ----

  const sessions = status?.sessions ?? [];
  const current = sessions[sessionIdx];
  const toggleMute = useCallback((idx: number) => {
    const s = (status?.sessions ?? [])[idx];
    if (!s) { setMessage('no session to mute'); return; }
    void control(`${s.muted ? 'unmuted' : 'muted'} ${s.voice}`, { cmd: 'mute', scope: { session: s.id }, value: !s.muted });
  }, [status, control]);

  // ---- keyboard ----

  const globalVolume = (dir: -1 | 1) => {
    const value = clamp((status?.volume ?? edit.volume) + dir * VOLUME_STEP, 0, 1);
    void control(`volume ${value.toFixed(2)}`, { cmd: 'volume', value: Math.round(value * 100) / 100 });
  };


  const onPrompt = (input: string, key: Key) => {
    if (key.escape) { setPrompt(null); setMessage('cancelled'); return; }
    if (key.return) {
      const name = prompt ?? '';
      setPrompt(null);
      try {
        setMessage(savePatch(name, { voice: editRef.current.voice, texture: editRef.current.texture }));
        setPatches(listPatches());
      } catch (e) {
        setMessage(`save failed: ${(e as Error).message}`);
      }
      return;
    }
    if (key.backspace || key.delete) { setPrompt((p) => (p ?? '').slice(0, -1)); return; }
    if (input && !key.ctrl && !key.meta && !key.tab) setPrompt((p) => (p ?? '') + input);
  };

  useInput((input, key) => {
    if (looksLikeMouse(input) || input.startsWith('[<')) return; // mouse reports are handled below
    if (prompt !== null) { onPrompt(input, key); return; }

    if (input === 'q' || (key.ctrl && input === 'c')) { exit(); return; }

    // pages and cells
    if (key.tab) { nextPage(key.shift ? -1 : 1); return; }
    if (key.upArrow || input === 'k') { move(0, -1); return; }
    if (key.downArrow || input === 'j') { move(0, 1); return; }
    if (key.leftArrow) { move(-1, 0); return; }
    if (key.rightArrow) { move(1, 0); return; }
    if (input === 'l' || input === '>') { nudge(1); return; }
    if (input === 'h' || input === '<') { nudge(-1); return; }
    if (input === '+' || input === '=') { globalVolume(1); return; }
    if (input === '-') { globalVolume(-1); return; }
    if (key.return) { const c = cells[focused]; if (c?.kind === 'pick') load(c); return; }
    if (input === '[') { if (page === 'patches') setPatchPage((p) => Math.max(0, p - 1)); return; }
    if (input === ']') { if (page === 'patches') setPatchPage((p) => Math.min(patchPages - 1, p + 1)); return; }

    const audition = auditionFor(input);
    if (audition) { preview(audition.what, audition.name); return; }

    // sessions
    if (input === 'J') { setSessionIdx((i) => Math.min(Math.max(0, sessions.length - 1), i + 1)); return; }
    if (input === 'K') { setSessionIdx((i) => Math.max(0, i - 1)); return; }
    if (input === 'm') { toggleMute(sessionIdx); return; }
    if (input === 'p') {
      if (!current) { setMessage('no session to push to'); return; }
      void control(`pushed ${edit.voice.name} · ${edit.texture} to ${current.voice}`, { cmd: 'set', session: current.id, voice: edit.voice, texture: edit.texture });
      return;
    }
    if (input === 'M') {
      const value = !(status?.mute ?? false);
      void control(value ? 'muted all' : 'unmuted all', { cmd: 'mute', scope: 'all', value });
      return;
    }

    // saving
    if (input === 's') { save(); return; }
    if (input === 'S') { setPrompt(''); return; }
  });

  // ---- mouse ----

  const view: View = {
    page, cells, focused, edit, status, daemon, sessionIdx, message, prompt,
    firstRun: firstRun && page === 'palette',
    projectLabel: target.inProject ? shortPath(target.root, Math.max(12, Math.floor(width / 3))) : path.basename(cwd),
    patchPage, patchPages,
  };
  const viewRef = useRef(view);
  viewRef.current = view;
  const layRef = useRef(lay);
  layRef.current = lay;
  const dragging = useRef<number | null>(null);

  const onMouse = useCallback((ev: MouseEvent) => {
    const v = viewRef.current;
    const l = layRef.current;
    const hit = hitTest(v, l, ev.x, ev.y);
    if (ev.kind === 'wheel') {
      if (hit?.type === 'cell') setFocused(hit.index);
      const idx = hit?.type === 'cell' ? hit.index : v.focused;
      const cell = v.cells[idx];
      if (cell && (cell.kind === 'range' || cell.kind === 'cycle')) applyChange(cell, adjust(editRef.current, cell, ev.button < 0 ? 1 : -1));
      return;
    }
    if (ev.kind === 'release') { dragging.current = null; return; }
    if (ev.kind === 'motion') {
      if (dragging.current === null || ev.button !== 0) return;
      const cell = v.cells[dragging.current];
      if (cell?.kind !== 'range') return;
      const h = hitTest(v, l, ev.x, ev.y);
      const f = h?.type === 'cell' && h.index === dragging.current && h.fraction !== undefined
        ? h.fraction
        : clamp((ev.x - 1 - rulerStart(l, dragging.current) + 0.5) / 12, 0, 1);
      applyChange(cell, setFraction(editRef.current, cell, f));
      return;
    }
    if (ev.button !== 0) return;
    if (!hit) return;
    if (hit.type === 'tab') { gotoPage(hit.page); return; }
    if (hit.type === 'session') {
      setSessionIdx(hit.index);
      if (hit.mute) toggleMute(hit.index);
      return;
    }
    setFocused(hit.index);
    const cell = v.cells[hit.index];
    if (cell?.kind === 'range' && hit.fraction !== undefined) {
      dragging.current = hit.index;
      applyChange(cell, setFraction(editRef.current, cell, hit.fraction));
    }
  }, [applyChange, gotoPage, toggleMute]);

  useEffect(() => {
    if (!internal_eventEmitter) return;
    const handler = (chunk: string) => { if (looksLikeMouse(chunk)) for (const ev of parseMouse(chunk)) onMouse(ev); };
    internal_eventEmitter.on('input', handler);
    return () => { internal_eventEmitter.removeListener('input', handler); };
  }, [internal_eventEmitter, onMouse]);

  // ---- render ----

  const lines: Line[] = renderLines(view, lay);
  return (
    <Box flexDirection="column" width={width}>
      {lines.map((line, i) => (
        <Text key={i} wrap="truncate">
          {line.map((s, j) => (
            <Text key={j} color={s.color} dimColor={s.dim} bold={s.bold} inverse={s.inverse}>{s.text}</Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
