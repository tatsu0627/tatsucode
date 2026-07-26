import * as THREE from 'three';

/**
 * VISUAL profile per surface type. The ballistic profile (what a round can
 * punch through) lives in src/combat/surfaces.js; this file only decides what
 * the hit *looks* like.
 *
 * Colours are linear. Spark/fire colours are deliberately > 1.0 so they cross
 * the bloom threshold (POST.bloom.threshold = 1.15) and glow; dust and debris
 * albedos stay inside the 0.02–0.9 range the art bible mandates.
 */
const C = (r, g, b) => new THREE.Color(r, g, b);

export const SURFACE_FX = {
  concrete: {
    sparks: 5, sparkColor: C(3.4, 1.9, 0.9), sparkSpeed: 4.5, sparkLife: 0.22,
    dust: 9, dustColor: C(0.62, 0.59, 0.54), dustSize: [0.10, 0.62], dustLife: 1.5,
    smoke: 2, smokeColor: C(0.50, 0.48, 0.45),
    chunks: 5, chunkSize: 0.035, chunkColor: C(0.36, 0.35, 0.32),
    decal: 'hole', decalSize: 0.075, decalTint: C(0.66, 0.64, 0.59), holeDark: 1.0,
    lightPeak: 0, sound: 'concrete',
  },
  asphalt: {
    sparks: 3, sparkColor: C(3.0, 1.7, 0.8), sparkSpeed: 4.0, sparkLife: 0.2,
    dust: 8, dustColor: C(0.30, 0.29, 0.28), dustSize: [0.09, 0.55], dustLife: 1.4,
    smoke: 2, smokeColor: C(0.24, 0.23, 0.22),
    chunks: 4, chunkSize: 0.03, chunkColor: C(0.16, 0.155, 0.15),
    decal: 'hole', decalSize: 0.07, decalTint: C(0.30, 0.29, 0.28), holeDark: 1.0,
  },
  brick: {
    sparks: 4, sparkColor: C(3.2, 1.7, 0.7), sparkSpeed: 4.2, sparkLife: 0.2,
    dust: 9, dustColor: C(0.55, 0.34, 0.26), dustSize: [0.10, 0.58], dustLife: 1.5,
    smoke: 2, smokeColor: C(0.42, 0.28, 0.22),
    chunks: 5, chunkSize: 0.033, chunkColor: C(0.40, 0.22, 0.16),
    decal: 'hole', decalSize: 0.075, decalTint: C(0.52, 0.33, 0.25), holeDark: 1.0,
  },
  metal: {
    sparks: 22, sparkColor: C(14.0, 6.4, 1.7), sparkSpeed: 9.5, sparkLife: 0.42,
    dust: 3, dustColor: C(0.30, 0.30, 0.31), dustSize: [0.05, 0.26], dustLife: 0.7,
    smoke: 1, smokeColor: C(0.22, 0.22, 0.23),
    chunks: 2, chunkSize: 0.018, chunkColor: C(0.42, 0.44, 0.46), metalChunk: true,
    decal: 'hole', decalSize: 0.05, decalTint: C(0.72, 0.74, 0.78), holeDark: 0.85,
    lightPeak: 3.5, lightColor: C(1.0, 0.62, 0.24),
  },
  steel: null,   // alias, filled below
  rust: {
    sparks: 12, sparkColor: C(11.0, 4.6, 1.1), sparkSpeed: 8.0, sparkLife: 0.36,
    dust: 6, dustColor: C(0.45, 0.26, 0.16), dustSize: [0.07, 0.36], dustLife: 1.0,
    smoke: 1, smokeColor: C(0.33, 0.21, 0.14),
    chunks: 3, chunkSize: 0.02, chunkColor: C(0.34, 0.18, 0.10),
    decal: 'hole', decalSize: 0.055, decalTint: C(0.48, 0.28, 0.17), holeDark: 0.9,
    lightPeak: 2.5, lightColor: C(1.0, 0.58, 0.22),
  },
  wood: {
    sparks: 1, sparkColor: C(2.2, 1.2, 0.4), sparkSpeed: 3.0, sparkLife: 0.18,
    dust: 7, dustColor: C(0.58, 0.46, 0.30), dustSize: [0.07, 0.42], dustLife: 1.2,
    smoke: 2, smokeColor: C(0.40, 0.32, 0.22),
    chunks: 8, chunkSize: 0.03, chunkColor: C(0.42, 0.31, 0.18), splinter: true,
    decal: 'hole', decalSize: 0.065, decalTint: C(0.46, 0.34, 0.20), holeDark: 1.0,
  },
  drywall: {
    sparks: 0, sparkColor: C(1, 1, 1), sparkSpeed: 1, sparkLife: 0.1,
    dust: 14, dustColor: C(0.80, 0.79, 0.76), dustSize: [0.12, 0.72], dustLife: 1.9,
    smoke: 3, smokeColor: C(0.72, 0.71, 0.68),
    chunks: 5, chunkSize: 0.03, chunkColor: C(0.74, 0.73, 0.70),
    decal: 'hole', decalSize: 0.085, decalTint: C(0.80, 0.79, 0.76), holeDark: 1.0,
  },
  sand: {
    sparks: 0, sparkColor: C(1, 1, 1), sparkSpeed: 1, sparkLife: 0.1,
    dust: 16, dustColor: C(0.66, 0.56, 0.39), dustSize: [0.13, 0.85], dustLife: 2.1,
    smoke: 2, smokeColor: C(0.58, 0.50, 0.36),
    chunks: 3, chunkSize: 0.02, chunkColor: C(0.50, 0.42, 0.29),
    decal: 'hole', decalSize: 0.10, decalTint: C(0.52, 0.44, 0.31), holeDark: 0.55,
  },
  dirt: {
    sparks: 0, sparkColor: C(1, 1, 1), sparkSpeed: 1, sparkLife: 0.1,
    dust: 14, dustColor: C(0.40, 0.33, 0.24), dustSize: [0.12, 0.78], dustLife: 1.9,
    smoke: 2, smokeColor: C(0.32, 0.27, 0.20),
    chunks: 4, chunkSize: 0.024, chunkColor: C(0.26, 0.21, 0.15),
    decal: 'hole', decalSize: 0.10, decalTint: C(0.30, 0.25, 0.18), holeDark: 0.7,
  },
  sandbag: {
    sparks: 0, sparkColor: C(1, 1, 1), sparkSpeed: 1, sparkLife: 0.1,
    dust: 13, dustColor: C(0.62, 0.55, 0.42), dustSize: [0.11, 0.70], dustLife: 2.0,
    smoke: 2, smokeColor: C(0.54, 0.48, 0.37),
    chunks: 2, chunkSize: 0.018, chunkColor: C(0.48, 0.42, 0.32),
    decal: 'hole', decalSize: 0.085, decalTint: C(0.58, 0.51, 0.39), holeDark: 0.6,
  },
  glass: {
    sparks: 6, sparkColor: C(5.0, 6.0, 7.0), sparkSpeed: 5.5, sparkLife: 0.3,
    dust: 3, dustColor: C(0.60, 0.66, 0.70), dustSize: [0.05, 0.28], dustLife: 0.9,
    smoke: 0, smokeColor: C(0.5, 0.5, 0.5),
    chunks: 9, chunkSize: 0.026, chunkColor: C(0.55, 0.64, 0.68), glassChunk: true,
    decal: 'glass', decalSize: 0.16, decalTint: C(0.68, 0.75, 0.80), holeDark: 0.7,
  },
  foliage: {
    sparks: 0, sparkColor: C(1, 1, 1), sparkSpeed: 1, sparkLife: 0.1,
    dust: 4, dustColor: C(0.26, 0.34, 0.17), dustSize: [0.08, 0.40], dustLife: 1.0,
    smoke: 0, smokeColor: C(0.3, 0.35, 0.2),
    chunks: 7, chunkSize: 0.028, chunkColor: C(0.20, 0.30, 0.13), splinter: true,
    decal: null, decalSize: 0, decalTint: C(1, 1, 1), holeDark: 0,
  },
  water: {
    sparks: 0, sparkColor: C(1, 1, 1), sparkSpeed: 1, sparkLife: 0.1,
    dust: 12, dustColor: C(0.60, 0.68, 0.72), dustSize: [0.08, 0.55], dustLife: 0.9,
    smoke: 0, smokeColor: C(0.5, 0.5, 0.5),
    chunks: 0, chunkSize: 0.01, chunkColor: C(0.5, 0.6, 0.65),
    decal: null, decalSize: 0, decalTint: C(1, 1, 1), holeDark: 0,
  },
  rubber: {
    sparks: 0, sparkColor: C(1, 1, 1), sparkSpeed: 1, sparkLife: 0.1,
    dust: 5, dustColor: C(0.16, 0.16, 0.17), dustSize: [0.07, 0.34], dustLife: 1.1,
    smoke: 3, smokeColor: C(0.13, 0.13, 0.14),
    chunks: 3, chunkSize: 0.02, chunkColor: C(0.10, 0.10, 0.11),
    decal: 'hole', decalSize: 0.06, decalTint: C(0.16, 0.16, 0.17), holeDark: 1.0,
  },
  flesh: {
    sparks: 0, sparkColor: C(1, 1, 1), sparkSpeed: 1, sparkLife: 0.1,
    dust: 0, dustColor: C(0.4, 0.05, 0.04), dustSize: [0.06, 0.3], dustLife: 0.6,
    smoke: 0, smokeColor: C(0.3, 0.04, 0.03),
    chunks: 0, chunkSize: 0.012, chunkColor: C(0.28, 0.03, 0.03),
    decal: 'blood', decalSize: 0.22, decalTint: C(0.30, 0.030, 0.022), holeDark: 0,
    blood: true,
  },
};

SURFACE_FX.steel = SURFACE_FX.metal;
SURFACE_FX.tile = SURFACE_FX.concrete;
SURFACE_FX.plaster = SURFACE_FX.drywall;
SURFACE_FX.gravel = SURFACE_FX.dirt;
SURFACE_FX.cloth = SURFACE_FX.sandbag;
SURFACE_FX.default = SURFACE_FX.concrete;

export function fxProfile(name) {
  return SURFACE_FX[name] || SURFACE_FX.concrete;
}
