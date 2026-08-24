import { defineConfig, devices } from '@playwright/test';

/**
 * Some environments (CI images, sandboxes) ship a Chromium build that does not match the version
 * Playwright would download. Point PLAYWRIGHT_CHROMIUM_EXECUTABLE at that binary to use it instead
 * of failing; unset, Playwright resolves its own browser as normal.
 */
const executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'];
const launch = executablePath ? { launchOptions: { executablePath } } : {};

/**
 * PlayMode equivalents from the design doc run here: they drive the real app in a real
 * browser. Mobile is a first-class target, not an afterthought — see docs/ARCHITECTURE.md.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], ...launch } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], ...launch } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
