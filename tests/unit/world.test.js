// The world is generated from fixed seeds. These guard the things that are easy to break when
// moving trees, roads or terrain around: the walk must start somewhere walkable, paths must stay
// open, and the same world must come out every time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, heightAt, lakeField, roadDistance, START, WATER_Y, BOUNDS } from '../../src/world.js';

const world = buildWorld();

test('the world is the same on every load', () => {
  const again = buildWorld();
  const pick = (w) => JSON.stringify([w.cypresses, w.olives, w.houses, w.lamps, w.obstacles.length]);
  assert.equal(pick(again), pick(world));
});

test('the walk starts on dry land, inside the bounds, clear of every obstacle', () => {
  assert.ok(heightAt(START.x, START.z) > WATER_Y + 0.25, 'start is in the water');
  assert.ok(Math.hypot(START.x, START.z) < BOUNDS, 'start is outside the bounds');
  const PLAYER = 0.4;
  for (const o of world.obstacles) {
    const dx = START.x - o.x, dz = START.z - o.z;
    if (o.r !== undefined) {
      assert.ok(Math.hypot(dx, dz) > o.r + PLAYER, `start is inside a tree at ${o.x.toFixed(1)}, ${o.z.toFixed(1)}`);
    } else {
      const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
      assert.ok(Math.abs(lx) > o.hw + PLAYER || Math.abs(lz) > o.hd + PLAYER, 'start is inside a house');
    }
  }
});

test('no tree stands on a road', () => {
  for (const c of world.cypresses) assert.ok(roadDistance(c.x, c.z) > 1.5, `cypress on a road at ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`);
  for (const o of world.olives) assert.ok(roadDistance(o.x, o.z) > 1.5, `tree on a road at ${o.x.toFixed(1)}, ${o.z.toFixed(1)}`);
});

test('nothing stands in the lake', () => {
  for (const t of [...world.cypresses, ...world.olives, ...world.houses]) {
    assert.ok(lakeField(t.x, t.z) > 1.0, `something stands in the lake at ${t.x.toFixed(1)}, ${t.z.toFixed(1)}`);
  }
});
