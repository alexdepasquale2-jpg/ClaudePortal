import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.spec.ts'] },
});
