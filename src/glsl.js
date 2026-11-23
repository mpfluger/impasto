// Shared GLSL. Every scene material writes two render targets:
//   location 0: colour (rgb) + material id (a; +0.5 = "no outline")
//   location 1: screen-space brush direction (xy) + two world-anchored stroke seeds (zw)
//   location 2: the stroke this pixel belongs to: offset to its centre in pixels (xy), a hash (z),
//               and the brush width in pixels (w). Stroke centres are scattered in world space,
//               so every stroke stays put on the surface it was painted on.

export const NLAMPS = 10;
export const NV = 7;   // sky vortices
export const NS = 16;  // the eleven stars of the painting, and a few behind you

export const NOISE = /* glsl */ `
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y), u.z);
}
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * snoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

export const UNIFORMS = /* glsl */ `
#define NLAMPS ${NLAMPS}
uniform float uTime;
uniform float uDream;
uniform float uNight;
uniform float uDay;
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uShadowTint;
uniform vec3 uFogCol;
uniform float uStrokeWorld;
uniform vec3 uPlayer;
uniform vec2 uWind;
uniform vec3 uLamps[NLAMPS];
uniform float uLampAmt;
uniform vec3 uLampCol;
uniform float uWindowAmt;

// ---- the sky is painted live ----
// About half the sky strokes are repainted in place, each every 1-2 minutes at its own moment. Between repaints it
// keeps exactly the colour the sky had when it was laid; when its turn comes a new stroke, with a new
// shape and the newer colours of the turning swirl, is dragged in over it.
float repaintPeriod(float h){ return fract(h * 5.71) < 0.45 ? 1e6 : 60.0 + 60.0 * fract(h * 17.31); } // about half never repaint
float repaintEpoch(float h, float t){ float P = repaintPeriod(h); return floor((t + h * P) / P); }
float repaintStart(float h, float e){ float P = repaintPeriod(h); return P > 1e5 ? 0.0 : e * P - h * P; }

// ---- stroke centres (shared by vertex and fragment shaders) ----
// Nearest of the jittered points in the 2x2x2 cells around q, and its hash.
vec4 nearestCentre(vec3 q){
  vec3 b = floor(q - 0.5);
  float best = 1e9; vec4 r = vec4(0.0);
  for (int i = 0; i < 8; i++){
    vec3 c = b + vec3(float(i & 1), float((i >> 1) & 1), float(i >> 2));
    float hc = hash13(c);
    vec3 fp = c + 0.15 + 0.7 * fract(hc * vec3(1.0, 37.93, 413.31) + vec3(0.0, 0.31, 0.67));
    vec3 dd = fp - q; float d = dot(dd, dd);
    if (d < best){ best = d; r = vec4(fp, fract(hc * 911.71 + 0.123)); }
  }
  return r;
}
// Stroke centres live on a world-space grid whose size follows distance, so strokes keep
// roughly the same size on screen; between two sizes the choice is dithered cell by cell,
// so strokes are swapped one at a time rather than in a visible band.
vec4 strokeCentre(vec3 wp, float dist, out float s){
  float lod = log2(max(dist * uStrokeWorld, 1e-4));
  float l0 = floor(lod), t = lod - l0;
  s = exp2(l0);
  if (hash13(floor(wp / s) + 0.37) < t) s *= 2.0;
  vec4 c = nearestCentre(wp / s);
  return vec4(c.xyz * s, fract(c.w + s * 0.137));
}
`;

export const FRAG = /* glsl */ `
layout(location = 1) out highp vec4 gFlow;
layout(location = 2) out highp vec4 gStroke;
uniform float uPxScale;
vec4 gS = vec4(0.0); // set by strokeCell / strokeCellDir, written by writeOut

float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

// Project a world-space tangent to a screen-space direction (pixel units, y up).
vec2 screenDir(vec3 wp, vec3 wt){
  vec3 p = (viewMatrix * vec4(wp, 1.0)).xyz;
  vec3 t = (viewMatrix * vec4(wt, 0.0)).xyz;
  vec2 d = t.xy * (-p.z) + p.xy * t.z;
  float l = length(d);
  return l > 1e-6 ? d / l : vec2(1.0, 0.0);
}

vec2 toScreen(vec3 v){ return v.xy / max(-v.z, 1e-3) * uPxScale; }
// The stroke a surface point belongs to, from its centre (world), hash and cell size.
void strokeFromCentre(vec3 cw, float h, float s, vec3 wp){
  vec3 vc = (viewMatrix * vec4(cw, 1.0)).xyz, vp = (viewMatrix * vec4(wp, 1.0)).xyz;
  gS = vec4(toScreen(vc) - toScreen(vp), h, s * uPxScale / max(-vp.z, 1e-3));
}
void strokeCell(vec3 wp, float dist){
  float s; vec4 c = strokeCentre(wp, dist, s);
  strokeFromCentre(c.xyz, c.w, s, wp);
}
// For things that move (trees swaying, hills heaving in a dream): strokes are chosen on the resting
// shape and carried along with it, so they sway with the tree instead of crawling over it.
void strokeCellMoved(vec3 rest, vec3 wp, float dist){
  float s; vec4 c = strokeCentre(rest, dist, s);
  strokeFromCentre(c.xyz + (wp - rest), c.w, s, wp);
}
// The same for things at infinity (the sky): centres scattered over the sphere of directions.
void strokeCellDir(vec3 d, float F){
  vec4 c = nearestCentre(d * F);
  vec3 vc = (viewMatrix * vec4(c.xyz / F, 0.0)).xyz, vp = (viewMatrix * vec4(d, 0.0)).xyz;
  gS = vec4(toScreen(vc) - toScreen(vp), floor(c.w * 1024.0) / 1024.0, uPxScale / F);
}

// Two stroke seeds anchored to the surface, with octave blending by distance so
// a stroke stays roughly the same size on screen without swimming.
vec2 strokeSeeds(vec3 wp, float dist){
  strokeCell(wp, dist);
  float lod = log2(max(dist * uStrokeWorld, 1e-4));
  float l0 = floor(lod); float t = lod - l0;
  vec3 p0 = wp / exp2(l0); vec3 p1 = wp / exp2(l0 + 1.0);
  vec2 drift = vec2(0.0);
  float a = mix(vnoise3(p0 + drift.x), vnoise3(p1 + 17.1), t);
  float b = mix(vnoise3(p0 + 41.7), vnoise3(p1 + 63.3 + drift.y), t);
  float k = inversesqrt(t * t + (1.0 - t) * (1.0 - t));
  return clamp((vec2(a, b) - 0.5) * k * 1.35 + 0.5, 0.0, 1.0);
}

// Stylised light: banded lambert, shadows pushed toward the complementary (violet / blue).
vec3 shadeLit(vec3 base, vec3 n, float ao){
  float ndl = dot(n, uLightDir);
  float lit = smoothstep(-0.1, 0.3, ndl) * 0.6 + smoothstep(0.42, 0.85, ndl) * 0.4;
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  vec3 col = base * (amb + uLightCol * lit * 1.15);
  col = mix(col, col * 0.55 + uShadowTint * lum(base) * 0.75, (1.0 - lit) * 0.5);
  return col * ao;
}
vec3 lampLight(vec3 wp, vec3 base){
  float a = 0.0;
  for (int i = 0; i < NLAMPS; i++){ vec3 d = uLamps[i] - wp; a += 1.0 / (1.0 + dot(d, d) * 0.09); }
  return base * uLampCol * a * uLampAmt * 1.3;
}
vec3 nightShift(vec3 col){
  float l = lum(col);
  vec3 nc = vec3(l * 0.55, l * 0.85 + 0.02, l * 1.3 + 0.07);
  return mix(col, nc, uNight * 0.16) * (1.0 + uNight * 0.18);   // a light blue cast, not a blue wash
}
vec3 applyFog(vec3 col, float dist){
  float f = smoothstep(80.0, 900.0, dist);
  return mix(col, uFogCol, f * 0.5);
}
vec3 rotateAround(vec3 t, vec3 n, float a){ return t * cos(a) + cross(n, t) * sin(a); }

void writeOut(vec3 col, float id, float outline, vec2 sdir, vec2 seeds){
  pc_fragColor = vec4(max(col, 0.0), id + (outline > 0.5 ? 0.0 : 0.5));
  gFlow = vec4(sdir, seeds);
  gStroke = gS;
}
`;

// The sky: Starry-Night vortices, haloed stars, crescent moon, a Sower sun, swirling day clouds.
export const SKY = /* glsl */ `
#define NV ${NV}
#define NS ${NS}
uniform vec3 uVC[NV];
uniform vec3 uVU[NV];
uniform vec3 uVV[NV];
uniform vec4 uVP[NV];   // radius, base spin, spiral arms, speed
uniform vec4 uStars[NS];
uniform vec3 uSkyTop, uSkyMid, uSkyHor, uSwirlA, uSwirlB, uSunCol, uStarCore, uStarHalo, uCloudCol, uCloudShade;
uniform vec3 uSunDir, uMoonDir;
uniform float uSunSize, uStarAmt, uCloudAmt, uMoonAmt, uSunAmt;

vec3 rotAxis(vec3 v, vec3 k, float a){ float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }

uniform float uSwirlT; // a clock that runs a little faster in a dream (integrated, so it never lurches)
vec3 skyShade(vec3 d, out vec3 tang, out vec3 wd, float t){
  float dream = 1.0;
  float hc = max(d.y, 0.0);
  vec3 col = mix(uSkyHor, uSkyMid, smoothstep(0.0, 0.3, hc));
  col = mix(col, uSkyTop, smoothstep(0.3, 0.95, hc));
  vec2 dxz = normalize(d.xz + vec2(1e-5));
  float sunAz = max(0.0, dot(dxz, normalize(uSunDir.xz + vec2(1e-5))));
  col = mix(col, uSunCol, pow(sunAz, 5.0) * (1.0 - smoothstep(0.0, 0.45, hc)) * uSunAmt * 0.45);

  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 az = cross(up, d); float azl = length(az); az = azl > 1e-4 ? az / azl : vec3(1.0, 0.0, 0.0);
  float phiAz = atan(d.z, d.x);
  float wave = sin(phiAz * 3.0 + d.y * 8.0 - t * 0.005 * dream);
  vec3 windT = normalize(az + up * wave * 0.45);

  wd = d; tang = vec3(0.0); float vsum = 0.0; float bands = 0.0;
  for (int i = 0; i < NV; i++){
    vec3 c = uVC[i]; vec4 P = uVP[i];
    float ca = clamp(dot(d, c), -1.0, 1.0);
    float ang = acos(ca);
    float rr = ang / P.x;
    float fall = exp(-rr * rr);
    wd = rotAxis(wd, c, (P.y + t * P.w * 0.003) * fall);
    vec3 q = d - c * ca; float ql = length(q);
    float phi = atan(dot(q, uVV[i]), dot(q, uVU[i]));
    // the bands turn slowly, at about the pace of the courses of strokes (see strokeCellSky),
    // so the strokes carry their colour round instead of colour sliding beneath them
    float ph = rr * 3.4 + phi / 6.2831 * P.z - t * P.w * 0.007 * P.z / 6.2831;   // slow, so strokes laid minutes apart still agree
    float band = 0.5 + 0.5 * cos(6.2831 * ph + snoise(d * 5.0 + float(i) * 3.7) * 1.4);
    bands += fall * smoothstep(0.05, 0.4, rr) * band;
    vec3 rot = cross(c, d); float rl = length(rot);
    vec3 rad = ql > 1e-4 ? -q / ql : vec3(0.0);
    if (rl > 1e-5) tang += (rot / rl + rad * 0.3) * fall * 3.0;
    vsum += fall;
  }
  tang += windT * (0.45 + max(0.0, 1.0 - vsum));

  // flowing strands that ride the vortex field
  float n1 = snoise(vec3(wd.x * 2.4, wd.y * 11.0, wd.z * 2.4) + vec3(0.0, 0.0, t * 0.01));
  float n2 = fbm3(wd * 3.2 + 7.0);
  float s = 0.5 + 0.5 * (n1 * 0.5 + n2 * 0.65);
  s = s * 0.72 + bands * 0.5 - 0.08;
  float horizonFade = smoothstep(-0.05, 0.12, d.y);
  float sA = smoothstep(0.38, 0.72, s) * horizonFade;   // plenty of pale streaks, as in the painting
  float sB = smoothstep(0.68, 0.98, s) * horizonFade;
  float sD = smoothstep(0.36, 0.1, s);
  float strandAmt = 1.0 - uCloudAmt * 0.6;
  col = mix(col, uSwirlA, sA * 0.78 * strandAmt);
  col = mix(col, uSwirlB, sB * 0.75 * strandAmt);
  col = mix(col, col * 0.7, sD * 0.55);

  // swirling clouds by day
  float cl = smoothstep(0.48, 0.74, s + fbm3(wd * 1.6 + 3.0) * 0.3) * uCloudAmt * smoothstep(-0.02, 0.15, d.y);
  vec3 cc = mix(uCloudShade, uCloudCol, smoothstep(0.5, 0.95, s + dot(d, uSunDir) * 0.2));
  col = mix(col, cc, cl);

  // The eleven stars of The Starry Night (and a few behind you): a small orange-yellow core, a pale
  // yellow centre, and a halo of concentric creamy-white and greenish-yellow courses cooling into the blue.
  if (uStarAmt > 0.01){
    for (int j = 0; j < NS; j++){
      vec4 S = uStars[j];
      float R = S.w;                                   // halo radius (radians)
      float a = acos(clamp(dot(d, S.xyz), -1.0, 1.0));
      if (a < R * 1.15){
        float x = a / R;
        float tw = 0.93 + 0.07 * sin(t * 1.3 + float(j) * 2.1);
        float halo = smoothstep(1.08, 0.3, x) * tw;
        float rings = 0.5 + 0.5 * cos(x * 17.0 + float(j));
        vec3 hc = mix(vec3(0.94, 0.95, 0.78), vec3(0.78, 0.9, 0.6), rings);
        hc = mix(hc, vec3(0.6, 0.76, 0.86), smoothstep(0.55, 1.0, x) * 0.6);
        col = mix(col, hc, halo * 0.88 * uStarAmt);
        col = mix(col, vec3(1.0, 0.95, 0.62), smoothstep(0.42, 0.2, x) * uStarAmt);
        col = mix(col, vec3(1.0, 0.7, 0.16), smoothstep(0.2, 0.1, x) * uStarAmt);
        vec3 ct = cross(S.xyz, d); float cl2 = length(ct);
        if (cl2 > 1e-5) tang += ct / cl2 * halo * 8.0 * uStarAmt;
      }
    }
  }

  // the crescent moon of the painting: a thick golden crescent opening to the upper right, its dark
  // side filled with pale paint, inside a wide yellow-green halo of concentric strokes
  if (uMoonAmt > 0.01){
    float a = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
    float mr = 0.084, HR = 0.21;
    if (a < HR * 1.1){
      vec3 side = normalize(cross(uMoonDir, up));
      vec3 c2 = normalize(uMoonDir + side * mr * 0.26 + up * mr * 0.24);   // the cut that leaves a C, about 0.4 of the radius thick
      float a2 = acos(clamp(dot(d, c2), -1.0, 1.0));
      float disk = smoothstep(mr, mr * 0.92, a);
      float cres = disk * smoothstep(mr * 0.9, mr * 0.97, a2);
      float x = a / HR;
      float halo = smoothstep(1.05, 0.25, x);
      float rings = 0.5 + 0.5 * cos(x * 14.0);
      vec3 hc = mix(vec3(0.86, 0.88, 0.56), vec3(0.62, 0.78, 0.5), smoothstep(0.35, 0.9, x));
      hc = mix(hc, hc * 0.82, rings * 0.6);
      col = mix(col, hc, halo * 0.9 * uMoonAmt);
      col = mix(col, vec3(0.9, 0.9, 0.66), disk * uMoonAmt);            // the dark side, filled with pale paint
      col = mix(col, mix(vec3(0.78, 0.42, 0.04), vec3(0.92, 0.62, 0.1), smoothstep(mr * 0.98, mr * 0.84, a)), cres * uMoonAmt);
      vec3 ct = cross(uMoonDir, d); float cl3 = length(ct);
      if (cl3 > 1e-5) tang += ct / cl3 * halo * 10.0 * uMoonAmt;
    }
  }

  // the sun, enormous at the horizon like The Sower
  if (uSunAmt > 0.01){
    float a = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    float sr = uSunSize;
    float disk = smoothstep(sr, sr * 0.9, a);
    float halo = exp(-a / (sr * 1.3));
    float rings = 0.6 + 0.4 * cos(a / sr * 6.0);
    col = mix(col, mix(uSunCol, vec3(1.0, 1.0, 0.86), 0.35), clamp(halo * rings, 0.0, 1.0) * 0.8 * uSunAmt);
    col = mix(col, uSunCol * 1.05 + vec3(0.04), disk * uSunAmt);
    vec3 radial = d - uSunDir * dot(d, uSunDir); float rl = length(radial);
    vec3 ct = cross(uSunDir, d); float cl4 = length(ct);
    if (rl > 1e-5 && cl4 > 1e-5) tang += (ct / cl4 * 0.5 + radial / rl * 0.9) * halo * 10.0 * uSunAmt;
  }
  return col;
}

// Sky strokes. Around each vortex the sky is laid in concentric courses, one brush wide; every
// course turns as a solid ring at its own pace (faster near the eye), so whole strokes travel
// round the vortex, sliding past their neighbours, the swirl moving stroke by stroke. Elsewhere,
// in the open sky, strokes are scattered as on the land.
void strokeCellSky(vec3 d, float F){
  int vi = 0; float best = 0.0;
  for (int i = 0; i < NV; i++){
    float a = acos(clamp(dot(d, uVC[i]), -1.0, 1.0)) / uVP[i].x;
    float f = exp(-a * a);
    if (f > best){ best = f; vi = i; }
  }
  float ringW = 1.0 / F;
  vec3 C = uVC[vi]; vec4 P = uVP[vi];
  float ang = acos(clamp(dot(d, C), -1.0, 1.0));
  if (best < 0.32 || ang < ringW * 0.7){ strokeCellDir(d, F); return; }
  float k = floor(ang / ringW);
  float rk = (k + 0.5) * ringW;
  float fk = exp(-(rk / P.x) * (rk / P.x));
  float spin = 0.0;                                              // strokes stay where they were laid
  float phi = atan(dot(d, uVV[vi]), dot(d, uVU[vi]));
  float n = max(3.0, floor(6.2831 * sin(rk) / (ringW * 3.6)));   // strokes in this course
  float hk = hash12(vec2(k, float(vi) * 7.0 + 0.5));
  float u = (phi - spin) / 6.2831 * n + hk * 3.0;
  float j = floor(u);
  float hj = hash12(vec2(k * 13.1 + mod(j, n), float(vi) * 3.0 + 1.0));
  float phc = (j + 0.5 + (hj - 0.5) * 0.3 - hk * 3.0) / n * 6.2831 + spin;
  float rc = rk + (hj - 0.5) * ringW * 0.25;
  vec3 cen = cos(rc) * C + sin(rc) * (cos(phc) * uVU[vi] + sin(phc) * uVV[vi]);
  vec3 vc = (viewMatrix * vec4(cen, 0.0)).xyz, vp = (viewMatrix * vec4(d, 0.0)).xyz;
  // the hash is kept to 1/1024 so the paint pass reads back exactly the same repaint schedule
  gS = vec4(toScreen(vc) - toScreen(vp), floor(fract(hj * 7.31 + k * 0.137 + float(vi) * 0.311) * 1024.0) / 1024.0, uPxScale / F);
}
`;
