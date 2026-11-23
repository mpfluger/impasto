import * as THREE from 'three';
import { NOISE, UNIFORMS, FRAG, SKY } from './glsl.js';
import { heightAt, MAP_N, WATER_Y, LAKE, mulberry32, snoise2 } from './world.js';

const V3 = THREE.Vector3;

function makeMat(S, vs, fs, extra = {}, opts = {}, sky = false) {
  const pre = NOISE + UNIFORMS + `#define WATER_Y ${WATER_Y.toFixed(2)}\n`;
  return new THREE.ShaderMaterial({
    uniforms: { ...S, ...extra },
    vertexShader: pre + vs,
    fragmentShader: pre + FRAG + (sky ? SKY : '') + fs,
    ...opts,
  });
}

// ---------------------------------------------------------------- sky
function buildSky(S) {
  const geo = new THREE.SphereGeometry(1500, 64, 32);
  const mat = makeMat(S, /* glsl */ `
    varying vec3 vDir;
    void main(){
      vDir = position;
      vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_Position = p.xyww;
      gl_Position.z = p.w * 0.99999;
    }`, /* glsl */ `
    uniform float uSkySeedF;
    varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      vec3 tang, wd;
      // which stroke this is, and so the moment it was last painted: the sky is shaded as it was then
      strokeCellSky(d, uSkySeedF * 0.9);
      float tPaint = repaintStart(gS.z, repaintEpoch(gS.z, uSwirlT));
      vec3 col = skyShade(d, tang, wd, tPaint);
      vec3 wp = cameraPosition + d * 1000.0;
      vec3 T = tang - d * dot(tang, d);
      vec2 seeds = vec2(vnoise3(wd * uSkySeedF), vnoise3(wd * uSkySeedF + 31.7));
      seeds = clamp((seeds - 0.5) * 1.6 + 0.5, 0.0, 1.0);
      writeOut(col, 0.0, 0.0, screenDir(wp, T), seeds);
    }`, {}, { side: THREE.BackSide, depthWrite: false, depthTest: false }, true);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- terrain
function buildTerrain(S, world) {
  const SEG = 400, EXT = 760;
  const map = (u) => EXT * (0.28 * u + 0.72 * u * u * u); // dense near the middle, sparse at the mountains
  const pos = new Float32Array((SEG + 1) * (SEG + 1) * 3);
  let o = 0;
  for (let j = 0; j <= SEG; j++) {
    const z = map((j / SEG) * 2 - 1);
    for (let i = 0; i <= SEG; i++) {
      const x = map((i / SEG) * 2 - 1);
      pos[o++] = x; pos[o++] = heightAt(x, z); pos[o++] = z;
    }
  }
  const idx = new Uint32Array(SEG * SEG * 6);
  o = 0;
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const tPatch = new THREE.DataTexture(world.patch, MAP_N, MAP_N, THREE.RGBAFormat);
  tPatch.magFilter = tPatch.minFilter = THREE.NearestFilter; tPatch.needsUpdate = true;
  const tRoad = new THREE.DataTexture(world.road, MAP_N, MAP_N, THREE.RGBAFormat);
  tRoad.magFilter = tRoad.minFilter = THREE.LinearFilter; tRoad.needsUpdate = true;

  const mat = makeMat(S, /* glsl */ `
    varying vec3 vW; varying vec3 vN; varying vec3 vRest;
    void main(){
      vec3 p = position;
      vRest = position;
      float dc = length(p.xz - cameraPosition.xz);
      // In a dream the ring of mountains beyond the walkable land rises and sinks in slow swells that
      // roll in toward you: whole ranges grow by half their height and settle again.
      float ring = smoothstep(400.0, 650.0, length(p.xz));
      float ang = atan(p.z, p.x);
      // swells roll in toward you: crests travel inward from the horizon, gently uneven around it
      float swell = sin(dc * 0.01 + uTime * 0.32 + 0.6 * sin(ang * 2.0)) * (0.75 + 0.25 * sin(ang * 3.0 + 1.3));
      p.y += uDream * ring * swell * (max(p.y, 0.0) * 0.3 + 8.0);
      vW = p; vN = normal;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`, /* glsl */ `
    uniform sampler2D tPatch; uniform sampler2D tRoad;
    varying vec3 vW; varying vec3 vN; varying vec3 vRest;
    void main(){
      vec3 n = normalize(vN);
      float dist = length(cameraPosition - vW);
      vec2 seeds = strokeSeeds(vRest, dist);
      strokeCellMoved(vRest, vW, dist);
      float sx = seeds.x, sy = seeds.y;
      vec2 muv = (vW.xz + 512.0) / 1024.0;
      vec2 jit = vec2(snoise(vec3(vW.xz * 0.11, 1.0)), snoise(vec3(vW.xz * 0.11, 7.0))) * 1.4 / 1024.0;
      vec4 P = texture(tPatch, muv + jit);
      vec4 R = texture(tRoad, muv);
      float type = floor(P.r * 255.0 / 32.0 + 0.5);
      float ang = P.g * 3.14159; float prnd = P.b;
      vec3 fdir = vec3(cos(ang), 0.0, sin(ang));
      vec2 perp = vec2(-fdir.z, fdir.x);
      float stripe = sin(dot(vW.xz, perp) * 2.3 + prnd * 20.0 + snoise(vec3(vW.xz * 0.05, 4.0)) * 2.0);
      float st = smoothstep(-0.3, 0.3, stripe);
      vec3 contour = cross(n, vec3(0.0, 1.0, 0.0)); float sl = length(contour);
      vec2 cn = vec2(snoise(vec3(vW.xz * 0.016, 3.0)), snoise(vec3(vW.xz * 0.016, 9.0)));
      vec3 curl = normalize(vec3(cn.x, 0.0, cn.y) + vec3(1e-3, 0.0, 0.0));
      vec3 meadowT = sl > 0.03 ? normalize(mix(curl, contour / sl, smoothstep(0.08, 0.35, sl))) : curl;
      vec3 T = meadowT;
      vec3 base;
      float wheatGround = 0.0;
      if (type < 0.5) {            // meadow
        base = mix(vec3(0.22, 0.45, 0.22), vec3(0.5, 0.68, 0.27), sx);
        base = mix(base, vec3(0.7, 0.74, 0.34), smoothstep(0.72, 0.97, sy) * 0.7);
        base = mix(base, vec3(0.14, 0.34, 0.32), smoothstep(0.3, 0.05, sy) * 0.6);
      } else if (type < 1.5) {     // wheat
        base = mix(vec3(0.72, 0.5, 0.13), vec3(0.92, 0.76, 0.27), sx);
        base = mix(base, vec3(0.5, 0.58, 0.2), smoothstep(0.25, 0.04, sy) * 0.5);
        base = mix(base, vec3(0.9, 0.45, 0.12), smoothstep(0.85, 1.0, sy) * 0.5);
        T = wheatWindT(vW.xz);
        // the ground under the wheat shares the wheat's strokes, so the field is one painted surface
        strokeCellCanopy(vW, vW.y);
        wheatGround = 1.0;
      } else if (type < 2.5) {     // ploughed earth, furrows converging in perspective
        base = mix(vec3(0.4, 0.25, 0.2), vec3(0.7, 0.46, 0.22), st);
        base = mix(base, vec3(0.36, 0.28, 0.56), (1.0 - st) * smoothstep(0.5, 0.1, sy) * 0.85);
        base = mix(base, vec3(0.9, 0.58, 0.26), smoothstep(0.8, 1.0, sx) * 0.6);
        T = fdir;
      } else if (type < 3.5) {     // lavender rows
        base = mix(vec3(0.26, 0.46, 0.26), vec3(0.5, 0.42, 0.8), st);
        base = mix(base, vec3(0.72, 0.56, 0.88), smoothstep(0.72, 1.0, sx) * st * 0.7);
        T = fdir;
      } else if (type < 4.5) {     // young crops
        base = mix(vec3(0.8, 0.68, 0.35), vec3(0.34, 0.6, 0.24), st);
        base = mix(base, vec3(0.55, 0.76, 0.3), sx * 0.4);
        T = fdir;
      } else {                     // olive grove ground
        base = mix(vec3(0.5, 0.58, 0.32), vec3(0.74, 0.65, 0.4), sx);
        base = mix(base, vec3(0.42, 0.48, 0.58), smoothstep(0.3, 0.05, sy) * 0.6);
      }
      // roads: pale ochre, strokes run along the road
      float rm = R.r;
      vec3 rdir = normalize(vec3(R.g * 2.0 - 1.0, 0.0, R.b * 2.0 - 1.0) + vec3(1e-4, 0.0, 0.0));
      base = mix(base, mix(vec3(0.88, 0.76, 0.52), vec3(0.78, 0.56, 0.32), sx), rm);
      T = normalize(mix(T, rdir, rm));
      // shore
      float shore = smoothstep(1.0, 0.0, vW.y - WATER_Y);
      base = mix(base, mix(vec3(0.8, 0.72, 0.5), vec3(0.3, 0.56, 0.52), sy), shore * 0.85);
      // the Alpilles
      float rC = length(vW.xz);
      float mt = smoothstep(290.0, 420.0, rC) * smoothstep(5.0, 22.0, vW.y + snoise(vec3(vW.xz * 0.01, 2.0)) * 6.0);
      float ridge = snoise(vec3(vW.xz * 0.03, vW.y * 0.05));
      // the hills in the painting's blues: mid blue with lighter and deeper strokes
      vec3 mcol = mix(vec3(0.2, 0.27, 0.58), vec3(0.4, 0.5, 0.8), sx);
      mcol = mix(mcol, vec3(0.13, 0.19, 0.44), smoothstep(0.0, -0.5, ridge) * 0.6);
      mcol = mix(mcol, vec3(0.55, 0.64, 0.88), smoothstep(0.5, 0.9, ridge) * smoothstep(0.6, 0.9, sy) * 0.5);
      base = mix(base, mcol, mt);
      T = normalize(mix(T, sl > 0.03 ? contour / sl : T, mt));
      T = normalize(T - n * dot(T, n) + vec3(1e-5));
      float ao = 1.0 - R.a * 0.62;
      vec3 col = shadeLit(base, n, ao);
      col += lampLight(vW, base);
      col = nightShift(col);
      col = applyFog(col, dist);
      writeOut(col, 1.0, 1.0 - wheatGround, screenDir(vW, T), seeds); // no contour lines inside the wheat
    }`, { tPatch: { value: tPatch }, tRoad: { value: tRoad } });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- wheat
function buildWheat(S, world) {
  const SEGS = 5;
  const pos = [], index = [];
  for (let k = 0; k <= SEGS; k++) { const h = k / SEGS; pos.push(-0.5, h, 0, 0.5, h, 0); }
  for (let k = 0; k < SEGS; k++) { const a = k * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  const count = world.wheat.length / 4;
  const mat = makeMat(S, /* glsl */ `
    varying vec3 vW; varying float vH; varying float vRnd; varying vec3 vT; varying vec3 vNrm;
    varying float vRootY;
    void main(){
      vec3 root = instanceMatrix[3].xyz;
      float rnd = hash12(root.xz * 3.1);
      float h = position.y;
      // beyond a few dozen metres single blades can't be told apart; there the field is the painted
      // wheat surface of the ground itself, which takes broad strokes cleanly. Blades shrink away.
      float H = (0.85 + rnd * 0.6) * (1.0 - smoothstep(24.0, 42.0, length(root - cameraPosition)));
      float w = mix(0.024, 0.011, h);
      w = mix(w, 0.036, smoothstep(0.6, 0.76, h)) * (1.0 - smoothstep(0.88, 1.0, h) * 0.85);
      vec3 side = normalize(vec3(instanceMatrix[0].x, 0.0, instanceMatrix[0].z));
      // wind rolls over the field in broad, slow waves; each blade only adds a faint lazy sway of its own
      float gust = snoise(vec3(root.xz * 0.035 - uWind * uTime * 0.4, uTime * 0.05));
      vec2 bend = uWind * (0.22 + 0.45 * (gust * 0.5 + 0.5)) * (1.0 + uDream * 0.7)
                + vec2(sin(uTime * 0.55 + rnd * 6.0), cos(uTime * 0.47 + rnd * 5.0)) * 0.018;
      vec2 away = root.xz - uPlayer.xz; float dp = length(away);
      bend += away / max(dp, 0.01) * smoothstep(1.7, 0.3, dp) * 1.3;
      vec3 p = root + side * position.x * w * 2.0 + vec3(0.0, h * H, 0.0);
      p.xz += bend * h * h * H;
      p.y -= dot(bend, bend) * h * h * H * 0.35;
      vT = normalize(vec3(bend.x * 2.0 * h * H, H, bend.y * 2.0 * h * H));
      vNrm = normalize(cross(side, vT));
      vW = p; vH = h; vRnd = rnd;
      vRootY = root.y;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`, /* glsl */ `
    varying vec3 vW; varying float vH; varying float vRnd; varying vec3 vT; varying vec3 vNrm;
    varying float vRootY;
    void main(){
      float dist = length(cameraPosition - vW);
      vec3 rootC = mix(vec3(0.42, 0.42, 0.13), vec3(0.62, 0.44, 0.12), vRnd);
      vec3 midC = mix(vec3(0.88, 0.64, 0.17), vec3(0.96, 0.8, 0.3), fract(vRnd * 7.3));
      vec3 earC = mix(vec3(0.99, 0.87, 0.42), vec3(0.93, 0.56, 0.15), fract(vRnd * 13.1));
      vec3 base = mix(rootC, midC, smoothstep(0.0, 0.5, vH));
      base = mix(base, earC, smoothstep(0.6, 0.8, vH));
      if (fract(vRnd * 31.7) < 0.08) base = mix(base, vec3(0.38, 0.6, 0.22), 0.6);
      vec3 n = normalize(vNrm); if (!gl_FrontFacing) n = -n;
      n = normalize(n + vec3(0.0, 0.7, 0.0));
      vec3 col = shadeLit(base * (1.0 + uNight * 0.45), n, mix(0.7, 1.0, vH));
      // light glowing through the ears when the sun is behind them
      vec3 V = normalize(vW - cameraPosition);
      float through = pow(max(dot(V, uLightDir), 0.0), 3.0) * smoothstep(0.3, 0.9, vH);
      col += base * uLightCol * through * (1.0 - uNight) * 0.9;
      col += lampLight(vW, base);
      col = mix(nightShift(col), col, 0.4);
      col = applyFog(col, dist);
      vec2 seeds = vec2(fract(vRnd * 91.3 + vH * 0.3), fract(vRnd * 47.9 + vH * 0.5));
      // the wheat is painted on its canopy, shared with the ground between the blades (see glsl.js)
      strokeCellCanopy(vW, vRootY);
      writeOut(col, 2.0, 0.0, screenDir(vW, wheatWindT(vW.xz)), seeds);
    }`, {}, { side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new V3(1, 1, 1), up = new V3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    q.setFromAxisAngle(up, world.wheat[i * 4 + 3] * Math.PI * 2);
    m.compose(new V3(world.wheat[i * 4], world.wheat[i * 4 + 1] - 0.05, world.wheat[i * 4 + 2]), q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- cypresses
// Vincent's cypress is not a column but a cluster of flame tongues: a tall central flame with shorter
// ones round it, each tapering to a point and curving upward, the lower ones leaning out, so the
// silhouette is ragged with many tips. Where tongues overlap, the outline pass draws umber lines.
function cypressGeometry(seed) {
  const R = mulberry32(seed);
  const pos = [], nor = [], tan = [], info = [], idx = [];
  const NT = 9, RINGS = 28, SEG = 10;
  let base = 0;
  for (let k = 0; k < NT; k++) {
    const main = k === 0;
    const H = main ? 1.0 : 0.45 + R() * 0.45;
    const y0 = main ? 0.0 : R() * 0.1;
    const ang = (k / NT) * Math.PI * 2 + R() * 0.8;
    const off = main ? 0.0 : 0.22 + R() * 0.28;
    const lean = main ? 0.06 : 0.14 + R() * 0.2 * (1.2 - H);       // lower tongues lean further out
    const rad = main ? 0.5 : 0.28 + R() * 0.16;
    const ph = R() * 6.28, wig = main ? 0.12 : 0.1 + R() * 0.12;
    // swoosh: the tongue twists round the trunk as it rises, swings in an S, and its tip hooks over
    const twist = (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.7);
    const hookA = ang + (R() < 0.5 ? -1.6 : 1.6), hook = 0.12 + R() * 0.16;
    const spine = (t) => {
      const at = ang + twist * t, rr = off + lean * t * t;
      const hk = hook * Math.pow(Math.max(0, t - 0.6) / 0.4, 2);
      return [
        Math.cos(at) * rr + Math.sin(t * 4.2 + ph) * wig * t + Math.cos(hookA) * hk,
        y0 + (H - y0) * t,
        Math.sin(at) * rr + Math.cos(t * 3.6 + ph) * wig * t + Math.sin(hookA) * hk,
      ];
    };
    const tr = R();
    for (let j = 0; j <= RINGS; j++) {
      const t = j / RINGS;
      const c = spine(t), c2 = spine(Math.min(1, t + 0.02)), c1 = spine(Math.max(0, t - 0.02));
      let tx = c2[0] - c1[0], ty = c2[1] - c1[1], tz = c2[2] - c1[2];
      const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      // a rounded foot, a full body and a sharp tip
      const r = rad * Math.pow(1 - t, 0.8) * Math.min(1, (t + 0.06) / 0.22);
      for (let s = 0; s <= SEG; s++) {
        const a = (s / SEG) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        pos.push(c[0] + ca * r, c[1], c[2] + sa * r);
        const ny = rad / Math.max(0.2, H - y0) * 0.8;
        const nl = Math.hypot(ca, ny, sa);
        nor.push(ca / nl, ny / nl, sa / nl);
        tan.push(tx, ty, tz);
        info.push(tr, t, k === 0 ? 1 : 0);
      }
    }
    for (let j = 0; j < RINGS; j++) for (let s = 0; s < SEG; s++) {
      const a = base + j * (SEG + 1) + s, b = a + SEG + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    base += (RINGS + 1) * (SEG + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
  geo.setIndex(idx);
  return geo;
}

function buildCypresses(S, world) {
  const mat = makeMat(S, /* glsl */ `
    attribute vec3 aTan; attribute vec3 aInfo;
    varying vec3 vW; varying vec3 vN; varying vec3 vT; varying float vH; varying float vRnd; varying vec3 vInfo; varying vec3 vRest;
    void main(){
      vec3 ip = instanceMatrix[3].xyz;
      float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
      float rnd = hash12(ip.xz);
      // each tree turned its own way, so no two cypresses show the same flames
      float ra = rnd * 6.2831, c = cos(ra), s = sin(ra);
      vec3 p = position; p.xz = vec2(c * p.x - s * p.z, s * p.x + c * p.z);
      vec3 nl = normal; nl.xz = vec2(c * nl.x - s * nl.z, s * nl.x + c * nl.z);
      vec3 tl = aTan; tl.xz = vec2(c * tl.x - s * tl.z, s * tl.x + c * tl.z);
      float h = p.y;
      vec3 w = ip + vec3(p.x * sx, p.y * sy, p.z * sx);
      vRest = w;
      float sway = sin(uTime * 0.6 + rnd * 6.0) * 0.4 + snoise(vec3(ip.xz * 0.02, uTime * 0.15));
      w.xz += (uWind * (sway * 0.5 + 0.4)) * h * h * sy * 0.025 * (1.0 + uDream * 1.3);
      vW = w; vN = normalize(vec3(nl.x / sx, nl.y / sy, nl.z / sx)); vT = normalize(vec3(tl.x * sx, tl.y * sy, tl.z * sx));
      vH = h; vRnd = rnd; vInfo = aInfo;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }`, /* glsl */ `
    varying vec3 vW; varying vec3 vN; varying vec3 vT; varying float vH; varying float vRnd; varying vec3 vInfo; varying vec3 vRest;
    void main(){
      vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
      float dist = length(cameraPosition - vW);
      vec2 seeds = strokeSeeds(vRest, dist);
      strokeCellMoved(vRest, vW, dist);
      vec3 V = normalize(cameraPosition - vW);
      // deep green flames, lighter and blue-green where they turn to the light, umber at their edges
      vec3 dark = vec3(0.06, 0.18, 0.11), mid = vec3(0.12, 0.33, 0.18), hi = vec3(0.27, 0.48, 0.25);
      vec3 blueGreen = vec3(0.1, 0.3, 0.32), umber = vec3(0.44, 0.23, 0.09);
      vec3 base = mix(dark, mid, 0.35 + 0.65 * seeds.x * (0.6 + 0.4 * vInfo.x));
      base = mix(base, hi, smoothstep(0.62, 0.95, seeds.x) * smoothstep(-0.2, 0.6, dot(n, uLightDir)) * 0.8);
      base = mix(base, blueGreen, smoothstep(0.3, 0.05, seeds.y) * 0.45);
      float rim = 1.0 - abs(dot(n, V));
      float edgeLine = smoothstep(0.6, 0.9, rim) * (0.75 + 0.25 * vInfo.x);
      base = mix(base, umber, edgeLine * 0.85);
      vec3 col = shadeLit(base * 1.35, n, mix(0.6, 1.0, smoothstep(0.0, 0.3, vH)));
      col += lampLight(vW, base) * 0.6;
      col = mix(col, nightShift(col), 0.5);                 // keep its greens and browns at night
      col = mix(col, base * 1.15, edgeLine * 0.45);
      col = applyFog(col, dist);
      // strokes run up each tongue along its own spine
      writeOut(col, 3.0, 1.0, screenDir(vW, vT), seeds);
    }`, {}, { side: THREE.DoubleSide });
  const list = world.cypresses;
  const group = new THREE.Group();
  for (let v = 0; v < 3; v++) {
    const sub = list.filter((_, i) => i % 3 === v);
    if (!sub.length) continue;
    const mesh = new THREE.InstancedMesh(cypressGeometry(500 + v * 77), mat, sub.length);
    const m = new THREE.Matrix4();
    // the cluster is wider than the old single column; scale it to keep the trees' footprint
    sub.forEach((c, i) => { m.makeScale(c.r * 1.25, c.h, c.r * 1.25); m.setPosition(c.x, c.y, c.z); mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------- olive trees
function mergeParts(parts) {
  for (const p of parts) { if (p.geo.index) p.geo = p.geo.toNonIndexed(); if (!p.geo.attributes.normal) p.geo.computeVertexNormals(); }
  let n = 0; for (const p of parts) n += p.geo.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), part = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    const g = p.geo;
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    part.fill(p.part, o, o + g.attributes.position.count);
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return geo;
}
function oliveGeometry(seed) {
  const r = mulberry32(seed);
  const parts = [];
  const pts = [new V3(0, -0.6, 0)];
  let x = 0, z = 0;
  for (let i = 1; i <= 4; i++) { x += (r() - 0.5) * 0.8; z += (r() - 0.5) * 0.8; pts.push(new V3(x, i * 0.62 - 0.4, z)); }
  parts.push({ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.3, 7, false), part: 0 });
  const top = pts[pts.length - 1];
  for (let b = 0; b < 3; b++) {
    const a = r() * Math.PI * 2;
    const bp = [top.clone().add(new V3(0, -0.3, 0)), top.clone().add(new V3(Math.cos(a) * 0.9, 0.5, Math.sin(a) * 0.9)), top.clone().add(new V3(Math.cos(a) * 1.6, 1.0 + r() * 0.4, Math.sin(a) * 1.6))];
    parts.push({ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bp), 8, 0.14, 5, false), part: 0 });
  }
  const crown = top.clone().add(new V3(0, 1.4, 0));
  for (let k = 0; k < 7; k++) {
    const rad = 0.9 + r() * 0.8;
    const g = new THREE.IcosahedronGeometry(rad, 2);
    const p = g.attributes.position;
    const off = new V3((r() - 0.5) * 3.2, (r() - 0.3) * 1.3, (r() - 0.5) * 3.2);
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const d = 1 + 0.25 * snoise2(vx * 1.3 + seed, vz * 1.3 + vy) ;
      p.setXYZ(i, vx * d + crown.x + off.x, vy * d * 0.75 + crown.y + off.y, vz * d + crown.z + off.z);
    }
    g.computeVertexNormals();
    parts.push({ geo: g, part: 1 });
  }
  return mergeParts(parts);
}
function buildOlives(S, world) {
  const mat = makeMat(S, /* glsl */ `
    attribute float aPart;
    varying vec3 vW; varying vec3 vN; varying float vPart; varying vec3 vRest;
    void main(){
      vec4 w = instanceMatrix * vec4(position, 1.0);
      vRest = w.xyz;
      vec3 ip = instanceMatrix[3].xyz;
      float sway = snoise(vec3(ip.xz * 0.05, uTime * 0.2));
      w.xz += uWind * (0.15 + 0.25 * sway) * aPart * max(position.y - 1.2, 0.0) * 0.3 * (1.0 + uDream * 0.9);
      vW = w.xyz; vN = normalize(mat3(instanceMatrix) * normal); vPart = aPart;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`, /* glsl */ `
    varying vec3 vW; varying vec3 vN; varying float vPart; varying vec3 vRest;
    void main(){
      vec3 n = normalize(vN); float dist = length(cameraPosition - vW);
      vec2 seeds = strokeSeeds(vRest, dist);
      strokeCellMoved(vRest, vW, dist);
      vec3 base; vec3 T; float id;
      if (vPart < 0.5){
        base = mix(vec3(0.34, 0.24, 0.2), vec3(0.6, 0.46, 0.3), seeds.x);
        base = mix(base, vec3(0.24, 0.3, 0.52), smoothstep(0.32, 0.05, seeds.y) * 0.6);
        T = vec3(0.0, 1.0, 0.0); id = 5.0;
      } else {
        base = mix(vec3(0.3, 0.46, 0.36), vec3(0.6, 0.68, 0.48), seeds.x);
        base = mix(base, vec3(0.8, 0.82, 0.62), smoothstep(0.74, 0.98, seeds.y) * 0.7);
        base = mix(base, vec3(0.3, 0.42, 0.62), smoothstep(0.32, 0.05, seeds.y) * 0.55);
        // foliage painted in curls, like the rounded blue-green trees round the painting's village:
        // strokes wind round small centres scattered over the crown, each curl with a pale rim
        base = mix(base, vec3(0.2, 0.42, 0.46), 0.35);
        vec4 cc = nearestCentre(vW / 1.1);
        vec3 rv = vW - cc.xyz * 1.1; rv -= n * dot(rv, n);
        float rr = length(rv) / 1.1;
        T = normalize(cross(n, rv) + vec3(1e-4));
        base = mix(base * 0.78, base * 1.2 + vec3(0.06, 0.07, 0.05), smoothstep(0.18, 0.5, rr));
        id = 4.0;
      }
      vec3 col = shadeLit(base, n, 1.0) + lampLight(vW, base) * 0.5;
      col = nightShift(col); col = applyFog(col, dist);
      writeOut(col, id, 1.0, screenDir(vW, T), seeds);
    }`);
  const group = new THREE.Group();
  for (let v = 0; v < 3; v++) {
    const list = world.olives.filter((o) => o.v === v);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(oliveGeometry(100 + v * 31), mat, list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    list.forEach((o, i) => { q.setFromAxisAngle(new V3(0, 1, 0), o.rot); m.compose(new V3(o.x, o.y, o.z), q, new V3(o.s, o.s, o.s)); mesh.setMatrixAt(i, m); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------- village
function buildVillage(S, world) {
  const P = [], N = [], UV = [], INFO = [], TAN = [];
  const tri = (a, b, c, uva, uvb, uvc, info, tan) => {
    const e1 = new V3().subVectors(b, a), e2 = new V3().subVectors(c, a);
    const n = new V3().crossVectors(e1, e2).normalize();
    for (const [p, uv] of [[a, uva], [b, uvb], [c, uvc]]) { P.push(p.x, p.y, p.z); N.push(n.x, n.y, n.z); UV.push(uv[0], uv[1]); INFO.push(...info); TAN.push(tan.x, tan.y, tan.z); }
  };
  const quad = (a, b, c, d, uva, uvb, uvc, uvd, info, tan) => { tri(a, b, c, uva, uvb, uvc, info, tan); tri(a, c, d, uva, uvc, uvd, info, tan); };

  const box = (xf, w, d, h, seed, part, ground = -2.5) => {
    const hw = w / 2, hd = d / 2;
    const c = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = c[k], [bx, bz] = c[(k + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const A = xf(ax, ground, az), B = xf(bx, ground, bz), C = xf(bx, h, bz), D = xf(ax, h, az);
      const tan = new V3().subVectors(B, A).normalize();
      // wind so the outward face is front-facing
      quad(A, D, C, B, [0, ground], [0, h], [len, h], [len, ground], [seed, h, len, part], tan);
    }
  };
  const gableRoof = (xf, w, d, h, rh, seed, wallPart) => {
    const hw = w / 2 + 0.45, hd = d / 2 + 0.45;
    const ridgeA = xf(-hw, h + rh, 0), ridgeB = xf(hw, h + rh, 0);
    const eA1 = xf(-hw, h - 0.2, hd), eB1 = xf(hw, h - 0.2, hd), eA2 = xf(-hw, h - 0.2, -hd), eB2 = xf(hw, h - 0.2, -hd);
    const s1 = new V3().subVectors(eA1, ridgeA).normalize(), s2 = new V3().subVectors(eA2, ridgeA).normalize();
    const L = Math.hypot(hd, rh + 0.2);
    quad(ridgeA, eA1, eB1, ridgeB, [0, 0], [0, L], [w, L], [w, 0], [seed, h, w, 1], s1);
    quad(ridgeB, eB2, eA2, ridgeA, [0, 0], [0, L], [w, L], [w, 0], [seed, h, w, 1], s2);
    // gable ends (wall)
    const g1 = [xf(-w / 2, h, -d / 2), xf(-w / 2, h, d / 2), xf(-w / 2, h + rh, 0)];
    const g2 = [xf(w / 2, h, d / 2), xf(w / 2, h, -d / 2), xf(w / 2, h + rh, 0)];
    tri(g1[0], g1[1], g1[2], [0, h], [d, h], [d / 2, h + rh], [seed, h, d, wallPart], new V3(0, 1, 0));
    tri(g2[0], g2[1], g2[2], [0, h], [d, h], [d / 2, h + rh], [seed, h, d, wallPart], new V3(0, 1, 0));
  };
  const pyramid = (xf, w, h, rh, seed) => {
    const hw = w / 2 + 0.2;
    const apex = xf(0, h + rh, 0);
    const c = [xf(-hw, h, -hw), xf(hw, h, -hw), xf(hw, h, hw), xf(-hw, h, hw)];
    for (let k = 0; k < 4; k++) {
      const a = c[k], b = c[(k + 1) % 4];
      const mid = new V3().addVectors(a, b).multiplyScalar(0.5);
      tri(apex, b, a, [0, 0], [w, rh], [0, rh], [seed, h, w, 3], new V3().subVectors(mid, apex).normalize());
    }
  };

  for (const hs of world.houses) {
    const c = Math.cos(hs.rot), s = Math.sin(hs.rot);
    const mk = (ox, oz) => (x, y, z) => new V3(hs.x + (x + ox) * c - (z + oz) * s, hs.y + y, hs.z + (x + ox) * s + (z + oz) * c);
    if (hs.church) {
      const xf = mk(0, 0);
      box(xf, hs.w, hs.d, hs.h, 0.62, 2);
      gableRoof((x, y, z) => xf(-z, y, x), hs.d, hs.w, hs.h, 3.6, 0.62, 2);
      const tf = mk(0, hs.d / 2 + 2.2);
      box(tf, 4.4, 4.4, hs.h + 9, 0.62, 2);
      pyramid(tf, 4.4, hs.h + 9, 10, 0.62);
    } else {
      const xf = mk(0, 0);
      box(xf, hs.w, hs.d, hs.h, hs.seed, 0);
      gableRoof(xf, hs.w, hs.d, hs.h, hs.d * (0.3 + hs.seed * 0.12), hs.seed, 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('aUV', new THREE.Float32BufferAttribute(UV, 2));
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(INFO, 4));
  geo.setAttribute('aTan', new THREE.Float32BufferAttribute(TAN, 3));

  const mat = makeMat(S, /* glsl */ `
    attribute vec2 aUV; attribute vec4 aInfo; attribute vec3 aTan;
    varying vec2 vUV; varying vec4 vInfo; varying vec3 vTan; varying vec3 vW; varying vec3 vN;
    void main(){
      vUV = aUV; vInfo = aInfo; vTan = aTan; vW = position; vN = normal;
      gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    }`, /* glsl */ `
    varying vec2 vUV; varying vec4 vInfo; varying vec3 vTan; varying vec3 vW; varying vec3 vN;
    void main(){
      vec3 n = normalize(vN); float dist = length(cameraPosition - vW);
      vec2 seeds = strokeSeeds(vW, dist);
      float seed = vInfo.x; float part = vInfo.w;
      float k = floor(seed * 4.0);
      vec3 wall = k < 1.0 ? vec3(0.93, 0.84, 0.6) : k < 2.0 ? vec3(0.66, 0.77, 0.88) : k < 3.0 ? vec3(0.9, 0.7, 0.4) : vec3(0.95, 0.91, 0.82);
      float k2 = floor(fract(seed * 7.13) * 4.0);
      vec3 roof = k2 < 1.0 ? vec3(0.8, 0.36, 0.2) : k2 < 2.0 ? vec3(0.88, 0.52, 0.22) : k2 < 3.0 ? vec3(0.34, 0.42, 0.64) : vec3(0.28, 0.54, 0.46);
      vec3 base; vec3 T = vTan; float id = 6.0; float glow = 0.0;
      if (part > 0.5 && part < 1.5 || part > 2.5){
        base = part > 2.5 ? vec3(0.22, 0.26, 0.42) : roof;
        id = 7.0;
        base = mix(base, base * 0.6 + vec3(0.08, 0.08, 0.26), smoothstep(0.32, 0.05, seeds.y) * 0.55);
        base *= 0.88 + 0.24 * seeds.x;
      } else {
        if (part > 1.5) wall = vec3(0.6, 0.66, 0.8);
        base = wall * (0.9 + 0.16 * seeds.x);
        base = mix(base, vec3(0.55, 0.65, 0.9), smoothstep(0.22, 0.02, seeds.y) * 0.22);
        base = mix(base, vec3(1.0, 0.86, 0.55), smoothstep(0.85, 1.0, seeds.y) * 0.2);
        if (fract(seed * 3.7) < 0.5) T = vec3(0.0, 1.0, 0.0);
        vec2 uv = vUV; float H = vInfo.y; float L = vInfo.z;
        vec2 g = vec2((uv.x - 0.7) / 2.3, (uv.y - 0.9) / 2.4);
        vec2 cell = floor(g); vec2 f = fract(g);
        float inside = step(0.0, g.x) * step(uv.x, L - 0.9) * step(0.0, g.y) * step(uv.y, H - 0.6);
        float win = inside * step(0.27, f.x) * step(f.x, 0.6) * step(0.1, f.y) * step(f.y, 0.56);
        float shutter = inside * (step(0.1, f.x) * step(f.x, 0.25) + step(0.62, f.x) * step(f.x, 0.77)) * step(0.1, f.y) * step(f.y, 0.56);
        float lit = step(0.32, hash12(cell + seed * 91.0)) * (part > 1.5 ? 0.0 : 1.0);
        vec3 shutCol = fract(seed * 5.3) < 0.5 ? vec3(0.22, 0.5, 0.44) : vec3(0.28, 0.44, 0.78);
        base = mix(base, shutCol, shutter * 0.85);
        base = mix(base, vec3(0.1, 0.14, 0.3), win);
        glow = win * lit * uWindowAmt;
      }
      T = normalize(T + vec3(1e-5));
      vec3 col = shadeLit(base, n, 1.0) + lampLight(vW, base);
      col = nightShift(col);
      col = mix(col, vec3(1.0, 0.8, 0.28) * 1.7, glow);
      col = applyFog(col, dist);
      writeOut(col, id, 1.0, screenDir(vW, T), seeds);
    }`);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- lake
function buildWater(S) {
  const geo = new THREE.PlaneGeometry(LAKE.rx * 2.8, LAKE.rz * 2.8, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(LAKE.rot);
  geo.translate(LAKE.x, WATER_Y, LAKE.z);
  const mat = makeMat(S, /* glsl */ `
    varying vec3 vW;
    void main(){ vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`, /* glsl */ `
    uniform vec3 uWaterDeep;
    varying vec3 vW;
    float column(vec3 V, vec3 dm, float r1, float width){
      vec2 a = normalize(V.xz + 1e-5), b = normalize(dm.xz + 1e-5);
      float dh = 1.0 - dot(a, b) + r1 * 0.00003;
      float dv = V.y - dm.y;
      return exp(-abs(dh) / width) * exp(-dv * dv / (dv < 0.0 ? 0.012 : 0.0008));
    }
    void main(){
      vec3 toF = vW - cameraPosition; float dist = length(toF); vec3 V = toF / dist;
      vec2 rp = vW.xz;
      float r1 = snoise(vec3(rp * vec2(0.08, 0.35), uTime * 0.25));
      float r2 = snoise(vec3(rp * vec2(0.25, 0.9), uTime * 0.4 + 5.0));
      vec3 n = normalize(vec3(r1 * 0.05 + r2 * 0.02, 1.0, r1 * 0.12 + r2 * 0.08));
      vec3 r = reflect(V, n); r.y = abs(r.y) * 2.2 + 0.1; r = normalize(r); // painted reflections lean upward into the swirls
      vec3 tang, wd; vec3 sky = skyShade(r, tang, wd, uSwirlT);
      float fres = 0.6 + 0.4 * pow(1.0 - max(-V.y, 0.0), 3.0);
      vec3 col = mix(uWaterDeep, sky * 1.05, fres);
      col = mix(col, col * vec3(0.8, 1.05, 1.0), 0.5 * (r1 * 0.5 + 0.5));
      float dash = 0.55 + 0.45 * smoothstep(-0.2, 0.4, sin(vW.z * 4.0 + vW.x * 1.5 + r1 * 5.0 + uTime));
      vec3 glow = vec3(0.0);
      for (int i = 0; i < NLAMPS; i++){
        vec3 M = uLamps[i]; M.y = 2.0 * WATER_Y - M.y;
        glow += uLampCol * column(V, normalize(M - cameraPosition), r1, 0.00008) * dash;
      }
      col += glow * uLampAmt * 2.4;
      vec3 mm = vec3(uMoonDir.x, -uMoonDir.y, uMoonDir.z);
      col += vec3(1.0, 0.75, 0.25) * column(V, mm, r1, 0.0004) * dash * uMoonAmt * smoothstep(0.0, 0.1, uMoonDir.y);
      vec3 sm = vec3(uSunDir.x, -uSunDir.y, uSunDir.z);
      col += uSunCol * column(V, sm, r1, 0.0012) * dash * uSunAmt * smoothstep(0.0, 0.05, uSunDir.y) * 0.8;
      col = applyFog(col, dist);
      vec3 T = normalize(vec3(cos(${LAKE.rot.toFixed(3)}), 0.0, -sin(${LAKE.rot.toFixed(3)})) + vec3(0.0, 0.0, r1 * 0.25));
      vec2 seeds = strokeSeeds(vW * vec3(1.0, 1.0, 2.5), dist);
      strokeCell(vW, dist);
      writeOut(col, 8.0, 0.0, screenDir(vW, T), seeds);
    }`, { uWaterDeep: { value: new THREE.Color(0.08, 0.2, 0.4) } }, {}, true);
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

// ---------------------------------------------------------------- lamps
function buildLamps(S, world) {
  const solid = makeMat(S, /* glsl */ `
    varying vec3 vW; varying vec3 vN;
    void main(){ vec4 w = instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }`, /* glsl */ `
    varying vec3 vW; varying vec3 vN;
    void main(){
      float dist = length(cameraPosition - vW);
      vec3 col = shadeLit(vec3(0.12, 0.14, 0.24), normalize(vN), 1.0) + lampLight(vW, vec3(0.3)) * 0.3;
      writeOut(applyFog(col, dist), 5.0, 1.0, screenDir(vW, vec3(0.0, 1.0, 0.0)), strokeSeeds(vW, dist));
    }`);
  const glowMat = makeMat(S, /* glsl */ `
    varying vec3 vW; varying vec3 vN;
    void main(){ vec4 w = instanceMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }`, /* glsl */ `
    varying vec3 vW; varying vec3 vN;
    void main(){
      float dist = length(cameraPosition - vW);
      vec3 col = mix(vec3(0.5, 0.45, 0.3), uLampCol * 1.8 + 0.2, uLampAmt);
      vec3 V = normalize(cameraPosition - vW);
      writeOut(col, 9.0, 0.0, screenDir(vW, cross(normalize(vN), V) + vec3(1e-4)), strokeSeeds(vW, dist));
    }`);
  const n = world.lamps.length;
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.09, 2.6, 6).translate(0, 1.3, 0), solid, n);
  const lights = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.26, 1), glowMat, n);
  const m = new THREE.Matrix4();
  world.lamps.forEach((l, i) => { m.makeTranslation(l.x, l.y - 0.1, l.z); posts.setMatrixAt(i, m); m.makeTranslation(l.x, l.y + 2.65, l.z); lights.setMatrixAt(i, m); });
  posts.frustumCulled = lights.frustumCulled = false;
  const g = new THREE.Group(); g.add(posts, lights);
  return g;
}

// ---------------------------------------------------------------- points: flowers & fireflies
function pointsMaterial(S, isGlow) {
  return makeMat(S, /* glsl */ `
    attribute vec3 aColor; attribute float aSize;
    uniform float uPxScale; uniform float uAmt;
    varying vec3 vCol; varying vec3 vW; varying float vSeed;
    void main(){
      vec3 p = position;
      ${isGlow ? '' : `
      // flowers nod with the same slow waves of wind as the wheat
      float gust = snoise(vec3(p.xz * 0.035 - uWind * uTime * 0.4, uTime * 0.05));
      p.xz += uWind * (0.06 + 0.1 * gust) * (1.0 + uDream * 0.5);
      vec2 away = p.xz - uPlayer.xz; float dp = length(away);
      p.xz += away / max(dp, 0.01) * smoothstep(1.4, 0.2, dp) * 0.5;`}
      vec4 mv = viewMatrix * vec4(p, 1.0);
      gl_PointSize = clamp(aSize * uAmt * uPxScale / -mv.z${isGlow ? '' : ' * 1.7'}, 0.0, ${isGlow ? '40.0' : '34.0'}) * smoothstep(0.6, 2.5, -mv.z);
      vCol = aColor; vW = p; vSeed = hash12(position.xz * 7.0);
      ${isGlow ? '' : `
      // fewer, broader dabs: about half the flowers are painted, and tiny far ones thin out
      // steadily (each flower has a fixed chance) instead of flickering as specks
      float keep = hash12(position.xz * 3.3 + 1.7);
      if (keep > 0.48 * smoothstep(1.5, 5.0, gl_PointSize)) { gl_PointSize = 0.0; mv.z = 1.0; }`}
      gl_Position = projectionMatrix * mv;
    }`, /* glsl */ `
    uniform float uAmt;
    varying vec3 vCol; varying vec3 vW; varying float vSeed;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      ${isGlow ? 'float r = length(c);' : `
      // a single loaded dab of paint: an irregular blob rather than a disc
      c.y *= 1.35; // a dab laid on sideways, wider than tall
      float a = atan(c.y, c.x);
      float rim = 0.82 + 0.12 * sin(a * 3.0 + vSeed * 40.0) + 0.06 * sin(a * 5.0 + vSeed * 17.0);
      float r = length(c) / rim;`}
      if (r > 0.5) discard;
      float dist = length(cameraPosition - vW);
      vec3 col;
      ${isGlow ? `col = vCol * (1.3 + 0.9 * (1.0 - r * 2.0));` : `
      col = shadeLit(vCol, vec3(0.0, 1.0, 0.0), 1.0) * 1.2 + lampLight(vW, vCol) * 0.5;
      col = nightShift(col); col = applyFog(col, dist);`}
      vec2 dir = normalize(vec2(c.y + 0.35, -c.x + 0.1));
      // flowers pass a dome as their first seed: the paint pass turns it into a raised blob
      writeOut(col, ${isGlow ? '9.0' : '11.0'}, 0.0, dir, ${isGlow ? 'vec2(vSeed, fract(vSeed * 7.0 + r))' : 'vec2(0.5 + 0.4 * (1.0 - 4.0 * r * r), vSeed)'});
    }`, { uPxScale: S.uPxScale, uAmt: { value: 1 } });
}
function buildFlowers(S, world) {
  const f = world.flowers, n = f.length / 7;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos.set([f[i * 7], f[i * 7 + 1], f[i * 7 + 2]], i * 3);
    col.set([f[i * 7 + 3], f[i * 7 + 4], f[i * 7 + 5]], i * 3);
    size[i] = f[i * 7 + 6];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const pts = new THREE.Points(geo, pointsMaterial(S, false));
  pts.frustumCulled = false;
  return pts;
}
function buildFireflies(S) {
  const n = 320;
  const rng = mulberry32(9);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  const seeds = [];
  for (let i = 0; i < n; i++) {
    seeds.push([rng(), rng(), rng(), rng()]);
    const warm = rng();
    col.set(warm < 0.7 ? [1.0, 0.86, 0.36] : [0.75, 1.0, 0.55], i * 3);
    size[i] = 0.1 + rng() * 0.1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = pointsMaterial(S, true);
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  const BOX = 70;
  pts.userData.update = (t, player, amt) => {
    mat.uniforms.uAmt.value = amt;
    if (amt <= 0.001) return;
    const p = geo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const s = seeds[i];
      const wx = ((s[0] * BOX + Math.sin(t * 0.13 + s[3] * 20) * 6 + t * 0.4 * (s[2] - 0.5) - player.x) % BOX + BOX * 1.5) % BOX - BOX / 2 + player.x;
      const wz = ((s[1] * BOX + Math.cos(t * 0.11 + s[2] * 20) * 6 - player.z) % BOX + BOX * 1.5) % BOX - BOX / 2 + player.z;
      p[i * 3] = wx; p[i * 3 + 2] = wz;
      p[i * 3 + 1] = heightAt(wx, wz) + 0.6 + s[2] * 2.8 + Math.sin(t * (0.7 + s[3]) + s[0] * 30) * 0.4;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return pts;
}

// ---------------------------------------------------------------- crows
function buildCrows(S) {
  const P = [], W = [];
  const add = (x, y, z, w) => { P.push(x, y, z); W.push(w); };
  // body
  add(0, 0, 0.32, 0); add(-0.07, 0, -0.05, 0); add(0.07, 0, -0.05, 0);
  add(-0.07, 0, -0.05, 0); add(0, 0, -0.36, 0); add(0.07, 0, -0.05, 0);
  add(-0.12, 0, -0.42, 0); add(0, 0, -0.25, 0); add(0.12, 0, -0.42, 0);
  // wings
  for (const sgn of [-1, 1]) {
    add(0, 0, 0.12, 0); add(0, 0, -0.12, 0); add(sgn * 0.38, 0, 0.02, sgn * 0.5);
    add(sgn * 0.38, 0, 0.02, sgn * 0.5); add(0, 0, -0.12, 0); add(sgn * 0.72, 0, -0.12, sgn * 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  const mat = makeMat(S, /* glsl */ `
    attribute float aWing;
    varying vec3 vW;
    void main(){
      vec3 p = position;
      float ph = uTime * 8.0 + float(gl_InstanceID) * 1.7;
      p.y += sin(ph) * abs(aWing) * 0.38;
      p.x *= 1.0 - 0.15 * abs(aWing) * (0.5 + 0.5 * sin(ph));
      vec4 w = instanceMatrix * vec4(p, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`, /* glsl */ `
    varying vec3 vW;
    void main(){
      float dist = length(cameraPosition - vW);
      vec3 col = mix(vec3(0.03, 0.04, 0.1), vec3(0.12, 0.13, 0.28), uDay * 0.4);
      writeOut(applyFog(col, dist), 10.0, 0.0, screenDir(vW, vec3(1.0, 0.0, 0.0)), vec2(0.5));
    }`, {}, { side: THREE.DoubleSide });
  const n = 34;
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  const rng = mulberry32(31);
  const flocks = [{ x: 70, z: 10, r: 45 }, { x: 10, z: 70, r: 38 }, { x: -60, z: -90, r: 50 }];
  const birds = [];
  for (let i = 0; i < n; i++) {
    const f = flocks[i % flocks.length];
    birds.push({ f, ph: rng() * Math.PI * 2, sp: (0.18 + rng() * 0.1) * (rng() < 0.5 ? 1 : -1), rr: f.r * (0.6 + rng() * 0.6), alt: 14 + rng() * 14, wob: rng() * 10 });
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new V3();
  mesh.userData.update = (t, amt) => {
    birds.forEach((b, i) => {
      const a = b.ph + t * b.sp;
      const x = b.f.x + Math.cos(a) * b.rr + Math.sin(t * 0.3 + b.wob) * 6;
      const z = b.f.z + Math.sin(a) * b.rr * 0.7 + Math.cos(t * 0.23 + b.wob) * 6;
      const y = heightAt(b.f.x, b.f.z) + b.alt + Math.sin(t * 0.5 + b.wob) * 3 + (1 - amt) * 120;
      const dx = -Math.sin(a) * b.sp, dz = Math.cos(a) * b.sp * 0.7;
      e.set(0, Math.atan2(dx, dz), -Math.sign(b.sp) * 0.35);
      q.setFromEuler(e);
      s.setScalar(amt > 0.01 ? 1.5 : 0);
      m.compose(new V3(x, y, z), q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

export function buildScene(S, world) {
  const scene = new THREE.Scene();
  const sky = buildSky(S);
  scene.add(sky);
  scene.add(buildTerrain(S, world));
  scene.add(buildWater(S));
  scene.add(buildVillage(S, world));
  scene.add(buildCypresses(S, world));
  scene.add(buildOlives(S, world));
  scene.add(buildLamps(S, world));
  scene.add(buildFlowers(S, world));
  const fireflies = buildFireflies(S); scene.add(fireflies);
  const crows = buildCrows(S); scene.add(crows);
  return { scene, sky, fireflies, crows };
}
