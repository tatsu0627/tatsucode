import * as THREE from 'three';
import { bevelBox } from '../world/geo.js';

/**
 * Procedural M4-pattern carbine.
 *
 * Built from bevelled primitives in code — there are no downloadable assets in
 * this project. Proportions are taken from the real thing in metres, because a
 * viewmodel that is even 10% off in receiver-to-barrel ratio reads as a toy no
 * matter how good the material is.
 *
 * Local space: +X right, +Y up, -Z forward (muzzle points at -Z), origin at the
 * pistol grip so rotations pivot where the hand would hold it.
 *
 * Named nodes the weapons module animates:
 *   root, charging, magazine, trigger, bolt, muzzle (empty at the muzzle tip)
 */

const MATS = {};

function materials() {
  if (MATS.polymer) return MATS;

  // Glass-filled nylon: dark, matte, very slightly warm. Never pure black —
  // real polymer always picks up some sheen and a black surface kills the form.
  MATS.polymer = new THREE.MeshStandardMaterial({
    color: 0x33363b, roughness: 0.60, metalness: 0.0,
  });
  // Hard-anodised aluminium: a metal, but a rough one. Type III anodising is
  // matte — a glossy receiver is the classic giveaway of a fake gun model.
  MATS.alloy = new THREE.MeshStandardMaterial({
    color: 0x4a4e54, roughness: 0.42, metalness: 1.0,
  });
  // Nitrided barrel steel, darker and slightly glossier than the receiver.
  MATS.steel = new THREE.MeshStandardMaterial({
    color: 0x2c2f33, roughness: 0.32, metalness: 1.0,
  });
  MATS.optic = new THREE.MeshStandardMaterial({
    color: 0x2a2d31, roughness: 0.48, metalness: 1.0,
  });
  // Coated lens: strong tint, low roughness, and emissive enough that the
  // reticle reads against a bright desert background.
  MATS.lens = new THREE.MeshStandardMaterial({
    color: 0x14323c, roughness: 0.08, metalness: 0.0,
    transparent: true, opacity: 0.55,
  });
  MATS.reticle = new THREE.MeshBasicMaterial({
    color: 0xff3322, transparent: true, opacity: 0.95, toneMapped: false,
  });
  MATS.brass = new THREE.MeshStandardMaterial({
    color: 0xb08d3a, roughness: 0.3, metalness: 1.0,
  });
  return MATS;
}

function part(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = false;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

const cyl = (r1, r2, h, seg = 14) => new THREE.CylinderGeometry(r1, r2, h, seg);

export function buildCarbine() {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'carbine';

  // ---- lower receiver + grip ---------------------------------------------
  part(root, bevelBox(0.038, 0.062, 0.20, 0.004), M.alloy, 0, 0.078, -0.035);
  // magazine well
  part(root, bevelBox(0.036, 0.055, 0.048, 0.003), M.alloy, 0, 0.045, 0.008);

  // Pistol grip, raked back ~22 degrees like the real A2 grip.
  const grip = part(root, bevelBox(0.034, 0.105, 0.045, 0.008), M.polymer, 0, 0.0, -0.005, 0.38);
  grip.name = 'grip';

  // trigger guard + trigger
  part(root, bevelBox(0.028, 0.006, 0.058, 0.002), M.alloy, 0, 0.028, -0.048);
  part(root, bevelBox(0.006, 0.004, 0.058, 0.001), M.alloy, 0, 0.049, -0.078);
  const trigger = part(root, bevelBox(0.007, 0.026, 0.010, 0.002), M.steel, 0, 0.040, -0.050, 0.1);
  trigger.name = 'trigger';

  // ---- magazine (curved STANAG: three segments with increasing rake) ------
  const magazine = new THREE.Group();
  magazine.name = 'magazine';
  magazine.position.set(0, 0.036, 0.010);
  root.add(magazine);
  part(magazine, bevelBox(0.030, 0.075, 0.043, 0.004), M.polymer, 0, -0.038, 0.004, 0.06);
  part(magazine, bevelBox(0.029, 0.070, 0.042, 0.004), M.polymer, 0, -0.104, 0.014, 0.16);
  part(magazine, bevelBox(0.030, 0.016, 0.044, 0.004), M.polymer, 0, -0.146, 0.026, 0.16);

  // ---- upper receiver -----------------------------------------------------
  part(root, bevelBox(0.040, 0.048, 0.235, 0.004), M.alloy, 0, 0.132, -0.055);
  // Picatinny top rail: individual slots, because a smooth-topped receiver is
  // instantly readable as fake at ADS distance.
  for (let i = 0; i < 13; i++) {
    part(root, bevelBox(0.030, 0.007, 0.0075, 0.0012), M.alloy, 0, 0.160, 0.040 - i * 0.0155);
  }
  // forward assist + ejection port cover
  part(root, cyl(0.008, 0.008, 0.020, 10), M.alloy, 0.022, 0.128, 0.012, 0, 0, Math.PI / 2);
  part(root, bevelBox(0.004, 0.026, 0.052, 0.001), M.alloy, 0.021, 0.132, -0.028);
  // brass deflector
  part(root, bevelBox(0.010, 0.020, 0.016, 0.004), M.alloy, 0.022, 0.146, 0.004);

  const bolt = part(root, bevelBox(0.020, 0.018, 0.030, 0.002), M.steel, 0.012, 0.132, -0.020);
  bolt.name = 'bolt';

  // Charging handle, animated on reload.
  const charging = new THREE.Group();
  charging.name = 'charging';
  charging.position.set(0, 0.150, 0.052);
  root.add(charging);
  part(charging, bevelBox(0.052, 0.010, 0.014, 0.002), M.alloy, 0, 0, 0);
  part(charging, bevelBox(0.014, 0.012, 0.030, 0.002), M.alloy, -0.024, -0.002, -0.014);

  // ---- handguard ----------------------------------------------------------
  // Free-float tube with M-LOK style slots and a top rail continuing the upper.
  part(root, bevelBox(0.044, 0.046, 0.230, 0.005), M.alloy, 0, 0.130, -0.290);
  for (let i = 0; i < 12; i++) {
    part(root, bevelBox(0.030, 0.006, 0.0075, 0.0012), M.alloy, 0, 0.155, -0.180 - i * 0.0155);
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      part(root, bevelBox(0.004, 0.010, 0.030, 0.001), M.polymer,
        sx * 0.023, 0.128, -0.215 - i * 0.040);
    }
  }

  // ---- barrel + gas block + muzzle ---------------------------------------
  part(root, cyl(0.0092, 0.0092, 0.150, 12), M.steel, 0, 0.130, -0.440, Math.PI / 2);
  part(root, bevelBox(0.020, 0.024, 0.030, 0.002), M.steel, 0, 0.137, -0.398);
  part(root, cyl(0.0035, 0.0035, 0.115, 8), M.steel, 0, 0.148, -0.360, Math.PI / 2);

  // A2-style birdcage: a tube with slots cut by dark inserts.
  part(root, cyl(0.0125, 0.0125, 0.052, 14), M.steel, 0, 0.130, -0.530, Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    part(root, bevelBox(0.004, 0.004, 0.028, 0.0008), M.polymer,
      Math.cos(a) * 0.011, 0.130 + Math.sin(a) * 0.011, -0.532);
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0.130, -0.560);
  root.add(muzzle);

  // ---- stock --------------------------------------------------------------
  part(root, cyl(0.014, 0.014, 0.115, 12), M.alloy, 0, 0.118, 0.115, Math.PI / 2);
  part(root, bevelBox(0.036, 0.058, 0.100, 0.006), M.polymer, 0, 0.112, 0.150);
  part(root, bevelBox(0.040, 0.070, 0.020, 0.006), M.polymer, 0, 0.104, 0.205);
  // cheek weld ridge
  part(root, bevelBox(0.030, 0.014, 0.080, 0.004), M.polymer, 0, 0.146, 0.150);

  // ---- optic --------------------------------------------------------------
  const optic = new THREE.Group();
  optic.name = 'optic';
  optic.position.set(0, 0.196, -0.030);
  root.add(optic);
  part(optic, bevelBox(0.030, 0.030, 0.038, 0.004), M.optic, 0, -0.026, 0.006);   // mount
  part(optic, cyl(0.019, 0.019, 0.078, 16), M.optic, 0, 0, 0, Math.PI / 2);       // tube
  part(optic, cyl(0.021, 0.021, 0.010, 16), M.optic, 0, 0, -0.040, Math.PI / 2);  // objective bell
  part(optic, cyl(0.021, 0.021, 0.010, 16), M.optic, 0, 0, 0.040, Math.PI / 2);   // ocular
  part(optic, cyl(0.0175, 0.0175, 0.002, 16), M.lens, 0, 0, -0.034, Math.PI / 2);
  const reticle = part(optic, new THREE.RingGeometry(0.0016, 0.0030, 12), M.reticle, 0, 0, -0.030);
  reticle.name = 'reticle';
  // turrets
  part(optic, cyl(0.008, 0.008, 0.012, 10), M.optic, 0, 0.021, 0.004);
  part(optic, cyl(0.008, 0.008, 0.012, 10), M.optic, 0.021, 0, 0.004, 0, 0, Math.PI / 2);

  // Back-up iron sight, folded down beside the optic.
  part(root, bevelBox(0.018, 0.020, 0.006, 0.001), M.alloy, 0, 0.170, -0.150, -0.5);

  // ---- sling loop ---------------------------------------------------------
  part(root, new THREE.TorusGeometry(0.010, 0.0022, 6, 12), M.steel, -0.022, 0.110, 0.060, 0, Math.PI / 2);

  root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; } });
  return { root, nodes: { muzzle, charging, magazine, trigger, bolt, optic, reticle } };
}

export function disposeCarbine(model) {
  model.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
}
