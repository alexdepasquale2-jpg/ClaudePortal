import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Tauri sets TAURI_DEV_HOST when a phone runs the dev build over the LAN.
const host = process.env.TAURI_DEV_HOST;
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  // Keep Tauri's Rust compiler output visible in the same terminal.
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    // fonts.css lives in xindoze/assets, outside this package root.
    fs: { allow: [here, path.resolve(here, '../..')] },
    // tauri.conf.json's devUrl points here.
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5174 } : undefined,
  },
  build: {
    outDir: 'dist',
    // Tauri ships local files; a source map is only useful in debug builds.
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
