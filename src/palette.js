import * as THREE from 'three';
import { NV, NS, NLAMPS } from './glsl.js';
import { mulberry32 } from './world.js';

const V3 = THREE.Vector3;

// Four moods, each a homage: The Starry Night, a rose dawn, Wheat Field with Cypresses, The Sower.
const MOODS = {
  night: {
    skyTop: '#22408e', skyMid: '#3463ac', skyHor: '#5f8fb8', swirlA: '#86c4d8', swirlB: '#eef3cf',
    sunCol: '#ffe070', starCore: '#fffbd0', starHalo: '#f2dc66', cloudCol: '#c8d8f0', cloudShade: '#5a78b0',
    lightCol: '#8aa8d8', ambSky: '#5874c0', ambGround: '#30447a', shadowTint: '#28287a', fog: '#2c4c8c',
    outline: '#081030', waterDeep: '#0c2050', lampCol: '#ffc04a', canvas: '#e9e1cc',
    cloudAmt: 0.0, lampAmt: 1.0, windowAmt: 1.0, sat: 1.12, contrast: 1.06, vignette: 0.32, bloom: 0.45,
  },
  dawn: {
    skyTop: '#4f62b4', skyMid: '#d9a3b0', skyHor: '#f6cf86', swirlA: '#f8d6b8', swirlB: '#fff4d8',
    sunCol: '#ffd36a', starCore: '#fff8d0', starHalo: '#f2dc8a', cloudCol: '#fbe8d8', cloudShade: '#a88ab8',
    lightCol: '#ffb08a', ambSky: '#8e86cc', ambGround: '#5e4c78', shadowTint: '#4a3a98', fog: '#c8a8b8',
    outline: '#2a1a50', waterDeep: '#3a4a8a', lampCol: '#ffc870', canvas: '#efe6d2',
    cloudAmt: 0.45, lampAmt: 0.35, windowAmt: 0.45, sat: 1.1, contrast: 1.04, vignette: 0.26, bloom: 0.7,
  },
  day: {
    skyTop: '#2963c0', skyMid: '#5b9ad8', skyHor: '#acd4e2', swirlA: '#e6f0f2', swirlB: '#ffffff',
    sunCol: '#fff3a8', starCore: '#ffffff', starHalo: '#ffffff', cloudCol: '#fbfaf0', cloudShade: '#9ab2d8',
    lightCol: '#fff0c4', ambSky: '#6c8ccc', ambGround: '#5a6a3a', shadowTint: '#3c4aa0', fog: '#9cbad8',
    outline: '#16264e', waterDeep: '#2f6ab0', lampCol: '#ffd080', canvas: '#f2ead6',
    cloudAmt: 1.0, lampAmt: 0.0, windowAmt: 0.0, sat: 1.1, contrast: 1.05, vignette: 0.22, bloom: 0.45,
  },
  gold: {
    skyTop: '#9fc464', skyMid: '#e2d64a', skyHor: '#f3bf3c', swirlA: '#faea7a', swirlB: '#fffacc',
    sunCol: '#ffe23c', starCore: '#fffbd0', starHalo: '#f2dc66', cloudCol: '#fff2b0', cloudShade: '#c8a050',
    lightCol: '#ffb45a', ambSky: '#9488da', ambGround: '#6a5a9a', shadowTint: '#4a3aa8', fog: '#c8b070',
    outline: '#2a1848', waterDeep: '#3a3a8a', lampCol: '#ffc050', canvas: '#efe4c8',
    cloudAmt: 0.35, lampAmt: 0.45, windowAmt: 0.55, sat: 1.14, contrast: 1.05, vignette: 0.28, bloom: 0.8,
  },
};
const COLOR_KEYS = Object.keys(MOODS.night).filter((k) => typeof MOODS.night[k] === 'string');
const NUM_KEYS = Object.keys(MOODS.night).filter((k) => typeof MOODS.night[k] === 'number');
const moodCols = {};
for (const [name, m] of Object.entries(MOODS)) { moodCols[name] = {}; for (const k of COLOR_KEYS) moodCols[name][k] = new THREE.Color(m[k]); }

const dirFromAzEl = (az, el) => { const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180; return new V3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize(); };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createUniforms(world) {
  const u = (v) => ({ value: v });
  const S = {
    uTime: u(0), uSwirlT: u(0), uDream: u(0), uNight: u(1), uDay: u(0),
    uLightDir: u(new V3(0, 1, 0)), uLightCol: u(new THREE.Color()), uAmbSky: u(new THREE.Color()), uAmbGround: u(new THREE.Color()),
    uShadowTint: u(new THREE.Color()), uFogCol: u(new THREE.Color()), uStrokeWorld: u(0.0092), uPlayer: u(new V3()), uWind: u(new THREE.Vector2(1, 0)),
    uLamps: u([]), uLampAmt: u(1), uLampCol: u(new THREE.Color()), uWindowAmt: u(1), uPxScale: u(500),
    // sky
    uVC: u([]), uVU: u([]), uVV: u([]), uVP: u([]), uStars: u([]),
    uSkyTop: u(new THREE.Color()), uSkyMid: u(new THREE.Color()), uSkyHor: u(new THREE.Color()), uSwirlA: u(new THREE.Color()), uSwirlB: u(new THREE.Color()),
    uSunCol: u(new THREE.Color()), uStarCore: u(new THREE.Color()), uStarHalo: u(new THREE.Color()), uCloudCol: u(new THREE.Color()), uCloudShade: u(new THREE.Color()),
    uSunDir: u(new V3()), uMoonDir: u(new V3()), uSunSize: u(0.08), uStarAmt: u(1), uCloudAmt: u(0), uMoonAmt: u(1), uSunAmt: u(0), uSkySeedF: u(100),
  };
  // vortices: azimuth (0 = north, toward the village), elevation, radius, spin, arms, speed
  const VORT = [
    [2, 30, 0.3, 2.4, 2, 1.0], [-30, 21, 0.16, 1.9, 1, 1.3], [32, 47, 0.2, 1.6, 2, 0.8],
    [95, 30, 0.32, -2.1, 2, -0.9], [180, 36, 0.38, 1.8, 3, 0.7], [-100, 26, 0.3, 2.0, 2, 1.1], [40, 80, 0.42, 1.2, 3, 0.5],
  ];
  for (let i = 0; i < NV; i++) {
    const [az, el, r, sp, arms, spd] = VORT[i];
    const c = dirFromAzEl(az, el);
    const U = new V3().crossVectors(new V3(0, 1, 0), c).normalize();
    const Vv = new V3().crossVectors(c, U).normalize();
    S.uVC.value.push(c); S.uVU.value.push(U); S.uVV.value.push(Vv); S.uVP.value.push(new THREE.Vector4(r, sp, arms, spd));
  }
  // great haloed stars: a cluster above the village, the rest scattered
  const rng = mulberry32(1889);
  // [azimuth, elevation, halo radius]: measured from the canvas of The Starry Night, which looks
  // north over the village just as the walk begins (the moon follows its own path, top right)
  const fixed = [[-28, 42, 0.067], [-19, 43, 0.039], [-11, 42, 0.05], [-6, 41, 0.039], [7, 39.5, 0.067], [-18.6, 33, 0.056],
    [14.5, 29, 0.067], [-12.5, 22.5, 0.045], [-32, 13.5, 0.034], [-26, 11.6, 0.05], [-10.4, 8.5, 0.095]];
  for (let i = 0; i < NS; i++) {
    const f = fixed[i] || [70 + (i - 11) * 50 + rng() * 25, 18 + rng() * 35, 0.04 + rng() * 0.02];
    const d = dirFromAzEl(f[0], f[1]);
    S.uStars.value.push(new THREE.Vector4(d.x, d.y, d.z, f[2]));
  }
  for (let i = 0; i < NLAMPS; i++) {
    const l = world.lamps[i];
    S.uLamps.value.push(l ? new V3(l.x, l.y + 2.65, l.z) : new V3(0, -9999, 0));
  }
  return S;
}

export class TimeOfDay {
  constructor(S) {
    this.S = S;
    this.t = 0.02; // just after midnight: The Starry Night
    this.grade = {};
    this.night = 1; this.day = 0;
  }
  advance(dt, mult) {
    const CYCLE = 840; // seconds for a full day
    const rate = (this.night > 0.5 ? 0.75 : 1.0) * mult;
    this.t = (this.t + (dt / CYCLE) * rate) % 1;
  }
  jump(t) { this.t = t; }
  update(time) {
    const S = this.S, t = this.t;
    const a = 2 * Math.PI * (t - 0.25);
    const sun = new V3(Math.cos(a), Math.sin(a) * 0.82, Math.sin(a) * 0.5).normalize();
    const mt = 2 * Math.PI * t;
    const moon = new V3(0.5 - 0.9 * Math.sin(mt), 0.5 * Math.cos(mt), -0.75).normalize();
    const e = sun.y;
    const night = ss(0.02, -0.2, e), day = ss(0.12, 0.42, e);
    const golden = Math.max(0, 1 - night - day);
    const dawnness = ss(-0.2, 0.2, sun.x);
    this.night = night; this.day = day;
    const w = { night, day, gold: golden * (1 - dawnness), dawn: golden * dawnness };
    const tmp = new THREE.Color();
    const blend = (key, out) => { out.setRGB(0, 0, 0); for (const m in w) { if (w[m] > 0) { tmp.copy(moodCols[m][key]).multiplyScalar(w[m]); out.add(tmp); } } return out; };
    const blendN = (key) => { let v = 0; for (const m in w) v += MOODS[m][key] * w[m]; return v; };
    const map = { skyTop: 'uSkyTop', skyMid: 'uSkyMid', skyHor: 'uSkyHor', swirlA: 'uSwirlA', swirlB: 'uSwirlB', sunCol: 'uSunCol', starCore: 'uStarCore', starHalo: 'uStarHalo', cloudCol: 'uCloudCol', cloudShade: 'uCloudShade', lightCol: 'uLightCol', ambSky: 'uAmbSky', ambGround: 'uAmbGround', shadowTint: 'uShadowTint', fog: 'uFogCol', lampCol: 'uLampCol' };
    for (const k in map) blend(k, S[map[k]].value);
    this.grade.outline = blend('outline', this.grade.outline || new THREE.Color());
    this.grade.waterDeep = blend('waterDeep', this.grade.waterDeep || new THREE.Color());
    this.grade.canvas = blend('canvas', this.grade.canvas || new THREE.Color());
    for (const k of ['sat', 'contrast', 'vignette', 'bloom']) this.grade[k] = blendN(k);

    S.uCloudAmt.value = blendN('cloudAmt');
    S.uLampAmt.value = blendN('lampAmt');
    S.uWindowAmt.value = blendN('windowAmt');
    S.uNight.value = night; S.uDay.value = day;
    S.uSunDir.value.copy(sun);
    S.uMoonDir.value.copy(moon);
    S.uSunAmt.value = ss(-0.12, 0.02, e);
    S.uSunSize.value = 0.07 + 0.085 * (1 - ss(0.0, 0.35, e));
    S.uStarAmt.value = ss(-0.02, -0.16, e);
    S.uMoonAmt.value = ss(0.0, 0.12, moon.y) * (1 - day * 0.85);
    // key light: sun by day, moon by night (kept low for long raking light)
    const ls = sun.clone(); ls.y = Math.max(ls.y, 0.1); ls.normalize();
    const lm = moon.clone(); lm.y = Math.min(Math.max(lm.y, 0.25), 0.5); lm.normalize();
    S.uLightDir.value.copy(lm.lerp(ls, ss(-0.1, 0.06, e))).normalize();
    // wind slowly turns and breathes
    const wa = 0.6 + Math.sin(time * 0.013) * 0.8, ws = 0.75 + 0.35 * Math.sin(time * 0.05) + 0.25 * day;
    S.uWind.value.set(Math.cos(wa) * ws, Math.sin(wa) * ws);
    return this.grade;
  }
}
