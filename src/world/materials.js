import * as THREE from 'three';
import { PALETTE, PBR } from '../core/artdirection.js';
import { TextureLibrary } from './texgen.js';

/**
 * materials.js — the shared material library.
 *
 * Rules enforced here, from the art bible:
 *   - metalness is 0 or 1 (the map carries the exception at rust/paint fronts)
 *   - roughness is never flat: every material samples the packed ORM map's
 *     green channel, and the material's scalar roughness is a *multiplier* of 1
 *     so the texture is always in charge
 *   - envMapIntensity comes from PBR.envMapIntensity, never hardcoded per-object
 *   - vertexColors is on everywhere so the world builder can bake ground grime,
 *     dust accumulation and per-module tonal drift into the mesh
 *
 * A "tint" is a livery, not a re-authoring: paintedSteel is generated white and
 * the same three textures serve the green barriers, the tan doors and the bare
 * steel towers, so we pay for one 1024^3 texture set instead of three.
 */

const DEFAULTS = {
  envMapIntensity: PBR.envMapIntensity,
  vertexColors: true,
  roughness: 1,
  metalness: 1,
  dithering: true,
};

const RECIPES = {
  // key             texture set     tint                 extra
  concrete: ['concrete', 0xffffff, { normalScale: 1.0 }],
  concreteWarm: ['concrete', 0xc9b9a2, { normalScale: 1.0 }],
  concreteDark: ['concrete', 0x8d8b87, { normalScale: 1.0 }],
  plaster: ['plasterBrick', 0xffffff, { normalScale: 1.0 }],
  plasterWarm: ['plasterBrick', 0xd8c4a6, { normalScale: 1.0 }],
  sand: ['sand', 0xffffff, { normalScale: 0.9 }],
  asphalt: ['asphalt', 0xffffff, { normalScale: 1.0 }],
  corrugated: ['corrugated', 0xffffff, { normalScale: 1.0 }],
  corrugatedTan: ['corrugated', 0xb8a483, { normalScale: 1.0 }],
  corrugatedGreen: ['corrugated', 0x83907a, { normalScale: 1.0 }],
  container: ['container', 0xffffff, { normalScale: 1.0 }],
  steelPainted: ['paintedSteel', PALETTE.paintedTan, { normalScale: 1.0 }],
  steelGreen: ['paintedSteel', PALETTE.paintedGreen, { normalScale: 1.0 }],
  steelBare: ['paintedSteel', PALETTE.steel, { normalScale: 1.0 }],
  steelWhite: ['paintedSteel', 0xcfcabf, { normalScale: 1.0 }],
  steelRed: ['paintedSteel', 0x9c4b39, { normalScale: 1.0 }],
  rusted: ['rustedSteel', 0xffffff, { normalScale: 1.1 }],
  sandbag: ['sandbag', 0xffffff, { normalScale: 1.15 }],
  sandbagGreen: ['sandbag', 0x8d9179, { normalScale: 1.15 }],
  wood: ['wood', 0xffffff, { normalScale: 1.0 }],
  woodPale: ['wood', 0xc9b48c, { normalScale: 1.0 }],
  tarp: ['tarp', 0x6d7358, { normalScale: 1.0, side: THREE.DoubleSide }],
  tarpTan: ['tarp', 0xa89066, { normalScale: 1.0, side: THREE.DoubleSide }],
  grating: ['grating', 0xffffff, { normalScale: 1.0, alphaTest: 0.5, side: THREE.DoubleSide }],
  chainlink: ['chainlink', 0xffffff, { normalScale: 1.0, alphaTest: 0.45, side: THREE.DoubleSide }],
};

export class MaterialLibrary {
  constructor(renderer, opts = {}) {
    this.tex = new TextureLibrary(renderer, opts);
    this.map = new Map();
    this.infoMap = new Map();
    this._decalTex = null;
  }

  /** Build every material named in RECIPES plus the handful of untextured ones. */
  buildAll() {
    for (const key of Object.keys(RECIPES)) this.get(key);
    this._buildSpecials();
    return this;
  }

  info(key) {
    if (!this.infoMap.has(key)) this.get(key);
    return this.infoMap.get(key) || { tileMetres: 1 };
  }

  get(key) {
    if (this.map.has(key)) return this.map.get(key);
    const r = RECIPES[key];
    if (!r) throw new Error(`materials: unknown material "${key}"`);
    const [texName, tint, extra = {}] = r;
    const set = this.tex.get(texName);
    const m = new THREE.MeshStandardMaterial({
      ...DEFAULTS,
      color: new THREE.Color(tint),
      map: set.map,
      normalMap: set.normalMap,
      aoMap: set.ormMap,
      roughnessMap: set.ormMap,
      metalnessMap: set.ormMap,
      normalScale: new THREE.Vector2(extra.normalScale ?? 1, extra.normalScale ?? 1),
      side: extra.side ?? THREE.FrontSide,
      alphaTest: extra.alphaTest ?? 0,
      transparent: false,
      aoMapIntensity: extra.aoMapIntensity ?? 1.0,
    });
    m.name = key;
    this.map.set(key, m);
    this.infoMap.set(key, { tileMetres: set.tileMetres, tex: set });
    return m;
  }

  _buildSpecials() {
    const add = (key, mat, tileMetres = 1) => {
      mat.name = key; this.map.set(key, mat); this.infoMap.set(key, { tileMetres });
      return mat;
    };

    // Dirty glass — never a clean mirror; grime rides in the roughness map.
    const glassTex = this._makeGlassTexture();
    add('glass', new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(PALETTE.glass),
      roughness: 1, metalness: 0,
      roughnessMap: glassTex, map: glassTex,
      envMapIntensity: PBR.envMapIntensity * 1.6,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      vertexColors: true, depthWrite: false,
    }), 1.4);

    // Broken-out window: just the frame's dark interior. Cheap, but it is what
    // sells "you can see into that building" at distance.
    add('void', new THREE.MeshStandardMaterial({
      color: 0x14120f, roughness: 0.95, metalness: 0, vertexColors: true,
      envMapIntensity: PBR.envMapIntensity * 0.15,
    }));

    // Decals: one atlas, one draw call, additive-free alpha blending.
    add('decal', new THREE.MeshStandardMaterial({
      map: this.decalTexture(), transparent: true, roughness: 0.92, metalness: 0,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      side: THREE.DoubleSide, vertexColors: true, envMapIntensity: PBR.envMapIntensity * 0.5,
      alphaTest: 0.02,
    }));

    // Cables/wires — thin, matte, almost black. Kept separate so they can be
    // excluded from shadow casting if the lighting agent needs the budget.
    add('cable', new THREE.MeshStandardMaterial({
      color: 0x1d1c1a, roughness: 0.78, metalness: 0, vertexColors: true,
      envMapIntensity: PBR.envMapIntensity,
    }));

    // Far backdrop: no normal map (it would alias at 400 m), heavy haze tint.
    const sandSet = this.tex.get('sand');
    add('backdrop', new THREE.MeshStandardMaterial({
      color: 0xa08d70, map: sandSet.map, roughness: 1, metalness: 0,
      vertexColors: true, envMapIntensity: PBR.envMapIntensity * 0.8, fog: true,
    }), 60);

    add('backdropFar', new THREE.MeshStandardMaterial({
      color: 0x9a8a72, roughness: 1, metalness: 0, vertexColors: true,
      envMapIntensity: PBR.envMapIntensity * 0.7,
    }), 60);
  }

  _makeGlassTexture() {
    const S = 256, data = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const u = x / S, v = y / S;
      const n = Math.sin(u * 31.1 + Math.cos(v * 17.3) * 3) * 0.5 + 0.5;
      const streak = Math.pow(Math.abs(Math.sin(u * 9.4 + n * 2)), 6);
      const grime = Math.min(1, n * 0.5 + streak * 0.7 + (1 - v) * 0.25);
      data[i] = 40 + grime * 70; data[i + 1] = 46 + grime * 66; data[i + 2] = 50 + grime * 58;
      data[i + 3] = 255;
    }
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }

  /**
   * The decal atlas is drawn with canvas2d, which only exists in a browser.
   * Returning null without one lets the whole material library be constructed
   * in plain Node — which is what makes the offline geometry benchmark in
   * tools/levelbench.mjs possible, and that has been the fastest way to catch
   * level-construction faults without waiting on a headless render.
   */
  decalTexture() {
    if (typeof document === 'undefined') return null;
    if (!this._decalTex) this._decalTex = buildDecalAtlas();
    return this._decalTex;
  }

  dispose() {
    for (const m of this.map.values()) m.dispose();
  }
}

// ===========================================================================
// DECAL ATLAS — stencils, tags, stains, scorch, posters, tracks.
// Drawn with canvas2d because strokes and glyph rasterisation are what it is
// good at; no font files are used, glyphs come from a hand-coded 5x7 bitmap so
// the result is identical on every machine.
// ===========================================================================
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00010', '00100', '01000', '10000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function stencilText(ctx, text, x, y, px, color, bridge = true) {
  ctx.save();
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = FONT[ch];
    if (!g) { cx += px * 6; continue; }
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (g[r][c] === '1') ctx.fillRect(cx + c * px, y + r * px, px * 1.02, px * 1.02);
      }
    }
    cx += px * 6;
  }
  if (bridge) {
    // stencil bridges: knock two thin horizontal gaps through every glyph
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fillRect(x - px, y + px * 1.6, cx - x + px * 2, px * 0.5);
    ctx.fillRect(x - px, y + px * 4.6, cx - x + px * 2, px * 0.5);
  }
  ctx.restore();
  return cx - x;
}

function textWidth(text, px) { return text.length * px * 6; }

function roughen(ctx, w, h, amount, seed = 1) {
  // Erode the mark so it is not a crisp vector shape — spray, wear and dust.
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < amount; i++) {
    const r = 1 + rnd() * 7;
    ctx.globalAlpha = 0.25 + rnd() * 0.7;
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Rect list must stay in sync with DECALS below. */
export const DECALS = {
  stencilRestricted: [0.0, 0.0, 1.0, 0.09],
  stencilBlacksite: [0.0, 0.09, 1.0, 0.18],
  hazard: [0.0, 0.18, 1.0, 0.25],
  num07: [0.0, 0.25, 0.25, 0.44],
  num12: [0.25, 0.25, 0.5, 0.44],
  arrow: [0.5, 0.25, 0.75, 0.44],
  tag: [0.75, 0.25, 1.0, 0.44],
  oil: [0.0, 0.44, 0.25, 0.68],
  scorch: [0.25, 0.44, 0.5, 0.68],
  splatter: [0.5, 0.44, 0.75, 0.68],
  waterStain: [0.75, 0.44, 1.0, 0.68],
  rustRun: [0.0, 0.68, 0.25, 0.87],
  poster: [0.25, 0.68, 0.5, 0.87],
  bullets: [0.5, 0.68, 0.75, 0.87],
  tyre: [0.75, 0.68, 1.0, 0.87],
  dirtEdge: [0.0, 0.87, 1.0, 1.0],
};

function buildDecalAtlas() {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const R = (k) => DECALS[k].map((v, i) => v * S);
  const cell = (k) => { const [x0, y0, x1, y1] = R(k); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  const sub = (k, fn) => {
    const c = cell(k);
    ctx.save(); ctx.translate(c.x, c.y);
    ctx.beginPath(); ctx.rect(0, 0, c.w, c.h); ctx.clip();
    fn(ctx, c.w, c.h);
    ctx.restore();
  };

  // --- stencilled sign text
  sub('stencilRestricted', (g, w, h) => {
    const t = 'RESTRICTED AREA';
    const px = Math.min(h / 9, w / textWidth(t, 1));
    stencilText(g, t, (w - textWidth(t, px)) / 2, h * 0.14, px, 'rgba(228,224,214,0.92)');
    roughen(g, w, h, 220, 7);
  });
  sub('stencilBlacksite', (g, w, h) => {
    const t = 'BLACKSITE-07 / AUTH ONLY';
    const px = Math.min(h / 9, w / textWidth(t, 1));
    stencilText(g, t, (w - textWidth(t, px)) / 2, h * 0.16, px, 'rgba(30,28,26,0.9)');
    roughen(g, w, h, 260, 11);
  });

  // --- hazard chevrons
  sub('hazard', (g, w, h) => {
    const step = h * 1.15;
    for (let x = -h; x < w + h; x += step * 2) {
      g.fillStyle = 'rgba(206,168,48,0.9)';
      g.beginPath(); g.moveTo(x, h); g.lineTo(x + step, 0); g.lineTo(x + step * 1.7, 0); g.lineTo(x + step * 0.7, h); g.closePath(); g.fill();
      g.fillStyle = 'rgba(24,22,20,0.9)';
      g.beginPath(); g.moveTo(x + step * 0.7, h); g.lineTo(x + step * 1.7, 0); g.lineTo(x + step * 2.4, 0); g.lineTo(x + step * 1.4, h); g.closePath(); g.fill();
    }
    roughen(g, w, h, 340, 3);
  });

  // --- big painted unit numbers
  const bigNum = (k, t, col) => sub(k, (g, w, h) => {
    const px = Math.min(h / 8.4, w / textWidth(t, 1.1));
    stencilText(g, t, (w - textWidth(t, px)) / 2, (h - px * 7) / 2, px, col);
    roughen(g, w, h, 200, t.charCodeAt(0));
  });
  bigNum('num07', '07', 'rgba(236,232,222,0.9)');
  bigNum('num12', 'C4', 'rgba(30,28,26,0.88)');

  // --- directional arrow
  sub('arrow', (g, w, h) => {
    g.fillStyle = 'rgba(228,222,206,0.85)';
    g.beginPath();
    g.moveTo(w * 0.12, h * 0.42); g.lineTo(w * 0.56, h * 0.42); g.lineTo(w * 0.56, h * 0.24);
    g.lineTo(w * 0.9, h * 0.5); g.lineTo(w * 0.56, h * 0.76); g.lineTo(w * 0.56, h * 0.58);
    g.lineTo(w * 0.12, h * 0.58); g.closePath(); g.fill();
    roughen(g, w, h, 160, 21);
  });

  // --- spray tag: loose overlapping strokes
  sub('tag', (g, w, h) => {
    let s = 99;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    g.strokeStyle = 'rgba(178,58,44,0.75)'; g.lineWidth = h * 0.07; g.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      g.beginPath();
      g.moveTo(w * (0.1 + rnd() * 0.2), h * (0.2 + rnd() * 0.6));
      for (let k = 0; k < 3; k++) g.lineTo(w * (0.2 + rnd() * 0.7), h * (0.15 + rnd() * 0.7));
      g.stroke();
    }
    g.strokeStyle = 'rgba(226,222,210,0.5)'; g.lineWidth = h * 0.03;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(w * rnd(), h * rnd());
      g.lineTo(w * rnd(), h * rnd());
      g.stroke();
    }
    roughen(g, w, h, 300, 5);
  });

  // --- ground stains
  const blob = (k, colors, n, spread, seed) => sub(k, (g, w, h) => {
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) {
      const cx = w * (0.5 + (rnd() - 0.5) * spread), cy = h * (0.5 + (rnd() - 0.5) * spread);
      const r = h * (0.08 + rnd() * 0.3);
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      const c = colors[(rnd() * colors.length) | 0];
      grd.addColorStop(0, c[0]); grd.addColorStop(1, c[1]);
      g.fillStyle = grd;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
    roughen(g, w, h, 180, seed + 3);
  });
  blob('oil', [['rgba(16,14,12,0.85)', 'rgba(16,14,12,0)'], ['rgba(38,30,22,0.6)', 'rgba(38,30,22,0)']], 16, 0.7, 31);
  blob('scorch', [['rgba(12,10,9,0.9)', 'rgba(12,10,9,0)'], ['rgba(60,48,38,0.5)', 'rgba(60,48,38,0)']], 22, 0.95, 47);
  blob('splatter', [['rgba(70,58,42,0.55)', 'rgba(70,58,42,0)']], 26, 1.0, 59);
  blob('waterStain', [['rgba(58,54,44,0.4)', 'rgba(58,54,44,0)'], ['rgba(96,90,74,0.3)', 'rgba(96,90,74,0)']], 14, 0.8, 67);

  // --- rust run (drips under a fixing)
  sub('rustRun', (g, w, h) => {
    let s = 17;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 26; i++) {
      const x = w * (0.15 + rnd() * 0.7), len = h * (0.25 + rnd() * 0.7);
      const grd = g.createLinearGradient(0, h * 0.06, 0, h * 0.06 + len);
      grd.addColorStop(0, 'rgba(122,68,36,0.75)');
      grd.addColorStop(0.35, 'rgba(140,80,42,0.45)');
      grd.addColorStop(1, 'rgba(140,80,42,0)');
      g.fillStyle = grd;
      g.fillRect(x, h * 0.06, w * (0.008 + rnd() * 0.03), len);
    }
    const grd2 = g.createRadialGradient(w * 0.5, h * 0.08, 0, w * 0.5, h * 0.08, w * 0.42);
    grd2.addColorStop(0, 'rgba(104,58,32,0.7)'); grd2.addColorStop(1, 'rgba(104,58,32,0)');
    g.fillStyle = grd2; g.fillRect(0, 0, w, h * 0.4);
    roughen(g, w, h, 160, 23);
  });

  // --- torn poster
  sub('poster', (g, w, h) => {
    g.fillStyle = 'rgba(206,196,172,0.92)';
    g.beginPath();
    g.moveTo(w * 0.14, h * 0.06); g.lineTo(w * 0.86, h * 0.1); g.lineTo(w * 0.83, h * 0.74);
    g.lineTo(w * 0.55, h * 0.9); g.lineTo(w * 0.4, h * 0.72); g.lineTo(w * 0.16, h * 0.8);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(52,46,40,0.8)';
    for (let i = 0; i < 7; i++) g.fillRect(w * 0.22, h * (0.2 + i * 0.075), w * (0.3 + (i % 3) * 0.16), h * 0.028);
    g.fillStyle = 'rgba(150,54,40,0.8)';
    g.fillRect(w * 0.22, h * 0.12, w * 0.42, h * 0.05);
    roughen(g, w, h, 120, 71);
  });

  // --- bullet impact cluster
  sub('bullets', (g, w, h) => {
    let s = 5;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 14; i++) {
      const cx = w * (0.1 + rnd() * 0.8), cy = h * (0.1 + rnd() * 0.8), r = h * (0.02 + rnd() * 0.045);
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2);
      grd.addColorStop(0, 'rgba(22,20,18,0.95)');
      grd.addColorStop(0.3, 'rgba(150,144,132,0.5)');
      grd.addColorStop(1, 'rgba(150,144,132,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r * 3.2, 0, Math.PI * 2); g.fill();
    }
    roughen(g, w, h, 90, 91);
  });

  // --- tyre track
  sub('tyre', (g, w, h) => {
    g.fillStyle = 'rgba(28,25,22,0.5)';
    for (let y = 0; y < h; y += h * 0.055) {
      g.fillRect(w * 0.18, y, w * 0.64, h * 0.03);
      g.fillRect(w * 0.1, y + h * 0.027, w * 0.8, h * 0.012);
    }
    g.fillStyle = 'rgba(28,25,22,0.28)';
    g.fillRect(w * 0.1, 0, w * 0.8, h);
    roughen(g, w, h, 260, 101);
  });

  // --- ground-line dirt gradient (a wide soft band, used where wall meets floor)
  sub('dirtEdge', (g, w, h) => {
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, 'rgba(48,40,30,0.72)');
    grd.addColorStop(0.35, 'rgba(66,56,42,0.34)');
    grd.addColorStop(1, 'rgba(80,70,54,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    roughen(g, w, h, 420, 13);
  });

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
