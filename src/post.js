import * as THREE from 'three';

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMMON = /* glsl */ `
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
`;

// Per material id. LEN: how far the brush drags colour (fraction of screen height).
// WID: brush width relative to the spacing of stroke centres. JIT: how differently each stroke is mixed.
//            sky   land  wheat cyp   olive trunk wall  roof  water glow  crow  flower
const LEN = [0.085, 0.06, 0.034, 0.05, 0.042, 0.03, 0.036, 0.034, 0.07, 0.012, 0.004, 0.008, 0.03, 0.03, 0.03, 0.03];
const WID = [1.45, 1.35, 1.0, 1.2, 1.15, 1.05, 1.05, 1.05, 1.3, 1.0, 1.0, 1.0, 1.1, 1.1, 1.1, 1.1]; // overlapping, so the canvas is always covered
const JIT = [0.85, 1.0, 1.0, 1.0, 1.0, 0.8, 0.5, 0.7, 0.9, 0.25, 0.15, 0.35, 0.8, 0.8, 0.8, 0.8];

export class Post {
  constructor(renderer, S) {
    this.r = renderer; this.S = S;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(tri);
    this.quad.frustumCulled = false;
    this.fsScene = new THREE.Scene(); this.fsScene.add(this.quad);
    this.fsCam = new THREE.Camera();

    const lin = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { ...lin, count: 3, depthBuffer: true, depthTexture: new THREE.DepthTexture(4, 4) });
    this.rtLic = new THREE.WebGLRenderTarget(4, 4, { ...lin, count: 2, depthBuffer: false });
    this.rtPaint = new THREE.WebGLRenderTarget(4, 4, { ...lin, depthBuffer: false });
    this.rtB1 = new THREE.WebGLRenderTarget(4, 4, { ...lin, depthBuffer: false });
    this.rtB2 = new THREE.WebGLRenderTarget(4, 4, { ...lin, depthBuffer: false });
    this.rtGlow = new THREE.WebGLRenderTarget(4, 4, { ...lin, depthBuffer: false });
    this.overlay = new THREE.Scene(); // things that glow on top of the finished painting (fireflies)

    // Pass 1: drag colour along the brush field (line-integral convolution), and smooth the two
    // world-anchored stroke seeds: A along the flow (its level sets become lanes), B across it
    // (its level sets cut the lanes into separate strokes).
    this.licMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtScene.textures[0] }, tFlow: { value: this.rtScene.textures[1] },
        uRes: { value: new THREE.Vector2() }, uLen: { value: LEN },
        uDream: S.uDream, uPaintOn: { value: 1 },
      },
      vertexShader: VS,
      fragmentShader: COMMON + /* glsl */ `
        layout(location = 1) out highp vec4 gSeed;
        uniform sampler2D tColor; uniform sampler2D tFlow; uniform vec2 uRes;
        uniform float uLen[16]; uniform float uDream; uniform float uPaintOn;
        varying vec2 vUv;
        vec2 dirAt(vec2 uv){ vec2 d = texture(tFlow, uv).xy; float l = length(d); return l > 1e-4 ? d / l : vec2(1.0, 0.0); }
        void main(){
          vec4 c0 = texture(tColor, vUv); vec4 f0 = texture(tFlow, vUv);
          float id0 = floor(c0.a);
          if (uPaintOn < 0.5){ gl_FragColor = vec4(c0.rgb, id0); gSeed = vec4(0.5); return; }
          int ii = int(clamp(id0, 0.0, 15.0));
          float L = uLen[ii] * uRes.y * (1.0 + uDream * 0.45);
          const int N = 6;
          vec2 stepUv = vec2(L / float(N)) / uRes;
          vec3 acc = c0.rgb; float accA = f0.z; float wsum = 1.0;
          // the brush direction is averaged along the path too (as doubled angles, since a stroke has no
          // front or back), so strokes don't flip between neighbouring blades of wheat and the ground
          vec2 dd0 = dirAt(vUv); vec2 accD = vec2(dd0.x * dd0.x - dd0.y * dd0.y, 2.0 * dd0.x * dd0.y);
          for (int s = 0; s < 2; s++){
            vec2 p = vUv; vec2 d = dirAt(vUv) * (s == 0 ? 1.0 : -1.0);
            for (int i = 1; i <= N; i++){
              vec2 nd = dirAt(p); if (dot(nd, d) < 0.0) nd = -nd;
              d = normalize(mix(d, nd, 0.75));
              p += d * stepUv;
              vec4 c = texture(tColor, p);
              float w = 1.0 - smoothstep(0.5, 1.0, float(i) / float(N));
              w *= abs(floor(c.a) - id0) < 0.5 ? 1.0 : 0.05;
              acc += c.rgb * w; accA += texture(tFlow, p).z * w; wsum += w;
              accD += vec2(nd.x * nd.x - nd.y * nd.y, 2.0 * nd.x * nd.y) * w;
            }
          }
          float ang = 0.5 * atan(accD.y, accD.x);
          vec2 d0 = length(accD) > 1e-4 ? vec2(cos(ang), sin(ang)) : dd0;
          gl_FragColor = vec4(acc / wsum, id0);
          gSeed = vec4((accA / wsum - 0.5) * 2.4, 0.0, d0);
        }`,
      depthTest: false, depthWrite: false,
    });

    // Pass 2: lay the strokes. Every stroke has a centre scattered in world space (written by the
    // scene pass). For each pixel we gather the strokes whose centres lie nearby along the brush
    // direction, draw each as a capsule aligned with the flow at its own centre, filled with the
    // colour found at that centre, and keep the two uppermost: one stroke laid over another.
    this.paintMat = new THREE.ShaderMaterial({
      uniforms: {
        tLic: { value: this.rtLic.textures[0] }, tSeed: { value: this.rtLic.textures[1] },
        tFlow: { value: this.rtScene.textures[1] }, tStroke: { value: this.rtScene.textures[2] },
        uRes: { value: new THREE.Vector2() }, uWid: { value: WID }, uJit: { value: JIT },
        uDream: S.uDream, uPaintOn: { value: 1 }, uBrush: { value: 1 }, uTime: S.uTime, uNight: S.uNight, uSwirlT: S.uSwirlT,
      },
      vertexShader: VS,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D tLic; uniform sampler2D tSeed; uniform sampler2D tFlow; uniform sampler2D tStroke; uniform vec2 uRes;
        uniform float uWid[16]; uniform float uJit[16]; uniform float uDream; uniform float uPaintOn; uniform float uBrush; uniform float uTime; uniform float uNight; uniform float uSwirlT;
        // the same repaint schedule as the sky (glsl.js): it must match exactly
        float repaintPeriod(float h){ return fract(h * 5.71) < 0.45 ? 1e6 : 60.0 + 60.0 * fract(h * 17.31); } // about half never repaint
        float repaintEpoch(float h, float t){ float P = repaintPeriod(h); return floor((t + h * P) / P); }
        float repaintStart(float h, float e){ float P = repaintPeriod(h); return P > 1e5 ? 0.0 : e * P - h * P; }
        varying vec2 vUv;
        // Stroke directions. On the land and trees they come straight from the surface each stroke is
        // painted on, so they move only with that surface, never with whatever else is on screen nearby.
        // The sky takes the field smoothed along its flow: there it only ever smooths sky, so it holds still.
        int dirMode = 0;
        vec2 dirAt(vec2 uv){
          vec2 d = dirMode == 0 ? texture(tSeed, uv).zw : texture(tFlow, uv).xy;
          float l = length(d); return l > 1e-4 ? d / l : vec2(1.0, 0.0);
        }
        // the wheat and the ground it grows from are painted as one surface, so strokes can run across both
        float grp(float id){ return abs(id - 2.0) < 0.5 ? 1.0 : id; }

        // Each stroke is mixed on the palette separately: a pale tint with lead white, the mid tone
        // or a deeper shade, nudged warm or cool and toward teal or violet; streaks of unmixed paint
        // run along it.
        vec3 mixPaint(vec3 base, float r1, float r2, float streak, float bristle, float j){
          float tone = r1 < 0.2 ? 0.8 : (r1 > 0.62 ? 1.18 : 1.0 + (r1 - 0.4) * 0.3);
          vec3 c = base * mix(1.0, tone, j);
          float L = lum(base);
          vec3 white = mix(vec3(0.86, 0.95, 1.0), vec3(1.0, 0.96, 0.82), smoothstep(0.0, 0.5, base.r - base.b + 0.25));
          float pale = r1 > 0.58 ? (0.22 + 0.3 * fract(r2 * 5.3)) : 0.0;
          c = mix(c, white * clamp(L * 1.9 + 0.2, 0.32, 1.0), pale * j);
          c += (r2 - 0.5) * j * vec3(0.16, 0.05, -0.16) * (0.3 + 1.2 * L);
          c += (fract(r1 * 7.31 + r2 * 3.7) - 0.5) * j * vec3(-0.1, 0.12, 0.03) * (0.3 + L);
          c *= streak > 0.78 ? 1.2 : (streak < 0.22 ? 0.82 : 1.0);
          c += (streak > 0.9 ? 0.07 : 0.0) * vec3(1.0, 0.97, 0.88) * (0.3 + L);
          return c * (0.9 + 0.16 * bristle);
        }

        void main(){
          vec4 c0 = texture(tLic, vUv);
          if (uPaintOn < 0.5){ gl_FragColor = vec4(c0.rgb, 0.5); return; }
          float id0 = c0.a;
          int ii = int(clamp(id0 + 0.5, 0.0, 15.0));
          vec4 s0 = texture(tSeed, vUv);
          // flowers are single blobs of paint; glows and crows are thin, flat touches
          if (ii == 11){ gl_FragColor = vec4(c0.rgb, 0.3 + 0.7 * sqrt(clamp(s0.x / 0.96, 0.0, 1.0))); return; }
          if (ii == 9 || ii == 10){ gl_FragColor = vec4(c0.rgb, 0.3); return; }

          dirMode = ii == 0 ? 0 : 1;
          vec2 P = gl_FragCoord.xy;
          vec4 S0 = texelFetch(tStroke, ivec2(P), 0);
          float j = uJit[ii];
          // beneath the strokes lies an earlier layer of the same paint, so the canvas is always covered
          vec3 under = c0.rgb;
          if (S0.w <= 0.0){ gl_FragColor = vec4(c0.rgb, 0.3); return; }

          float wmul = uWid[ii] * 1.15 * uBrush;
          float Wn = S0.w * wmul;
          vec2 d = dirAt(vUv), n = vec2(-d.y, d.x);
          // look far enough along the flow to find the ends of the longest strokes, including the larger
          // ones where stroke size steps up with distance, so no stroke ever loses its ends
          float reach = Wn * 3.8;

          float p1 = -1e9, p2 = -1e9;                           // order of the top two strokes (higher lies on top)
          float seenA = -1.0, seenB = -1.0, seenC = -1.0;       // centres already tested (neighbouring samples often agree)
          vec4 A1 = vec4(0.0), A2 = vec4(0.0);                  // their colour (rgb) and height (a)
          float k1 = 0.0, k2 = 0.0;                             // their coverage
          for (int i = -4; i <= 4; i++){
            for (int jj = -1; jj <= 1; jj++){
              vec2 q = P + d * (float(i) / 4.0 * reach) + n * (float(jj) * Wn * 0.6);
              ivec2 qi = ivec2(clamp(q, vec2(0.0), uRes - 1.0));
              vec4 st = texelFetch(tStroke, qi, 0);
              if (st.w <= 0.0) continue;
              float prio = st.z;
              if (prio == seenA || prio == seenB || prio == seenC) continue;
              seenC = seenB; seenB = seenA; seenA = prio;
              vec2 C = vec2(qi) + 0.5 + st.xy;                   // the stroke's centre, in pixels
              if (length(P - C) > st.w * wmul * 3.0) continue;   // too far away to reach this pixel
              vec4 lc = texture(tLic, C / uRes);
              if (abs(grp(lc.a) - grp(id0)) > 0.5) continue;    // strokes stay on their own object (wheat and ground are one)
              // sky strokes are repainted in turn: each repaint is a new stroke (new shape, the newer colour),
              // dragged in from its start, and the most recently painted lie on top
              float ord = prio, age = 1e3, sh = prio;
              if (ii == 0){
                float e = repaintEpoch(prio, uSwirlT), t0 = repaintStart(prio, e);
                age = uSwirlT - t0; ord = t0; sh = fract(prio + e * 0.6180339);
              }
              float r1 = sh, r2 = fract(sh * 7.13 + 0.31), r3 = fract(sh * 13.7 + 0.71), r4 = fract(sh * 29.3 + 0.17);
              float W = st.w * wmul * (0.82 + 0.3 * r3);
              // long strokes as in the painting (about four widths); a stroke only changes when it is repainted
              float Ls = W * (3.0 + 1.8 * r2);
              // Vincent's dark accents: short, narrow, near-black ultramarine dashes tucked between the
              // light strokes, thick in the sky, a few on the land
              float r5 = fract(sh * 53.7 + 0.29);
              bool darkDash = ii == 0 && r5 < 0.14;            // in the sky only, as in the painting
              if (darkDash){ W *= 0.33; Ls *= 0.55; }
              if (ii == 3){ W *= 0.8; Ls *= 1.6; }              // the cypress: long, narrow strokes up its tongues
              // one fixed orientation per stroke: the smoothed field gives its line, the signed flow at its own
              // centre which way it runs, so every pixel of the stroke agrees and nothing flips
              vec2 dc = dirAt(C / uRes);
              if (dot(dc, texture(tFlow, C / uRes).xy) < 0.0) dc = -dc;
              vec2 dp = dot(d, dc) < 0.0 ? -d : d;
              float th = (r4 - 0.5) * 0.36;                      // no two strokes quite parallel
              dc = vec2(dc.x * cos(th) - dc.y * sin(th), dc.x * sin(th) + dc.y * cos(th));
              vec2 v = P - C;
              float y = dot(v, dc), x = dot(v, vec2(-dc.y, dc.x));
              x -= y * (dc.x * dp.y - dc.y * dp.x) * 0.5;        // bend a little with the field
              // and each stroke has its own curve: some straight, some bowed like a comma
              float curv = (r4 - 0.5) * 1.1 / Ls;
              x -= y * y * curv;
              // the stroke: set down bluntly, dragged, narrowing and running dry where the brush lifted
              float g = clamp(y / Ls + 0.5, 0.0, 1.0);
              float pulled = r2 > 0.5 ? 1.0 : -1.0;              // which way the brush travelled
              float lift = pulled > 0.0 ? g : 1.0 - g;
              float rad = 0.5 * W * mix(1.0, 0.35 + 0.4 * r3, smoothstep(0.45, 1.0, lift)); // taper varies by stroke
              float halfL = max(0.0, 0.5 * Ls - rad);
              vec2 e = vec2(abs(x), max(abs(y) - halfL, 0.0)) / rad;
              bool atStart = y * pulled < 0.0;
              float en = atStart ? pow(pow(e.x, 4.0) + pow(e.y, 4.0), 0.25) : length(e);  // squarish start, round end
              float sd = (en - 1.0) * rad;
              float cov = 1.0 - smoothstep(-0.8, 0.8, sd);
              cov *= 1.0 - smoothstep(-0.06, 0.0, lift - clamp(age / 1.0, 0.0, 1.0));  // the brush still travelling, unhurried
              if (cov <= 0.002) continue;
              // relief: rounded crown, a lip where the brush pushed paint aside, broken bristle furrows,
              // and a ridge of paint where the brush lifted
              float inner = clamp(-sd / rad, 0.0, 1.0);
              float crown = sqrt(inner);
              float lip = smoothstep(0.0, 0.18, inner) * (1.0 - smoothstep(0.18, 0.55, inner));
              float pile = 1.0 + 0.6 * smoothstep(0.62, 0.92, lift);
              float nb = 5.0 + 4.0 * r3;
              float bx = x / W * nb + r1 * 7.0;
              float hair = hash12(vec2(floor(bx), sh * 91.0));
              float bristle = (0.5 + 0.5 * sin(bx * 6.2832)) * (0.55 + 0.45 * hair);
              bristle = mix(0.55, bristle, smoothstep(0.25, 0.7, vnoise2(vec2(floor(bx) * 3.7 + sh * 50.0, y / W * 1.6))));
              bristle = mix(bristle, 0.6, smoothstep(0.82, 1.0, lift));
              float streak = hash12(vec2(floor(bx * 0.5) + 3.0, sh * 37.0));
              // dry brush: toward the lifted end some hairs have run out of paint
              float dry = smoothstep(0.78, 1.0, lift) * (1.0 - smoothstep(0.1, 0.35, hair + 0.3 * (1.0 - lift))) * 0.85;
              cov *= 1.0 - dry;
              if (cov <= 0.002) continue;
              float load = 0.6 + 0.4 * r3;
              float h = (0.42 + 0.5 * crown + 0.1 * lip) * pile * load * (0.66 + 0.34 * bristle); // a clear step at every edge
              // the stroke carries the colour found at its centre, with a little of what lies beneath
              vec3 base = mix(lc.rgb, c0.rgb, ii == 0 ? 0.0 : 0.22);  // a sky stroke is its own colour
              vec4 A = vec4(mixPaint(base, r1, r2, streak, bristle, j), h);
              if (darkDash) A.rgb = mix(vec3(0.12, 0.2, 0.46), vec3(0.03, 0.04, 0.13), uNight) * (0.85 + 0.3 * bristle);
              if (ord > p1){ p2 = p1; A2 = A1; k2 = k1; p1 = ord; A1 = A; k1 = cov; }
              else if (ord > p2){ p2 = ord; A2 = A; k2 = cov; }
            }
          }
          vec3 col = under; float h = 0.22;
          if (p2 > -1e8){ col = mix(col, A2.rgb, k2); h = mix(h, A2.a * 0.7, k2); }
          if (p1 > -1e8){ col = mix(col, A1.rgb, k1); h = mix(h, A1.a, k1); }
          gl_FragColor = vec4(max(col, 0.0), h);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: this.rtPaint.texture }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        void main(){
          vec3 c = texture(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
                 + texture(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          c *= 0.25;
          float l = max(c.r, max(c.g, c.b));
          gl_FragColor = vec4(c * smoothstep(0.82, 1.25, l), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VS,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main(){
          vec3 c = texture(tSrc, vUv).rgb * 0.2;
          c += (texture(tSrc, vUv + uDir * 1.4).rgb + texture(tSrc, vUv - uDir * 1.4).rgb) * 0.17;
          c += (texture(tSrc, vUv + uDir * 3.3).rgb + texture(tSrc, vUv - uDir * 3.3).rgb) * 0.12;
          c += (texture(tSrc, vUv + uDir * 5.3).rgb + texture(tSrc, vUv - uDir * 5.3).rgb) * 0.07;
          c += (texture(tSrc, vUv + uDir * 7.5).rgb + texture(tSrc, vUv - uDir * 7.5).rgb) * 0.04;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });

    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tPaint: { value: this.rtPaint.texture }, tColor: { value: this.rtScene.textures[0] }, tDepth: { value: this.rtScene.depthTexture },
        tBloom: { value: this.rtB1.texture }, tGlow: { value: this.rtGlow.texture },
        uRes: { value: new THREE.Vector2() }, uScreen: { value: new THREE.Vector2() },
        uNear: { value: 0.1 }, uFar: { value: 3000 }, uTime: S.uTime, uDream: S.uDream,
        uReveal: { value: 0 }, uPaintOn: { value: 1 }, uBloom: { value: 0.8 }, uRelief: { value: 5.2 },
        uSat: { value: 1.1 }, uContrast: { value: 1.05 }, uVignette: { value: 0.3 },
        uOutline: { value: new THREE.Color() }, uCanvas: { value: new THREE.Color() }, uLightView: { value: new THREE.Vector3(-0.6, 0.7, 0.3) },
      },
      vertexShader: VS,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D tPaint; uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBloom; uniform sampler2D tGlow;
        uniform vec2 uRes; uniform vec2 uScreen;
        uniform float uNear, uFar, uTime, uDream, uReveal, uPaintOn, uBloom, uRelief, uSat, uContrast, uVignette;
        uniform vec3 uOutline; uniform vec3 uCanvas; uniform vec3 uLightView;
        varying vec2 vUv;
        float linD(vec2 uv){ float d = texture(tDepth, uv).r; float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main(){
          // The canvas breathes: the picture ripples in slow waves, a little always and more in a dream,
          // most toward the sides of the screen and around shapes, where outlines waver against what lies
          // behind them.
          vec2 cq = vUv - 0.5; cq.x *= uScreen.x / uScreen.y;
          float toSide = smoothstep(0.2, 0.85, length(cq));
          float dA = linD(vUv), dB = linD(vUv + vec2(4.0, 0.0) / uRes), dC = linD(vUv + vec2(0.0, 4.0) / uRes);
          float nearShape = smoothstep(0.04, 0.25, max(abs(dB - dA), abs(dC - dA)) / min(dA, min(dB, dC)));
          // the slow, broad waves of the first version: the picture sways rather than wiggles
          vec2 ripple = vec2(sin(vUv.y * 9.0 + uTime * 0.7), cos(vUv.x * 8.0 + uTime * 0.6));
          float amp = (0.0018 + 0.0028 * uDream) * (0.6 + 0.7 * toSide);
          vec2 uv = vUv + ripple * amp;
          // The background flows around things: near the outline of anything standing nearer, what lies
          // behind is gently pushed away from it and swirled along it, slowly breathing. The object itself
          // stays still; only the world behind it bends, like air shimmering round a flame.
          vec2 pxs = 1.0 / uRes * (uRes.y / 1080.0);
          float dHere = linD(vUv);
          vec2 toward = vec2(0.0);
          for (int k = 0; k < 8; k++){
            float a = float(k) * 0.7854;
            vec2 dir = vec2(cos(a), sin(a));
            for (int j = 0; j < 3; j++){
              float rad = j == 0 ? 10.0 : (j == 1 ? 22.0 : 40.0);
              float dn = linD(vUv + dir * rad * pxs);
              float occ = smoothstep(0.06, 0.3, (dHere - dn) / dHere);   // a nearer thing lies that way
              toward += dir * occ * (j == 0 ? 0.5 : (j == 1 ? 0.33 : 0.2));
            }
          }
          float tl = length(toward);
          if (tl > 1e-3){
            vec2 nrmT = toward / tl, along = vec2(-nrmT.y, nrmT.x);
            float breathe = 0.65 + 0.35 * sin(uTime * 0.7 + dHere * 0.03);
            float swirl = sin(uTime * 0.45 + dHere * 0.02 + vUv.x * 3.0);
            float strength = smoothstep(0.0, 1.2, tl) * (7.0 + 12.0 * uDream) * breathe;
            uv += (-nrmT * 0.8 + along * swirl * 0.9) * strength * pxs;
          }
          vec2 px = 1.0 / uRes;
          vec4 P = texture(tPaint, uv);
          vec3 col = P.rgb;

          // impasto: each stroke's height is lit like thick oil paint under a raking gallery light
          float hC = P.a;
          float hL = texture(tPaint, uv - vec2(px.x, 0.0)).a, hR = texture(tPaint, uv + vec2(px.x, 0.0)).a;
          float hD = texture(tPaint, uv - vec2(0.0, px.y)).a, hU = texture(tPaint, uv + vec2(0.0, px.y)).a;
          // a wider baseline catches the body of each stroke, the narrow one its furrows
          float hL2 = texture(tPaint, uv - vec2(px.x * 2.5, 0.0)).a, hR2 = texture(tPaint, uv + vec2(px.x * 2.5, 0.0)).a;
          float hD2 = texture(tPaint, uv - vec2(0.0, px.y * 2.5)).a, hU2 = texture(tPaint, uv + vec2(0.0, px.y * 2.5)).a;
          float rel = uRelief * uRes.y / 720.0;
          vec2 grad = vec2(hL - hR, hD - hU) * 0.6 + vec2(hL2 - hR2, hD2 - hU2) * 0.24;
          vec3 nrm = normalize(vec3(grad * rel, 1.0));
          // The paint is lit by the scene's own light (the moon by night, the sun by day), seen from where
          // you stand: turn, and the ridges catch it differently and their shadows swing round.
          vec2 lxy = uLightView.xy; float lxl = length(lxy);
          vec2 ldir = normalize(mix(vec2(-0.66, 0.75), lxl > 1e-3 ? lxy / lxl : vec2(-0.66, 0.75), smoothstep(0.05, 0.3, lxl)));
          vec3 Ld = normalize(vec3(ldir * 0.8, 0.5 + 0.25 * max(uLightView.z, 0.0)));
          float diff = dot(nrm, Ld) - Ld.z;                 // 0 on flat paint, +/- on slopes
          vec3 Hh = normalize(Ld + vec3(0.0, 0.0, 1.0));
          float spec = pow(max(dot(nrm, Hh), 0.0), 26.0);
          float cavity = smoothstep(0.02, 0.3, hC);         // valleys between strokes hold shadow
          float shade = (1.0 + max(diff, 0.0) * 0.7 + min(diff, 0.0) * 0.55) * mix(0.9, 1.0, cavity);
          col *= mix(1.0, shade, uPaintOn);
          // each stroke casts a short shadow onto the paint beneath it, on the side away from the light
          float shStep = uRes.y / 1080.0;
          float occ = 0.0;
          for (int k = 1; k <= 3; k++){
            float hs = texture(tPaint, uv + ldir * px * float(k) * 2.0 * shStep).a;
            occ = max(occ, hs - hC - float(k) * 0.06);
          }
          col *= 1.0 - smoothstep(0.04, 0.22, occ) * 0.38 * uPaintOn;
          // old oil paint: a soft, mostly matte sheen on the ridges that face the light
          col += spec * 0.13 * uPaintOn * (0.3 + lum(col)) * cavity * vec3(1.0, 0.98, 0.93);

          // contour lines where a nearer form meets a farther one
          float d0 = linD(uv); vec4 c0 = texture(tColor, uv);
          float flag = fract(c0.a) < 0.25 ? 1.0 : 0.0;
          float wpx = (1.2 + 1.4 * P.a) * uRes.y / 1080.0;
          float edge = 0.0, skyline = 0.0;
          for (int k = 0; k < 4; k++){
            vec2 o = (k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0)) * px * wpx;
            float d1 = linD(uv + o);
            edge = max(edge, smoothstep(0.05, 0.18, (d1 - d0) / d0));
            // land meeting the sky: a broader line, a few pixels thick like a loaded brush
            float d2 = linD(uv + o * (2.6 + 1.5 * hash12(floor(gl_FragCoord.xy / 9.0))));
            if (d0 < 2500.0) skyline = max(skyline, max(step(2500.0, d1), step(2500.0, d2) * 0.85));
          }
          // contours fade with distance, except the skyline: like Vincent's far hills, the ridge of the
          // mountains keeps a dark blue line against the sky (and you can watch it swell in a dream)
          // the village keeps its dark outlines even from afar; the cypress is drawn round in umber
          float idE = floor(c0.a);
          float fadeE = (idE > 5.5 && idE < 7.5) ? 1.0 : (1.0 - smoothstep(180.0, 650.0, d0) * 0.75);
          edge = max(edge * flag * fadeE, skyline * smoothstep(300.0, 600.0, d0) * 0.85);
          vec3 oc = abs(idE - 3.0) < 0.5 ? vec3(0.34, 0.17, 0.07) : uOutline;
          col = mix(col, oc * (0.55 + 0.7 * lum(col)), edge * 0.8 * uPaintOn);

          col += texture(tBloom, vUv).rgb * uBloom;
          col += texture(tGlow, vUv).rgb;                      // fireflies, glowing over the paint

          float l = lum(col);
          col = mix(vec3(l), col, uSat * (0.97 + 0.3 * uDream));   // a touch less saturated than before
          // acid drift: hues wander in slow waves across the canvas, a little always, much more in a dream
          float wave = sin(vUv.x * 2.3 + vUv.y * 1.7 + uTime * 0.13) + 0.6 * sin(vUv.x * -1.4 + vUv.y * 3.1 - uTime * 0.09 + 2.0);
          float hr = sin(uTime * 0.11) * (0.05 + 0.4 * uDream) + wave * (0.035 + 0.33 * uDream) + sin(uTime * 0.043 + 1.7) * 0.025;
          vec3 yiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * col;
          float ch = cos(hr), sh = sin(hr);
          yiq.yz = vec2(ch * yiq.y - sh * yiq.z, sh * yiq.y + ch * yiq.z);
          col = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * yiq;
          col = (col - 0.5) * uContrast + 0.5;

          vec2 fc = gl_FragCoord.xy;
          float weave = sin(fc.x * 1.9) * sin(fc.y * 1.9) * 0.5 + (vnoise2(fc * vec2(0.5, 0.05)) - 0.5) * 0.6;
          col *= 1.0 + weave * (0.03 + 0.14 * (1.0 - cavity)) * uPaintOn; // the canvas weave shows where paint is thin

          vec2 q = vUv - 0.5; q.x *= uScreen.x / uScreen.y;
          col *= mix(1.0, 1.0 - uVignette, smoothstep(0.35, 1.0, length(q)));

          // reveal: a primed canvas with a blue underdrawing, then paint arrives stroke by stroke
          float cov = P.a * 0.45 + vnoise2(vUv * uScreen / 26.0) * 0.4 + vnoise2(vUv * uScreen / 7.0) * 0.15;
          float vis = smoothstep(cov - 0.04, cov + 0.04, uReveal * 1.15 - 0.05);
          vec3 canvas = uCanvas * (1.0 + weave * 0.06);
          canvas *= 1.0 - (1.0 - lum(P.rgb)) * 0.12;
          canvas = mix(canvas, vec3(0.2, 0.24, 0.4), edge * 0.75);
          col = mix(canvas, col, vis);

          col += (hash12(fc + fract(uTime) * 100.0) - 0.5) * 0.022;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
  }

  setSize(w, h, sw, sh) {
    this.w = w; this.h = h;
    this.rtScene.setSize(w, h);
    this.rtLic.setSize(w, h);
    this.rtPaint.setSize(w, h);
    this.rtGlow.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / 4)), bh = Math.max(1, Math.floor(h / 4));
    this.rtB1.setSize(bw, bh); this.rtB2.setSize(bw, bh);
    this.paintMat.uniforms.uRes.value.set(w, h);
    this.licMat.uniforms.uRes.value.set(w, h);
    this.finalMat.uniforms.uRes.value.set(w, h);
    this.finalMat.uniforms.uScreen.value.set(sw, sh);
    this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.bw = bw; this.bh = bh;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.fsScene, this.fsCam);
  }

  render(scene, camera, grade, opts) {
    const r = this.r;
    const F = this.finalMat.uniforms;
    F.uNear.value = camera.near; F.uFar.value = camera.far;
    F.uReveal.value = opts.reveal;
    F.uPaintOn.value = opts.paint ? 1 : 0;
    this.paintMat.uniforms.uPaintOn.value = opts.paint ? 1 : 0;
    this.licMat.uniforms.uPaintOn.value = opts.paint ? 1 : 0;
    F.uSat.value = grade.sat; F.uContrast.value = grade.contrast; F.uVignette.value = grade.vignette; F.uBloom.value = grade.bloom;
    F.uOutline.value.copy(grade.outline); F.uCanvas.value.copy(grade.canvas);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    F.uLightView.value.copy(this.S.uLightDir.value).transformDirection(camera.matrixWorldInverse);

    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(scene, camera);

    // the glowing overlay, tested against the scene's depth so it hides behind trees and hills
    this.overlay.traverse((o) => {
      const u = o.material && o.material.uniforms;
      if (u && u.tDepth) { u.tDepth.value = this.rtScene.depthTexture; u.uRes.value.set(this.w, this.h); u.uNear.value = camera.near; u.uFar.value = camera.far; }
    });
    r.setRenderTarget(this.rtGlow);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(this.overlay, camera);

    this.pass(this.licMat, this.rtLic);
    this.pass(this.paintMat, this.rtPaint);
    this.pass(this.brightMat, this.rtB1);
    this.blurMat.uniforms.tSrc.value = this.rtB1.texture; this.blurMat.uniforms.uDir.value.set(1 / this.bw, 0);
    this.pass(this.blurMat, this.rtB2);
    this.blurMat.uniforms.tSrc.value = this.rtB2.texture; this.blurMat.uniforms.uDir.value.set(0, 1 / this.bh);
    this.pass(this.blurMat, this.rtB1);
    this.pass(this.finalMat, null);
  }
}
