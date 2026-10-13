import React from 'react';
import { Box, Text } from 'ink';
import type { Preset } from './save.js';

export const PRESETS_WIDTH = 16;

export interface PresetsProps {
  presets: Preset[];
  highlighted: number;
  /** Name of the voice currently loaded in the editor. */
  loaded: string;
}

/** Left column: the palette, then saved patches. */
export function Presets({ presets, highlighted, loaded }: PresetsProps): React.JSX.Element {
  let lastKind: Preset['kind'] | null = null;
  const rows: React.JSX.Element[] = [];
  presets.forEach((p, i) => {
    if (p.kind !== lastKind) {
      rows.push(<Text key={`h-${p.kind}`} dimColor>{p.kind === 'palette' ? 'palette' : 'patches'}</Text>);
      lastKind = p.kind;
    }
    const hi = i === highlighted;
    const mark = p.name === loaded ? '*' : ' ';
    rows.push(
      <Text key={`${p.kind}-${p.name}`} inverse={hi} color={hi ? 'cyan' : undefined} wrap="truncate">
        {`${hi ? '>' : ' '}${mark}${p.name}`}
      </Text>,
    );
  });
  if (!presets.some((p) => p.kind === 'patch')) {
    rows.push(<Text key="h-patch" dimColor>patches</Text>);
    rows.push(<Text key="none" dimColor>  (none)</Text>);
  }
  return (
    <Box flexDirection="column" width={PRESETS_WIDTH} flexShrink={0} borderStyle="single" paddingX={1}>
      {rows}
    </Box>
  );
}
