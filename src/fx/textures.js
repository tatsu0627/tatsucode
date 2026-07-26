import * as THREE from 'three';

/**
 * Procedural VFX textures.
 *
 * Every texture used by the FX module is generated here at boot from typed
 * arrays — no external assets, no network fetch, deterministic across runs so
 * screenshots are comparable frame to frame.
 *
 * Channel conventions (documented per generator):
 *   smoke/dust  RGB = tangent-space bump normal of the density field, A = density
 *   spark/fire  RGB = white, A = intensity mask
 *   decals      R = hole/dark mask, G = crater height, B = rim/dust mask, A = coverage
 */

// --- deterministic value noise ---------------------------------------------

function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function fbm(x, y, octaves, seed, lacunarity = 2.03, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 71);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

function makeTexture(data, size, { srgb = false, wrap = THREE.ClampToEdgeWrapping } = {}) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = wrap;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Bake a tangent-space normal map from a scalar height field (Sobel).
function bakeNormals(out, height, size, strength) {
  const at = (x, y) => height[Math.min(size - 1, Math.max(0, x)) + Math.min(size - 1, Math.max(0, y)) * size];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const i = (x + y * size) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
    }
  }
}

// ---------------------------------------------------------------------------
// SMOKE / DUST — soft eroded puff. Baked bump normals let the shader light the
// interior of the puff instead of returning a flat lambert disc, which is most
// of the difference between "volume" and "grey card".
// ---------------------------------------------------------------------------
export function puffTexture(size = 128, { octaves = 5, erosion = 0.42, seed = 17, sharpness = 1.35 } = {}) {
  const data = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv * 2 - 1;
      const v = (y + 0.5) * inv * 2 - 1;
      const r = Math.hypot(u, v);
      // Soft sphere falloff, then eroded by fbm so the silhouette is ragged.
      let d = Math.max(0, 1 - r);
      d = Math.pow(d, sharpness);
      const n = fbm(x * inv * 4.0, y * inv * 4.0, octaves, seed);
      d *= 1 - erosion + erosion * (n * 1.7);
      // Kill anything outside the disc so mip bleeding never squares it off.
      d *= Math.max(0, 1 - Math.pow(r, 3.0));
      d = Math.max(0, Math.min(1, d));
      height[x + y * size] = d;
    }
  }
  bakeNormals(data, height, size, 2.6);
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = height[i] * 255;
  return makeTexture(data, size);
}

// ---------------------------------------------------------------------------
// SPARK — a hot core with a soft halo. The quad is stretched along velocity by
// the shader, so the texture itself stays round.
// ---------------------------------------------------------------------------
export function sparkTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv * 2 - 1;
      const v = (y + 0.5) * inv * 2 - 1;
      const r = Math.min(1, Math.hypot(u, v));
      const core = Math.pow(Math.max(0, 1 - r * 1.9), 4.0);
      const halo = Math.pow(Math.max(0, 1 - r), 2.2) * 0.55;
      const a = Math.min(1, core + halo);
      const i = (x + y * size) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      data[i + 3] = a * 255;
    }
  }
  return makeTexture(data, size);
}

// ---------------------------------------------------------------------------
// FLASH — multi-lobed muzzle star: a hot core, a handful of asymmetric petals
// and thin needles. Random per-instance roll hides the repetition.
// ---------------------------------------------------------------------------
export function flashTexture(size = 128, seed = 5) {
  const data = new Uint8Array(size * size * 4);
  const inv = 1 / size;
  const lobes = 5;
  const phase = [];
  for (let i = 0; i < lobes; i++) phase.push(hash2(i, seed, 3) * Math.PI * 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv * 2 - 1;
      const v = (y + 0.5) * inv * 2 - 1;
      const r = Math.hypot(u, v);
      const th = Math.atan2(v, u);
      let petal = 0;
      for (let i = 0; i < lobes; i++) {
        const w = 0.55 + 0.45 * hash2(i, seed + 9, 11);
        petal = Math.max(petal, Math.pow(Math.max(0, Math.cos(th - phase[i])), 14) * w);
      }
      const star = petal * Math.pow(Math.max(0, 1 - r), 2.4);
      const needles = Math.pow(Math.max(0, Math.abs(Math.cos((th - phase[0]) * 2))), 60) *
                      Math.pow(Math.max(0, 1 - r), 1.1) * 0.6;
      const core = Math.pow(Math.max(0, 1 - r * 2.6), 3.0);
      const a = Math.min(1, core + star * 0.85 + needles);
      const i2 = (x + y * size) * 4;
      data[i2] = 255; data[i2 + 1] = 255; data[i2 + 2] = 255;
      data[i2 + 3] = a * 255;
    }
  }
  return makeTexture(data, size);
}

// ---------------------------------------------------------------------------
// FIRE RAMP — 1D lifetime gradient sampled by the fireball. White-hot core to
// soot. Values are HDR-scaled in the shader so the head blooms.
// ---------------------------------------------------------------------------
export function rampTexture(stops) {
  const w = 64;
  const data = new Uint8Array(w * 4);
  for (let i = 0; i < w; i++) {
    const t = i / (w - 1);
    let a = stops[0], b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) { a = stops[s]; b = stops[s + 1]; break; }
    }
    const f = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
    data[i * 4 + 0] = (a[1] + (b[1] - a[1]) * f) * 255;
    data[i * 4 + 1] = (a[2] + (b[2] - a[2]) * f) * 255;
    data[i * 4 + 2] = (a[3] + (b[3] - a[3]) * f) * 255;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// BULLET HOLE ATLAS — 2x2 variants.
//   R = hole darkness (the punched void)
//   G = crater height, used to derive a bump normal in the decal shader so the
//       hole lip catches the sun instead of reading as a printed sticker
//   B = rim spall / dust ring
//   A = coverage
// ---------------------------------------------------------------------------
export function bulletHoleAtlas(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const cell = size / 2;
  const heights = new Float32Array(size * size);
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const seed = 41 + (cx + cy * 2) * 137;
      const holeR = 0.16 + hash2(cx, cy, seed) * 0.06;
      const spikes = 6 + Math.floor(hash2(cx, cy, seed + 3) * 5);
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const u = (x + 0.5) / cell * 2 - 1;
          const v = (y + 0.5) / cell * 2 - 1;
          const r = Math.hypot(u, v);
          const th = Math.atan2(v, u);
          // Chipped outline: radius modulated by angular noise + radial spikes.
          const wob = 1 + 0.34 * (valueNoise(Math.cos(th) * 3 + 8, Math.sin(th) * 3 + 8, seed) - 0.5)
                        + 0.16 * Math.cos(th * spikes + seed);
          const hr = holeR * wob;
          const hole = 1 - smooth(Math.min(1, Math.max(0, (r - hr * 0.55) / (hr * 0.85))));
          // Spall ring: cracked dust halo, noisy and clearly not a clean circle.
          const ringN = fbm(Math.cos(th) * 2.6 + 3, Math.sin(th) * 2.6 + 3, 4, seed + 21);
          const ringR = hr * (2.1 + ringN * 2.4);
          let rim = Math.exp(-Math.pow((r - hr * 1.25) / (ringR * 0.75), 2.0));
          rim *= 0.35 + 0.65 * fbm(u * 4 + 5, v * 4 + 5, 4, seed + 55);
          // Radial cracks.
          const crack = Math.pow(Math.max(0, Math.cos(th * spikes * 0.5 + seed * 0.7)), 28) *
                        Math.max(0, 1 - r / (hr * 4.5)) * 0.7;
          const cov = Math.min(1, hole + rim * 0.9 + crack);
          // Crater height: a depression at the hole, a raised lip around it.
          const lip = Math.exp(-Math.pow((r - hr * 1.15) / (hr * 0.6), 2.0)) * 0.55;
          const h = Math.max(0, lip - hole * 0.9) + 0.5;
          const px = cx * cell + x, py = cy * cell + y;
          const i = (px + py * size) * 4;
          data[i + 0] = Math.min(255, hole * 255);
          data[i + 2] = Math.min(255, (rim * 0.85 + crack) * 255);
          data[i + 3] = Math.min(255, cov * 255) * (r < 0.98 ? 1 : 0);
          heights[px + py * size] = h;
        }
      }
    }
  }
  // G channel keeps the raw height; the shader differences it for the bump.
  for (let i = 0; i < size * size; i++) data[i * 4 + 1] = Math.min(255, heights[i] * 255);
  const tex = makeTexture(data, size);
  // Mips across atlas cell borders bleed; two levels is a safe compromise.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// ---------------------------------------------------------------------------
// BLOOD DECAL ATLAS — 2x2 splatters with satellite droplets.
// ---------------------------------------------------------------------------
export function bloodAtlas(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const cell = size / 2;
  for (let cy = 0; cy < 2; cy++) {
    for (let cx = 0; cx < 2; cx++) {
      const seed = 900 + (cx + cy * 2) * 313;
      // Precompute satellite droplets so the splat is not a single blob.
      const drops = [];
      for (let d = 0; d < 26; d++) {
        const a = hash2(d, seed, 7) * Math.PI * 2;
        const rr = 0.22 + Math.pow(hash2(d, seed + 4, 9), 0.6) * 0.66;
        drops.push([Math.cos(a) * rr, Math.sin(a) * rr, 0.015 + hash2(d, seed + 8, 5) * 0.055]);
      }
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const u = (x + 0.5) / cell * 2 - 1;
          const v = (y + 0.5) / cell * 2 - 1;
          const r = Math.hypot(u, v);
          const th = Math.atan2(v, u);
          const wob = 0.30 + 0.16 * fbm(Math.cos(th) * 2 + 2, Math.sin(th) * 2 + 2, 4, seed);
          let cov = 1 - smooth(Math.min(1, Math.max(0, (r - wob * 0.7) / (wob * 0.8))));
          for (let d = 0; d < drops.length; d++) {
            const dd = Math.hypot(u - drops[d][0], v - drops[d][1]);
            cov = Math.max(cov, 1 - smooth(Math.min(1, dd / drops[d][2])));
          }
          cov *= Math.max(0, 1 - Math.pow(r, 4));
          const i = (cx * cell + x + (cy * cell + y) * size) * 4;
          data[i + 0] = 255 * Math.min(1, cov * 1.2);   // core mask
          data[i + 1] = 255 * 0.5;
          data[i + 2] = 255 * Math.min(1, cov * 0.6);
          data[i + 3] = Math.min(255, cov * 255);
        }
      }
    }
  }
  return makeTexture(data, size);
}

// ---------------------------------------------------------------------------
// SCORCH — explosion ground mark.
// ---------------------------------------------------------------------------
export function scorchTexture(size = 128, seed = 313) {
  const data = new Uint8Array(size * size * 4);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv * 2 - 1;
      const v = (y + 0.5) * inv * 2 - 1;
      const r = Math.hypot(u, v);
      const th = Math.atan2(v, u);
      const wob = 0.62 + 0.22 * fbm(Math.cos(th) * 2.2 + 4, Math.sin(th) * 2.2 + 4, 4, seed);
      let cov = 1 - smooth(Math.min(1, Math.max(0, (r - wob * 0.35) / (wob * 0.8))));
      cov *= 0.45 + 0.55 * fbm(u * 3.4 + 11, v * 3.4 + 11, 5, seed + 3);
      // Radial streaks flung outward from the seat of the blast.
      const streak = Math.pow(Math.max(0, Math.cos(th * 9 + seed)), 6) * Math.max(0, 1 - Math.abs(r - 0.55) / 0.42);
      cov = Math.min(1, cov + streak * 0.35);
      cov *= Math.max(0, 1 - Math.pow(r, 3));
      const i = (x + y * size) * 4;
      data[i + 0] = 255 * cov;   // darkness
      data[i + 1] = 128;
      data[i + 2] = 255 * cov * 0.25;
      data[i + 3] = Math.min(255, cov * 235);
    }
  }
  return makeTexture(data, size);
}

// ---------------------------------------------------------------------------
// GLASS CRACK — radial fracture web for glass impacts.
// ---------------------------------------------------------------------------
export function glassCrackTexture(size = 192, seed = 77) {
  const data = new Uint8Array(size * size * 4);
  const inv = 1 / size;
  const N = 11;
  const dirs = [];
  for (let i = 0; i < N; i++) {
    dirs.push(i / N * Math.PI * 2 + hash2(i, seed, 3) * 0.35);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv * 2 - 1;
      const v = (y + 0.5) * inv * 2 - 1;
      const r = Math.hypot(u, v);
      const th = Math.atan2(v, u);
      let c = 0;
      for (let i = 0; i < N; i++) {
        let da = th - dirs[i];
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const jitter = (valueNoise(r * 9 + i * 13, i * 7, seed) - 0.5) * 0.25;
        const w = 0.012 + r * 0.02;
        c = Math.max(c, Math.exp(-Math.pow((da + jitter * r) / w, 2)) * Math.max(0, 1 - r * 1.05));
      }
      // Concentric fracture rings.
      for (let k = 1; k <= 3; k++) {
        const rr = 0.18 * k + 0.06 * valueNoise(Math.cos(th) * 3, Math.sin(th) * 3, seed + k * 17);
        c = Math.max(c, Math.exp(-Math.pow((r - rr) / 0.016, 2)) * 0.75 * Math.max(0, 1 - r));
      }
      const hole = Math.pow(Math.max(0, 1 - r * 9), 2);
      const cov = Math.min(1, c + hole);
      const i2 = (x + y * size) * 4;
      data[i2 + 0] = 255 * Math.min(1, hole);
      data[i2 + 1] = 255 * (0.5 + cov * 0.4);
      data[i2 + 2] = 255 * Math.min(1, c);
      data[i2 + 3] = Math.min(255, cov * 255);
    }
  }
  return makeTexture(data, size);
}
