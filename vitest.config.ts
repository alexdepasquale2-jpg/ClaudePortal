import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@campaign': fileURLToPath(new URL('./src/campaign', import.meta.url)),
      '@gameplay': fileURLToPath(new URL('./src/gameplay', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@scenes': fileURLToPath(new URL('./src/scenes', import.meta.url)),
      '@render': fileURLToPath(new URL('./src/render', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
