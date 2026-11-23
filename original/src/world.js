// World generation: terrain height, field patchwork, roads, lake, village, vegetation.
// Everything is deterministic (seeded) so the landscape is the same on every visit.

export const MAP_N = 1024;          // world map texture resolution
export const MAP_HALF = 512;        // map covers [-512, 512] metres
export const WATER_Y = -0.6;
export const VILLAGE = { x: -28, z: -172 };
export const LAKE = { x: 80, z: -210, rx: 62, rz: 38, rot: 0.35 };
export const START = { x: 1.5, z: 9 };
export const OLIVE = { x: -128, z: -40, r: 72 };
export const BOUNDS = 360;

// ---------- seeded random + noise ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedRng = mulberry32(1889);
const perm = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(seedRng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const GR = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
export function snoise2(x, y) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0, tt;
  tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { const g = GR[perm[ii + perm[jj]] & 7]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0); }
  tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { const g = GR[perm[ii + i1 + perm[jj + j1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1); }
  tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { const g = GR[perm[ii + 1 + perm[jj + 1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2); }
  return 70 * n;
}
export function fbm2(x, y, oct = 4) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * snoise2(x * f + i * 17.3, y * f - i * 9.1); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function ridged2(x, y, oct = 4) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { let r = 1 - Math.abs(snoise2(x * f + 3.1 * i, y * f + 7.7 * i)); r *= r; s += a * r; n += a; a *= 0.5; f *= 2.1; }
  return s / n;
}
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- lake ----------
const LC = Math.cos(LAKE.rot), LS = Math.sin(LAKE.rot);
export function lakeField(x, z) {
  const dx = x - LAKE.x, dz = z - LAKE.z;
  const u = (dx * LC - dz * LS) / LAKE.rx, v = (dx * LS + dz * LC) / LAKE.rz;
  return Math.hypot(u, v) + snoise2(x * 0.025 + 11, z * 0.025 - 3) * 0.12;
}
export function lakePoint(theta, scale) {
  const u = Math.cos(theta) * LAKE.rx * scale, v = Math.sin(theta) * LAKE.rz * scale;
  return [LAKE.x + u * LC + v * LS, LAKE.z - u * LS + v * LC];
}

// ---------- roads ----------
const ROADS = [
  [[2, 14], [4, -20], [-4, -55], [-14, -95], [-22, -130], [-27, -160], [-30, -185]],
  [[-27, -160], [-6, -178], [16, -192], [30, -205]],
  [[2, 14], [10, 42], [36, 82], [74, 110], [120, 120]],
  [[-4, -55], [-48, -52], [-100, -38], [-150, -30]],
  [[4, -20], [40, -28], [92, -18], [150, 12]],
  [[-30, -185], [-60, -200], [-110, -205]],
];
function catmull(pts, step = 2.5) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
export const roadPolylines = ROADS.map((r) => catmull(r));

// map helpers
const N = MAP_N;
const toTex = (w) => (w + MAP_HALF) * (N / (2 * MAP_HALF)) - 0.5;
const toWorld = (i) => (i + 0.5) * ((2 * MAP_HALF) / N) - MAP_HALF;

const roadDist = new Float32Array(N * N).fill(99);
const roadDX = new Float32Array(N * N), roadDZ = new Float32Array(N * N);
for (const pl of roadPolylines) {
  for (let k = 0; k < pl.length - 1; k++) {
    const [ax, az] = pl[k], [bx, bz] = pl[k + 1];
    const ex = bx - ax, ez = bz - az, el2 = ex * ex + ez * ez || 1, el = Math.sqrt(el2);
    const R = 8;
    const i0 = Math.max(0, Math.floor(toTex(Math.min(ax, bx) - R))), i1 = Math.min(N - 1, Math.ceil(toTex(Math.max(ax, bx) + R)));
    const j0 = Math.max(0, Math.floor(toTex(Math.min(az, bz) - R))), j1 = Math.min(N - 1, Math.ceil(toTex(Math.max(az, bz) + R)));
    for (let j = j0; j <= j1; j++) {
      const wz = toWorld(j);
      for (let i = i0; i <= i1; i++) {
        const wx = toWorld(i);
        const t = Math.min(1, Math.max(0, ((wx - ax) * ex + (wz - az) * ez) / el2));
        const d = Math.hypot(wx - (ax + ex * t), wz - (az + ez * t));
        const idx = j * N + i;
        if (d < roadDist[idx]) { roadDist[idx] = d; roadDX[idx] = ex / el; roadDZ[idx] = ez / el; }
      }
    }
  }
}
function sampleBilinear(arr, x, z) {
  const fx = toTex(x), fz = toTex(z);
  if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return 99;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = arr[j * N + i], b = arr[j * N + i + 1], c = arr[(j + 1) * N + i], d = arr[(j + 1) * N + i + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}
export function roadDistance(x, z) { return sampleBilinear(roadDist, x, z); }
const roadMaskFromDist = (d, x, z) => smoothstep(2.9 + snoise2(x * 0.08, z * 0.08) * 0.6, 1.3, d);

// ---------- height ----------
export function heightAt(x, z) {
  let h = fbm2(x / 170, z / 170, 4) * 14 + 3;
  h += fbm2(x / 45, z / 45, 2) * 1.6;
  // the hill you start on
  h += 7 * Math.exp(-((x - 2) ** 2 + (z - 4) ** 2) / (58 * 58));
  // valley that holds the village
  const dv = (x - VILLAGE.x) ** 2 + (z - VILLAGE.z) ** 2;
  const vm = Math.exp(-dv / (100 * 100)) * 0.85;
  h = h * (1 - vm) + vm * (1.4 + fbm2(x / 40, z / 40, 2) * 1.0);
  // lake basin with gentle shore
  const lf = lakeField(x, z);
  const shore = smoothstep(1.7, 1.0, lf);
  h = lerp(h, Math.min(h, 0.8), shore * 0.8);
  const basin = smoothstep(1.02, 0.7, lf);
  h = lerp(h, -4.5, basin);
  // the Alpilles: mountains rising around the valley, tallest to the north
  const r = Math.hypot(x, z) + 1e-3;
  const m = smoothstep(330, 620, r + snoise2(x / 160, z / 160) * 40);
  if (m > 0) {
    const north = Math.max(0, -z / r);
    h += m * (22 + 38 * north + 48 * ridged2(x / 110, z / 110, 5)) + smoothstep(620, 950, r) * 70;
  }
  // roads sit slightly into the ground
  const rd = roadDistance(x, z);
  if (rd < 6) h -= roadMaskFromDist(rd, x, z) * 0.25;
  return h;
}
export function normalAt(x, z) {
  const e = 0.6;
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz, l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

// ---------- field patchwork (Voronoi) ----------
export const FIELD = { MEADOW: 0, WHEAT: 1, PLOUGHED: 2, LAVENDER: 3, YOUNG: 4, OLIVE: 5 };
const CELL = 34;
const CELLS = Math.ceil(MAP_HALF / CELL) + 2;
const SPAN = 2 * CELLS + 1;
const siteArr = new Array(SPAN * SPAN);
const sites = { set: (ci, cj, s) => { siteArr[(cj + CELLS) * SPAN + ci + CELLS] = s; }, get: (ci, cj) => (ci < -CELLS || cj < -CELLS || ci > CELLS || cj > CELLS ? null : siteArr[(cj + CELLS) * SPAN + ci + CELLS]), values: () => siteArr };
{
  const rng = mulberry32(77);
  for (let cj = -CELLS; cj <= CELLS; cj++) {
    for (let ci = -CELLS; ci <= CELLS; ci++) {
      const sx = (ci + 0.15 + 0.7 * rng()) * CELL, sz = (cj + 0.15 + 0.7 * rng()) * CELL;
      const r = rng();
      let type;
      const dOl = Math.hypot(sx - OLIVE.x, sz - OLIVE.z), dV = Math.hypot(sx - VILLAGE.x, sz - VILLAGE.z), dS = Math.hypot(sx - START.x, sz - START.z);
      if (dOl < OLIVE.r) type = FIELD.OLIVE;
      else if (dV < 66) type = r < 0.65 ? FIELD.MEADOW : FIELD.YOUNG;
      else if (dS < 20) type = FIELD.MEADOW;
      else type = r < 0.42 ? FIELD.WHEAT : r < 0.58 ? FIELD.MEADOW : r < 0.72 ? FIELD.PLOUGHED : r < 0.82 ? FIELD.LAVENDER : FIELD.YOUNG;
      sites.set(ci, cj, { x: sx, z: sz, type, angle: rng() * Math.PI, rnd: rng() });
    }
  }
  // make sure the first steps lead into wheat
  const force = (x, z, type) => { let best = null, bd = 1e9; for (const s of sites.values()) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } } best.type = type; };
  force(34, -4, FIELD.WHEAT); force(26, 42, FIELD.WHEAT); force(-34, 22, FIELD.LAVENDER); force(60, 20, FIELD.WHEAT); force(-40, -40, FIELD.PLOUGHED);
}
function siteAt(x, z) {
  const wx = x + snoise2(x * 0.035, z * 0.035) * 7, wz = z + snoise2(x * 0.035 + 40, z * 0.035) * 7;
  const ci = Math.floor(wx / CELL), cj = Math.floor(wz / CELL);
  let best = null, bd = 1e9;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const s = sites.get(ci + di, cj + dj); if (!s) continue;
    const d = (s.x - wx) ** 2 + (s.z - wz) ** 2; if (d < bd) { bd = d; best = s; }
  }
  return best;
}
export function fieldAt(x, z) { const s = siteAt(x, z); return s ? s.type : 0; }

// ---------- build everything ----------
export function buildWorld() {
  const rng = mulberry32(1853);
  const R = () => rng();

  // patch texture (nearest) & road/AO texture (linear)
  const patch = new Uint8Array(N * N * 4);
  const road = new Uint8Array(N * N * 4);
  const ao = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const wz = toWorld(j);
    for (let i = 0; i < N; i++) {
      const wx = toWorld(i), idx = j * N + i, o = idx * 4;
      const s = siteAt(wx, wz);
      patch[o] = s.type * 32; patch[o + 1] = Math.floor((s.angle / Math.PI) * 255); patch[o + 2] = Math.floor(s.rnd * 255); patch[o + 3] = 255;
      const rm = roadMaskFromDist(roadDist[idx], wx, wz);
      road[o] = Math.floor(rm * 255);
      road[o + 1] = Math.floor((roadDX[idx] * 0.5 + 0.5) * 255);
      road[o + 2] = Math.floor((roadDZ[idx] * 0.5 + 0.5) * 255);
    }
  }

  const obstacles = []; // {x,z,r} circles or {x,z,c,s,hw,hd} boxes
  const okGround = (x, z, roadClear = 4) => {
    if (lakeField(x, z) < 1.15) return false;
    if (roadDistance(x, z) < roadClear) return false;
    if (Math.hypot(x, z) > 330) return false;
    return true;
  };
  const splatAO = (x, z, rad, amt) => {
    const ci = toTex(x), cj = toTex(z), rr = rad * (N / (2 * MAP_HALF));
    for (let j = Math.floor(cj - rr); j <= Math.ceil(cj + rr); j++) for (let i = Math.floor(ci - rr); i <= Math.ceil(ci + rr); i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const d = Math.hypot(i - ci, j - cj) / rr; if (d >= 1) continue;
      const idx = j * N + i; ao[idx] = Math.min(1, ao[idx] + amt * (1 - d * d));
    }
  };

  // ---- village houses ----
  const houses = [];
  const nearHouse = (x, z, pad) => houses.some((h) => Math.hypot(h.x - x, h.z - z) < pad + h.rad);
  // church
  {
    const x = -40, z = -182;
    houses.push({ x, z, y: heightAt(x, z), w: 8, d: 17, h: 9, rot: 0.12, church: true, rad: 10, seed: 0.5 });
  }
  let tries = 0;
  while (houses.length < 38 && tries++ < 4000) {
    const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 58;
    const x = VILLAGE.x + Math.cos(a) * rr, z = VILLAGE.z + Math.sin(a) * rr * 0.8;
    const w = 5 + R() * 4.5, d = 4 + R() * 3.5, h = 3.6 + R() * 3.2;
    const rad = Math.hypot(w, d) * 0.5;
    if (lakeField(x, z) < 1.25 || roadDistance(x, z) < rad + 2.2 || nearHouse(x, z, rad + 1.5)) continue;
    // orient along the nearest road, roughly
    const fx = toTex(x), fz = toTex(z); const idx = Math.round(fz) * N + Math.round(fx);
    const base = Math.atan2(roadDZ[idx], roadDX[idx]);
    const rot = -base + (R() < 0.5 ? 0 : Math.PI / 2) + (R() - 0.5) * 0.25;
    houses.push({ x, z, y: heightAt(x, z), w, d, h, rot, church: false, rad, seed: R() });
  }
  for (const h of houses) {
    obstacles.push({ x: h.x, z: h.z, c: Math.cos(h.rot), s: Math.sin(h.rot), hw: h.w / 2 + 0.3, hd: h.d / 2 + 0.3 });
    splatAO(h.x, h.z, h.rad + 3, 0.5);
  }

  // ---- cypresses ----
  const cypresses = [{ x: -15, z: -9, h: 30, r: 3.6 }];
  const addCyp = (x, z, h, r) => { cypresses.push({ x, z, h, r }); };
  // a few by the big one
  addCyp(-19.5, -4.5, 17, 2.4); addCyp(-11, -15, 12, 1.8);
  tries = 0;
  while (cypresses.length < 16 && tries++ < 2000) { // around the village
    const a = R() * Math.PI * 2, rr = 25 + R() * 55;
    const x = VILLAGE.x + Math.cos(a) * rr, z = VILLAGE.z + Math.sin(a) * rr;
    if (!okGround(x, z, 3.5) || nearHouse(x, z, 3)) continue;
    addCyp(x, z, 11 + R() * 9, 1.6 + R() * 1.2);
  }
  // along the road to the village
  const mainRoad = roadPolylines[0];
  for (let k = 12; k < mainRoad.length - 6; k += 9) {
    const [ax, az] = mainRoad[k], [bx, bz] = mainRoad[k + 1];
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    const side = (k / 9) % 2 ? 1 : -1;
    const x = ax - (dz / l) * 5.5 * side, z = az + (dx / l) * 5.5 * side;
    if (okGround(x, z, 3) && !nearHouse(x, z, 3)) addCyp(x, z, 9 + R() * 6, 1.4 + R() * 0.6);
  }
  tries = 0;
  while (cypresses.length < 60 && tries++ < 5000) { // scattered, sometimes in pairs
    const x = (R() - 0.5) * 620, z = (R() - 0.5) * 620;
    if (!okGround(x, z, 4) || nearHouse(x, z, 4) || Math.hypot(x - START.x, z - START.z) < 18) continue;
    if (normalAt(x, z)[1] < 0.92) continue;
    if (cypresses.some((c) => Math.hypot(c.x - x, c.z - z) < 10)) continue;
    const h = 8 + R() * 10;
    addCyp(x, z, h, h * (0.11 + R() * 0.03));
    if (R() < 0.35) addCyp(x + 3 + R() * 2, z + (R() - 0.5) * 4, h * 0.7, h * 0.08);
  }
  for (const c of cypresses) {
    c.y = heightAt(c.x, c.z) - 0.6;
    obstacles.push({ x: c.x, z: c.z, r: c.r * 0.45 });
    splatAO(c.x, c.z, c.r * 2.2, 0.55);
  }

  // ---- olive grove ----
  const olives = [];
  {
    const rot = 0.4, cr = Math.cos(rot), sr = Math.sin(rot);
    for (let a = -9; a <= 9; a++) for (let b = -9; b <= 9; b++) {
      const lx = a * 10 + (R() - 0.5) * 3, lz = b * 9 + (R() - 0.5) * 3;
      const x = OLIVE.x + lx * cr - lz * sr, z = OLIVE.z + lx * sr + lz * cr;
      if (Math.hypot(x - OLIVE.x, z - OLIVE.z) > OLIVE.r - 6) continue;
      if (!okGround(x, z, 4)) continue;
      olives.push({ x, z, y: heightAt(x, z) - 0.2, s: 0.85 + R() * 0.45, rot: R() * Math.PI * 2, v: Math.floor(R() * 3) });
    }
    tries = 0;
    while (tries++ < 400) { // a few stray olives in meadows
      const x = (R() - 0.5) * 500, z = (R() - 0.5) * 500;
      if (!okGround(x, z, 4) || fieldAt(x, z) !== FIELD.MEADOW || nearHouse(x, z, 4)) continue;
      if (Math.hypot(x - START.x, z - START.z) < 14) continue;
      olives.push({ x, z, y: heightAt(x, z) - 0.2, s: 0.8 + R() * 0.5, rot: R() * Math.PI * 2, v: Math.floor(R() * 3) });
      if (olives.length > 160) break;
    }
  }
  for (const o of olives) { obstacles.push({ x: o.x, z: o.z, r: 0.5 * o.s }); splatAO(o.x, o.z, 4.5 * o.s, 0.45); }

  // write AO into road texture alpha
  for (let i = 0; i < N * N; i++) road[i * 4 + 3] = Math.floor(Math.min(1, ao[i]) * 255);

  // ---- lamps along the lake shore and the village road ----
  const lamps = [];
  for (let k = 0; k < 7; k++) {
    const th = 2.35 + k * 0.24;
    let s = 1.08, p;
    for (let n = 0; n < 12; n++) { p = lakePoint(th, s); if (heightAt(p[0], p[1]) > WATER_Y + 0.5) break; s += 0.03; }
    lamps.push({ x: p[0], z: p[1], y: heightAt(p[0], p[1]) });
  }
  for (const k of [18, 34, 50]) {
    const pl = roadPolylines[0]; const [x, z] = pl[pl.length - k] || pl[pl.length - 1];
    lamps.push({ x: x + 3, z, y: heightAt(x + 3, z) });
  }
  for (const l of lamps) obstacles.push({ x: l.x, z: l.z, r: 0.25 });

  // ---- wheat stalks ----
  const wheat = [];
  const WHEAT_MAX = 130000;
  tries = 0;
  while (wheat.length < WHEAT_MAX * 4 && tries++ < 2000000) {
    const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 175;
    const x = 25 + Math.cos(a) * rr, z = 5 + Math.sin(a) * rr;
    if (fieldAt(x, z) !== FIELD.WHEAT) continue;
    if (roadDistance(x, z) < 2.6 || lakeField(x, z) < 1.2) continue;
    wheat.push(x, heightAt(x, z), z, R());
  }

  // ---- wildflowers (poppies, irises, daisies) ----
  const flowers = [];
  const palette = [[0.86, 0.16, 0.1], [0.92, 0.25, 0.12], [0.98, 0.95, 0.85], [0.38, 0.35, 0.85], [0.98, 0.82, 0.2], [0.85, 0.45, 0.7]];
  tries = 0;
  while (flowers.length < 22000 * 7 && tries++ < 400000) {
    const x = (R() - 0.5) * 420, z = (R() - 0.5) * 420 - 40;
    const f = fieldAt(x, z), rd = roadDistance(x, z);
    const near = Math.hypot(x - START.x, z - START.z);
    const keep = (f === FIELD.MEADOW && R() < 0.8) || (f === FIELD.OLIVE && R() < 0.3) || (rd > 1.8 && rd < 4.5) || (f === FIELD.WHEAT && R() < 0.07);
    if (!keep || lakeField(x, z) < 1.1 || rd < 1.6 || Math.hypot(x, z) > 330) continue;
    const pick = f === FIELD.WHEAT ? (R() < 0.8 ? 0 : 3) : near < 60 && R() < 0.3 ? 3 : Math.floor(R() * palette.length);
    const c = palette[pick];
    flowers.push(x, heightAt(x, z) + 0.25 + R() * 0.35, z, c[0], c[1], c[2], 0.14 + R() * 0.12);
  }

  return { patch, road, houses, cypresses, olives, lamps, wheat: new Float32Array(wheat), flowers: new Float32Array(flowers), obstacles };
}
