/** A frame is the shared harmonic ground every session plays in. */
export interface Frame {
  /** Pedal root, MIDI note. Never moves during a session. */
  root: number;
  /** Extended voicings as semitone offsets above the root, octave spread kept. */
  voicings: number[][];
  bpm: number;
  /** Bars per chord before the colour advances. */
  chordBars: number;
}

export type BellColour = 'glass' | 'wood' | 'soft';

/** A voice is what one project sounds like inside the frame. */
export interface Voice {
  name: string;
  /** 0 = triangle bed, 1 = saw bed. */
  timbre: number;
  /** Octave offset for the pad rungs. */
  register: number;
  /** 0..1, maps to lowpass cutoff. */
  brightness: number;
  movement: { depth: number; rate: number };
  width: { detune: number; pan: number };
  bell: BellColour;
}

export type SessionState = 'working' | 'blocked' | 'waiting' | 'ended';

export type CanonicalEvent =
  | 'session.start'
  | 'session.end'
  | 'turn.end'
  | 'turn.fail'
  | 'permission.request'
  | 'compact'
  | 'working'
  | 'waiting'
  | 'activity';

export const DEFAULT_FRAME: Frame = {
  root: 43, // G2
  // Over a pedal: m7b13 -> m9b13-ish -> m11 -> m7. Octave spread kept verbatim.
  voicings: [
    [0, 15, 19, 20, 22],
    [0, 7, 8, 15, 26],
    [0, 10, 15, 17, 26],
    [0, 7, 10, 15, 22],
  ],
  bpm: 60,
  chordBars: 4,
};
