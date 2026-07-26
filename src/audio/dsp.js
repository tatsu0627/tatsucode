/**
 * DSP PRIMITIVES — buffers, envelopes and impulse responses.
 *
 * Everything in this engine is synthesised at runtime; there are no audio files.
 * That is a constraint, not a compromise: it means every shot can be a different
 * shot, which is the difference between a gun that sounds like a gun and a gun
 * that sounds like a WAV being retriggered.
 */

const bufferCache = new Map();

/** Deterministic-ish PRNG so a "variant" is reproducible when we want it. */
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cached noise buffers. Pink and brown are integrated white noise — brown has
 * the -6 dB/oct slope that reads as "air" and "rumble"; white is far too bright
 * to use raw for anything but a transient.
 */
export function noiseBuffer(ctx, seconds = 2, type = 'white') {
  const key = `${type}:${seconds}:${ctx.sampleRate}`;
  const hit = bufferCache.get(key);
  if (hit) return hit;

  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    if (type === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else if (type === 'pink') {
      // Paul Kellet's economical pink filter.
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else { // brown
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
  }
  bufferCache.set(key, buf);
  return buf;
}

/**
 * Impulse response generator.
 *
 * A convolver fed with plain exponential noise gives you "a reverb". What sells
 * an outdoor gunshot is the *discrete* early reflections — the crack coming back
 * off a wall 20 metres away as an identifiable slap, not a wash. So the IR is
 * built as: sparse deterministic taps + a diffuse decaying noise tail, damped
 * with a one-pole so the tail darkens as it decays like real air does.
 */
export function makeIR(ctx, {
  duration = 2.0,
  decay = 2.4,          // higher = faster decay
  preDelay = 0.008,
  taps = [],            // [{t, gain, pan}] discrete early reflections
  damping = 0.35,       // 0 = bright, 1 = very dark tail
  diffuse = 1.0,        // level of the noise tail
  seed = 1337,
} = {}) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * duration));
  const buf = ctx.createBuffer(2, len, sr);
  const rnd = mulberry(seed);
  const pre = Math.floor(preDelay * sr);
  const coef = 1 - Math.pow(damping, 0.35) * 0.92;

  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.pow(1 - (i - pre) / (len - pre), 1.2) * Math.exp(-decay * t);
      const w = rnd() * 2 - 1;
      lp += coef * (w - lp);
      d[i] = lp * env * diffuse;
    }
    // Discrete taps sit on top: a few samples of shaped noise each, so they
    // read as a distinct slap rather than a click.
    for (const tap of taps) {
      const at = Math.floor((tap.t + preDelay) * sr);
      if (at >= len) continue;
      const panGain = ch === 0 ? 1 - Math.max(0, tap.pan || 0)
                               : 1 + Math.min(0, tap.pan || 0);
      const n = Math.floor(sr * 0.004);
      let tlp = 0;
      for (let k = 0; k < n && at + k < len; k++) {
        const w = rnd() * 2 - 1;
        tlp += 0.45 * (w - tlp);
        d[at + k] += tlp * tap.gain * panGain * Math.pow(1 - k / n, 1.5);
      }
    }
  }
  return buf;
}

/** The three environments. Swapped by audio.setEnvironment(). */
export function environmentIR(ctx, name) {
  switch (name) {
    case 'indoor':
      // Tight, dark, dense. Small concrete room, low ceiling.
      return makeIR(ctx, {
        duration: 0.62, decay: 7.5, preDelay: 0.004, damping: 0.62, diffuse: 0.85,
        taps: [
          { t: 0.008, gain: 0.55, pan: -0.6 }, { t: 0.013, gain: 0.48, pan: 0.5 },
          { t: 0.021, gain: 0.40, pan: 0.2 }, { t: 0.029, gain: 0.32, pan: -0.3 },
          { t: 0.038, gain: 0.24, pan: 0.7 }, { t: 0.051, gain: 0.18, pan: -0.2 },
        ], seed: 7717,
      });

    case 'tunnel': {
      // Flutter echo: regular taps between two parallel walls, band-limited.
      const taps = [];
      for (let i = 1; i <= 16; i++) {
        taps.push({ t: i * 0.029, gain: 0.62 * Math.pow(0.80, i), pan: i % 2 ? -0.75 : 0.75 });
      }
      return makeIR(ctx, {
        duration: 1.9, decay: 2.6, preDelay: 0.006, damping: 0.70, diffuse: 0.75,
        taps, seed: 4242,
      });
    }

    case 'outdoor':
    default:
      // Long slap-back off compound walls, then a thin diffuse desert tail.
      // The wide, late, slightly stereo-offset slaps are what make an outdoor
      // rifle sound big instead of dry.
      return makeIR(ctx, {
        duration: 2.6, decay: 2.15, preDelay: 0.012, damping: 0.30, diffuse: 0.42,
        taps: [
          { t: 0.041, gain: 0.42, pan: -0.7 }, { t: 0.062, gain: 0.34, pan: 0.55 },
          { t: 0.089, gain: 0.30, pan: 0.15 }, { t: 0.118, gain: 0.26, pan: -0.45 },
          { t: 0.157, gain: 0.22, pan: 0.65 }, { t: 0.203, gain: 0.17, pan: -0.25 },
          { t: 0.268, gain: 0.13, pan: 0.35 }, { t: 0.341, gain: 0.10, pan: -0.55 },
          { t: 0.437, gain: 0.075, pan: 0.20 }, { t: 0.566, gain: 0.05, pan: -0.15 },
        ], seed: 90210,
      });
  }
}

// ---------------------------------------------------------------------------
// Node helpers. All of them schedule their own teardown — a synthesised game
// with no cleanup leaks nodes until the context starves.
// ---------------------------------------------------------------------------

export function biquad(ctx, type, freq, Q = 1, gain = 0) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  if (gain) f.gain.value = gain;
  return f;
}

/**
 * Percussive envelope. `attack` in the single-millisecond range is what makes a
 * gunshot transient read as a crack rather than a thump.
 */
export function env(ctx, t, { attack = 0.001, decay = 0.1, peak = 1, hold = 0, curve = 'exp' } = {}) {
  const g = ctx.createGain();
  const p = g.gain;
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + attack);
  const s = t + attack + hold;
  if (hold) p.setValueAtTime(peak, s);
  if (curve === 'exp') p.exponentialRampToValueAtTime(Math.max(0.00001, peak * 0.0008), s + decay);
  else p.linearRampToValueAtTime(0, s + decay);
  g._end = s + decay;
  return g;
}

export function noiseSource(ctx, t, { type = 'white', rate = 1, duration = 0.5, offset = null } = {}) {
  const buf = noiseBuffer(ctx, 2, type);
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = rate;
  s.loop = true;
  const off = offset == null ? Math.random() * 1.5 : offset;
  s.start(t, off);
  s.stop(t + duration + 0.05);
  return s;
}

export function osc(ctx, t, { type = 'sine', freq = 220, duration = 0.3, detune = 0 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.start(t);
  o.stop(t + duration + 0.05);
  return o;
}

/** Exponential pitch sweep — the "thump" of a muzzle blast is a falling tone. */
export function sweep(param, t, from, to, time, shape = 'exp') {
  param.cancelScheduledValues(t);
  param.setValueAtTime(Math.max(0.0001, from), t);
  if (shape === 'exp') param.exponentialRampToValueAtTime(Math.max(0.0001, to), t + time);
  else param.linearRampToValueAtTime(to, t + time);
}

/** tanh-ish soft clipper used as the last line of defence before the DAC. */
export function softClipCurve(amount = 1.6, n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}
