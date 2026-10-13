import type { CanonicalEvent, SessionState } from '../engine/types.js';

/** One audition key: what the daemon previews when it is pressed. */
export interface Audition {
  what: 'event' | 'state';
  name: CanonicalEvent | SessionState;
}

/** Digits audition one-shots; letters audition the three held states. */
export const AUDITION_KEYS: Record<string, Audition> = {
  '1': { what: 'event', name: 'session.start' },
  '2': { what: 'event', name: 'turn.end' },
  '3': { what: 'event', name: 'permission.request' },
  '4': { what: 'event', name: 'turn.fail' },
  '5': { what: 'event', name: 'session.end' },
  '6': { what: 'event', name: 'compact' },
  w: { what: 'state', name: 'working' },
  b: { what: 'state', name: 'blocked' },
  i: { what: 'state', name: 'waiting' },
};

export const auditionFor = (input: string): Audition | undefined =>
  Object.prototype.hasOwnProperty.call(AUDITION_KEYS, input) ? AUDITION_KEYS[input] : undefined;

/** The footer: two rows of key/meaning pairs, editing keys then session and save keys. */
export const KEY_HELP: ReadonlyArray<ReadonlyArray<readonly [string, string]>> = [
  [
    ['j/k', 'preset'],
    ['Enter', 'load'],
    ['Tab', 'slider'],
    ['h/l', 'adjust'],
    ['a', 'advanced'],
    ['1-6 w b i', 'audition'],
  ],
  [
    ['J/K', 'session'],
    ['m', 'mute it'],
    ['p', 'push voice to it'],
    ['M', 'mute all'],
    ['+/-', 'volume'],
    ['s', 'save'],
    ['S', 'save patch'],
    ['q', 'quit'],
  ],
];

/** Volume step for + and -. */
export const VOLUME_STEP = 0.05;
