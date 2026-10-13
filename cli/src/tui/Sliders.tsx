import React from 'react';
import { Box, Text } from 'ink';
import { formatValue, fraction, type Edit, type Macro, type Page } from './macros.js';

const LABEL = 11;
const VALUE = 6;
const BAR_MAX = 20;
const BAR_MIN = 6;

/** Bar cells that fit in a column `innerWidth` wide: "> label [bar] value". */
export function barWidth(innerWidth: number): number {
  const fixed = 2 + LABEL + 1 + 2 + 1 + VALUE;
  return Math.max(BAR_MIN, Math.min(BAR_MAX, innerWidth - fixed));
}

export interface SlidersProps {
  edit: Edit;
  macros: Macro[];
  focused: number;
  page: Page;
  /** Columns available inside the border and padding. */
  innerWidth?: number;
}

function bar(f: number, width: number): string {
  const filled = Math.round(f * width);
  return '='.repeat(filled) + '-'.repeat(width - filled);
}

function Slider({ edit, macro, focused, width }: { edit: Edit; macro: Macro; focused: boolean; width: number }): React.JSX.Element {
  const label = macro.label.padEnd(LABEL);
  const value = formatValue(edit, macro).padStart(VALUE);
  const body = macro.kind === 'cycle'
    ? `< ${macro.get(edit).padEnd(width - 4)} >`
    : `[${bar(fraction(edit, macro), width)}]`;
  return (
    <Text color={focused ? 'cyan' : undefined} bold={focused} wrap="truncate">
      {`${focused ? '>' : ' '} ${label} ${body} ${value}`}
    </Text>
  );
}

/** Centre column: the voice's macros as horizontal sliders, one page at a time. */
export function Sliders({ edit, macros, focused, page, innerWidth = 44 }: SlidersProps): React.JSX.Element {
  const current = macros[focused];
  const width = barWidth(innerWidth);
  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="single" paddingX={1}>
      <Text wrap="truncate">
        <Text bold>{edit.voice.name}</Text>
        <Text dimColor>{`  ${page === 'main' ? 'voice' : 'advanced'}  (a toggles)`}</Text>
      </Text>
      {macros.map((m, i) => <Slider key={m.id} edit={edit} macro={m} focused={i === focused} width={width} />)}
      <Text dimColor wrap="truncate">{current?.note ? `${current.label}: ${current.note}` : ' '}</Text>
      {page === 'advanced' ? (
        <Text dimColor wrap="truncate">fm ratio and reverb are stored only (not rendered yet)</Text>
      ) : null}
    </Box>
  );
}
