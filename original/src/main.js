import * as THREE from 'three';
import { buildWorld, START, heightAt } from './world.js';
import { buildScene } from './objects.js';
import { createUniforms, TimeOfDay } from './palette.js';
import { Post } from './post.js';
import { Player } from './player.js';
import { Soundscape } from './audio.js';

THREE.ColorManagement.enabled = false; // palettes are authored directly in display (sRGB) values

const $ = (id) => document.getElementById(id);
const QUOTES = [
  'I dream of painting, and then I paint my dream.',
  'For my part I know nothing with any certainty, but the sight of the stars makes me dream.',
  'It often seems to me that the night is still more richly coloured than the day.',
  'This morning I saw the countryside from my window a long time before sunrise, with nothing but the morning star, which looked very big.',
  'What is done in love is done well.',
  'Great things are not done by impulse, but by a series of small things brought together.',
];

function fail(msg) {
  $('loading').style.display = 'none';
  $('err').textContent = msg;
  $('err').style.display = 'block';
}

async function boot() {
  const canvas = $('c');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
  } catch (e) {
    return fail('This painting needs WebGL 2. Please open it in a recent Chrome, Edge or Firefox with hardware acceleration on.');
  }
  if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
    return fail('Your GPU cannot render to floating-point targets, which the paint pipeline needs.');
  }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  await new Promise((r) => setTimeout(r, 30)); // let the loading text paint
  const t0 = performance.now();
  const world = buildWorld();
  const S = createUniforms(world);
  const { scene, sky, fireflies, crows } = buildScene(S, world);
  console.log(`world built in ${(performance.now() - t0).toFixed(0)} ms`);
  const waterDeep = scene.children.find((o) => o.material?.uniforms?.uWaterDeep).material.uniforms.uWaterDeep.value;

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
  const fovRad = (62 * Math.PI) / 180;
  S.uStrokeWorld.value = fovRad * 0.0095;
  S.uSkySeedF.value = 1 / (fovRad * 0.0095);

  const post = new Post(renderer, S);
  const tod = new TimeOfDay(S);
  const player = new Player(camera, canvas, world);
  const audio = new Soundscape();
  player.onStep = (a) => audio.step(a);

  // ---- sizing with adaptive resolution ----
  let scale = 1, maxScale = 1;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cw = innerWidth, ch = innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(cw, ch, false);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    const sw = Math.floor(cw * dpr), sh = Math.floor(ch * dpr);
    maxScale = Math.min(1, 1440 / sh);
    scale = Math.min(scale, maxScale);
    const w = Math.max(64, Math.floor(sw * scale)), h = Math.max(64, Math.floor(sh * scale));
    post.setSize(w, h, sw, sh);
    camera.aspect = cw / ch; camera.updateProjectionMatrix();
    S.uPxScale.value = h * 0.5 * camera.projectionMatrix.elements[5];
  };
  resize();
  addEventListener('resize', resize);

  // ---- state ----
  let started = false, paint = true, hideUI = false, timeMult = 1;
  let reveal = 0, revealTarget = 0.22;
  let dream = 0, still = 0, quoteIdx = Math.floor(Math.random() * QUOTES.length), quoteShown = false;
  let elapsed = 0;
  const debug = { dream: null };

  $('loading').style.display = 'none';
  $('title').classList.add('show');

  const enter = () => {
    if (!started) {
      started = true;
      revealTarget = 1;
      $('title').classList.remove('show');
      setTimeout(() => { if (!hideUI) $('hint').classList.add('show'); }, 7000);
      setTimeout(() => $('hint').classList.remove('show'), 19000);
      audio.start();
    }
    $('paused').classList.remove('show');
    player.lock();
  };
  $('enter').addEventListener('click', enter);
  canvas.addEventListener('click', () => { if (started && !player.locked) enter(); });
  document.addEventListener('pointerlockchange', () => {
    if (started && document.pointerLockElement !== canvas && !hideUI) $('paused').classList.add('show');
    if (document.pointerLockElement === canvas) $('paused').classList.remove('show');
  });
  $('paused').addEventListener('click', enter);
  if (new URLSearchParams(location.search).has('instant')) { // skip the title (handy for screenshots)
    started = true; reveal = revealTarget = 1; hideUI = true; document.body.classList.add('noui'); $('title').classList.remove('show');
  }

  addEventListener('keydown', (e) => {
    if (!started) { if (e.code === 'Enter' || e.code === 'Space') enter(); return; }
    switch (e.code) {
      case 'KeyP': paint = !paint; flash(paint ? 'paint' : 'the world beneath the paint'); break;
      case 'KeyM': audio.setMuted(!audio.muted); flash(audio.muted ? 'silence' : 'sound'); break;
      case 'KeyH': hideUI = !hideUI; document.body.classList.toggle('noui', hideUI); break;
      case 'KeyF': if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); break;
      case 'Digit1': tod.jump(0.02); flash('the starry night'); break;
      case 'Digit2': tod.jump(0.245); flash('dawn'); break;
      case 'Digit3': tod.jump(0.42); flash('wheat field with cypresses'); break;
      case 'Digit4': tod.jump(0.714); flash('the sower'); break;
    }
  });
  let flashTimer;
  function flash(text) {
    const el = $('flash'); el.textContent = text; el.classList.add('show');
    clearTimeout(flashTimer); flashTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // ---- loop ----
  let last = performance.now(), acc = 0, frames = 0;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    elapsed += dt;
    timeMult = player.keys.has('KeyT') ? 40 : 1;
    tod.advance(dt, timeMult);

    if (started) {
      player.update(dt, true);
    } else {
      // attract: a slow gaze over the valley
      const a = Math.sin(elapsed * 0.05) * 0.5;
      player.tYaw = 0.08 + a; player.tPitch = 0.06 + Math.sin(elapsed * 0.07) * 0.05;
      player.update(dt, false);
    }

    // stillness invites the dream: stand and look, and the world begins to move
    if (started && player.speed < 0.25) still += dt; else still = Math.max(0, still - dt * 4);
    const lookUp = Math.max(0, player.pitch - 0.15) * 0.6;
    const dTarget = Math.min(1, Math.max(0, (still - 7) / 14) + (still > 4 ? lookUp : 0));
    dream += (dTarget - dream) * Math.min(1, dt * (dTarget > dream ? 0.18 : 0.9));
    if (debug.dream != null) dream = debug.dream;
    S.uDream.value = dream;
    if (dream > 0.45 && !quoteShown && !hideUI) {
      quoteShown = true;
      $('quote').innerHTML = `<span>${QUOTES[quoteIdx]}</span><em>Vincent van Gogh, letters</em>`;
      $('quote').classList.add('show');
    } else if (dream < 0.2 && quoteShown) {
      quoteShown = false; $('quote').classList.remove('show'); quoteIdx = (quoteIdx + 1) % QUOTES.length;
    }

    reveal += (revealTarget - reveal) * Math.min(1, dt * (revealTarget > 0.5 ? 0.45 : 1.2));
    S.uTime.value = elapsed;
    S.uPlayer.value.copy(player.pos);
    const grade = tod.update(elapsed);
    sky.position.copy(camera.position);
    fireflies.userData.update(elapsed, player.pos, tod.night * 0.9 + 0.1 + dream * 0.6);
    crows.userData.update(elapsed, 1 - tod.night);
    waterDeep.copy(grade.waterDeep); // water colour follows the mood

    audio.update({ night: tod.night, day: tod.day, dream, wind: S.uWind.value.length(), speed: player.speed, wheat: player.inWheat, height: player.pos.y });

    camera.updateMatrixWorld();
    post.render(scene, camera, grade, { reveal, paint });

    // adaptive resolution: keep it smooth
    acc += dt; frames++;
    if (acc > 1.5) {
      const ms = (acc / frames) * 1000;
      if (ms > 24 && scale > 0.5) { scale = Math.max(0.5, scale - 0.1); resize(); }
      else if (ms < 14 && scale < maxScale) { scale = Math.min(maxScale, scale + 0.05); resize(); }
      acc = 0; frames = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__painting = { S, tod, player, post, camera, debug, setScale: (s) => { scale = s; resize(); } };
}

boot().catch((e) => { console.error(e); fail('Something went wrong while stretching the canvas: ' + e.message); });
