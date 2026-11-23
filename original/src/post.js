import * as THREE from 'three';

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMMON = /* glsl */ `
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
`;

// Per material id: stroke length (fraction of screen height) and colour jitter.
//            sky   land  wheat cyp   olive trunk wall  roof  water glow  crow  flower
const LEN = [0.062, 0.042, 0.022, 0.036, 0.03, 0.024, 0.034, 0.03, 0.05, 0.012, 0.004, 0.008, 0.03, 0.03, 0.03, 0.03];
const JIT = [0.85, 1.0, 0.75, 1.0, 1.0, 0.8, 0.5, 0.7, 0.9, 0.25, 0.15, 0.35, 0.8, 0.8, 0.8, 0.8];

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
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { ...lin, count: 2, depthBuffer: true, depthTexture: new THREE.DepthTexture(4, 4) });
    this.rtPaint = new THREE.WebGLRenderTarget(4, 4, { ...lin, depthBuffer: false });
    this.rtB1 = new THREE.WebGLRenderTarget(4, 4, { ...lin, depthBuffer: false });
    this.rtB2 = new THREE.WebGLRenderTarget(4, 4, { ...lin, depthBuffer: false });

    this.paintMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rtScene.textures[0] }, tFlow: { value: this.rtScene.textures[1] },
        uRes: { value: new THREE.Vector2() }, uLen: { value: LEN }, uJit: { value: JIT },
        uDream: S.uDream, uPaintOn: { value: 1 }, uBrush: { value: 1 },
      },
      vertexShader: VS,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tFlow; uniform vec2 uRes;
        uniform float uLen[16]; uniform float uJit[16]; uniform float uDream; uniform float uPaintOn; uniform float uBrush;
        varying vec2 vUv;
        vec2 dirAt(vec2 uv){ vec2 d = texture(tFlow, uv).xy; float l = length(d); return l > 1e-4 ? d / l : vec2(1.0, 0.0); }
        void main(){
          vec4 c0 = texture(tColor, vUv); vec4 f0 = texture(tFlow, vUv);
          if (uPaintOn < 0.5){ gl_FragColor = vec4(c0.rgb, 0.5); return; }
          float id0 = floor(c0.a);
          int ii = int(clamp(id0, 0.0, 15.0));
          float L = uLen[ii] * uRes.y * uBrush * (1.0 + uDream * 0.6);
          const int N = 9;
          vec2 stepUv = vec2(L / float(N)) / uRes;
          vec3 acc = c0.rgb; vec2 accS = f0.zw; float wsum = 1.0;
          for (int s = 0; s < 2; s++){
            vec2 p = vUv; vec2 d = dirAt(vUv) * (s == 0 ? 1.0 : -1.0);
            for (int i = 1; i <= N; i++){
              vec2 nd = dirAt(p); if (dot(nd, d) < 0.0) nd = -nd;
              d = normalize(mix(d, nd, 0.75));
              p += d * stepUv;
              vec4 c = texture(tColor, p); vec4 f = texture(tFlow, p);
              float w = 1.0 - smoothstep(0.5, 1.0, float(i) / float(N));
              w *= abs(floor(c.a) - id0) < 0.5 ? 1.0 : 0.05;
              acc += c.rgb * w; accS += f.zw * w; wsum += w;
            }
          }
          vec3 col = acc / wsum; vec2 s = accS / wsum;
          vec2 sl = clamp((s - 0.5) * 2.5 + 0.5, 0.0, 1.0);
          s = mix(sl, smoothstep(0.38, 0.62, s), 0.55); // crisper stroke edges
          float j = uJit[ii];
          col *= mix(1.0 - 0.3 * j, 1.0 + 0.2 * j, s.x);
          col += (s.y - 0.5) * j * vec3(0.13, 0.05, -0.13);
          gl_FragColor = vec4(max(col, 0.0), s.x);
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
        tBloom: { value: this.rtB1.texture },
        uRes: { value: new THREE.Vector2() }, uScreen: { value: new THREE.Vector2() },
        uNear: { value: 0.1 }, uFar: { value: 3000 }, uTime: S.uTime, uDream: S.uDream,
        uReveal: { value: 0 }, uPaintOn: { value: 1 }, uBloom: { value: 0.8 }, uRelief: { value: 3.2 },
        uSat: { value: 1.1 }, uContrast: { value: 1.05 }, uVignette: { value: 0.3 },
        uOutline: { value: new THREE.Color() }, uCanvas: { value: new THREE.Color() },
      },
      vertexShader: VS,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D tPaint; uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBloom;
        uniform vec2 uRes; uniform vec2 uScreen;
        uniform float uNear, uFar, uTime, uDream, uReveal, uPaintOn, uBloom, uRelief, uSat, uContrast, uVignette;
        uniform vec3 uOutline; uniform vec3 uCanvas;
        varying vec2 vUv;
        float linD(vec2 uv){ float d = texture(tDepth, uv).r; float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main(){
          vec2 uv = vUv + vec2(sin(vUv.y * 9.0 + uTime * 0.7), cos(vUv.x * 8.0 + uTime * 0.6)) * 0.003 * uDream;
          vec2 px = 1.0 / uRes;
          vec4 P = texture(tPaint, uv);
          vec3 col = P.rgb;

          // impasto: the stroke seeds become paint height, lit from the upper left
          float hL = texture(tPaint, uv - vec2(px.x, 0.0)).a, hR = texture(tPaint, uv + vec2(px.x, 0.0)).a;
          float hD = texture(tPaint, uv - vec2(0.0, px.y)).a, hU = texture(tPaint, uv + vec2(0.0, px.y)).a;
          vec3 nrm = normalize(vec3((hL - hR) * uRelief, (hD - hU) * uRelief, 1.0));
          vec3 Ld = normalize(vec3(-0.45, 0.55, 0.7));
          float diff = dot(nrm, Ld);
          float spec = pow(max(dot(reflect(-Ld, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
          col *= mix(1.0, 0.8 + 0.28 * diff, uPaintOn);
          col += spec * 0.07 * uPaintOn * (0.4 + lum(col));

          // contour lines where a nearer form meets a farther one
          float d0 = linD(uv); vec4 c0 = texture(tColor, uv);
          float flag = fract(c0.a) < 0.25 ? 1.0 : 0.0;
          float wpx = (1.2 + 1.4 * P.a) * uRes.y / 1080.0;
          float edge = 0.0;
          for (int k = 0; k < 4; k++){
            vec2 o = (k == 0 ? vec2(1.0, 0.0) : k == 1 ? vec2(-1.0, 0.0) : k == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0)) * px * wpx;
            float d1 = linD(uv + o);
            edge = max(edge, smoothstep(0.05, 0.18, (d1 - d0) / d0));
          }
          edge *= flag * (1.0 - smoothstep(180.0, 650.0, d0) * 0.75);
          col = mix(col, uOutline * (0.55 + 0.7 * lum(col)), edge * 0.8 * uPaintOn);

          col += texture(tBloom, vUv).rgb * uBloom;

          float l = lum(col);
          col = mix(vec3(l), col, uSat);
          col = (col - 0.5) * uContrast + 0.5;

          vec2 fc = gl_FragCoord.xy;
          float weave = sin(fc.x * 1.9) * sin(fc.y * 1.9) * 0.5 + (vnoise2(fc * vec2(0.5, 0.05)) - 0.5) * 0.6;
          col *= 1.0 + weave * 0.035 * uPaintOn;

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
    this.rtPaint.setSize(w, h);
    const bw = Math.max(1, Math.floor(w / 4)), bh = Math.max(1, Math.floor(h / 4));
    this.rtB1.setSize(bw, bh); this.rtB2.setSize(bw, bh);
    this.paintMat.uniforms.uRes.value.set(w, h);
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
    F.uSat.value = grade.sat; F.uContrast.value = grade.contrast; F.uVignette.value = grade.vignette; F.uBloom.value = grade.bloom;
    F.uOutline.value.copy(grade.outline); F.uCanvas.value.copy(grade.canvas);

    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(scene, camera);

    this.pass(this.paintMat, this.rtPaint);
    this.pass(this.brightMat, this.rtB1);
    this.blurMat.uniforms.tSrc.value = this.rtB1.texture; this.blurMat.uniforms.uDir.value.set(1 / this.bw, 0);
    this.pass(this.blurMat, this.rtB2);
    this.blurMat.uniforms.tSrc.value = this.rtB2.texture; this.blurMat.uniforms.uDir.value.set(0, 1 / this.bh);
    this.pass(this.blurMat, this.rtB1);
    this.pass(this.finalMat, null);
  }
}
