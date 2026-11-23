// Shared GLSL. Every scene material writes two render targets:
//   location 0: colour (rgb) + material id (a; +0.5 = "no outline")
//   location 1: screen-space brush direction (xy) + two world-anchored stroke seeds (zw)
// The paint pass then drags paint along that direction field, so strokes stick to the world.

export const NLAMPS = 10;
export const NV = 7;   // sky vortices
export const NS = 16;  // big haloed stars

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
`;

export const FRAG = /* glsl */ `
layout(location = 1) out highp vec4 gFlow;

float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

// Project a world-space tangent to a screen-space direction (pixel units, y up).
vec2 screenDir(vec3 wp, vec3 wt){
  vec3 p = (viewMatrix * vec4(wp, 1.0)).xyz;
  vec3 t = (viewMatrix * vec4(wt, 0.0)).xyz;
  vec2 d = t.xy * (-p.z) + p.xy * t.z;
  float l = length(d);
  return l > 1e-6 ? d / l : vec2(1.0, 0.0);
}

// Two stroke seeds anchored to the surface, with octave blending by distance so
// a stroke stays roughly the same size on screen without swimming.
vec2 strokeSeeds(vec3 wp, float dist){
  float lod = log2(max(dist * uStrokeWorld, 1e-4));
  float l0 = floor(lod); float t = lod - l0;
  vec3 p0 = wp / exp2(l0); vec3 p1 = wp / exp2(l0 + 1.0);
  vec2 drift = vec2(uTime * 0.02 * uDream);
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
  return mix(col, nc, uNight * 0.3) * (1.0 + uNight * 0.18);
}
vec3 applyFog(vec3 col, float dist){
  float f = smoothstep(80.0, 900.0, dist);
  return mix(col, uFogCol, f * 0.5);
}
vec3 rotateAround(vec3 t, vec3 n, float a){ return t * cos(a) + cross(n, t) * sin(a); }

void writeOut(vec3 col, float id, float outline, vec2 sdir, vec2 seeds){
  pc_fragColor = vec4(max(col, 0.0), id + (outline > 0.5 ? 0.0 : 0.5));
  gFlow = vec4(sdir, seeds);
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

vec3 skyShade(vec3 d, out vec3 tang, out vec3 wd){
  float t = uTime;
  float dream = 1.0 + uDream * 2.0;
  float hc = max(d.y, 0.0);
  vec3 col = mix(uSkyHor, uSkyMid, smoothstep(0.0, 0.3, hc));
  col = mix(col, uSkyTop, smoothstep(0.3, 0.95, hc));
  vec2 dxz = normalize(d.xz + vec2(1e-5));
  float sunAz = max(0.0, dot(dxz, normalize(uSunDir.xz + vec2(1e-5))));
  col = mix(col, uSunCol, pow(sunAz, 5.0) * (1.0 - smoothstep(0.0, 0.45, hc)) * uSunAmt * 0.45);

  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 az = cross(up, d); float azl = length(az); az = azl > 1e-4 ? az / azl : vec3(1.0, 0.0, 0.0);
  float phiAz = atan(d.z, d.x);
  float wave = sin(phiAz * 3.0 + d.y * 8.0 - t * 0.05 * dream);
  vec3 windT = normalize(az + up * wave * 0.45);

  wd = d; tang = vec3(0.0); float vsum = 0.0; float bands = 0.0;
  for (int i = 0; i < NV; i++){
    vec3 c = uVC[i]; vec4 P = uVP[i];
    float ca = clamp(dot(d, c), -1.0, 1.0);
    float ang = acos(ca);
    float rr = ang / P.x;
    float fall = exp(-rr * rr);
    wd = rotAxis(wd, c, (P.y + t * P.w * 0.05 * dream) * fall);
    vec3 q = d - c * ca; float ql = length(q);
    float phi = atan(dot(q, uVV[i]), dot(q, uVU[i]));
    float ph = rr * 3.4 + phi / 6.2831 * P.z - t * P.w * 0.25 * dream;
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
  float sA = smoothstep(0.42, 0.78, s) * horizonFade;
  float sB = smoothstep(0.74, 1.0, s) * horizonFade;
  float sD = smoothstep(0.36, 0.1, s);
  float strandAmt = 1.0 - uCloudAmt * 0.6;
  col = mix(col, uSwirlA, sA * 0.78 * strandAmt);
  col = mix(col, uSwirlB, sB * 0.75 * strandAmt);
  col = mix(col, col * 0.7, sD * 0.55);

  // swirling clouds by day
  float cl = smoothstep(0.48, 0.74, s + fbm3(wd * 1.6 + 3.0) * 0.3) * uCloudAmt * smoothstep(-0.02, 0.15, d.y);
  vec3 cc = mix(uCloudShade, uCloudCol, smoothstep(0.5, 0.95, s + dot(d, uSunDir) * 0.2));
  col = mix(col, cc, cl);

  // stars with concentric halos
  if (uStarAmt > 0.01){
    for (int j = 0; j < NS; j++){
      vec4 S = uStars[j];
      float a = acos(clamp(dot(d, S.xyz), -1.0, 1.0));
      float sz = S.w;
      if (a < sz * 7.0){
        float tw = 0.85 + 0.15 * sin(t * 1.7 + float(j) * 2.1);
        float halo = exp(-a / (sz * 1.5)) * tw;
        float rings = 0.55 + 0.45 * cos(a / sz * 7.0 - t * 0.8 * dream - float(j));
        float core = smoothstep(sz * 0.6, sz * 0.12, a);
        col = mix(col, uStarHalo, clamp(halo * rings * 1.2, 0.0, 1.0) * 0.85 * uStarAmt);
        col = mix(col, uStarCore, core * uStarAmt);
        vec3 ct = cross(S.xyz, d); float cl2 = length(ct);
        if (cl2 > 1e-5) tang += ct / cl2 * halo * 8.0 * uStarAmt;
      }
    }
    vec3 g = d * 60.0; vec3 ci = floor(g); float hs = hash13(ci);
    if (hs > 0.92){
      vec3 cp = ci + 0.5 + (vec3(hash13(ci + 1.0), hash13(ci + 2.0), hash13(ci + 3.0)) - 0.5) * 0.5;
      float st = smoothstep(0.32, 0.0, length(g - cp)) * (0.6 + 0.4 * sin(t * 2.0 + hs * 90.0));
      col = mix(col, mix(uStarHalo, uStarCore, hs), st * uStarAmt * smoothstep(0.02, 0.2, d.y));
    }
  }

  // crescent moon with a great orange halo
  if (uMoonAmt > 0.01){
    float a = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
    float mr = 0.055;
    if (a < mr * 9.0){
      vec3 side = normalize(cross(uMoonDir, up));
      vec3 c2 = normalize(uMoonDir + side * mr * 0.7 + up * mr * 0.3);
      float a2 = acos(clamp(dot(d, c2), -1.0, 1.0));
      float disk = smoothstep(mr, mr * 0.86, a);
      float cres = disk * (1.0 - smoothstep(mr * 0.98, mr * 0.82, a2));
      float halo = exp(-a / (mr * 1.8));
      float rings = 0.55 + 0.45 * cos(a / mr * 5.0 - t * 0.5 * dream);
      col = mix(col, vec3(0.97, 0.86, 0.38), clamp(halo * rings * 1.1, 0.0, 1.0) * 0.85 * uMoonAmt);
      col = mix(col, vec3(0.86, 0.62, 0.22), disk * 0.35 * uMoonAmt);
      col = mix(col, vec3(1.0, 0.86, 0.3), cres * uMoonAmt);
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
    float rings = 0.6 + 0.4 * cos(a / sr * 6.0 - t * 0.5 * dream);
    col = mix(col, mix(uSunCol, vec3(1.0, 1.0, 0.86), 0.35), clamp(halo * rings, 0.0, 1.0) * 0.8 * uSunAmt);
    col = mix(col, uSunCol * 1.05 + vec3(0.04), disk * uSunAmt);
    vec3 radial = d - uSunDir * dot(d, uSunDir); float rl = length(radial);
    vec3 ct = cross(uSunDir, d); float cl4 = length(ct);
    if (rl > 1e-5 && cl4 > 1e-5) tang += (ct / cl4 * 0.5 + radial / rl * 0.9) * halo * 10.0 * uSunAmt;
  }
  return col;
}
`;
