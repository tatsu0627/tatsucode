import * as THREE from 'three';
import {
  mulberry, noiseBuffer, environmentIR, biquad, env, noiseSource, osc, sweep,
  softClipCurve,
} from './dsp.js';

/**
 * Owns the WebAudio graph: procedural weapon/impact SFX, ambience, reverb.
 *
 * CONTRACT
 *   play(name, opts)     — fire-and-forget one-shot, positional if
 *                          opts.position is a Vector3.
 *   setEnvironment(name) — swaps the convolver impulse
 *                          ('outdoor' | 'indoor' | 'tunnel').
 *   Silent no-op before the first user gesture, and never throws into the
 *   frame loop.
 *
 * Every sound is synthesised; nothing is loaded. A gunshot is built from three
 * layers — a transient crack, a low body, and the mechanical action — because a
 * single noise burst reads as a click rather than as a rifle. Each shot gets
 * fresh pitch and level jitter: identical repeats are the clearest tell of
 * cheap game audio, and a rifle fires many times per second.
 *
 * Graph:
 *   source -> [panner] -> dry ------------------> master -> clip -> compressor
 *                      \-> sendGain -> convolver -/
 */
export class AudioModule {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.rand = mulberry(0xA17D10);
    this._env = 'outdoor';
    this._irs = new Map();
    this._lastStep = 0;
    this._listenerPos = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
  }

  async init(engine) {
    this.engine = engine;
    // Browsers refuse to start an AudioContext without a gesture, so arm the
    // build on the first interaction and stay a no-op until then.
    const start = () => { this._ensure(); };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  _ensure() {
    if (this.ctx || !this.enabled) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return null; }

    const ctx = this.ctx = new Ctx({ latencyHint: 'interactive' });

    // Master bus: soft clip then compress, so a firefight never hard-clips.
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.18;
    this.compressor.connect(ctx.destination);

    this.clip = ctx.createWaveShaper();
    this.clip.curve = softClipCurve(1.5);
    this.clip.oversample = '2x';
    this.clip.connect(this.compressor);

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.clip);

    // Reverb send. The tail is most of what makes gunfire sound powerful
    // outdoors — a dry shot sounds like a toy.
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this._ir(this._env);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.9;
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);

    this.send = ctx.createGain();
    this.send.gain.value = 0.42;
    this.send.connect(this.convolver);

    this._noise = noiseBuffer(ctx, 2, 'white');
    this._startAmbience();
    return ctx;
  }

  _ir(name) {
    if (!this._irs.has(name)) this._irs.set(name, environmentIR(this.ctx, name));
    return this._irs.get(name);
  }

  setEnvironment(name) {
    this._env = name;
    if (this.ctx && this.convolver) this.convolver.buffer = this._ir(name);
  }

  /** Wind bed: filtered noise with a slowly wandering cutoff. */
  _startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;

    const lp = biquad(ctx, 'lowpass', 420, 0.7);
    const hp = biquad(ctx, 'highpass', 90, 0.7);
    const g = ctx.createGain();
    g.gain.value = 0.055;

    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.master);
    src.start();

    // A wandering cutoff keeps a looped buffer from revealing its period.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();

    this._ambience = { src, g };
  }

  /** Build the per-voice output path, positional when a position is given. */
  _out(position) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    if (position) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.maxDistance = 220;
      p.rolloffFactor = 1.1;
      if (p.positionX) {
        p.positionX.value = position.x; p.positionY.value = position.y; p.positionZ.value = position.z;
      } else {
        p.setPosition(position.x, position.y, position.z);
      }
      g.connect(p);
      p.connect(this.master);
      p.connect(this.send);
    } else {
      g.connect(this.master);
      g.connect(this.send);
    }
    return g;
  }

  play(name, opts = {}) {
    const ctx = this._ensure();
    if (!ctx || ctx.state === 'suspended') return;
    try {
      const t = ctx.currentTime;
      const out = this._out(opts.position);
      switch (name) {
        case 'fire': this._fire(t, out); break;
        case 'reload': this._reload(t, out); break;
        case 'impact': this._impact(t, out, opts.surface); break;
        case 'hitmarker': this._hitmarker(t, out); break;
        case 'step': this._step(t, out); break;
        case 'casing': this._casing(t, out); break;
        default: break;
      }
    } catch {
      // Audio must never take down the frame loop.
    }
  }

  /**
   * Rifle shot: crack + body + action, with per-shot variation so a burst never
   * sounds like the same sample repeated.
   */
  _fire(t, out) {
    const ctx = this.ctx;
    const j = 1 + (this.rand() - 0.5) * 0.14;     // pitch jitter
    const lvl = 0.85 + this.rand() * 0.3;

    // 1. Transient crack — very short, very bright.
    const crack = noiseSource(ctx, t, { duration: 0.16, rate: j });
    const crackHp = biquad(ctx, 'highpass', 1700 * j, 0.6);
    const crackPk = biquad(ctx, 'peaking', 3600 * j, 1.1, 7);
    const crackG = env(ctx, t, { attack: 0.0006, decay: 0.075, peak: 0.95 * lvl });
    crack.connect(crackHp); crackHp.connect(crackPk); crackPk.connect(crackG); crackG.connect(out);

    // 2. Body — low-passed noise plus a falling tone for the chest thump.
    const body = noiseSource(ctx, t, { duration: 0.3, rate: j * 0.9 });
    const bodyLp = biquad(ctx, 'lowpass', 900 * j, 1.0);
    const bodyG = env(ctx, t, { attack: 0.002, decay: 0.19, peak: 0.75 * lvl });
    body.connect(bodyLp); bodyLp.connect(bodyG); bodyG.connect(out);

    const thump = osc(ctx, t, { type: 'sine', freq: 132 * j, duration: 0.2 });
    sweep(thump.frequency, t, 132 * j, 58, 0.14);
    const thumpG = env(ctx, t, { attack: 0.001, decay: 0.13, peak: 0.5 * lvl });
    thump.connect(thumpG); thumpG.connect(out);

    // 3. Mechanical action, slightly delayed — the bolt does not move instantly.
    const act = noiseSource(ctx, t + 0.012, { duration: 0.1, rate: 1.6 });
    const actBp = biquad(ctx, 'bandpass', 2600, 3.5);
    const actG = env(ctx, t + 0.012, { attack: 0.001, decay: 0.055, peak: 0.16 });
    act.connect(actBp); actBp.connect(actG); actG.connect(out);
  }

  _reload(t, out) {
    const ctx = this.ctx;
    // Magazine release, mag out, mag in, charging handle — spread over the same
    // window the viewmodel animation uses.
    const clicks = [
      [0.00, 3200, 0.05, 0.20], [0.28, 1500, 0.08, 0.16],
      [0.95, 1800, 0.09, 0.22], [1.35, 2400, 0.06, 0.20],
      [1.90, 2900, 0.10, 0.26],
    ];
    for (const [dt, freq, dur, peak] of clicks) {
      const n = noiseSource(ctx, t + dt, { duration: dur + 0.05, rate: 1 });
      const bp = biquad(ctx, 'bandpass', freq * (0.9 + this.rand() * 0.2), 4.0);
      const g = env(ctx, t + dt, { attack: 0.001, decay: dur, peak });
      n.connect(bp); bp.connect(g); g.connect(out);
    }
  }

  _impact(t, out, surface = 'concrete') {
    const ctx = this.ctx;
    const tone = surface === 'metal' ? 3400 : surface === 'wood' ? 1200 : 700;
    const q = surface === 'metal' ? 6 : 1.4;
    const n = noiseSource(ctx, t, { duration: 0.22, rate: 0.9 + this.rand() * 0.3 });
    const f = biquad(ctx, surface === 'metal' ? 'bandpass' : 'lowpass', tone, q);
    const g = env(ctx, t, { attack: 0.0008, decay: surface === 'metal' ? 0.16 : 0.07, peak: 0.4 });
    n.connect(f); f.connect(g); g.connect(out);
  }

  _hitmarker(t, out) {
    const ctx = this.ctx;
    const o = osc(ctx, t, { type: 'square', freq: 1750, duration: 0.05 });
    const g = env(ctx, t, { attack: 0.0005, decay: 0.035, peak: 0.11 });
    o.connect(g); g.connect(out);
  }

  _step(t, out) {
    const ctx = this.ctx;
    const n = noiseSource(ctx, t, { duration: 0.14, rate: 0.8 + this.rand() * 0.4 });
    const lp = biquad(ctx, 'lowpass', 900 + this.rand() * 500, 0.9);
    const g = env(ctx, t, { attack: 0.002, decay: 0.06, peak: 0.09 });
    n.connect(lp); lp.connect(g); g.connect(out);
  }

  _casing(t, out) {
    const ctx = this.ctx;
    for (let i = 0; i < 2; i++) {
      const d = i * (0.08 + this.rand() * 0.05);
      const o = osc(ctx, t + d, { type: 'triangle', freq: 2600 + this.rand() * 1400, duration: 0.09 });
      const g = env(ctx, t + d, { attack: 0.0005, decay: 0.06, peak: 0.05 / (i + 1) });
      o.connect(g); g.connect(out);
    }
  }

  update(dt, engine) {
    const ctx = this.ctx;
    if (!ctx || !engine) return;

    // Keep the listener on the camera so panning and distance are correct.
    const cam = engine.camera;
    cam.getWorldPosition(this._listenerPos);
    cam.getWorldDirection(this._fwd);
    this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);

    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = this._listenerPos.x;
      L.positionY.value = this._listenerPos.y;
      L.positionZ.value = this._listenerPos.z;
      L.forwardX.value = this._fwd.x; L.forwardY.value = this._fwd.y; L.forwardZ.value = this._fwd.z;
      L.upX.value = this._up.x; L.upY.value = this._up.y; L.upZ.value = this._up.z;
    } else {
      L.setPosition(this._listenerPos.x, this._listenerPos.y, this._listenerPos.z);
      L.setOrientation(this._fwd.x, this._fwd.y, this._fwd.z, this._up.x, this._up.y, this._up.z);
    }

    // Footsteps, driven by the player's gait rather than a timer.
    const p = engine.modules.get('player');
    const st = p?.state;
    if (st?.onGround && (st.speed ?? 0) > 1.2) {
      const interval = Math.max(0.28, 0.62 - st.speed * 0.045);
      this._lastStep += dt;
      if (this._lastStep >= interval) {
        this._lastStep = 0;
        this.play('step');
      }
    } else {
      this._lastStep = 999;   // land the next step immediately on moving off
    }
  }
}
