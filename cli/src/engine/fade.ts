import type { AudioParam } from 'node-web-audio-api';

/** Seconds a mute or unmute takes, per session and on the master. */
export const MUTE_FADE_S = 0.2;

/** Linear ramp an AudioParam from wherever it is now to `target` over `seconds`. */
export function fadeTo(param: AudioParam, target: number, now: number, seconds: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + seconds);
}
