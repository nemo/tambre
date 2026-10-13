import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Tests never need an audio device: the engine opens an inert stub context.
    env: { TAMBRE_NO_AUDIO: '1' },
    testTimeout: 15_000,
  },
});
