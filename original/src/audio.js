// A generative soundscape: slow chords, a few twinkling notes, wind, crickets at night,
// birds by day, footsteps and rustling wheat. Everything is synthesised; no audio files.

const CHORDS = [
  [50, 57, 62, 64, 66, 69],   // D maj9
  [47, 54, 61, 62, 66],       // B m9
  [43, 50, 59, 61, 66],       // G maj7 #11
  [45, 52, 57, 59, 64],       // A sus2
  [40, 47, 54, 62, 66],       // E m9
  [43, 50, 55, 59, 64, 69],   // G 6/9
];
const PENTA = [74, 76, 78, 81, 83, 86, 88, 90];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Soundscape {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0.85, ctx.currentTime + 6);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(6, 2.4);
    const wet = ctx.createGain(); wet.gain.value = 0.85;
    this.reverb.connect(wet).connect(this.master);
    this.dry = ctx.createGain(); this.dry.gain.value = 0.6; this.dry.connect(this.master);

    this.delay = ctx.createDelay(2); this.delay.delayTime.value = 0.43;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2600;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.reverb);

    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5 * 0.6 + w * 0.4; }

    // wind bed
    const wind = ctx.createBufferSource(); wind.buffer = this.noise; wind.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 420; this.windF.Q.value = 0.7;
    this.windG = ctx.createGain(); this.windG.gain.value = 0.0;
    wind.connect(this.windF).connect(this.windG); this.windG.connect(this.dry); this.windG.connect(this.reverb);
    wind.start();
    // wheat rustle
    const rus = ctx.createBufferSource(); rus.buffer = this.noise; rus.loop = true; rus.playbackRate.value = 1.7;
    const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 2400;
    this.rusG = ctx.createGain(); this.rusG.gain.value = 0;
    rus.connect(rf).connect(this.rusG).connect(this.dry); rus.start();

    this.nextChord = ctx.currentTime + 0.3; this.ci = 0;
    this.nextTw = ctx.currentTime + 4; this.nextCr = ctx.currentTime + 1; this.nextBird = ctx.currentTime + 3;
  }

  impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return buf;
  }

  pad(notes, when, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + 4);
    env.gain.setValueAtTime(1, when + dur - 5);
    env.gain.linearRampToValueAtTime(0, when + dur + 1);
    lp.connect(env); env.connect(this.reverb); env.connect(this.dry);
    for (const n of notes) {
      for (const [type, det, g] of [['sine', 0, 0.035], ['triangle', 7, 0.012], ['sine', -6, 0.022]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(n); o.detune.value = det + (Math.random() - 0.5) * 4;
        const gg = ctx.createGain(); gg.gain.value = g * (n < 48 ? 1.3 : 1);
        o.connect(gg).connect(lp); o.start(when); o.stop(when + dur + 1.5);
      }
    }
  }

  twinkle(when, note, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(note);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = mtof(note) * 2.01;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, when + 3.2);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2).connect(g);
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.4;
    g.connect(pan); pan.connect(this.delay); pan.connect(this.reverb); pan.connect(this.dry);
    o.start(when); o2.start(when); o.stop(when + 3.4); o2.stop(when + 3.4);
  }

  cricket(when, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.frequency.value = 4300 + Math.random() * 600;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.8;
    o.connect(g).connect(pan); pan.connect(this.dry); pan.connect(this.reverb);
    const pulses = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < pulses; k++) {
      const t = when + k * 0.07;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012); g.gain.linearRampToValueAtTime(0, t + 0.045);
    }
    o.start(when); o.stop(when + pulses * 0.07 + 0.05);
  }

  bird(when, vol) {
    const ctx = this.ctx;
    const n = 2 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner(); pan.pan.value = (Math.random() - 0.5) * 1.6;
    pan.connect(this.dry); pan.connect(this.reverb);
    const base = 2200 + Math.random() * 1600;
    for (let k = 0; k < n; k++) {
      const t = when + k * (0.1 + Math.random() * 0.06);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t + 0.06);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(g).connect(pan); o.start(t); o.stop(t + 0.1);
    }
  }

  step(amt) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.6 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700 + Math.random() * 500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16 * amt, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.connect(f).connect(g).connect(this.dry);
    s.start(t, Math.random() * 3, 0.2);
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.4);
  }

  update(st) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    if (t > this.nextChord - 0.2) {
      const ch = CHORDS[this.ci++ % CHORDS.length];
      this.pad(ch, this.nextChord, 14);
      this.nextChord += 11 - st.dream * 3;
    }
    if (t > this.nextTw) {
      const n = 1 + (Math.random() < 0.35 ? 1 : 0) + (st.dream > 0.5 ? 2 : 0);
      for (let i = 0; i < n; i++) this.twinkle(t + 0.05 + i * (0.21 + Math.random() * 0.2), PENTA[Math.floor(Math.random() * PENTA.length)], 0.05 + st.night * 0.02);
      this.nextTw = t + (2.5 + Math.random() * 6) / (0.6 + st.night * 0.6 + st.dream);
    }
    if (st.night > 0.3 && t > this.nextCr) { this.cricket(t + 0.02, 0.012 * st.night); this.nextCr = t + 0.15 + Math.random() * 0.9; }
    if (st.day > 0.3 && t > this.nextBird) { this.bird(t + 0.02, 0.025 * st.day); this.nextBird = t + 2 + Math.random() * 7; }
    this.windG.gain.setTargetAtTime(0.03 + st.wind * 0.05 + st.dream * 0.04 + st.height * 0.002, t, 0.8);
    this.windF.frequency.setTargetAtTime(300 + st.wind * 250 + Math.sin(t * 0.3) * 120, t, 0.8);
    this.rusG.gain.setTargetAtTime(st.wheat * Math.min(1, st.speed / 3) * 0.07, t, 0.15);
  }
}
