/**
 * fields.js — scalar field toolkit for procedural texture synthesis.
 *
 * Everything here operates on square Float32Arrays of side `size` and is
 * TILEABLE: every lattice lookup wraps, every stamp wraps, so the resulting
 * maps repeat seamlessly. Nothing allocates inside a hot loop.
 *
 * The fBm is built as a resolution pyramid (white noise -> cubic B-spline
 * upsample -> add next octave) rather than by evaluating N octaves per pixel.
 * That makes a 6-octave 1024^2 field cost ~1.3x the pixel count instead of 6x,
 * which is the difference between a 2-second and a 20-second level load.
 */

// ---------------------------------------------------------------------------
// RNG
// ---------------------------------------------------------------------------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// basic buffers
// ---------------------------------------------------------------------------
export function field(size, v = 0) {
  const f = new Float32Array(size * size);
  if (v !== 0) f.fill(v);
  return f;
}

function whiteNoise(res, seed) {
  const out = new Float32Array(res * res);
  for (let y = 0, i = 0; y < res; y++) for (let x = 0; x < res; x++, i++) out[i] = hash2(x, y, seed);
  return out;
}

/** Cubic B-spline 2x upsample, separable, wrapping. res -> res*2 */
function upsample2(src, res) {
  const w2 = res * 2;
  const tmp = new Float32Array(w2 * res);
  for (let y = 0; y < res; y++) {
    const ro = y * res, so = y * w2;
    for (let x = 0; x < res; x++) {
      const a = src[ro + (x === 0 ? res - 1 : x - 1)];
      const b = src[ro + x];
      const c = src[ro + (x === res - 1 ? 0 : x + 1)];
      tmp[so + 2 * x] = (a + 6 * b + c) * 0.125;
      tmp[so + 2 * x + 1] = (b + c) * 0.5;
    }
  }
  const out = new Float32Array(w2 * w2);
  for (let x = 0; x < w2; x++) {
    for (let y = 0; y < res; y++) {
      const a = tmp[(y === 0 ? res - 1 : y - 1) * w2 + x];
      const b = tmp[y * w2 + x];
      const c = tmp[(y === res - 1 ? 0 : y + 1) * w2 + x];
      out[(2 * y) * w2 + x] = (a + 6 * b + c) * 0.125;
      out[(2 * y + 1) * w2 + x] = (b + c) * 0.5;
    }
  }
  return out;
}

/**
 * Pyramid fBm in [0,1]. `startRes` is the resolution of the coarsest octave
 * (i.e. the largest feature size is size/startRes texels across).
 */
export function fbm(size, startRes, octaves, seed, gain = 0.5) {
  let res = Math.max(2, startRes);
  let buf = whiteNoise(res, seed);
  let amp = 1, sum = 1;
  for (let o = 1; o < octaves && res < size; o++) {
    buf = upsample2(buf, res); res *= 2;
    amp *= gain; sum += amp;
    const n = whiteNoise(res, seed + o * 7919 + 13);
    for (let i = 0; i < buf.length; i++) buf[i] += n[i] * amp;
  }
  while (res < size) { buf = upsample2(buf, res); res *= 2; }
  const inv = 1 / sum;
  for (let i = 0; i < buf.length; i++) buf[i] *= inv;
  return buf;
}

/** Ridged / filament noise — the basis for crack networks and rust fronts. */
export function ridged(src, sharp = 1) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    let r = 1 - Math.abs(src[i] * 2 - 1);
    if (sharp !== 1) r = Math.pow(r, sharp);
    out[i] = r;
  }
  return out;
}

export function bilerp(src, size, u, v) {
  let x = u * size, y = v * size;
  let x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  x0 = ((x0 % size) + size) % size; y0 = ((y0 % size) + size) % size;
  const x1 = x0 === size - 1 ? 0 : x0 + 1, y1 = y0 === size - 1 ? 0 : y0 + 1;
  const a = src[y0 * size + x0], b = src[y0 * size + x1];
  const c = src[y1 * size + x0], d = src[y1 * size + x1];
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

/** Domain-warp `src` by two offset fields. Amount is in texels. */
export function warp(src, size, wx, wy, amount) {
  const out = new Float32Array(src.length);
  const inv = 1 / size, a = amount * inv;
  for (let y = 0, i = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++, i++) {
      out[i] = bilerp(src, size, x * inv + (wx[i] - 0.5) * a * 2, v + (wy[i] - 0.5) * a * 2);
    }
  }
  return out;
}

export function blur3(src, size, passes = 1) {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(a.length);
    for (let y = 0; y < size; y++) {
      const ro = y * size;
      for (let x = 0; x < size; x++) {
        const l = a[ro + (x === 0 ? size - 1 : x - 1)];
        const c = a[ro + x];
        const r = a[ro + (x === size - 1 ? 0 : x + 1)];
        tmp[ro + x] = (l + 2 * c + r) * 0.25;
      }
    }
    const out = new Float32Array(a.length);
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const u = tmp[(y === 0 ? size - 1 : y - 1) * size + x];
        const c = tmp[y * size + x];
        const d = tmp[(y === size - 1 ? 0 : y + 1) * size + x];
        out[y * size + x] = (u + 2 * c + d) * 0.25;
      }
    }
    a = out;
  }
  return a;
}

// ---------------------------------------------------------------------------
// field maths
// ---------------------------------------------------------------------------
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;

export function remap(src, lo, hi) {
  const out = new Float32Array(src.length);
  const inv = 1 / (hi - lo);
  for (let i = 0; i < src.length; i++) out[i] = clamp01((src[i] - lo) * inv);
  return out;
}

export function mapField(src, fn) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = fn(src[i], i);
  return out;
}

export function normalize01(src) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < src.length; i++) { const v = src[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const inv = hi > lo ? 1 / (hi - lo) : 1;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = (src[i] - lo) * inv;
  return out;
}

// ---------------------------------------------------------------------------
// stamping — wrapping, bounded-cost primitives
// ---------------------------------------------------------------------------

/** Additive soft dome. cx/cy/r in texels. */
export function stampDome(dst, size, cx, cy, r, amp, power = 0.5) {
  const r2 = r * r, x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++) {
    const yy = ((y % size) + size) % size, dy = y - cy, dy2 = dy * dy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, d2 = dx * dx + dy2;
      if (d2 >= r2) continue;
      const xx = ((x % size) + size) % size;
      const t = 1 - d2 / r2;
      dst[yy * size + xx] += amp * Math.pow(t, power);
    }
  }
}

/** Multiplicative / lerp-toward soft disc, for blotches and stains. */
export function stampBlob(dst, size, cx, cy, r, target, strength, feather = 0.55) {
  const r2 = r * r, x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++) {
    const yy = ((y % size) + size) % size, dy = y - cy, dy2 = dy * dy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, d2 = dx * dx + dy2;
      if (d2 >= r2) continue;
      const xx = ((x % size) + size) % size;
      const d = Math.sqrt(d2) / r;
      const t = smoothstep(1, feather, d) * strength;
      const i = yy * size + xx;
      dst[i] += (target - dst[i]) * t;
    }
  }
}

/** Soft wrapping line segment (used for cracks, scratches, seams, streaks). */
export function stampSegment(dst, size, x0, y0, x1, y1, width, amp, mode = 'add') {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.max(1, Math.ceil(len));
  const hw = width * 0.5;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x0 + dx * t, cy = y0 + dy * t;
    const ix0 = Math.floor(cx - hw), ix1 = Math.ceil(cx + hw);
    const iy0 = Math.floor(cy - hw), iy1 = Math.ceil(cy + hw);
    for (let y = iy0; y <= iy1; y++) {
      const yy = ((y % size) + size) % size, ddy = y - cy;
      for (let x = ix0; x <= ix1; x++) {
        const ddx = x - cx, d = Math.hypot(ddx, ddy);
        if (d > hw) continue;
        const f = 1 - d / hw;
        const i = yy * size + xx_(x, size);
        if (mode === 'add') dst[i] += amp * f * f;
        else dst[i] += (amp - dst[i]) * f * f;
      }
    }
  }
}
function xx_(x, size) { return ((x % size) + size) % size; }

/**
 * Random-walk crack with branching. Produces the filamentary, tapering,
 * direction-persistent lines that real concrete failures make — thresholded
 * noise gives blobby "cracks" that always read as fake.
 */
export function stampCrack(dst, size, rnd, opts = {}) {
  const {
    x = rnd() * size, y = rnd() * size,
    dir = rnd() * Math.PI * 2,
    length = size * 0.4,
    width = 2.2,
    amp = -1,
    wander = 0.24,
    branch = 0.5,
    depth = 0,
  } = opts;
  let cx = x, cy = y, a = dir;
  const seg = 6;
  const n = Math.max(1, Math.floor(length / seg));
  for (let i = 0; i < n; i++) {
    a += (rnd() - 0.5) * wander;
    const nx = cx + Math.cos(a) * seg, ny = cy + Math.sin(a) * seg;
    const taper = 1 - i / n;
    stampSegment(dst, size, cx, cy, nx, ny, Math.max(0.8, width * (0.35 + 0.65 * taper)), amp * (0.4 + 0.6 * taper));
    cx = nx; cy = ny;
    if (depth < 2 && rnd() < branch / n * 3) {
      stampCrack(dst, size, rnd, {
        x: cx, y: cy, dir: a + (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.6),
        length: length * (0.25 + rnd() * 0.3), width: width * 0.6, amp: amp * 0.75,
        wander, branch: branch * 0.5, depth: depth + 1,
      });
    }
  }
}

/** Vertical drip / streak, brightest at the top, fading down. Rust & dirt runs. */
export function stampStreak(dst, size, x, y, len, width, amp, dirY = 1) {
  const steps = Math.ceil(Math.abs(len));
  for (let s = 0; s < steps; s++) {
    const t = s / steps;
    const fade = (1 - t) * (1 - t);
    const w = width * (0.6 + 0.4 * (1 - t));
    const cy = y + dirY * s;
    const cx = x + Math.sin(s * 0.07 + x) * width * 0.35;
    const ix0 = Math.floor(cx - w), ix1 = Math.ceil(cx + w);
    const yy = ((Math.round(cy) % size) + size) % size;
    for (let ix = ix0; ix <= ix1; ix++) {
      const d = Math.abs(ix - cx) / w;
      if (d > 1) continue;
      const f = (1 - d * d) * fade;
      const i = yy * size + xx_(ix, size);
      dst[i] += (amp - dst[i]) * f;
    }
  }
}

// ---------------------------------------------------------------------------
// packing to bytes
// ---------------------------------------------------------------------------

/** Sobel a height field (metres) into a tangent-space normal RGBA byte array. */
export function normalFromHeight(height, size, heightMetres, tileMetres) {
  const out = new Uint8Array(size * size * 4);
  // texel footprint in metres; gradient scale so bump slope is physical
  const texel = tileMetres / size;
  const k = heightMetres / (8 * texel);
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size, yc = y * size, yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const h00 = height[ym + xm], h10 = height[ym + x], h20 = height[ym + xp];
      const h01 = height[yc + xm], h21 = height[yc + xp];
      const h02 = height[yp + xm], h12 = height[yp + x], h22 = height[yp + xp];
      const gx = (h20 + 2 * h21 + h22) - (h00 + 2 * h01 + h02);
      const gy = (h02 + 2 * h12 + h22) - (h00 + 2 * h10 + h20);
      let nx = -gx * k, ny = -gy * k, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (yc + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = nz * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Cheap cavity/AO from a height field: how much lower a texel is than the
 * blurred neighbourhood. Darkens crack interiors, mortar joints, panel seams —
 * exactly where dirt and shadow actually collect.
 */
export function aoFromHeight(height, size, radius = 12, strength = 1) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < height.length; i++) { const v = height[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const range = hi - lo || 1;
  const passes = Math.max(1, Math.round(Math.log2(radius)));
  const wide = blur3(height, size, passes * 2);
  const out = new Float32Array(height.length);
  for (let i = 0; i < height.length; i++) {
    const d = (height[i] - wide[i]) / range;
    out[i] = clamp01(1 + d * 5 * strength);
  }
  return out;
}

export function packRGB(r, g, b, size, srgbSafe = true) {
  const n = size * size;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    out[j] = clamp01(r[i]) * 255;
    out[j + 1] = clamp01(g[i]) * 255;
    out[j + 2] = clamp01(b[i]) * 255;
    out[j + 3] = 255;
  }
  return out;
}
