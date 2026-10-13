import type { CanonicalEvent, SessionState } from '../engine/types.js';

/** One audition key: what the daemon previews when it is pressed. */
export interface Audition {
  what: 'event' | 'state';
  name: CanonicalEvent | SessionState;
}

/** Digits audition one-shots; space and w play working, b blocked, i waiting. */
export const AUDITION_KEYS: Record<string, Audition> = {
  ' ': { what: 'state', name: 'working' },
  w: { what: 'state', name: 'working' },
  b: { what: 'state', name: 'blocked' },
  i: { what: 'state', name: 'waiting' },
  '1': { what: 'event', name: 'session.start' },
  '2': { what: 'event', name: 'turn.end' },
  '3': { what: 'event', name: 'permission.request' },
  '4': { what: 'event', name: 'turn.fail' },
  '5': { what: 'event', name: 'session.end' },
  '6': { what: 'event', name: 'compact' },
};

export const auditionFor = (input: string): Audition | undefined =>
  Object.prototype.hasOwnProperty.call(AUDITION_KEYS, input) ? AUDITION_KEYS[input] : undefined;

/** Volume step for + and -. */
export const VOLUME_STEP = 0.05;
