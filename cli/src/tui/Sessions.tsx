import React from 'react';
import path from 'node:path';
import { Box, Text } from 'ink';
import type { SessionStatus, StatusReply } from '../ipc.js';

export const SESSIONS_WIDTH = 30;

export interface SessionsProps {
  status: StatusReply | null;
  highlighted: number;
}

const STATE_COLOUR: Record<SessionStatus['state'], string> = {
  working: 'green',
  blocked: 'yellow',
  waiting: 'blue',
  ended: 'gray',
};

/** Right column: the daemon's live sessions, polled once a second. */
export function Sessions({ status, highlighted }: SessionsProps): React.JSX.Element {
  const sessions = status?.sessions ?? [];
  return (
    <Box flexDirection="column" width={SESSIONS_WIDTH} flexShrink={0} borderStyle="single" paddingX={1}>
      <Text>
        <Text bold>sessions</Text>
        <Text dimColor>
          {status ? `  vol ${status.volume.toFixed(2)}${status.mute ? '  MUTED' : ''}` : '  daemon unreachable'}
        </Text>
      </Text>
      {sessions.length === 0 ? <Text dimColor>(none live)</Text> : null}
      {sessions.map((s, i) => {
        const hi = i === highlighted;
        const project = path.basename(s.projectRoot || '') || '?';
        return (
          <Box key={s.id} flexDirection="column">
            <Text inverse={hi} color={hi ? 'cyan' : undefined} wrap="truncate">
              {`${hi ? '>' : ' '} ${s.voice.padEnd(8)} ${project.slice(0, 18)}`}
            </Text>
            <Text wrap="truncate">
              {'   '}
              <Text color={STATE_COLOUR[s.state] ?? undefined}>{s.state.padEnd(8)}</Text>
              <Text dimColor>{` ${s.texture}`}</Text>
              {s.muted ? <Text color="red">{' muted'}</Text> : null}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
