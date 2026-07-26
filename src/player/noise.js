/**
 * Deterministic gradient (Perlin) noise.
 *
 * WHY THIS AND NOT Math.random(): camera shake driven by per-frame random
 * numbers is white noise — it reads as a broken monitor, not as a physical
 * disturbance, and its appearance changes with framerate because each frame
 * draws an independent sample. Gradient noise sampled along *time* is
 * continuous, band-limited, and framerate-independent: the same shake looks the
 * same at 30fps and 240fps. Layering octaves gives the sharp-onset/rolling-tail
 * character of a real recoil impulse.
 */

const PERM = new Uint8Array(512);
(function seed() {
  // xorshift so the table is identical on every machine and every run.
  let s = 0x9e3779b9;
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient in [-1,1] at an integer lattice point. */
function grad1(hash) {
  return ((hash & 15) / 7.5) - 1;
}

/** 1-D Perlin noise, output roughly in [-1,1]. */
export function perlin1(x) {
  const xi = Math.floor(x);
  const xf = x - xi;
  const i = xi & 255;
  const g0 = grad1(PERM[i]);
  const g1 = grad1(PERM[i + 1]);
  const u = fade(xf);
  const a = g0 * xf;
  const b = g1 * (xf - 1);
  return (a + u * (b - a)) * 2.0;
}

/**
 * Fractal Brownian motion over 1-D Perlin. `octaves` layers at increasing
 * frequency and decreasing amplitude — 3 is the sweet spot for shake: one slow
 * roll, one mid, one fine chatter.
 */
export function fbm1(x, octaves = 3, lacunarity = 2.17, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += perlin1(x * freq) * amp;
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

const GRAD_COS = new Float32Array(8);
const GRAD_SIN = new Float32Array(8);
for (let i = 0; i < 8; i++) {
  const a = (i * Math.PI) / 4;
  GRAD_COS[i] = Math.cos(a);
  GRAD_SIN[i] = Math.sin(a);
}

/**
 * 2-D Perlin noise on a lattice that wraps every `period` units, so sampling
 * u,v in [0,period) produces a seamlessly tiling texture. Used to author the
 * weapon's detail normal / roughness maps at runtime (no texture assets).
 */
export function perlin2(x, y, period = 256) {
  const xi0 = Math.floor(x), yi0 = Math.floor(y);
  const xf = x - xi0, yf = y - yi0;
  const wrap = (v) => ((v % period) + period) % period;
  const xa = wrap(xi0) & 255, xb = wrap(xi0 + 1) & 255;
  const ya = wrap(yi0) & 255, yb = wrap(yi0 + 1) & 255;
  const u = fade(xf), v = fade(yf);

  const g = (h, dx, dy) => GRAD_COS[h & 7] * dx + GRAD_SIN[h & 7] * dy;
  const aa = PERM[PERM[xa] + ya], ba = PERM[PERM[xb] + ya];
  const ab = PERM[PERM[xa] + yb], bb = PERM[PERM[xb] + yb];

  const n00 = g(aa, xf, yf), n10 = g(ba, xf - 1, yf);
  const n01 = g(ab, xf, yf - 1), n11 = g(bb, xf - 1, yf - 1);
  const x1 = n00 + u * (n10 - n00);
  const x2 = n01 + u * (n11 - n01);
  return (x1 + v * (x2 - x1)) * 1.4;
}

/**
 * Tiling fbm. `period` is the lattice period of the base octave in the same
 * units as x/y; every octave doubles it so the whole stack tiles together.
 */
export function fbm2Tiling(x, y, period, octaves = 4, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += perlin2(x * f, y * f, period * f) * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}
