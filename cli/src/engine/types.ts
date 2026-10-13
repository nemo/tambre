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

/**
 * Extra knobs behind the TUI's advanced page. Stored on the voice and carried
 * through the daemon; the engine applies only what it implements:
 *   resonance  -> the voice filter's Q (0..1 maps 0.5..4), default 0.7
 *   attack     -> the voice's entrance time constant when a session starts (seconds)
 *   release    -> the time constant of the fade to silence on `waiting` (seconds)
 * `fmRatio` and `reverb` are stored but not yet rendered.
 */
export interface VoiceAdvanced {
  attack?: number;
  release?: number;
  resonance?: number;
  fmRatio?: number;
  reverb?: number;
}

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
  advanced?: VoiceAdvanced;
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
  // Over a pedal, warm: maj9 -> 6/9 -> sus4add9 -> maj13. Every voicing
  // except the sus carries the major third; no b6, b7, b9 or tritone anywhere.
  voicings: [
    [0, 4, 7, 11, 14],
    [0, 7, 9, 12, 16],
    [0, 5, 7, 12, 14],
    [0, 4, 11, 14, 21],
  ],
  bpm: 60,
  chordBars: 4,
};
