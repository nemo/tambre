import type { Voice } from './engine/types.js';

/**
 * Eight built-in voices, deliberately far apart in timbre, register and pan
 * so that two concurrent projects are never mistaken for each other.
 */
export const PALETTE: Voice[] = [
  { name: 'moss',   timbre: 0.05, register: 0,  brightness: 0.30, movement: { depth: 0.25, rate: 0.05 }, width: { detune: 5, pan: -0.35 }, bell: 'soft'  },
  { name: 'brass',  timbre: 0.70, register: 0,  brightness: 0.55, movement: { depth: 0.35, rate: 0.08 }, width: { detune: 7, pan:  0.40 }, bell: 'glass' },
  { name: 'cedar',  timbre: 0.20, register: -1, brightness: 0.25, movement: { depth: 0.15, rate: 0.03 }, width: { detune: 4, pan: -0.70 }, bell: 'wood'  },
  { name: 'glass',  timbre: 0.10, register: 1,  brightness: 0.70, movement: { depth: 0.20, rate: 0.11 }, width: { detune: 6, pan:  0.70 }, bell: 'glass' },
  { name: 'reed',   timbre: 0.90, register: 0,  brightness: 0.40, movement: { depth: 0.45, rate: 0.06 }, width: { detune: 9, pan: -0.15 }, bell: 'wood'  },
  { name: 'tide',   timbre: 0.35, register: -1, brightness: 0.45, movement: { depth: 0.60, rate: 0.04 }, width: { detune: 8, pan:  0.15 }, bell: 'soft'  },
  { name: 'wire',   timbre: 0.60, register: 1,  brightness: 0.85, movement: { depth: 0.30, rate: 0.14 }, width: { detune: 3, pan: -0.55 }, bell: 'glass' },
  { name: 'felt',   timbre: 0.00, register: 0,  brightness: 0.15, movement: { depth: 0.10, rate: 0.02 }, width: { detune: 5, pan:  0.55 }, bell: 'soft'  },
];

export const voiceByName = (name: string): Voice | undefined =>
  PALETTE.find((v) => v.name === name);
