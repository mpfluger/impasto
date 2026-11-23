import * as THREE from 'three';
import { buildWorld } from './world.js';
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
  } catch {
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
  const BRUSH = fovRad * 0.0095 * 1.2; // world-anchored stroke cell size: strokes about 1% of the screen height, as in the painting
  S.uStrokeWorld.value = BRUSH;
  S.uSkySeedF.value = 1 / BRUSH;

  const post = new Post(renderer, S);
  post.overlay.add(fireflies);
  const tod = new TimeOfDay(S);
  const player = new Player(camera, canvas, world);
  const audio = new Soundscape();
  player.onStep = (a) => audio.step(a);

  // ---- sizing with adaptive resolution ----
  let scale = 1, maxScale = 1, raisedOnce = false, settled = false;
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
  const TITLE_REVEAL = 0.22; // on the title, only the underdrawing and the first touches of paint
  let started = false, paint = true, hideUI = false, timeMult = 1;
  let reveal = 0, revealTarget = TITLE_REVEAL;
  let dream = 0, still = 0, quoteIdx = Math.floor(Math.random() * QUOTES.length), quoteShown = false;
  let elapsed = 0, swirlT = 0;
  let attractT = 0, attractYaw = 0.08, attractPitch = 0.06; // the slow gaze on the title
  let hintTimers = [];
  const debug = { dream: null, fixedScale: false };

  $('loading').style.display = 'none';
  $('title').classList.add('show');

  // ---- the mouse ----
  // One simple rule: inside the painting the mouse is always held (pointer lock); the title page
  // has a normal cursor. Esc is the way out: in fullscreen it leaves fullscreen (the browser does
  // that), in a window it returns to the title. If the hold slips (leaving fullscreen, switching
  // windows), the next click or key takes it back. Where pointer lock is unavailable, the view
  // simply follows the mouse instead.
  let lockFailed = false, lockWorked = false, ourRelease = false, fsLeftAt = -1e9;
  // a refusal only means 'no pointer lock here' if it has never worked (Chrome also refuses a re-lock just after Esc)
  const lockRefused = () => { if (!lockWorked) lockFailed = true; syncMouse(); };
  const syncMouse = () => {
    const captured = player.locked;
    player.freeLook = started && (captured || lockFailed);
    document.body.classList.toggle('captured', started && (captured || lockFailed));
  };
  const capture = () => {
    if (!started || lockFailed || player.locked) return syncMouse();
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => {
        // some browsers refuse unadjustedMovement; try plainly, then fall back to following the mouse
        const p2 = canvas.requestPointerLock();
        if (p2 && p2.catch) p2.catch(lockRefused);
      });
    } catch { lockRefused(); }
    syncMouse();
  };
  const release = () => { if (document.pointerLockElement) { ourRelease = true; document.exitPointerLock(); } };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) fsLeftAt = performance.now(); });
  document.addEventListener('pointerlockchange', () => {
    const was = player.locked;
    player.locked = document.pointerLockElement === canvas;
    if (player.locked) lockWorked = true;
    if (was && !player.locked && started && !ourRelease) {
      // The browser let go, which means Esc or another window took focus. Give it a moment to see
      // whether fullscreen ended too: Esc in fullscreen only leaves fullscreen; Esc in a window
      // returns to the title; losing focus just waits for the next click or key.
      setTimeout(() => {
        const leftFullscreen = performance.now() - fsLeftAt < 700 || !!document.fullscreenElement;
        if (started && !player.locked && document.hasFocus() && !leftFullscreen) toTitle();
      }, 150);
    }
    ourRelease = false;
    syncMouse();
  });
  document.addEventListener('pointerlockerror', lockRefused);
  canvas.addEventListener('click', () => {
    if (!started) return;
    if (helpOpen()) setHelp(false);
    capture();
  });

  // ---- help ----
  const helpOpen = () => $('help').classList.contains('show');
  const setHelp = (on) => { $('help').classList.toggle('show', on); syncMouse(); };
  $('help').addEventListener('click', () => { setHelp(false); capture(); });

  // ---- title <-> walk ----
  const enter = () => {
    if (started) return;
    started = true;
    revealTarget = 1;
    $('title').classList.remove('show');
    $('enter').blur();
    setHelp(false);
    hintTimers.forEach(clearTimeout);
    hintTimers = [
      setTimeout(() => { if (!hideUI && started) $('hint').classList.add('show'); }, 7000),
      setTimeout(() => $('hint').classList.remove('show'), 19000),
    ];
    audio.start();
    capture();
  };
  const toTitle = () => {
    if (!started) return;
    started = false;
    release();
    setHelp(false);
    revealTarget = TITLE_REVEAL; // the paint sinks back into the underdrawing
    still = 0;
    attractT = 0; attractYaw = player.yaw; attractPitch = Math.min(0.3, Math.max(-0.1, player.pitch));
    $('hint').classList.remove('show');
    $('title').classList.add('show');
    audio.stop(); // the title is quiet; the music lives inside the painting
    syncMouse();
  };
  $('enter').addEventListener('click', enter);
  if (new URLSearchParams(location.search).has('instant')) { // skip the title (handy for screenshots)
    started = true; reveal = revealTarget = 1; hideUI = true; document.body.classList.add('noui'); $('title').classList.remove('show');
    syncMouse();
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    const req = document.documentElement.requestFullscreen;
    if (!req) return flash('fullscreen is not available here');
    req.call(document.documentElement).catch(() => flash('fullscreen is not allowed here'));
    capture();
    // some embedded browsers neither grant nor refuse: say so instead of doing nothing
    setTimeout(() => { if (!document.fullscreenElement) flash('fullscreen is not available in this window'); }, 1200);
  };

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) { setHelp(!helpOpen()); return; }
    if (e.code === 'Escape') {
      // with the mouse held the browser handles Esc itself (see pointerlockchange above);
      // without it: close the keys, or return to the title from a window
      if (helpOpen()) setHelp(false);
      else if (started && !document.fullscreenElement) toTitle();
      return;
    }
    if (e.code === 'KeyF') { toggleFullscreen(); return; }
    if (!started) { if (e.code === 'Enter' || e.code === 'Space') enter(); return; }
    switch (e.code) {
      case 'KeyX': toTitle(); return;
      case 'KeyP': paint = !paint; flash(paint ? 'paint' : 'the world beneath the paint'); break;
      case 'KeyM': audio.setMuted(!audio.muted); flash(audio.muted ? 'silence' : 'sound'); break;
      case 'KeyH': hideUI = !hideUI; document.body.classList.toggle('noui', hideUI); break;
      case 'Digit1': tod.jump(0.02); flash('the starry night'); break;
      case 'Digit2': tod.jump(0.245); flash('dawn'); break;
      case 'Digit3': tod.jump(0.42); flash('cypresses in the day'); break;
      case 'Digit4': tod.jump(0.714); flash('the sower'); break;
    }
    capture(); // if the hold slipped, any key takes it back
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
      // attract: a slow gaze over the valley, starting from wherever the walker last looked
      attractT += dt;
      player.tYaw = attractYaw + Math.sin(attractT * 0.05) * 0.5;
      player.tPitch = attractPitch + Math.sin(attractT * 0.07) * 0.05;
      player.update(dt, false);
    }

    // stillness invites the dream: stand quietly for a long while, and the world begins to move.
    // Looking around gently is part of standing still; turning quickly or walking wakes you.
    const turn = Math.abs(player.tYaw - (frame.lastYaw ?? player.tYaw)) / Math.max(dt, 1e-3);
    frame.lastYaw = player.tYaw;
    const quiet = started && player.speed < 0.25 && turn < 1.2;
    if (quiet) still += dt; else still = Math.max(0, still - dt * 6);
    // ~12 s of stillness before it begins, full after ~40 s; gazing up at the sky hurries it
    const lookUp = Math.max(0, player.pitch - 0.2) * 0.5;
    const dTarget = Math.min(1, Math.max(0, (still - 12) / 25) + (still > 8 ? lookUp : 0));
    dream += (dTarget - dream) * Math.min(1, dt * (dTarget > dream ? 0.15 : 0.6));
    if (debug.dream != null) dream = debug.dream;
    S.uDream.value = dream;
    swirlT += dt * (1 + dream * 0.8); // the sky turns a little faster in a dream, never in a lurch
    S.uSwirlT.value = swirlT;
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

    audio.update({ night: tod.night, day: tod.day, dream, wind: S.uWind.value.length(), speed: player.speed, height: player.pos.y });

    camera.updateMatrixWorld();
    post.render(scene, camera, grade, { reveal, paint });

    // adaptive resolution: keep it smooth
    acc += dt; frames++;
    // adaptive resolution, kept calm: every change re-lays the paint slightly, so measure over 4 s,
    // step down only when clearly too slow, step up only when clearly fast, and once it has had to
    // step down after stepping up, hold that level for good
    if (acc > 4 && !debug.fixedScale) {
      const ms = (acc / frames) * 1000;
      if (ms > 26 && scale > 0.5) { scale = Math.max(0.5, scale - 0.1); if (raisedOnce) settled = true; resize(); }
      else if (ms < 12 && scale < maxScale && !settled) { scale = Math.min(maxScale, scale + 0.1); raisedOnce = true; resize(); }
      acc = 0; frames = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__painting = { S, tod, player, post, camera, debug, audio, setScale: (s) => { scale = s; resize(); } };
}

boot().catch((e) => { console.error(e); fail('Something went wrong while stretching the canvas: ' + e.message); });
