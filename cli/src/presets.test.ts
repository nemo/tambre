import { describe, it, expect } from 'vitest';
import { PRESETS, presetByName } from './presets.js';

describe('presets', () => {
  it('ships exactly 12 presets', () => {
    expect(PRESETS).toHaveLength(12);
  });
  it('has distinct names', () => {
    const names = PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it('looks up by name', () => {
    expect(presetByName('snap')?.name).toBe('snap');
    expect(presetByName('nope')).toBeUndefined();
  });
});