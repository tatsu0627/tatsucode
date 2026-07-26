import * as THREE from 'three';
import { Builder, mat, bevelBox, catenary, tubeAlong, rand } from './geo.js';

/**
 * "Blacksite" — the level layout.
 *
 * Authored against the six capture vantage points in src/core/capture.js, since
 * those are the frames that get reviewed. Roughly:
 *
 *        -Z (north)
 *   ┌──────────────────────────┐
 *   │  tower      mesa backdrop│
 *   │ ┌────────┐    ┌─────────┐│
 *   │ │ admin  │    │warehouse││   admin block is the interior vantage,
 *   │ │ 2-floor│    │ (east)  ││   warehouse gives the east silhouette
 *   │ └────────┘    └─────────┘│
 *   │      courtyard + road    │   road runs north-south at x≈-2
 *   │  barriers / sandbags     │
 *   └──────────────────────────┘
 *        +Z (player spawn)
 *
 * Everything is metres. The Builder handles bevelling, world-space UVs, vertex
 * dirt and collider generation, so this file is concerned only with layout and
 * dressing density.
 */

const R = rand(20260726);
const rnd = (a, b) => a + R() * (b - a);
const pick = arr => arr[Math.floor(R() * arr.length) % arr.length];

// ---------------------------------------------------------------------------
// wall with openings
// ---------------------------------------------------------------------------
/**
 * A wall running along X or Z, with rectangular holes punched for doors and
 * windows. Built as jamb/sill/lintel segments rather than CSG — cheaper, and it
 * keeps every piece a clean bevelled box that catches a highlight on its edges.
 *
 * openings: [{at, width, bottom, top}] where `at` is the centre offset along the
 * wall's own axis, measured from its centre.
 */
function wall(b, matKey, opts) {
  const { x, z, len, height, thick = 0.35, axis = 'x', base = 0, openings = [] } = opts;
  const along = axis === 'x';
  const half = len / 2;

  // Sort openings and walk the wall left-to-right emitting solid spans between.
  const sorted = [...openings].sort((a, o) => a.at - o.at);
  let cursor = -half;

  const solidSpan = (from, to) => {
    const w = to - from;
    if (w <= 0.01) return;
    const c = (from + to) / 2;
    b.box(matKey,
      along ? x + c : x, base + height / 2, along ? z : z + c,
      along ? w : thick, height, along ? thick : w,
      { bevel: 0.03 });
  };

  for (const o of sorted) {
    const left = o.at - o.width / 2;
    const right = o.at + o.width / 2;
    solidSpan(cursor, left);
    const bottom = o.bottom ?? 0;
    const top = o.top ?? height;
    // sill below the opening
    if (bottom > 0.01) {
      const c = o.at;
      b.box(matKey,
        along ? x + c : x, base + bottom / 2, along ? z : z + c,
        along ? o.width : thick, bottom, along ? thick : o.width,
        { bevel: 0.03 });
    }
    // lintel above it
    if (top < height - 0.01) {
      const c = o.at;
      const h = height - top;
      b.box(matKey,
        along ? x + c : x, base + top + h / 2, along ? z : z + c,
        along ? o.width : thick, h, along ? thick : o.width,
        { bevel: 0.03 });
    }
    cursor = right;
  }
  solidSpan(cursor, half);
}

// ---------------------------------------------------------------------------
// props
// ---------------------------------------------------------------------------

function jerseyBarrier(b, x, z, rotY) {
  // Tapered profile: wide foot, narrow top. Two stacked boxes reads correctly at
  // gameplay distance and costs a fraction of a lathe.
  b.box('concreteWarm', x, 0.28, z, 0.62, 0.56, 1.9, { rotY, bevel: 0.05 });
  b.box('concreteWarm', x, 0.72, z, 0.34, 0.42, 1.86, { rotY, bevel: 0.05, collide: false });
}

function sandbagWall(b, x, z, len, rotY, rows = 3) {
  const bagW = 0.52, bagH = 0.22, bagD = 0.34;
  const n = Math.max(1, Math.round(len / bagW));
  const c = Math.cos(rotY), s = Math.sin(rotY);
  for (let row = 0; row < rows; row++) {
    const inset = row * 0.045;
    const offset = (row % 2) * bagW * 0.5;
    for (let i = 0; i < n - row; i++) {
      const t = (i - (n - row - 1) / 2) * bagW + offset;
      const px = x + c * t, pz = z - s * t;
      b.instance('sandbag', row % 2 ? 'sandbagGreen' : 'sandbag',
        () => bevelBox(bagW * 0.97, bagH, bagD, 0.07),
        mat(px, bagH / 2 + row * bagH * 0.94, pz,
            rotY + rnd(-0.09, 0.09), 1, 1, 1 - inset));
    }
  }
  // One conservative collider for the whole emplacement.
  b.collideBox(x, (rows * bagH) / 2, z, Math.abs(c) * len + 0.4, rows * bagH, Math.abs(s) * len + 0.4);
}

function container(b, x, y, z, rotY, matKey) {
  const w = 6.06, h = 2.59, d = 2.44;
  b.box(matKey, x, y + h / 2, z, w, h, d, { rotY, bevel: 0.035 });
  // Corner castings — small, but they are what make a container read as a
  // container rather than a painted box.
  const c = Math.cos(rotY), s = Math.sin(rotY);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lx = sx * (w / 2 - 0.16), lz = sz * (d / 2 - 0.16);
    for (const sy of [0, 1]) {
      b.instance('casting', 'steelBare', () => bevelBox(0.3, 0.24, 0.3, 0.02),
        mat(x + c * lx - s * lz, y + (sy ? h - 0.12 : 0.12), z + s * lx + c * lz, rotY));
    }
  }
}

function barrel(b, x, z, matKey = 'rusted') {
  const g = () => new THREE.CylinderGeometry(0.29, 0.29, 0.88, 16, 1);
  b.instance('barrel', matKey, g, mat(x, 0.44, z, rnd(0, 6.28)));
  // Rolling ribs.
  for (const yy of [0.28, 0.6]) {
    b.instance('barrelRib', matKey, () => new THREE.TorusGeometry(0.295, 0.022, 6, 18, Math.PI * 2),
      mat(x, yy, z, 0, 1, 1, 1, Math.PI / 2));
  }
  b.collideBox(x, 0.44, z, 0.6, 0.88, 0.6);
}

function crate(b, x, z, size = 0.8, rotY = 0) {
  b.instance('crate', R() < 0.5 ? 'wood' : 'woodPale',
    () => bevelBox(size, size * 0.82, size * 0.92, 0.02), mat(x, size * 0.41, z, rotY));
  b.collideBox(x, size * 0.41, z, size, size * 0.82, size * 0.92, rotY);
}

function acUnit(b, x, y, z, rotY = 0) {
  b.box('steelWhite', x, y + 0.36, z, 1.05, 0.72, 0.95, { rotY, bevel: 0.03, collide: false });
  b.instance('acFan', 'grating', () => new THREE.CircleGeometry(0.29, 20),
    mat(x, y + 0.4, z + 0.49, rotY, 1, 1, 1, 0, 0));
}

function pipeRun(b, pts, radius, matKey = 'rusted') {
  const geo = tubeAlong(pts.map(p => new THREE.Vector3(...p)), radius, 8, false);
  b.place(matKey, geo, [0, 0, 0], [0, 0, 0], [1, 1, 1], { collide: false });
}

function cable(b, a, c, sag) {
  const pts = catenary(new THREE.Vector3(...a), new THREE.Vector3(...c), sag, 16);
  b.place('steelBare', tubeAlong(pts, 0.022, 5, false), [0, 0, 0], [0, 0, 0], [1, 1, 1], { collide: false });
}

function lightPole(b, x, z) {
  b.box('steelBare', x, 3.0, z, 0.16, 6.0, 0.16, { bevel: 0.02 });
  b.box('steelBare', x + 0.5, 5.9, z, 1.1, 0.12, 0.12, { bevel: 0.02, collide: false });
  b.box('steelWhite', x + 1.0, 5.78, z, 0.44, 0.16, 0.3, { bevel: 0.03, collide: false });
}

function antenna(b, x, y, z) {
  b.box('steelBare', x, y + 1.6, z, 0.07, 3.2, 0.07, { bevel: 0.01, collide: false });
  for (const yy of [1.0, 1.9, 2.7]) {
    b.instance('antennaArm', 'steelBare', () => bevelBox(0.9, 0.035, 0.035, 0.008),
      mat(x, y + yy, z, rnd(0, 3.14)));
  }
}

// ---------------------------------------------------------------------------
// the level
// ---------------------------------------------------------------------------
export function buildLevel(matlib, root) {
  const b = new Builder(matlib);

  // --- ground ------------------------------------------------------------
  // Sand base, with an asphalt road strip and a concrete apron. Slightly
  // different heights so the edges read as real kerbs rather than decals.
  b.box('sand', 0, -0.6, -10, 200, 1.2, 200, { bevel: 0, collide: false, tile: 6 });
  b.box('asphalt', -2, -0.005, -8, 9.5, 0.06, 76, { bevel: 0.02, collide: false, tile: 5 });
  b.box('concrete', 8, -0.01, -4, 14, 0.08, 28, { bevel: 0.02, collide: false, tile: 4 });
  // Kerbs along the road.
  for (const kx of [-6.9, 2.9]) {
    b.box('concreteDark', kx, 0.06, -8, 0.32, 0.16, 76, { bevel: 0.03, collide: false });
  }

  // --- admin block (west, two storeys, interior vantage) ------------------
  const A = { x: -14, z: -6, w: 16, d: 16, h: 3.3, h2: 3.1 };
  const floorY = [0, A.h];

  // Ground floor: east wall faces the courtyard and carries the big openings
  // that the volumetric shafts read through.
  wall(b, 'plasterWarm', {
    x: A.x + A.w / 2, z: A.z, len: A.d, height: A.h, axis: 'z',
    openings: [
      { at: -4.5, width: 2.0, bottom: 0, top: 2.4 },      // doorway
      { at: 1.0, width: 2.6, bottom: 1.0, top: 2.5 },     // window
      { at: 5.5, width: 2.6, bottom: 1.0, top: 2.5 },
    ],
  });
  wall(b, 'plasterWarm', { x: A.x - A.w / 2, z: A.z, len: A.d, height: A.h, axis: 'z',
    openings: [{ at: 0, width: 2.4, bottom: 1.1, top: 2.5 }] });
  wall(b, 'plasterWarm', { x: A.x, z: A.z - A.d / 2, len: A.w, height: A.h, axis: 'x',
    openings: [{ at: -3, width: 2.2, bottom: 1.1, top: 2.5 }, { at: 4, width: 2.2, bottom: 1.1, top: 2.5 }] });
  wall(b, 'plasterWarm', { x: A.x, z: A.z + A.d / 2, len: A.w, height: A.h, axis: 'x',
    openings: [{ at: 2.5, width: 2.6, bottom: 0, top: 2.5 }] });

  // Second storey, set back slightly with a parapet — the setback catches the
  // low sun and gives the silhouette a step instead of a flat slab.
  b.box('concrete', A.x, A.h - 0.12, A.z, A.w + 0.5, 0.34, A.d + 0.5, { bevel: 0.04, collide: false });
  wall(b, 'plasterWarm', { x: A.x + A.w / 2 - 0.4, z: A.z, len: A.d - 1, height: A.h2, axis: 'z', base: A.h,
    openings: [{ at: -3, width: 2.4, bottom: 1.0, top: 2.4 }, { at: 3, width: 2.4, bottom: 1.0, top: 2.4 }] });
  wall(b, 'plasterWarm', { x: A.x - A.w / 2 + 0.4, z: A.z, len: A.d - 1, height: A.h2, axis: 'z', base: A.h });
  wall(b, 'plasterWarm', { x: A.x, z: A.z - A.d / 2 + 0.4, len: A.w - 1, height: A.h2, axis: 'x', base: A.h,
    openings: [{ at: 0, width: 2.6, bottom: 1.0, top: 2.4 }] });
  wall(b, 'plasterWarm', { x: A.x, z: A.z + A.d / 2 - 0.4, len: A.w - 1, height: A.h2, axis: 'x', base: A.h });

  // Roof slab + parapet.
  const roofY = A.h + A.h2;
  b.box('concrete', A.x, roofY + 0.1, A.z, A.w - 0.6, 0.24, A.d - 0.6, { bevel: 0.04 });
  for (const [px, pz, pw, pd] of [
    [A.x, A.z - A.d / 2 + 0.4, A.w - 0.6, 0.28],
    [A.x, A.z + A.d / 2 - 0.4, A.w - 0.6, 0.28],
    [A.x - A.w / 2 + 0.4, A.z, 0.28, A.d - 0.6],
    [A.x + A.w / 2 - 0.4, A.z, 0.28, A.d - 0.6],
  ]) b.box('concreteWarm', px, roofY + 0.62, pz, pw, 0.8, pd, { bevel: 0.035, collide: false });

  // Interior: floor slab, a mezzanine, and a stair — the interior vantage looks
  // straight in here, so it cannot be an empty shell.
  b.box('concreteDark', A.x, -0.02, A.z, A.w - 0.7, 0.12, A.d - 0.7, { bevel: 0, collide: false, tile: 3 });
  b.box('concreteDark', A.x - 3, A.h - 0.15, A.z + 3.5, 9, 0.3, 8, { bevel: 0.03 });
  for (let i = 0; i < 9; i++) {                        // stair flight
    b.box('concreteDark', A.x + 3.4, 0.18 + i * 0.36, A.z + 6.6 - i * 0.62, 3.0, 0.36, 0.62,
      { bevel: 0.02 });
  }
  // Interior partitions and clutter.
  b.box('plaster', A.x - 2.0, 1.4, A.z - 2.5, 0.25, 2.8, 6.0, { bevel: 0.03 });
  crate(b, A.x + 4.2, A.z - 4.0, 0.9, 0.3);
  crate(b, A.x + 4.6, A.z - 5.0, 0.7, -0.5);
  crate(b, A.x + 3.6, A.z - 4.6, 0.75, 1.1);
  barrel(b, A.x - 5.5, A.z - 5.5, 'steelGreen');
  barrel(b, A.x - 4.8, A.z - 6.1);
  b.box('steelGreen', A.x - 6.0, 0.9, A.z + 4.0, 0.9, 1.8, 1.6, { bevel: 0.03 });   // locker bank
  b.box('steelGreen', A.x - 6.0, 0.9, A.z + 5.7, 0.9, 1.8, 1.6, { bevel: 0.03 });
  b.box('wood', A.x + 1.5, 0.74, A.z + 4.5, 1.8, 0.08, 0.9, { bevel: 0.02 });        // desk top
  for (const [lx, lz] of [[0.8, 0.38], [-0.8, 0.38], [0.8, -0.38], [-0.8, -0.38]])
    b.box('steelBare', A.x + 1.5 + lx, 0.37, A.z + 4.5 + lz, 0.07, 0.74, 0.07, { bevel: 0.01, collide: false });

  // --- warehouse (east, corrugated) --------------------------------------
  const W = { x: 15, z: -4, w: 18, d: 22, h: 6.4 };
  wall(b, 'corrugatedTan', { x: W.x - W.w / 2, z: W.z, len: W.d, height: W.h, axis: 'z', thick: 0.3,
    openings: [{ at: -2, width: 5.0, bottom: 0, top: 4.6 }] });     // roller door
  wall(b, 'corrugatedTan', { x: W.x + W.w / 2, z: W.z, len: W.d, height: W.h, axis: 'z', thick: 0.3 });
  wall(b, 'corrugatedTan', { x: W.x, z: W.z - W.d / 2, len: W.w, height: W.h, axis: 'x', thick: 0.3 });
  wall(b, 'corrugatedTan', { x: W.x, z: W.z + W.d / 2, len: W.w, height: W.h, axis: 'x', thick: 0.3,
    openings: [{ at: 0, width: 4.0, bottom: 0, top: 4.2 }] });
  // Shallow pitched roof.
  for (const s of [-1, 1]) {
    b.box('corrugated', W.x + s * W.w / 4, W.h + 0.5, W.z, W.w / 2 + 0.4, 0.22, W.d + 0.6,
      { rot: [0, 0, s * 0.12], bevel: 0.03, collide: false });
  }
  // Roof-line ribs read strongly against the sky in the vista shot.
  for (let i = -4; i <= 4; i++) {
    b.box('steelBare', W.x, W.h + 0.62, W.z + i * 2.4, W.w + 0.6, 0.1, 0.14, { bevel: 0.015, collide: false });
  }
  acUnit(b, W.x - 4, W.h + 0.7, W.z + 6, 0.2);
  acUnit(b, W.x + 2, W.h + 0.7, W.z + 7.5, -0.1);
  antenna(b, W.x + 6, W.h + 0.8, W.z - 8);

  // --- guard tower (north, silhouette anchor for the vista) ---------------
  const T = { x: -1, z: -34, h: 7.2 };
  for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
    b.box('steelBare', T.x + dx, T.h / 2, T.z + dz, 0.22, T.h, 0.22, { bevel: 0.02 });
  }
  // Cross bracing — thin diagonals that alias badly without good AA, which makes
  // them a useful honesty check on the render pipeline.
  for (const [ax, az, bx, bz] of [[-1.5, -1.5, 1.5, -1.5], [1.5, 1.5, -1.5, 1.5],
                                  [-1.5, -1.5, -1.5, 1.5], [1.5, -1.5, 1.5, 1.5]]) {
    for (const s of [1, -1]) {
      const len = Math.hypot(bx - ax, bz - az);
      const midx = T.x + (ax + bx) / 2, midz = T.z + (az + bz) / 2;
      const ang = Math.atan2(bz - az, bx - ax);
      b.box('steelBare', midx, T.h * 0.5, midz, Math.hypot(len, T.h * 0.8), 0.07, 0.07,
        { rot: [0, -ang, s * Math.atan2(T.h * 0.8, len)], bevel: 0.012, collide: false });
    }
  }
  b.box('concreteDark', T.x, T.h + 0.12, T.z, 4.4, 0.24, 4.4, { bevel: 0.04 });
  wall(b, 'sandbag', { x: T.x, z: T.z - 2.0, len: 4.4, height: 1.1, axis: 'x', base: T.h + 0.24, thick: 0.5 });
  wall(b, 'sandbag', { x: T.x, z: T.z + 2.0, len: 4.4, height: 1.1, axis: 'x', base: T.h + 0.24, thick: 0.5 });
  wall(b, 'sandbag', { x: T.x - 2.0, z: T.z, len: 4.4, height: 1.1, axis: 'z', base: T.h + 0.24, thick: 0.5 });
  b.box('corrugatedGreen', T.x, T.h + 2.9, T.z, 5.0, 0.16, 5.0, { bevel: 0.04, collide: false });
  for (const [dx, dz] of [[-2.0, -2.0], [2.0, -2.0], [-2.0, 2.0], [2.0, 2.0]])
    b.box('steelBare', T.x + dx, T.h + 2.0, T.z + dz, 0.1, 1.7, 0.1, { bevel: 0.015, collide: false });

  // --- courtyard dressing -------------------------------------------------
  for (const [x, z, r] of [[3.5, 8, 0.06], [3.6, 5.9, -0.04], [3.4, 3.8, 0.02],
                           [-7.4, 7.2, 3.18], [-7.5, 5.1, 3.10], [-7.3, 3.0, 3.20]])
    jerseyBarrier(b, x, z, r);

  sandbagWall(b, 5.5, -1.0, 5.5, 0.06, 3);
  sandbagWall(b, -6.5, -9.0, 4.4, Math.PI / 2, 3);

  container(b, 9.5, 0, 12.5, 0.04, 'container');
  container(b, 9.6, 2.62, 12.4, 0.02, 'steelRed');
  container(b, 2.0, 0, -20.0, 1.55, 'steelGreen');
  container(b, -9.0, 0, -20.5, 1.60, 'container');

  for (const [x, z] of [[6.9, 6.2], [7.5, 6.9], [6.6, 7.3], [-4.2, -14.5], [-3.4, -14.9],
                        [12.0, 9.0], [12.7, 9.6], [-11.5, 8.4], [-12.2, 8.9]])
    barrel(b, x, z, R() < 0.4 ? 'steelGreen' : 'rusted');

  for (const [x, z] of [[1.2, 10.5], [1.9, 11.2], [1.4, 11.9], [-9.5, -1.0], [-10.2, -1.4],
                        [13.5, 3.0], [14.2, 3.6], [-3.0, 14.0], [-2.2, 14.4]])
    crate(b, x, z, rnd(0.65, 0.95), rnd(0, 3.14));

  lightPole(b, 4.5, 14);
  lightPole(b, 4.5, -2);
  lightPole(b, 4.5, -18);
  cable(b, [4.5, 5.9, 14], [4.5, 5.9, -2], 1.1);
  cable(b, [4.5, 5.9, -2], [4.5, 5.9, -18], 1.1);
  cable(b, [-6.1, 5.4, -6], [4.5, 5.8, -2], 1.4);

  pipeRun(b, [[-6.0, 4.2, -13], [-6.0, 4.2, 1], [-6.0, 2.0, 1]], 0.09);
  pipeRun(b, [[-6.35, 3.9, -13], [-6.35, 3.9, 1]], 0.06);
  pipeRun(b, [[6.2, 5.6, -14], [6.2, 5.6, 6], [6.2, 1.2, 6]], 0.11, 'steelGreen');

  // Chain-link along the south edge — alpha-tested, another AA stress test.
  for (let i = 0; i < 6; i++) {
    const z = 18.5;
    const x = -18 + i * 6;
    b.box('chainlink', x, 1.2, z, 6, 2.4, 0.04, { bevel: 0, collide: false, dirt: false });
    b.box('steelBare', x - 3, 1.3, z, 0.09, 2.6, 0.09, { bevel: 0.015, collide: false });
  }

  // Tarps over a couple of stacks — soft shapes among all the hard boxes.
  b.box('tarpTan', 12.0, 1.35, 9.3, 3.2, 0.06, 2.6, { rot: [0.06, 0.2, -0.04], bevel: 0.02, collide: false });
  b.box('tarp', -12.0, 1.0, 8.6, 2.6, 0.06, 2.2, { rot: [-0.05, -0.3, 0.05], bevel: 0.02, collide: false });

  // Rubble/debris scatter — small, dense, and irregular. Cheap, and it does more
  // for "this place is used" than another building would.
  for (let i = 0; i < 150; i++) {
    const x = rnd(-26, 26), z = rnd(-32, 20);
    // keep it out of the buildings' footprints
    if (Math.abs(x - A.x) < A.w / 2 && Math.abs(z - A.z) < A.d / 2) continue;
    if (Math.abs(x - W.x) < W.w / 2 && Math.abs(z - W.z) < W.d / 2) continue;
    const s = rnd(0.06, 0.26);
    b.instance('rubble', pick(['concreteDark', 'concreteWarm', 'rusted']),
      () => bevelBox(1, 0.6, 0.85, 0.12),
      mat(x, s * 0.3, z, rnd(0, 6.28), s, s * rnd(0.5, 1.0), s * rnd(0.7, 1.2)));
  }

  // --- distant backdrop ---------------------------------------------------
  // Mesa silhouettes far to the north. Non-colliding, no shadow cost, purely for
  // the vista frame's depth read — the haze does the rest.
  for (let i = 0; i < 14; i++) {
    const x = rnd(-160, 160);
    const z = -110 - R() * 90;
    const w = rnd(24, 70), h = rnd(9, 30);
    const m = b.instance('mesa', 'sand', () => bevelBox(1, 1, 1, 0.06),
      mat(x, h / 2, z, rnd(0, 6.28), w, h, rnd(20, 50)));
    void m;
  }

  const targets = b.build(root, 'blacksite');
  return { targets, colliders: b.colliders, tris: b.tris };
}

export const SPAWNS = [
  { pos: [-2, 1.68, 14], yaw: Math.PI },
  { pos: [8, 1.68, 6], yaw: -2.2 },
  { pos: [-12, 1.68, 4], yaw: 2.6 },
];
