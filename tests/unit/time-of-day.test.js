// The keys 1-4 jump to named moods. Tweaking the sun's path or the mood blend can quietly move them,
// or leave a stretch of the cycle where the blend weights don't add up and the sky goes black.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUniforms, TimeOfDay } from '../../src/palette.js';
import { NV, NS, NLAMPS } from '../../src/glsl.js';

const fresh = () => {
  const S = createUniforms({ lamps: [] });
  return { S, tod: new TimeOfDay(S) };
};
const at = (t) => { const { S, tod } = fresh(); tod.jump(t); tod.update(0); return { S, tod }; };

test('uniform arrays match the sizes the shaders are compiled with', () => {
  const { S } = fresh();
  assert.equal(S.uVC.value.length, NV);
  assert.equal(S.uVP.value.length, NV);
  assert.equal(S.uStars.value.length, NS);
  assert.equal(S.uLamps.value.length, NLAMPS);
});

test('1 is the starry night', () => {
  const { tod } = at(0.02);
  assert.ok(tod.night > 0.95, `night=${tod.night}`);
});

test('3 is full day', () => {
  const { tod } = at(0.42);
  assert.ok(tod.day > 0.95, `day=${tod.day}`);
});

test('2 is dawn and 4 is dusk: golden light, on opposite sides of the sky', () => {
  const dawn = at(0.245), dusk = at(0.714);
  for (const { tod } of [dawn, dusk]) assert.ok(tod.night < 0.3 && tod.day < 0.3, `night=${tod.night} day=${tod.day}`);
  assert.ok(dawn.S.uSunDir.value.x > 0, 'dawn sun should rise in the east');
  assert.ok(dusk.S.uSunDir.value.x < 0, 'dusk sun should set in the west');
});

test('the sky never goes black anywhere in the day', () => {
  for (let i = 0; i < 100; i++) {
    const { S } = at(i / 100);
    const c = S.uSkyTop.value;
    assert.ok(c.r + c.g + c.b > 0.15, `sky too dark at t=${i / 100}: ${c.getHexString()}`);
  }
});
