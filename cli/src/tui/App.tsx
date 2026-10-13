import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout, type Key } from 'ink';
import type { ControlMessage, ControlReply, StatusReply } from '../ipc.js';
import { cloneVoice, resolveSession } from '../config.js';
import { adjust, macrosFor, type Edit, type Page } from './macros.js';
import { auditionFor, KEY_HELP, VOLUME_STEP } from './keys.js';
import { listPresets, saveDefault, savePatch, saveTarget, type Preset } from './save.js';
import { Presets, PRESETS_WIDTH } from './Presets.js';
import { Sliders } from './Sliders.js';
import { Sessions, SESSIONS_WIDTH } from './Sessions.js';

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
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const noteName = (midi: number) => `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;

export function App({ client, cwd = process.cwd(), initialStatus = null, pollMs = 1000 }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // Centre column = terminal width minus the two fixed columns, its border and padding.
  const innerWidth = Math.max(24, (stdout?.columns ?? 100) - PRESETS_WIDTH - SESSIONS_WIDTH - 4);
  const initial = useMemo(() => resolveSession(cwd), [cwd]);
  const target = useMemo(() => saveTarget(cwd), [cwd]);

  const [presets, setPresets] = useState<Preset[]>(() => listPresets());
  const [highlighted, setHighlighted] = useState<number>(() => Math.max(0, listPresets().findIndex((p) => p.name === initial.voice.name)));
  const [edit, setEdit] = useState<Edit>({ voice: initial.voice, texture: initial.texture });
  const [page, setPage] = useState<Page>('main');
  const [focused, setFocused] = useState(0);
  const [status, setStatus] = useState<StatusReply | null>(initialStatus);
  const [sessionIdx, setSessionIdx] = useState(0);
  const [message, setMessage] = useState<string>(target.inProject ? `project ${target.root}` : 'no project here; s saves the user default');
  const [prompt, setPrompt] = useState<string | null>(null);

  const macros = useMemo(() => macrosFor(page), [page]);
  const editRef = useRef(edit);
  editRef.current = edit;

  const refresh = useCallback(async () => {
    try {
      const s = await client.status();
      setStatus(s);
    } catch {
      setStatus(null);
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

  const load = (p: Preset) => {
    setEdit((e) => ({ voice: cloneVoice(p.voice), texture: p.texture ?? e.texture }));
    setMessage(`loaded ${p.kind} ${p.name}`);
  };

  const onPrompt = (input: string, key: Key) => {
    if (key.escape) { setPrompt(null); setMessage('cancelled'); return; }
    if (key.return) {
      const name = prompt ?? '';
      setPrompt(null);
      try {
        setMessage(savePatch(name, editRef.current));
        setPresets(listPresets());
      } catch (e) {
        setMessage(`save failed: ${(e as Error).message}`);
      }
      return;
    }
    if (key.backspace || key.delete) { setPrompt((p) => (p ?? '').slice(0, -1)); return; }
    if (input && !key.ctrl && !key.meta && !key.tab) setPrompt((p) => (p ?? '') + input);
  };

  useInput((input, key) => {
    if (prompt !== null) { onPrompt(input, key); return; }

    if (input === 'q' || (key.ctrl && input === 'c')) { exit(); return; }

    // left column
    if (input === 'j' || key.downArrow) { setHighlighted((h) => Math.min(presets.length - 1, h + 1)); return; }
    if (input === 'k' || key.upArrow) { setHighlighted((h) => Math.max(0, h - 1)); return; }
    if (key.return) { const p = presets[highlighted]; if (p) load(p); return; }

    // centre
    if (key.tab) { setFocused((f) => (f + (key.shift ? -1 : 1) + macros.length) % macros.length); return; }
    if (input === 'l' || key.rightArrow) { setEdit((e) => adjust(e, macros[focused], 1)); return; }
    if (input === 'h' || key.leftArrow) { setEdit((e) => adjust(e, macros[focused], -1)); return; }
    if (input === 'a') { setPage((p) => (p === 'main' ? 'advanced' : 'main')); setFocused(0); return; }

    const audition = auditionFor(input);
    if (audition) {
      void control(`preview ${audition.name}`, { cmd: 'preview', ...audition, voice: edit.voice, texture: edit.texture });
      return;
    }

    // right column
    const sessions = status?.sessions ?? [];
    const current = sessions[sessionIdx];
    if (input === 'J') { setSessionIdx((i) => Math.min(Math.max(0, sessions.length - 1), i + 1)); return; }
    if (input === 'K') { setSessionIdx((i) => Math.max(0, i - 1)); return; }
    if (input === 'm') {
      if (!current) { setMessage('no session to mute'); return; }
      void control(`${current.muted ? 'unmuted' : 'muted'} ${current.voice}`, { cmd: 'mute', scope: { session: current.id }, value: !current.muted });
      return;
    }
    if (input === 'p') {
      if (!current) { setMessage('no session to push to'); return; }
      void control(`pushed ${edit.voice.name}/${edit.texture} to ${current.voice}`, { cmd: 'set', session: current.id, voice: edit.voice, texture: edit.texture });
      return;
    }
    if (input === 'M') {
      const value = !(status?.mute ?? false);
      void control(value ? 'muted all' : 'unmuted all', { cmd: 'mute', scope: 'all', value });
      return;
    }
    if (input === '+' || input === '=' || input === '-') {
      const value = clamp((status?.volume ?? 0.8) + (input === '-' ? -VOLUME_STEP : VOLUME_STEP), 0, 1);
      void control(`volume ${value.toFixed(2)}`, { cmd: 'volume', value: Math.round(value * 100) / 100 });
      return;
    }

    // saving
    if (input === 's') {
      try {
        setMessage(saveDefault(edit, cwd));
        setPresets(listPresets());
      } catch (e) {
        setMessage(`save failed: ${(e as Error).message}`);
      }
      return;
    }
    if (input === 'S') { setPrompt(''); return; }
  });

  const frame = status?.frame;
  const header = frame ? `frame ${noteName(frame.root)} ${frame.bpm} bpm` : 'frame ?';

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold color="cyan">tambre</Text>
        <Text dimColor>{`  ${header}  ${status ? 'daemon ok' : 'daemon unreachable'}`}</Text>
      </Text>
      <Box>
        <Presets presets={presets} highlighted={highlighted} loaded={edit.voice.name} />
        <Sliders edit={edit} macros={macros} focused={focused} page={page} innerWidth={innerWidth} />
        <Sessions status={status} highlighted={sessionIdx} />
      </Box>
      {prompt !== null ? (
        <Text>
          <Text color="yellow">patch name: </Text>
          <Text>{prompt}</Text>
          <Text inverse> </Text>
          <Text dimColor>  (Enter saves, Esc cancels)</Text>
        </Text>
      ) : (
        KEY_HELP.map((row, i) => (
          <Text key={i} dimColor wrap="truncate">{row.map(([k, v]) => `${k} ${v}`).join('  ')}</Text>
        ))
      )}
      <Text color="green">{message}</Text>
    </Box>
  );
}
