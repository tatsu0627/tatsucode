import * as THREE from 'three';
import {
  fbm, warp, ridged, remap, normalize01, mapField, blur3,
  mulberry32, stampSegment, normalFromHeight, clamp01,
} from '../world/fields.js';

/**
 * WEAPON SURFACE MAPS.
 *
 * The viewmodel is on screen for every frame of gameplay and was the only
 * object in the project with no surface variation at all — every part a single
 * flat colour, no normal map, no roughness map. Under any lighting that reads
 * as grey blocks stuck together, which is exactly how review described it. The
 * fix is not more polygons; it is that real firearm surfaces are defined by
 * their finish. Anodised aluminium, glass-filled polymer and nitrided steel
 * look nothing alike, and at arm's length that difference is most of what sells
 * the object.
 *
 * Everything is generated at module load into DataTextures, seeded, so captures
 * stay byte-stable. Maps are shared singletons — one weapon or twenty costs the
 * same.
 *
 * Tile scale: these are authored against roughly a 6 cm square of surface, and
 * each material sets its own repeat to match the size of the part it covers.
 */

const S = 256;

// ---------------------------------------------------------------------------
// Height fields
// ---------------------------------------------------------------------------

/**
 * Type III anodising: a hard oxide layer grown on the alloy, so it inherits the
 * substrate's bead-blasted tooth rather than being smooth. Very fine, isotropic,
 * low amplitude — visible as a slight break-up of the specular, never as bumps.
 */
const H_ANODISED = (() => {
  const base = fbm(S, 96, 3, 8817);
  const fine = fbm(S, 190, 2, 8819);
  return mapField(base, (v, i) => clamp01(v * 0.62 + fine[i] * 0.38));
})();

/**
 * Nitrided barrel steel: the same fine tooth plus faint directional draw marks
 * left by the broaching and polishing, which is what makes steel read as steel
 * rather than as dark plastic. Stretched along X so it runs with the bore once
 * the material sets its repeat.
 */
const H_STEEL = (() => {
  const base = fbm(S, 60, 3, 5150);
  const drawn = warp(base, S, fbm(S, 8, 2, 5151), fbm(S, 140, 2, 5152), S * 0.02);
  const out = normalize01(drawn);
  const rnd = mulberry32(4242);
  // A handful of deeper drag lines. Linear features are safe at this scale —
  // the eye reads them as machining, and machining is repetitive in reality.
  for (let i = 0; i < 26; i++) {
    const y = rnd() * S;
    stampSegment(out, S, -2, y, S + 2, y + (rnd() - 0.5) * 3, 0.6 + rnd() * 0.9,
      (rnd() < 0.5 ? -1 : 1) * (0.04 + rnd() * 0.05));
  }
  return out;
})();

/**
 * Glass-filled nylon: injection-moulded stipple. Coarser than the metals and
 * higher contrast, because the mould texture is deliberate rather than
 * incidental — it is there to be gripped.
 */
const H_POLYMER = (() => {
  const cells = ridged(fbm(S, 46, 4, 3141), 2.2);
  const grain = fbm(S, 120, 3, 3142);
  return normalize01(mapField(cells, (v, i) => v * 0.7 + grain[i] * 0.3));
})();

/**
 * Optic bodies are bead-blasted before anodising, which leaves a flatter,
 * more uniform tooth than the receiver.
 */
const H_OPTIC = blur3(fbm(S, 130, 2, 2718), 1);

// ---------------------------------------------------------------------------
// Wear
// ---------------------------------------------------------------------------

/**
 * Finish wear, used to modulate roughness rather than albedo.
 *
 * A carbine wears where it is handled and where it rubs: the finish polishes
 * through to brighter, smoother metal. Driving roughness from this — instead of
 * painting scratches into the colour — keeps it subtle from the front and makes
 * the weapon come alive when it swings through a highlight, which is when the
 * player actually looks at it.
 */
const WEAR = (() => {
  const broad = warp(fbm(S, 5, 4, 9001), S, fbm(S, 11, 3, 9002), fbm(S, 11, 3, 9003), S * 0.06);
  const bite = fbm(S, 34, 3, 9004);
  return remap(mapField(normalize01(broad), (v, i) => v * 0.75 + bite[i] * 0.25), 0.35, 1.0);
})();

// ---------------------------------------------------------------------------
// Texture assembly
// ---------------------------------------------------------------------------

function normalTexture(height, heightMetres, tileMetres) {
  const rgb = normalFromHeight(height, S, heightMetres, tileMetres);
  const t = new THREE.DataTexture(rgb, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/**
 * A single-channel field as an 8-bit texture, remapped into [lo, hi].
 *
 * Written as RGBA rather than RedFormat: three samples roughnessMap.g and
 * metalnessMap.b, so a red-only texture silently reads as zero on both.
 */
function scalarTexture(src, lo, hi) {
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const v = Math.round(255 * clamp01(lo + (hi - lo) * src[i]));
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Combine a surface field with the wear mask into one roughness map. */
function roughnessTexture(src, lo, hi, wearAmount) {
  return scalarTexture(
    mapField(src, (v, i) => clamp01(v * (1 - wearAmount) + (1 - WEAR[i]) * wearAmount)),
    lo, hi);
}

// Height amplitudes are in metres against a 6 cm tile — all of these are
// microstructure, tens of microns, and are meant to affect only the specular.
const TILE = 0.06;

export const WEAPON_TEX = {
  anodisedN: normalTexture(H_ANODISED, 0.00016, TILE),
  anodisedR: roughnessTexture(H_ANODISED, 0.55, 0.78, 0.55),
  steelN: normalTexture(H_STEEL, 0.00012, TILE),
  steelR: roughnessTexture(H_STEEL, 0.24, 0.48, 0.65),
  polymerN: normalTexture(H_POLYMER, 0.00042, TILE),
  polymerR: roughnessTexture(H_POLYMER, 0.52, 0.80, 0.35),
  opticN: normalTexture(H_OPTIC, 0.00010, TILE),
  opticR: roughnessTexture(H_OPTIC, 0.62, 0.82, 0.25),
};

/** Per-part tiling. Texture.clone() shares the pixel data. */
export function tiled(tex, repeat) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

export function disposeWeaponTextures() {
  for (const t of Object.values(WEAPON_TEX)) t.dispose();
}
