// The painting lives almost entirely in shaders, and a shader that fails to compile shows up only
// as a console error and a blank or black canvas. These tests boot the real page in Chrome and
// catch exactly that, plus the title / walk / keys flow that has broken before.
import { test, expect } from '@playwright/test';

// Collect console errors and uncaught exceptions; Three.js reports shader compile failures this way.
function watchErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

// Grab the canvas just after a frame is drawn and measure how varied it is: a painted scene has
// many different colours, a failed render is one flat colour.
async function canvasVariety(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
    const src = document.getElementById('c');
    const small = document.createElement('canvas');
    small.width = 64; small.height = 36;
    const ctx = small.getContext('2d');
    ctx.drawImage(src, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data;
    let sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += l; sum2 += l * l; n++; }
    const mean = sum / n;
    resolve({ mean, sd: Math.sqrt(sum2 / n - mean * mean) });
  })));
}

const ready = (page) => page.waitForFunction(() => window.__painting, null, { timeout: 60_000 });
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

test('every shader compiles and the scene is painted', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?instant');
  await ready(page);
  await frames(page, 20);
  expect(errors).toEqual([]);
  const { mean, sd } = await canvasVariety(page);
  expect(mean).toBeGreaterThan(10);   // not black
  expect(sd).toBeGreaterThan(8);      // not one flat colour
});

test('all four times of day and the dream render without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?instant');
  await ready(page);
  for (const key of ['2', '3', '4', '1']) {
    await page.keyboard.press(key);
    await frames(page, 5);
  }
  await page.evaluate(() => { window.__painting.debug.dream = 1; });
  await frames(page, 10);
  expect(errors).toEqual([]);
  expect((await canvasVariety(page)).sd).toBeGreaterThan(8);
});

test('title, step inside, the keys card, and Esc back to the title', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await ready(page);
  const title = page.locator('#title');
  await expect(title).toHaveClass(/show/);

  await page.getByRole('button', { name: 'step inside' }).click();
  await expect(title).not.toHaveClass(/show/);

  await page.keyboard.press('Shift+Slash');
  await expect(page.locator('#help')).toHaveClass(/show/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).not.toHaveClass(/show/);

  // in a window (not fullscreen), Esc returns to the title
  await page.keyboard.press('Escape');
  await expect(title).toHaveClass(/show/);
  expect(errors).toEqual([]);
});
