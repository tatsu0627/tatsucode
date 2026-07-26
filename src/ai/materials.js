import * as THREE from 'three';
import { PBR, PALETTE } from '../core/artdirection.js';

/**
 * CHARACTER MATERIAL LIBRARY
 *
 * The art bible (src/core/artdirection.js) requires: metalness strictly 0 or 1,
 * roughness never below PBR.minRoughness, and *every* surface carrying normal +
 * roughness variation. Characters are the most-looked-at objects in the frame so
 * they get the same treatment as the level, not flat lambert primitives.
 *
 * Everything here is generated procedurally into DataTextures at module load:
 * no external assets exist in this project. Textures are seeded so screenshots
 * are byte-stable between runs.
 *
 * All materials/textures are module-level singletons shared by every agent —
 * 12+ soldiers must not mean 12+ copies of anything.
 */

// ---------------------------------------------------------------------------
// Deterministic value-noise / fbm
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Tiling fbm in [0,1]. `baseFreq` is lattice cells across the texture. */
function fbm(size, baseFreq, octaves, seed, stretchX = 1) {
  const out = new Float32Array(size * size);
  const rnd = mulberry32(seed);
  let amp = 1, total = 0, freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    const nx = Math.max(1, Math.round(freq * stretchX));
    const ny = Math.max(1, Math.round(freq));
    const lat = new Float32Array(nx * ny);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * ny;
      const y0 = Math.floor(fy) % ny, y1 = (y0 + 1) % ny;
      const ty = smooth(fy - Math.floor(fy));
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * nx;
        const x0 = Math.floor(fx) % nx, x1 = (x0 + 1) % nx;
        const tx = smooth(fx - Math.floor(fx));
        const a = lat[y0 * nx + x0], b = lat[y0 * nx + x1];
        const c = lat[y1 * nx + x0], d = lat[y1 * nx + x1];
        const top = a + (b - a) * tx;
        const bot = c + (d - c) * tx;
        out[y * size + x] += amp * (top + (bot - top) * ty);
      }
    }
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Height -> tangent-space normal map DataTexture. */
function normalMapFrom(height, size, strength) {
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // normalize(-dx, -dy, 1)
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round((-dx * l * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy * l * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((l * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Height -> greyscale multiplier map in [lo,hi] (used as roughnessMap). */
function scalarMapFrom(height, size, lo, hi) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < height.length; i++) {
    const v = Math.round((lo + (hi - lo) * height[i]) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const S = 128;

// Cloth: a woven twill overlaid with fibre noise. The periodic term is what
// makes it read as fabric rather than as generic grunge.
function clothHeight(seed, weaveFreq = 26, weaveAmt = 0.42) {
  const n = fbm(S, 10, 4, seed);
  const out = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2 * weaveFreq;
      const v = (y / S) * Math.PI * 2 * weaveFreq;
      const weave = 0.5 + 0.25 * (Math.sin(u) + Math.sin(v));
      out[y * S + x] = (1 - weaveAmt) * n[y * S + x] + weaveAmt * weave;
    }
  }
  return out;
}

// Ballistic nylon / MOLLE webbing: coarser, higher contrast weave.
const H_CLOTH = clothHeight(1337, 30, 0.5);
const H_NYLON = clothHeight(90210, 14, 0.62);
// Helmet cover + hard shells: fine orange-peel, no weave.
const H_SHELL = fbm(S, 22, 5, 4242);
// Leather: cracked cell noise approximated with high-octave fbm, sharpened.
const H_LEATHER = (() => {
  const n = fbm(S, 7, 5, 777);
  const o = new Float32Array(S * S);
  for (let i = 0; i < n.length; i++) {
    const v = Math.abs(n[i] - 0.5) * 2;
    o[i] = 1 - v * v;
  }
  return o;
})();
// Gunmetal: directional micro-scratches.
const H_METAL = fbm(S, 40, 3, 5150, 6);
// Skin: pores, very fine.
const H_SKIN = fbm(S, 34, 4, 31337);

const TEX = {
  clothN: normalMapFrom(H_CLOTH, S, 6.0),
  clothR: scalarMapFrom(H_CLOTH, S, 0.78, 1.0),
  nylonN: normalMapFrom(H_NYLON, S, 9.0),
  nylonR: scalarMapFrom(H_NYLON, S, 0.7, 1.0),
  shellN: normalMapFrom(H_SHELL, S, 3.2),
  shellR: scalarMapFrom(H_SHELL, S, 0.72, 1.0),
  leatherN: normalMapFrom(H_LEATHER, S, 5.0),
  leatherR: scalarMapFrom(H_LEATHER, S, 0.6, 1.0),
  metalN: normalMapFrom(H_METAL, S, 2.0),
  metalR: scalarMapFrom(H_METAL, S, 0.55, 1.0),
  skinN: normalMapFrom(H_SKIN, S, 2.4),
  skinR: scalarMapFrom(H_SKIN, S, 0.8, 1.0),
};

/** Shared image, per-material tiling. Texture.clone() reuses the pixel data. */
function tiled(tex, repeat) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

function mat(name, {
  color, roughness, metalness = 0, normal, rough, repeat = 4,
  normalScale = 1, emissive = null, emissiveIntensity = 1, transparent = false,
  opacity = 1, side = THREE.FrontSide,
}) {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: Math.max(PBR.minRoughness, roughness),
    metalness,
    transparent,
    opacity,
    side,
  });
  m.name = 'char_' + name;
  if (normal) {
    m.normalMap = tiled(normal, repeat);
    m.normalScale = new THREE.Vector2(normalScale, normalScale);
  }
  if (rough) m.roughnessMap = tiled(rough, repeat);
  if (emissive) {
    m.emissive = new THREE.Color(emissive);
    m.emissiveIntensity = emissiveIntensity;
  }
  m.envMapIntensity = PBR.envMapIntensity;
  return m;
}

// ---------------------------------------------------------------------------
// Palette extension — desert-compound OPFOR kit. Albedos stay inside the
// 0.02–0.9 window the bible demands; nothing here is pure black or white.
// ---------------------------------------------------------------------------
export const KIT = {
  fatigue:   0x8d7f61,  // sun-bleached desert BDU
  fatigueAlt:0x76705a,  // trousers, slightly greener
  carrier:   0x5f5641,  // coyote plate carrier
  pouch:     0x6b6049,
  webbing:   0x40402f,  // dark olive nylon straps
  helmet:    0x6d6650,
  pad:       0x2b2b28,  // rubberised knee/elbow pads
  boot:      0x413024,
  glove:     0x33302a,
  skin:      0xa87f5e,
  lens:      0x1d262b,
  gunmetal:  0x54585c,
  polymer:   0x33362f,
  patch:     PALETTE.rust,
};

export const MATERIALS = {
  fatigue:  mat('fatigue',  { color: KIT.fatigue,    roughness: 0.92, normal: TEX.clothN, rough: TEX.clothR, repeat: 5, normalScale: 0.9 }),
  trouser:  mat('trouser',  { color: KIT.fatigueAlt, roughness: 0.94, normal: TEX.clothN, rough: TEX.clothR, repeat: 4, normalScale: 1.0 }),
  carrier:  mat('carrier',  { color: KIT.carrier,    roughness: 0.82, normal: TEX.nylonN, rough: TEX.nylonR, repeat: 6, normalScale: 1.1 }),
  pouch:    mat('pouch',    { color: KIT.pouch,      roughness: 0.86, normal: TEX.nylonN, rough: TEX.nylonR, repeat: 9, normalScale: 1.0 }),
  webbing:  mat('webbing',  { color: KIT.webbing,    roughness: 0.95, normal: TEX.nylonN, rough: TEX.nylonR, repeat: 12, normalScale: 1.2 }),
  helmet:   mat('helmet',   { color: KIT.helmet,     roughness: 0.68, normal: TEX.shellN, rough: TEX.shellR, repeat: 3, normalScale: 0.7 }),
  pad:      mat('pad',      { color: KIT.pad,        roughness: 0.7,  normal: TEX.shellN, rough: TEX.shellR, repeat: 6, normalScale: 1.0 }),
  boot:     mat('boot',     { color: KIT.boot,       roughness: 0.58, normal: TEX.leatherN, rough: TEX.leatherR, repeat: 5, normalScale: 0.9 }),
  sole:     mat('sole',     { color: 0x24211d,       roughness: 0.85, normal: TEX.leatherN, rough: TEX.leatherR, repeat: 8, normalScale: 1.2 }),
  glove:    mat('glove',    { color: KIT.glove,      roughness: 0.72, normal: TEX.leatherN, rough: TEX.leatherR, repeat: 7, normalScale: 0.8 }),
  skin:     mat('skin',     { color: KIT.skin,       roughness: 0.62, normal: TEX.skinN, rough: TEX.skinR, repeat: 4, normalScale: 0.45 }),
  lens:     (() => {
    const m = mat('lens', { color: KIT.lens, roughness: 0.12, metalness: 1.0, normal: TEX.metalN, rough: TEX.metalR, repeat: 2, normalScale: 0.25 });
    return m;
  })(),
  gunmetal: mat('gunmetal', { color: KIT.gunmetal,   roughness: 0.42, metalness: 1.0, normal: TEX.metalN, rough: TEX.metalR, repeat: 4, normalScale: 0.6 }),
  gunworn:  mat('gunworn',  { color: 0x6a6c6e,       roughness: 0.28, metalness: 1.0, normal: TEX.metalN, rough: TEX.metalR, repeat: 8, normalScale: 0.5 }),
  polymer:  mat('polymer',  { color: KIT.polymer,    roughness: 0.55, normal: TEX.shellN, rough: TEX.shellR, repeat: 8, normalScale: 0.8 }),
  // Small emissive accents (optic housing dot, IR strobe) — reads at distance
  // and gives the silhouette a point of interest without breaking the palette.
  accent:   mat('accent',   { color: 0x772016, roughness: 0.35, emissive: 0xff3a1e, emissiveIntensity: 2.4 }),
};

export const ALL_CHAR_MATERIALS = Object.values(MATERIALS);

/** Debug/utility: flat unlit material for nav + hitbox gizmos. */
export function debugLineMaterial(color) {
  return new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.85 });
}

export function disposeCharacterMaterials() {
  for (const m of ALL_CHAR_MATERIALS) m.dispose();
  for (const t of Object.values(TEX)) t.dispose();
}
