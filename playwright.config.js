import { defineConfig } from '@playwright/test';

const PORT = 5199;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000, // software WebGL on CI machines is slow
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 960, height: 540 },
    // the installed Chrome (also present on GitHub's runners), so no browser download is needed;
    // without a GPU it falls back to SwiftShader, which must be allowed explicitly
    channel: 'chrome',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `node scripts/serve.mjs`,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
