import * as THREE from 'three';
import { heightAt, START, WATER_Y, BOUNDS, fieldAt, FIELD } from './world.js';

const EYE = 1.65;

export class Player {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.obstacles = world.obstacles;
    this.pos = new THREE.Vector3(START.x, heightAt(START.x, START.z), START.z);
    this.vel = new THREE.Vector3();
    this.vy = 0; this.air = 0; this.grounded = true;
    this.yaw = 0.08; this.pitch = 0.02; this.tYaw = this.yaw; this.tPitch = this.pitch;
    this.keys = new Set();
    this.bob = 0; this.lastStep = 0;
    this.locked = false;
    this.onStep = () => {};
    this.speed = 0;
    this.inWheat = 0;

    addEventListener('keydown', (e) => { this.keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseIn = false; });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
    // free look: the view follows the mouse with no click or capture.
    // Near the screen edges the view keeps turning, so you can look all the way round.
    this.freeLook = false; // switched on once the walk begins
    this.mouseIn = false; this.mx = 0; this.my = 0;
    addEventListener('mousemove', (e) => {
      this.mouseIn = true;
      this.mx = (e.clientX / innerWidth) * 2 - 1; this.my = (e.clientY / innerHeight) * 2 - 1;
      if (!this.freeLook) return;
      const k = this.locked ? 0.0021 : 0.0028;
      this.tYaw -= e.movementX * k;
      this.tPitch = Math.max(-1.35, Math.min(1.35, this.tPitch - e.movementY * k));
    });
    document.addEventListener('mouseleave', () => { this.mouseIn = false; });
    document.documentElement.addEventListener('mouseleave', () => { this.mouseIn = false; });
    // touch: drag to look, two fingers to walk
    let lastT = null;
    dom.addEventListener('touchstart', (e) => { lastT = e.touches[0]; this.touchWalk = e.touches.length > 1; }, { passive: true });
    dom.addEventListener('touchmove', (e) => {
      const t = e.touches[0]; if (!lastT) { lastT = t; return; }
      this.tYaw -= (t.clientX - lastT.clientX) * 0.005;
      this.tPitch = Math.max(-1.35, Math.min(1.35, this.tPitch - (t.clientY - lastT.clientY) * 0.005));
      lastT = t; this.touchWalk = e.touches.length > 1;
    }, { passive: true });
    dom.addEventListener('touchend', (e) => { if (!e.touches.length) { lastT = null; this.touchWalk = false; } }, { passive: true });
  }


  blocked(x, z) { return heightAt(x, z) < WATER_Y + 0.25 || Math.hypot(x, z) > BOUNDS; }

  collide(p) {
    const R = 0.4;
    for (const o of this.obstacles) {
      const dx = p.x - o.x, dz = p.z - o.z;
      if (o.r !== undefined) {
        const d = Math.hypot(dx, dz), m = o.r + R;
        if (d < m && d > 1e-5) { p.x = o.x + (dx / d) * m; p.z = o.z + (dz / d) * m; }
      } else {
        if (Math.abs(dx) > 14 || Math.abs(dz) > 14) continue;
        let lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
        const hw = o.hw + R, hd = o.hd + R;
        if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
          if (hw - Math.abs(lx) < hd - Math.abs(lz)) lx = Math.sign(lx) * hw; else lz = Math.sign(lz) * hd;
          p.x = o.x + lx * o.c - lz * o.s; p.z = o.z + lx * o.s + lz * o.c;
        }
      }
    }
  }

  update(dt, active) {
    const k = this.keys;
    let f = 0, s = 0;
    if (active) {
      if (k.has('KeyW') || k.has('ArrowUp') || this.touchWalk) f += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    }
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const sp = run ? 8.5 : 3.4;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * f + rx * s, wz = fz * f + rz * s;
    const l = Math.hypot(wx, wz); if (l > 0) { wx /= l; wz /= l; }
    // slow down a little when wading through wheat
    this.inWheat += ((fieldAt(this.pos.x, this.pos.z) === FIELD.WHEAT ? 1 : 0) - this.inWheat) * Math.min(1, dt * 3);
    const target = sp * (1 - this.inWheat * 0.18);
    const acc = 1 - Math.exp(-dt * (l > 0 ? 5 : 7));
    this.vel.x += (wx * target - this.vel.x) * acc;
    this.vel.z += (wz * target - this.vel.z) * acc;

    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const p = { x: this.pos.x, z: this.pos.z };
    if (!this.blocked(nx, p.z)) p.x = nx; else this.vel.x *= 0.3;
    if (!this.blocked(p.x, nz)) p.z = nz; else this.vel.z *= 0.3;
    this.collide(p);
    if (this.blocked(p.x, p.z)) { p.x = this.pos.x; p.z = this.pos.z; }
    this.pos.x = p.x; this.pos.z = p.z;

    const ground = heightAt(this.pos.x, this.pos.z);
    if (active && k.has('Space') && this.grounded) { this.vy = 4.6; this.grounded = false; }
    if (!this.grounded) {
      this.vy -= 6.5 * dt; // a dreamer's gravity
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) { this.pos.y = ground; this.grounded = true; this.vy = 0; this.onStep(1.4); }
    } else {
      this.pos.y += (ground - this.pos.y) * Math.min(1, dt * 14);
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && this.speed > 0.3) {
      this.bob += dt * this.speed * 1.85;
      const step = Math.floor(this.bob / Math.PI);
      if (step !== this.lastStep) { this.lastStep = step; this.onStep(Math.min(1, this.speed / 4)); }
    }
    const bobAmt = Math.min(1, this.speed / 3.4) * 0.045;

    // edge turning: rest the cursor near a screen edge and the view keeps drifting that way
    if (active && this.freeLook && this.mouseIn && !this.locked) {
      const edge = (v, start) => Math.sign(v) * Math.pow(Math.max(0, (Math.abs(v) - start) / (1 - start)), 2);
      this.tYaw -= edge(this.mx, 0.72) * 1.6 * dt;
      this.tPitch = Math.max(-1.35, Math.min(1.35, this.tPitch - edge(this.my, 0.7) * 0.9 * dt));
    }

    const sm = 1 - Math.exp(-dt * 16);
    this.yaw += (this.tYaw - this.yaw) * sm;
    this.pitch += (this.tPitch - this.pitch) * sm;
    this.camera.position.set(this.pos.x, this.pos.y + EYE + Math.abs(Math.sin(this.bob)) * bobAmt, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * bobAmt * 0.12, 'YXZ');
  }
}
