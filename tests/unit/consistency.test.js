// Facts that live in two places at once, where changing one copy silently breaks the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const read = (p) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the sky repaint schedule is identical in the scene shader and the paint pass', async () => {
  // glsl.js decides when each sky stroke was last painted (its colour); post.js decides how it is
  // drawn and when its new paint arrives. If the two disagree, strokes flicker or repaint out of sync.
  const fns = ['repaintPeriod', 'repaintEpoch', 'repaintStart'];
  const grab = (src) => fns.map((f) => {
    const m = src.match(new RegExp(`float ${f}\\(float h(?:, float [a-z])?\\)\\{[^\\n]*\\}`));
    assert.ok(m, `${f} not found`);
    return m[0];
  });
  assert.deepEqual(grab(await read('src/post.js')), grab(await read('src/glsl.js')));
});

test('the page loads the same Three.js the tests run against', async () => {
  const html = await read('index.html');
  const pkg = JSON.parse(await read('package.json'));
  const url = html.match(/"three":\s*"([^"]+)"/)[1];
  assert.ok(url.includes(`three@${pkg.devDependencies.three}/`), `index.html loads ${url}, package.json pins ${pkg.devDependencies.three}`);
});

test('the import map integrity hash matches that Three.js build', async () => {
  const html = await read('index.html');
  const expected = html.match(/"integrity":\s*\{\s*"[^"]+":\s*"(sha384-[^"]+)"/)[1];
  const file = await readFile(new URL('../../node_modules/three/build/three.module.js', import.meta.url));
  assert.equal(`sha384-${createHash('sha384').update(file).digest('base64')}`, expected);
});
