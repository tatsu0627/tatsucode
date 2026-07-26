import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MATERIALS } from './materials.js';
import { roundedBox, limb, blob, dome, cyl, arc, wrapY, bendZ } from './rig.js';

/**
 * PROCEDURAL SOLDIER — model + skeleton.
 *
 * PROPORTIONS (metres; the art bible fixes 1 unit = 1 metre and eye height at
 * 1.68, so the character must agree or every screenshot reads as toy-scale):
 *
 *   top of helmet   1.80      hip joint       0.905
 *   crown of skull  1.77      knee            0.470
 *   eye line        1.655     ankle           0.070
 *   chin            1.565     shoulder width  0.38 (biacromial)
 *   shoulder joint  1.425     head height     0.235  -> 7.6 heads tall
 *   elbow           1.125     upper arm       0.300
 *   wrist           0.855     forearm         0.270
 *   crotch          0.855     thigh           0.435
 *                             shin            0.400
 *
 * Head-to-body ratio is the single number that decides whether a character
 * reads as an adult human; 7.5–8 heads is the adult male range. Anything at
 * 6 heads or below immediately reads as a stylised toy.
 *
 * BUILD STRATEGY
 * Every piece of kit is authored once into a shared template. All parts on the
 * same bone using the same material are merged into a single BufferGeometry, so
 * a soldier is ~24 draw calls instead of ~90, and 12 agents share every buffer
 * and every material on the GPU. Per-agent state is only the bone Object3Ds.
 */

// ---------------------------------------------------------------------------
// Skeleton definition: [name, parent, offset]
// ---------------------------------------------------------------------------
export const SKELETON = [
  ['hips',      null,        [0, 0.950, 0]],
  ['spine',     'hips',      [0, 0.090, -0.005]],
  ['chest',     'spine',     [0, 0.200, 0.005]],
  ['neck',      'chest',     [0, 0.235, -0.010]],
  ['head',      'neck',      [0, 0.090, 0.012]],

  ['clavL',     'chest',     [ 0.050, 0.155, 0.005]],
  ['upperArmL', 'clavL',     [ 0.140, 0.030, 0]],
  ['lowerArmL', 'upperArmL', [0, -0.300, 0]],
  ['handL',     'lowerArmL', [0, -0.270, 0]],

  ['clavR',     'chest',     [-0.050, 0.155, 0.005]],
  ['upperArmR', 'clavR',     [-0.140, 0.030, 0]],
  ['lowerArmR', 'upperArmR', [0, -0.300, 0]],
  ['handR',     'lowerArmR', [0, -0.270, 0]],

  ['thighL',    'hips',      [ 0.095, -0.045, 0.005]],
  ['shinL',     'thighL',    [0, -0.435, 0]],
  ['footL',     'shinL',     [0, -0.400, 0]],
  ['toeL',      'footL',     [0, -0.055, 0.130]],

  ['thighR',    'hips',      [-0.095, -0.045, 0.005]],
  ['shinR',     'thighR',    [0, -0.435, 0]],
  ['footR',     'shinR',     [0, -0.400, 0]],
  ['toeR',      'footR',     [0, -0.055, 0.130]],
];

export const BONE_LENGTHS = {
  upperArm: 0.300, lowerArm: 0.270,
  thigh: 0.435, shin: 0.400,
};

/** Ankle height above the sole — feet plant at groundY + this. */
export const ANKLE_HEIGHT = 0.072;
export const STANCE_HIP_Y = 0.950;
export const EYE_LOCAL = new THREE.Vector3(0, 1.655, 0.075);

// Where the hands must be, expressed in the weapon's own space.
//
// wristL sits at the REAR of the handguard rather than out on the angled
// foregrip. That is not a stylistic choice: the biacromial width is 0.38 and
// the arm is 0.570 long, so with the weapon shouldered on the firing side the
// support hand can only reach the far foregrip by locking the elbow straight,
// which is exactly the T-pose stiffness this rig is trying to avoid. Gripping
// the rear of the handguard keeps the support elbow at a plausible ~60° bend.
export const WEAPON_ANCHORS = {
  wristR: new THREE.Vector3(0.010, 0.035, -0.052),
  wristL: new THREE.Vector3(-0.004, 0.056, 0.150),
  muzzle: new THREE.Vector3(0, 0.095, 0.545),
  optic: new THREE.Vector3(0, 0.170, 0.090),
  ejectPort: new THREE.Vector3(0.030, 0.100, 0.050),
  magwell: new THREE.Vector3(0, -0.030, 0.010),
};

// ---------------------------------------------------------------------------
// Part list authoring
// ---------------------------------------------------------------------------
const _parts = [];
const _m4 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _qq = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function part(bone, mat, geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  _parts.push({ bone, mat, geo, pos, rot, scale });
  return geo;
}

/** Mirror the last `n` authored parts across X onto another bone. */
function mirrorLast(n, boneMap) {
  const start = _parts.length - n;
  for (let i = start; i < start + n; i++) {
    const p = _parts[i];
    _parts.push({
      bone: boneMap[p.bone] || p.bone,
      mat: p.mat,
      geo: p.geo,
      pos: [-p.pos[0], p.pos[1], p.pos[2]],
      rot: [p.rot[0], -p.rot[1], -p.rot[2]],
      scale: [-p.scale[0], p.scale[1], p.scale[2]],
    });
  }
}

// ===========================================================================
// PELVIS / BELT
// ===========================================================================
function buildPelvis() {
  part('hips', 'trouser', roundedBox(0.300, 0.230, 0.205, 0.075, 4), [0, -0.030, 0]);
  part('hips', 'trouser', roundedBox(0.265, 0.100, 0.185, 0.060, 3), [0, -0.125, 0.005]);
  // Rigger's belt with a metal buckle.
  part('hips', 'webbing', roundedBox(0.318, 0.055, 0.222, 0.022, 3), [0, 0.048, 0]);
  part('hips', 'gunmetal', roundedBox(0.058, 0.046, 0.020, 0.007, 2), [0, 0.048, 0.115]);
  // Dump pouch, left rear.
  part('hips', 'pouch', roundedBox(0.115, 0.135, 0.075, 0.028, 3), [-0.150, -0.020, -0.095], [0, 0.35, 0]);
  part('hips', 'webbing', roundedBox(0.115, 0.012, 0.078, 0.005, 2), [-0.150, 0.040, -0.095], [0, 0.35, 0]);
  // Canteen, right rear.
  part('hips', 'pouch', cyl(0.047, 0.047, 0.150, 10), [0.150, -0.020, -0.095]);
  part('hips', 'webbing', roundedBox(0.098, 0.012, 0.098, 0.005, 2), [0.150, 0.048, -0.095]);
  // Rear-plate lower straps.
  part('hips', 'webbing', roundedBox(0.035, 0.090, 0.014, 0.005, 2), [-0.060, 0.075, -0.105]);
  part('hips', 'webbing', roundedBox(0.035, 0.090, 0.014, 0.005, 2), [0.060, 0.075, -0.105]);
}

// ===========================================================================
// ABDOMEN / CUMMERBUND
// ===========================================================================
function buildAbdomen() {
  part('spine', 'fatigue', roundedBox(0.290, 0.235, 0.200, 0.070, 4), [0, 0.060, 0]);
  // Cummerbund wrapping the waist — the visual link between plate and belt.
  part('spine', 'carrier', roundedBox(0.336, 0.140, 0.248, 0.048, 4), [0, 0.098, 0]);
  // MOLLE ladders: three rows of webbing across the front of the cummerbund.
  for (let i = 0; i < 3; i++) {
    part('spine', 'webbing', roundedBox(0.240, 0.011, 0.008, 0.003, 1), [0, 0.055 + i * 0.042, 0.126]);
  }
  // Side utility pouches.
  part('spine', 'pouch', roundedBox(0.058, 0.115, 0.100, 0.024, 3), [0.170, 0.095, 0.015]);
  part('spine', 'pouch', roundedBox(0.058, 0.115, 0.100, 0.024, 3), [-0.170, 0.095, 0.015]);
  part('spine', 'webbing', roundedBox(0.060, 0.012, 0.104, 0.004, 2), [0.170, 0.152, 0.015]);
  part('spine', 'webbing', roundedBox(0.060, 0.012, 0.104, 0.004, 2), [-0.170, 0.152, 0.015]);
}

// ===========================================================================
// CHEST / PLATE CARRIER
// ===========================================================================
function buildChest() {
  // Ribcage — wider at the top than the waist.
  part('chest', 'fatigue', roundedBox(0.360, 0.300, 0.220, 0.085, 4), [0, 0.070, 0]);
  part('chest', 'fatigue', roundedBox(0.300, 0.120, 0.200, 0.070, 3), [0, -0.045, 0]);
  // Collar.
  part('chest', 'fatigue', cyl(0.084, 0.098, 0.070, 12), [0, 0.215, -0.005]);

  // Front and back armour plates, slightly tilted to follow the chest.
  part('chest', 'carrier', roundedBox(0.288, 0.340, 0.058, 0.026, 4), [0, 0.058, 0.126], [-0.07, 0, 0]);
  part('chest', 'carrier', roundedBox(0.296, 0.352, 0.052, 0.026, 4), [0, 0.062, -0.126], [0.05, 0, 0]);

  // MOLLE on both plates.
  for (let i = 0; i < 4; i++) {
    part('chest', 'webbing', roundedBox(0.250, 0.011, 0.008, 0.003, 1), [0, -0.062 + i * 0.052, 0.158]);
    part('chest', 'webbing', roundedBox(0.256, 0.011, 0.008, 0.003, 1), [0, -0.062 + i * 0.052, -0.156]);
  }

  // Shoulder straps arching over the trapezius, front-to-back.
  for (const sx of [1, -1]) {
    part('chest', 'carrier', roundedBox(0.088, 0.048, 0.300, 0.020, 3), [sx * 0.092, 0.196, -0.004]);
    part('chest', 'webbing', roundedBox(0.070, 0.012, 0.140, 0.004, 2), [sx * 0.092, 0.222, 0.060]);
    // Quick-release buckle on the front of each strap.
    part('chest', 'polymer', roundedBox(0.052, 0.030, 0.026, 0.006, 2), [sx * 0.092, 0.170, 0.135]);
  }

  // Triple magazine pouches on the plate front.
  for (let i = -1; i <= 1; i++) {
    part('chest', 'pouch', roundedBox(0.082, 0.155, 0.062, 0.020, 3), [i * 0.088, -0.032, 0.176], [-0.07, 0, 0]);
    part('chest', 'carrier', roundedBox(0.084, 0.048, 0.068, 0.016, 2), [i * 0.088, 0.046, 0.180], [-0.07, 0, 0]);
    part('chest', 'webbing', roundedBox(0.020, 0.050, 0.010, 0.003, 1), [i * 0.088, 0.052, 0.214]);
  }

  // Admin pouch, upper left chest.
  part('chest', 'pouch', roundedBox(0.128, 0.098, 0.044, 0.016, 3), [-0.070, 0.132, 0.166], [-0.07, 0, 0]);
  // Grenade pouch, upper right.
  part('chest', 'pouch', roundedBox(0.062, 0.090, 0.058, 0.024, 3), [0.098, 0.130, 0.168], [-0.07, 0, 0]);
  // Radio on the back left plus a whip antenna.
  part('chest', 'polymer', roundedBox(0.078, 0.150, 0.052, 0.014, 3), [-0.098, 0.100, -0.168]);
  part('chest', 'polymer', cyl(0.005, 0.004, 0.240, 6), [-0.098, 0.290, -0.178], [-0.16, 0, 0.05]);
  // Hydration bladder on the back right.
  part('chest', 'pouch', roundedBox(0.130, 0.190, 0.055, 0.030, 3), [0.070, 0.090, -0.170]);
  part('chest', 'webbing', cyl(0.008, 0.008, 0.170, 6), [0.130, 0.190, -0.140], [0.25, 0, -0.35]);

  // Diagonal weapon sling across the chest.
  part('chest', 'webbing', roundedBox(0.036, 0.430, 0.013, 0.005, 2), [-0.030, 0.060, 0.166], [-0.05, 0, -0.62]);
  part('chest', 'webbing', roundedBox(0.036, 0.330, 0.013, 0.005, 2), [-0.055, 0.090, -0.160], [0.05, 0, 0.50]);

  // IR strobe on the shoulder — a single warm accent in the silhouette.
  part('chest', 'accent', roundedBox(0.024, 0.010, 0.030, 0.004, 1), [0.096, 0.222, -0.070]);
}

// ===========================================================================
// HEAD / HELMET / FACE COVER
// ===========================================================================
function buildHead() {
  part('neck', 'skin', cyl(0.052, 0.060, 0.120, 10), [0, 0.038, 0]);

  // Skull under a balaclava — no face is modelled, which is both authentic for
  // this kit and avoids the uncanny-valley trap of a procedural face.
  part('head', 'webbing', blob(0.083, 0.106, 0.100, 14, 10), [0, 0.102, 0.004]);
  part('head', 'webbing', roundedBox(0.118, 0.082, 0.130, 0.042, 3), [0, 0.048, 0.028]);
  // Shemagh bunched at the throat, with a hanging tail at the back.
  part('head', 'fatigue', blob(0.108, 0.062, 0.104, 12, 8), [0, 0.005, 0.004]);
  part('head', 'fatigue', roundedBox(0.140, 0.120, 0.090, 0.045, 3), [0, -0.030, -0.030], [0.25, 0, 0]);

  // Ballistic goggles: strap band + wrapped lens.
  part('head', 'pad', cyl(0.098, 0.098, 0.042, 16, true), [0, 0.118, 0.004], [0.05, 0, 0]);
  part('head', 'lens', wrapY(roundedBox(0.170, 0.058, 0.026, 0.011, 4), 0.115), [0, 0.118, 0.083], [0.05, 0, 0]);
  part('head', 'pad', roundedBox(0.020, 0.030, 0.020, 0.006, 2), [0, 0.100, 0.088]);

  // Helmet shell + rim.
  part('head', 'helmet', dome(0.112, 0.120, 0.128, Math.PI * 0.70, 18, 9), [0, 0.108, -0.004]);
  part('head', 'helmet', arc(0.108, 0.014, Math.PI * 2, 20, 6), [0, 0.070, -0.004], [Math.PI / 2, 0, 0], [1, 1.10, 1]);
  // NVG shroud and mount arm.
  part('head', 'polymer', roundedBox(0.058, 0.048, 0.030, 0.008, 2), [0, 0.170, 0.104], [-0.25, 0, 0]);
  part('head', 'gunmetal', roundedBox(0.026, 0.016, 0.050, 0.005, 2), [0, 0.186, 0.086]);
  // Side accessory rails.
  for (const sx of [1, -1]) {
    part('head', 'polymer', roundedBox(0.014, 0.024, 0.128, 0.005, 2), [sx * 0.110, 0.116, 0.004]);
    // Comms ear cup.
    part('head', 'pad', blob(0.024, 0.042, 0.042, 10, 8), [sx * 0.094, 0.070, -0.002]);
    // Chin strap.
    part('head', 'webbing', roundedBox(0.013, 0.115, 0.010, 0.004, 2), [sx * 0.090, 0.030, 0.018], [0, 0, sx * 0.22]);
    part('head', 'webbing', roundedBox(0.013, 0.100, 0.010, 0.004, 2), [sx * 0.086, 0.038, -0.045], [0.3, 0, sx * 0.20]);
  }
  part('head', 'webbing', roundedBox(0.070, 0.030, 0.024, 0.008, 2), [0, -0.018, 0.062]);
  // Counterweight pouch on the rear of the helmet.
  part('head', 'pouch', roundedBox(0.096, 0.072, 0.052, 0.020, 3), [0, 0.128, -0.114]);
  part('head', 'webbing', roundedBox(0.100, 0.010, 0.056, 0.003, 1), [0, 0.166, -0.114]);
  // Boom microphone.
  part('head', 'polymer', cyl(0.005, 0.004, 0.100, 6), [-0.082, 0.048, 0.036], [0, 0.55, 0.95]);
  part('head', 'polymer', blob(0.011, 0.011, 0.011, 8, 6), [-0.048, 0.020, 0.070]);
}

// ===========================================================================
// ARMS
// ===========================================================================
function buildArms() {
  const n0 = _parts.length;
  // Left upper arm: sleeve + shoulder armour + unit patch.
  part('upperArmL', 'fatigue', limb(0.300, 0.058, 0.049, 0.10), [0, 0, 0]);
  part('upperArmL', 'carrier', blob(0.064, 0.062, 0.066, 12, 8), [0.004, -0.010, 0]);
  part('upperArmL', 'carrier', roundedBox(0.030, 0.100, 0.110, 0.024, 3), [0.048, -0.048, 0]);
  part('upperArmL', 'pouch', roundedBox(0.010, 0.048, 0.048, 0.008, 2), [0.058, -0.100, 0.004]);
  // Left forearm: sleeve, elbow pad, cuff, wrist GPS.
  part('lowerArmL', 'fatigue', limb(0.270, 0.050, 0.043, 0.09), [0, 0, 0]);
  part('lowerArmL', 'pad', blob(0.052, 0.056, 0.056, 10, 8), [0, -0.006, -0.006]);
  part('lowerArmL', 'pad', roundedBox(0.076, 0.088, 0.070, 0.026, 3), [0, -0.030, 0.006]);
  part('lowerArmL', 'fatigue', cyl(0.047, 0.052, 0.050, 10), [0, -0.242, 0]);
  // Left hand: gloved fist.
  part('handL', 'glove', cyl(0.044, 0.046, 0.038, 10), [0, -0.012, 0]);
  part('handL', 'glove', roundedBox(0.050, 0.088, 0.080, 0.024, 3), [0, -0.048, 0.006]);
  part('handL', 'glove', roundedBox(0.052, 0.056, 0.052, 0.022, 3), [0, -0.078, 0.032]);
  part('handL', 'glove', roundedBox(0.030, 0.054, 0.030, 0.013, 2), [0.030, -0.052, 0.030], [0, 0, -0.35]);
  part('handL', 'pad', roundedBox(0.050, 0.048, 0.014, 0.005, 2), [0, -0.066, 0.052]);
  const n = _parts.length - n0;
  mirrorLast(n, {
    upperArmL: 'upperArmR', lowerArmL: 'lowerArmR', handL: 'handR',
  });
}

// ===========================================================================
// LEGS / BOOTS
// ===========================================================================
function buildLegs() {
  const n0 = _parts.length;
  part('thighL', 'trouser', limb(0.435, 0.090, 0.070, 0.09), [0, 0, 0]);
  // Cargo pocket with a flap.
  part('thighL', 'trouser', roundedBox(0.052, 0.140, 0.108, 0.026, 3), [0.070, -0.215, 0.012]);
  part('thighL', 'fatigue', roundedBox(0.056, 0.042, 0.112, 0.014, 2), [0.070, -0.150, 0.012]);
  part('thighL', 'webbing', roundedBox(0.058, 0.010, 0.114, 0.003, 1), [0.070, -0.176, 0.012]);

  part('shinL', 'trouser', limb(0.400, 0.070, 0.054, 0.07), [0, 0, 0]);
  // Knee pad wrapping the front of the joint, with retention straps.
  part('shinL', 'pad', roundedBox(0.104, 0.130, 0.090, 0.036, 3), [0, -0.032, 0.028]);
  part('shinL', 'webbing', roundedBox(0.108, 0.014, 0.096, 0.004, 2), [0, 0.014, 0.014]);
  part('shinL', 'webbing', roundedBox(0.108, 0.014, 0.096, 0.004, 2), [0, -0.086, 0.016]);
  // Blousing over the boot.
  part('shinL', 'trouser', cyl(0.064, 0.074, 0.070, 10), [0, -0.340, 0.002]);

  // Boot: ankle collar, vamp, toe box, lugged sole, laces.
  part('footL', 'boot', roundedBox(0.100, 0.130, 0.122, 0.032, 3), [0, 0.002, -0.008]);
  part('footL', 'boot', roundedBox(0.100, 0.080, 0.230, 0.030, 3), [0, -0.032, 0.058]);
  part('footL', 'boot', roundedBox(0.090, 0.058, 0.078, 0.028, 3), [0, -0.040, 0.152]);
  part('footL', 'sole', roundedBox(0.106, 0.030, 0.272, 0.010, 3), [0, -0.058, 0.055]);
  part('footL', 'sole', roundedBox(0.094, 0.034, 0.086, 0.010, 2), [0, -0.056, -0.038]);
  for (let i = 0; i < 4; i++) {
    part('footL', 'webbing', roundedBox(0.070, 0.008, 0.010, 0.003, 1), [0, -0.002 - i * 0.022, 0.052 + i * 0.020]);
  }
  const n = _parts.length - n0;
  mirrorLast(n, { thighL: 'thighR', shinL: 'shinR', footL: 'footR' });

  // Drop-leg holster with a sidearm, right thigh only (asymmetry helps the
  // silhouette read as a person rather than a mirrored mannequin).
  part('thighR', 'pouch', roundedBox(0.062, 0.160, 0.104, 0.022, 3), [-0.086, -0.250, 0.006]);
  part('thighR', 'gunmetal', roundedBox(0.032, 0.075, 0.038, 0.010, 2), [-0.086, -0.150, -0.016], [0.28, 0, 0]);
  part('thighR', 'webbing', roundedBox(0.070, 0.012, 0.108, 0.004, 2), [-0.086, -0.180, 0.006]);
  part('thighR', 'webbing', roundedBox(0.070, 0.012, 0.108, 0.004, 2), [-0.086, -0.310, 0.006]);
  part('thighR', 'webbing', roundedBox(0.014, 0.130, 0.010, 0.004, 2), [-0.116, -0.140, 0.006]);
}

// ===========================================================================
// WEAPON — a 0.78 m carbine, authored muzzle-forward along +Z
// ===========================================================================
function buildWeapon() {
  const W = 'weapon';
  // Receivers.
  part(W, 'gunmetal', roundedBox(0.040, 0.078, 0.105, 0.010, 3), [0, 0.048, 0.012]);
  part(W, 'gunmetal', roundedBox(0.044, 0.050, 0.210, 0.010, 3), [0, 0.098, 0.022]);
  part(W, 'gunworn', roundedBox(0.008, 0.030, 0.052, 0.004, 2), [0.024, 0.094, 0.046]);
  part(W, 'gunmetal', roundedBox(0.054, 0.014, 0.032, 0.005, 2), [0, 0.118, -0.078]);
  part(W, 'gunmetal', roundedBox(0.030, 0.014, 0.020, 0.004, 2), [-0.030, 0.118, -0.072]);
  // Magazine — bent so it curves like a real STANAG.
  part(W, 'polymer', bendZ(roundedBox(0.028, 0.200, 0.072, 0.010, 4), 0.022, 0.10), [0, -0.086, 0.010], [-0.06, 0, 0]);
  part(W, 'gunmetal', roundedBox(0.030, 0.016, 0.074, 0.004, 2), [0, 0.006, 0.010]);
  // Pistol grip, raked back.
  part(W, 'polymer', roundedBox(0.036, 0.108, 0.052, 0.018, 3), [0, -0.048, -0.048], [0.30, 0, 0]);
  part(W, 'gunmetal', arc(0.028, 0.005, Math.PI * 1.15, 10, 5), [0, -0.006, -0.012], [0, Math.PI / 2, -0.5]);
  // Buffer tube + collapsible stock.
  part(W, 'gunmetal', cyl(0.020, 0.020, 0.150, 10), [0, 0.098, -0.150], [Math.PI / 2, 0, 0]);
  part(W, 'polymer', roundedBox(0.054, 0.078, 0.130, 0.016, 3), [0, 0.090, -0.190]);
  part(W, 'polymer', roundedBox(0.030, 0.052, 0.060, 0.012, 2), [0, 0.048, -0.170]);
  part(W, 'pad', roundedBox(0.054, 0.092, 0.022, 0.008, 2), [0, 0.090, -0.256]);
  // Free-float handguard with a rail on top and slots along the sides.
  part(W, 'polymer', roundedBox(0.052, 0.058, 0.270, 0.014, 4), [0, 0.096, 0.255]);
  for (let i = 0; i < 9; i++) {
    part(W, 'gunmetal', roundedBox(0.030, 0.009, 0.014, 0.002, 1), [0, 0.128, 0.140 + i * 0.030]);
  }
  for (let i = 0; i < 6; i++) {
    part(W, 'gunmetal', roundedBox(0.056, 0.012, 0.010, 0.002, 1), [0, 0.076, 0.155 + i * 0.038]);
  }
  // Gas block, barrel and muzzle brake.
  part(W, 'gunmetal', roundedBox(0.032, 0.038, 0.042, 0.006, 2), [0, 0.108, 0.398]);
  part(W, 'gunworn', cyl(0.012, 0.012, 0.110, 10), [0, 0.096, 0.442], [Math.PI / 2, 0, 0]);
  part(W, 'gunmetal', cyl(0.018, 0.018, 0.062, 10), [0, 0.096, 0.520], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) {
    part(W, 'polymer', roundedBox(0.040, 0.007, 0.008, 0.002, 1), [0, 0.096, 0.503 + i * 0.017]);
  }
  // Red-dot optic on a riser.
  part(W, 'gunmetal', roundedBox(0.042, 0.034, 0.062, 0.008, 2), [0, 0.140, 0.090]);
  part(W, 'polymer', roundedBox(0.044, 0.052, 0.090, 0.012, 3), [0, 0.174, 0.090]);
  part(W, 'lens', cyl(0.020, 0.020, 0.008, 12), [0, 0.174, 0.134], [Math.PI / 2, 0, 0]);
  part(W, 'lens', cyl(0.020, 0.020, 0.008, 12), [0, 0.174, 0.047], [Math.PI / 2, 0, 0]);
  part(W, 'accent', blob(0.005, 0.005, 0.003, 6, 4), [0, 0.174, 0.131]);
  // Angled foregrip (the left-hand anchor) and a weapon light.
  part(W, 'polymer', roundedBox(0.034, 0.090, 0.048, 0.014, 3), [0, 0.048, 0.298], [-0.38, 0, 0]);
  part(W, 'polymer', cyl(0.015, 0.015, 0.076, 10), [-0.040, 0.090, 0.330], [Math.PI / 2, 0, 0]);
  part(W, 'lens', cyl(0.013, 0.013, 0.006, 10), [-0.040, 0.090, 0.369], [Math.PI / 2, 0, 0]);
  // Sling loops.
  part(W, 'gunmetal', arc(0.015, 0.004, Math.PI * 2, 8, 5), [0.028, 0.070, 0.360], [0, Math.PI / 2, 0]);
  part(W, 'gunmetal', arc(0.015, 0.004, Math.PI * 2, 8, 5), [0.026, 0.090, -0.140], [0, Math.PI / 2, 0]);
}

// ===========================================================================
// Template assembly
// ===========================================================================
let TEMPLATE = null;

/** Bones that own a hitbox, with the damage multiplier combat applies. */
const HITBOX_BONES = [
  ['head', 4.0],
  ['chest', 1.0],
  ['spine', 1.0],
  ['hips', 0.9],
  ['upperArmL', 0.7], ['lowerArmL', 0.6],
  ['upperArmR', 0.7], ['lowerArmR', 0.6],
  ['thighL', 0.85], ['shinL', 0.7],
  ['thighR', 0.85], ['shinR', 0.7],
];

export function getSoldierTemplate() {
  if (TEMPLATE) return TEMPLATE;

  _parts.length = 0;
  buildPelvis();
  buildAbdomen();
  buildChest();
  buildHead();
  buildArms();
  buildLegs();
  buildWeapon();

  // Group by bone+material and merge.
  const groups = new Map();
  for (const p of _parts) {
    const key = p.bone + '|' + p.mat;
    let g = groups.get(key);
    if (!g) { g = { bone: p.bone, mat: p.mat, geos: [] }; groups.set(key, g); }
    const geo = p.geo.clone();
    _e.set(p.rot[0], p.rot[1], p.rot[2]);
    _qq.setFromEuler(_e);
    _p.set(p.pos[0], p.pos[1], p.pos[2]);
    _s.set(p.scale[0], p.scale[1], p.scale[2]);
    _m4.compose(_p, _qq, _s);
    geo.applyMatrix4(_m4);
    if (p.scale[0] * p.scale[1] * p.scale[2] < 0) {
      // Mirrored parts have inverted winding; flip the index so backface
      // culling and normals stay correct.
      const idx = geo.getIndex();
      if (idx) {
        const a = idx.array;
        for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; }
        idx.needsUpdate = true;
      }
      const nrm = geo.attributes.normal;
      for (let i = 0; i < nrm.count; i++) {
        nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
      }
      nrm.needsUpdate = true;
    }
    g.geos.push(geo);
  }

  const meshDefs = [];
  const boneBounds = new Map();
  for (const g of groups.values()) {
    const merged = mergeGeometries(g.geos, false);
    if (!merged) continue;
    for (const geo of g.geos) geo.dispose();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    meshDefs.push({ bone: g.bone, mat: g.mat, geo: merged });
    if (g.bone !== 'weapon') {
      let b = boneBounds.get(g.bone);
      if (!b) { b = new THREE.Box3().makeEmpty(); boneBounds.set(g.bone, b); }
      b.union(merged.boundingBox);
    }
  }

  // Hitbox volumes derived straight from the authored geometry: tight by
  // construction, and they cannot drift out of sync with the model.
  const hitboxDefs = HITBOX_BONES.map(([bone, mult]) => {
    const b = boneBounds.get(bone);
    const box = b ? b.clone() : new THREE.Box3(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(0.1, 0.1, 0.1));
    // Limb bones are thin; a hair of padding keeps grazing shots feeling fair
    // without making the silhouette lie.
    box.expandByScalar(0.012);
    return { bone, mult, box };
  });

  let tris = 0;
  for (const d of meshDefs) tris += (d.geo.getIndex()?.count ?? d.geo.attributes.position.count) / 3;

  TEMPLATE = { meshDefs, hitboxDefs, triangles: Math.round(tris) };
  _parts.length = 0;
  return TEMPLATE;
}

// ---------------------------------------------------------------------------
// Per-agent kit variation — 3 shared material sets, so variety costs no memory.
// ---------------------------------------------------------------------------
function tintSet(hueShift, valueScale, satScale) {
  const set = {};
  const hsl = {};
  for (const [k, m] of Object.entries(MATERIALS)) {
    if (k === 'fatigue' || k === 'trouser' || k === 'carrier' || k === 'pouch' || k === 'helmet') {
      const c = m.clone();
      c.color.getHSL(hsl);
      c.color.setHSL(
        (hsl.h + hueShift + 1) % 1,
        THREE.MathUtils.clamp(hsl.s * satScale, 0, 1),
        THREE.MathUtils.clamp(hsl.l * valueScale, 0.03, 0.85),
      );
      c.name = m.name + '_v';
      set[k] = c;
    } else {
      set[k] = m;
    }
  }
  return set;
}

export const KIT_SETS = [
  MATERIALS,
  tintSet(-0.030, 0.86, 0.78),   // dustier, darker squad
  tintSet(0.022, 1.10, 0.62),    // sun-bleached, greyer squad
];

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------

/**
 * Build one soldier instance. Geometry and materials are shared with every
 * other instance; only the bone Object3Ds and the hitbox Box3s are per-agent.
 */
export function createSoldier({ kit = 0, scale = 1.0, castShadow = true } = {}) {
  const tpl = getSoldierTemplate();
  const mats = KIT_SETS[kit % KIT_SETS.length];

  const root = new THREE.Group();
  root.name = 'soldier';
  root.scale.setScalar(scale);

  const bones = {};
  for (const [name, parent, off] of SKELETON) {
    const b = new THREE.Object3D();
    b.name = name;
    b.position.set(off[0], off[1], off[2]);
    b.rotation.order = 'YXZ';
    bones[name] = b;
    (parent ? bones[parent] : root).add(b);
  }

  // The weapon lives on its own mount under the chest rather than in the hand:
  // the animation layer aims the WEAPON at the target and then IKs both hands
  // onto it, which is the only way to guarantee the muzzle actually points
  // where the agent is shooting.
  const weaponMount = new THREE.Object3D();
  weaponMount.name = 'weaponMount';
  weaponMount.rotation.order = 'YXZ';
  bones.chest.add(weaponMount);

  const meshes = [];
  const boneMesh = {};
  for (const def of tpl.meshDefs) {
    const parent = def.bone === 'weapon' ? weaponMount : bones[def.bone];
    if (!parent) continue;
    const mesh = new THREE.Mesh(def.geo, mats[def.mat] || MATERIALS[def.mat]);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;   // bones move the geometry far from its bounds
    mesh.name = def.bone + '_' + def.mat;
    parent.add(mesh);
    meshes.push(mesh);
    if (!boneMesh[def.bone]) boneMesh[def.bone] = mesh;
  }

  const hitboxes = tpl.hitboxDefs.map((d) => ({
    name: d.bone,
    bone: bones[d.bone],
    mesh: boneMesh[d.bone] || meshes[0],
    multiplier: d.mult,
    local: d.box,
    box: new THREE.Box3(),
  }));

  return { root, bones, weaponMount, meshes, hitboxes, scale };
}

export function soldierTriangleCount() {
  return getSoldierTemplate().triangles;
}
