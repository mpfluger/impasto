// Captures docs/screenshot.jpg (used by the README and as the link-preview image): the starting
// view at night, rendered on the GPU. `npm run screenshot`
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = 5198;
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`http://localhost:${PORT}/?instant`);
  await page.waitForFunction(() => window.__painting, null, { timeout: 60_000 });
  await page.evaluate(async () => {
    const W = window.__painting;
    W.debug.dream = 0; W.debug.fixedScale = true; W.setScale(1);
    const p = W.player; p.freeLook = false;
    p.tYaw = p.yaw = 0.0; p.tPitch = p.pitch = 0.16;
    await new Promise((r) => setTimeout(r, 2500));
  });
  await page.screenshot({ path: 'docs/screenshot.jpg', type: 'jpeg', quality: 85 });
  console.log('wrote docs/screenshot.jpg');
} finally {
  await browser.close();
  server.kill();
}
