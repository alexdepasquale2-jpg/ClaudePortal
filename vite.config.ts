import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

/**
 * SkyNeet Survivors runs in the browser — desktop and mobile.
 * Path aliases mirror the layer graph in docs/ARCHITECTURE.md; the same aliases are
 * declared in tsconfig.json and are what eslint-plugin-boundaries reasons about.
 */
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
  server: {
    // --host is set in the npm script so a phone on the same network can load the dev build.
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
