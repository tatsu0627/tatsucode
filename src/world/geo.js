import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, clamp01, smoothstep, lerp } from './fields.js';

/**
 * geo.js — geometry construction, UV projection, dirt baking and batching.
 *
 * THE BEVEL RULE
 *   Nothing in this level is an unbevelled box. Real edges are never
 *   mathematically sharp: they are chipped, chamfered or radiused, and they
 *   catch a bright line of light when a low sun rakes across them. A 90-degree
 *   edge produces a hard albedo step and nothing else, which is the single most
 *   recognisable tell of amateur real-time art. `bevelBox` builds a genuine
 *   chamfered solid: 6 flat faces, 12 flat chamfer strips, 8 corner triangles,
 *   with faceted normals so each chamfer returns its own specular highlight.
 *
 * THE UV RULE
 *   UVs are never authored per-object. `worldUV` projects world-space position
 *   onto the dominant axis of each face and divides by the material's
 *   `tileMetres`. Consequences: texture scale is physically identical on every
 *   surface in the level (the "why is the concrete tiling every 30 cm on this
 *   wall and every 4 m on that one" problem cannot occur), merged walls have
 *   continuous grain across the seam, and V always points along world +Y on
 *   vertical surfaces so corrugation runs vertically and brick courses run
 *   horizontally without any per-object bookkeeping.
 */

// ---------------------------------------------------------------------------
// bevelled box
// ---------------------------------------------------------------------------
const _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

export function bevelBox(w, h, d, bevel = 0.02) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const b = Math.max(0.0015, Math.min(bevel, hx * 0.42, hy * 0.42, hz * 0.42));
  const pos = [], nor = [], idx = [];

  // 24 "corner x axis" positions
  const P = [];
  for (let c = 0; c < 8; c++) {
    const sx = (c & 4) ? 1 : -1, sy = (c & 2) ? 1 : -1, sz = (c & 1) ? 1 : -1;
    P[c * 3 + 0] = [sx * hx, sy * (hy - b), sz * (hz - b)];
    P[c * 3 + 1] = [sx * (hx - b), sy * hy, sz * (hz - b)];
    P[c * 3 + 2] = [sx * (hx - b), sy * (hy - b), sz * hz];
  }
  const CI = (sx, sy, sz) => (sx > 0 ? 4 : 0) + (sy > 0 ? 2 : 0) + (sz > 0 ? 1 : 0);

  const emit = (verts, nx, ny, nz) => {
    // winding fix: compare the polygon normal to the intended normal
    _a.fromArray(verts[0]); _b.fromArray(verts[1]); _c.fromArray(verts[2]);
    _n.copy(_b).sub(_a).cross(_c.clone().sub(_a));
    const flip = _n.x * nx + _n.y * ny + _n.z * nz < 0;
    const list = flip ? verts.slice().reverse() : verts;
    const base = pos.length / 3;
    for (const v of list) { pos.push(v[0], v[1], v[2]); nor.push(nx, ny, nz); }
    for (let i = 2; i < list.length; i++) idx.push(base, base + i - 1, base + i);
  };

  // 6 faces
  const faceDefs = [
    [0, 1, [[-1, 1], [-1, -1], [1, -1], [1, 1]]],   // +X : (sy,sz)
    [0, -1, [[-1, -1], [-1, 1], [1, 1], [1, -1]]],  // -X
    [1, 1, [[-1, 1], [1, 1], [1, -1], [-1, -1]]],   // +Y : (sx,sz)
    [1, -1, [[-1, -1], [1, -1], [1, 1], [-1, 1]]],  // -Y
    [2, 1, [[-1, -1], [1, -1], [1, 1], [-1, 1]]],   // +Z : (sx,sy)
    [2, -1, [[-1, -1], [-1, 1], [1, 1], [1, -1]]],  // -Z
  ];
  for (const [axis, s, order] of faceDefs) {
    const verts = order.map(([p, q]) => {
      const sx = axis === 0 ? s : p;
      const sy = axis === 0 ? p : axis === 1 ? s : q;
      const sz = axis === 2 ? s : q;
      return P[CI(sx, sy, sz) * 3 + axis];
    });
    emit(verts, axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0);
  }

  // 12 edge chamfers
  const SQ = Math.SQRT1_2;
  for (let axis = 0; axis < 3; axis++) {
    const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
      const verts = [];
      for (const t of [-1, 1]) {
        const s = [0, 0, 0]; s[axis] = t; s[a1] = s1; s[a2] = s2;
        const ci = CI(s[0], s[1], s[2]);
        verts.push(P[ci * 3 + a1], P[ci * 3 + a2]);
      }
      // order round the quad
      const quad = [verts[0], verts[1], verts[3], verts[2]];
      const nrm = [0, 0, 0]; nrm[a1] = s1 * SQ; nrm[a2] = s2 * SQ;
      emit(quad, nrm[0], nrm[1], nrm[2]);
    }
  }

  // 8 corner triangles
  const IS = 1 / Math.sqrt(3);
  for (let c = 0; c < 8; c++) {
    const sx = (c & 4) ? 1 : -1, sy = (c & 2) ? 1 : -1, sz = (c & 1) ? 1 : -1;
    emit([P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], sx * IS, sy * IS, sz * IS);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Extruded 2D profile with a real bevel — jersey barriers, I-beams, kerbs. */
export function extrudeProfile(points, depth, bevel = 0.02, steps = 1) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, steps, curveSegments: 6,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
  });
  g.translate(0, 0, -depth / 2 - (bevel > 0 ? bevel : 0));
  g.deleteAttribute('uv');
  return g;
}

/** Revolved profile with proper chamfers — barrels, tanks, bollards, drums. */
export function lathe(profile, segments = 20) {
  const pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(pts, segments);
  g.deleteAttribute('uv');
  return g;
}

export function tubeAlong(points, radius, radialSeg = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'catmullrom', 0.3);
  const g = new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), radius, radialSeg, closed);
  return g;
}

/** A cable that hangs under gravity between two points. */
export function catenary(a, b, sag, segments = 14) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = lerp(a[0], b[0], t), z = lerp(a[2], b[2], t);
    const y = lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * sag;
    pts.push([x, y, z]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// UV projection + vertex dirt
// ---------------------------------------------------------------------------

/**
 * World-space triplanar-style planar projection. Chooses the axis by the
 * vertex normal so every face gets an undistorted, correctly scaled mapping.
 */
export function worldUV(geo, tileMetres, opts = {}) {
  const { offset = [0, 0], swap = false, scale = 1 } = opts;
  const p = geo.attributes.position, nAttr = geo.attributes.normal;
  const inv = 1 / (tileMetres * scale);
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = Math.abs(nAttr.getX(i)), ny = Math.abs(nAttr.getY(i)), nz = Math.abs(nAttr.getZ(i));
    let u, v;
    if (ny > nx && ny > nz) { u = x; v = z; }        // horizontal surfaces
    else if (nx >= nz) { u = z; v = y; }             // X-facing: V is world up
    else { u = x; v = y; }                           // Z-facing: V is world up
    if (swap) { const t = u; u = v; v = t; }
    uv[i * 2] = u * inv + offset[0];
    uv[i * 2 + 1] = v * inv + offset[1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/**
 * Bakes weathering into vertex colour. Three effects, all of which real
 * environments show and none of which a texture alone can give you because they
 * depend on world position rather than surface parameterisation:
 *   1. a grime gradient rising off the ground line (splash-back, wind-blown dust)
 *   2. warm dust settling on up-facing surfaces
 *   3. low-frequency world-space tonal drift so repeated modules stop reading
 *      as repeated modules
 */
const DIRT_DEFAULT = {
  ground: 0, dirtH: 1.4, dirtStrength: 0.5,
  dirtColor: [0.42, 0.36, 0.29],
  dust: 0.3, dustColor: [1.06, 0.99, 0.84],
  drift: 0.13, seed: 1,
};
export function vertexDirt(geo, opts = {}) {
  const o = { ...DIRT_DEFAULT, ...opts };
  const p = geo.attributes.position, nAttr = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ny = nAttr.getY(i);
    let r = 1, g = 1, b = 1;

    // 1. ground grime
    const gm = (1 - smoothstep(o.ground, o.ground + o.dirtH, y)) * o.dirtStrength;
    if (gm > 0) { r = lerp(r, o.dirtColor[0], gm); g = lerp(g, o.dirtColor[1], gm); b = lerp(b, o.dirtColor[2], gm); }

    // 2. dust on up-facing surfaces
    const dm = clamp01(ny) * o.dust;
    if (dm > 0) { r = lerp(r, o.dustColor[0], dm); g = lerp(g, o.dustColor[1], dm); b = lerp(b, o.dustColor[2], dm); }

    // 3. large-scale drift (value noise in world space, ~6 m features)
    const n = vnoise3(x * 0.17 + o.seed * 3.1, y * 0.11, z * 0.17);
    const k = 1 + (n - 0.5) * 2 * o.drift;
    col[i * 3] = r * k; col[i * 3 + 1] = g * k; col[i * 3 + 2] = b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function h3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (i, j, k) => h3(xi + i, yi + j, zi + k);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

// ---------------------------------------------------------------------------
// batching
// ---------------------------------------------------------------------------
const KEEP = ['position', 'normal', 'uv', 'color'];
function sanitize(geo) {
  for (const name of Object.keys(geo.attributes)) if (!KEEP.includes(name)) geo.deleteAttribute(name);
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    geo.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (!geo.attributes.color) {
    const c = new Float32Array(geo.attributes.position.count * 3); c.fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  geo.groups.length = 0;
  return geo;
}

/**
 * Accumulates the level. Static geometry is merged per material, repeats become
 * InstancedMesh, and every placement can register a collider in one call so the
 * collision world can never silently drift out of sync with what you can see.
 */
export class Builder {
  constructor(matlib) {
    this.matlib = matlib;
    this.batches = new Map();     // materialKey -> geometry[]
    this.inst = new Map();        // instanceKey -> {geo, matKey, mats:[], colors:[]}
    this.colliders = [];
    this.loose = [];              // pre-built meshes (LOD groups, alpha props)
    this.tris = 0;
  }

  /** Place a world-space geometry into a merge batch. */
  push(matKey, geo, opts = {}) {
    const set = this.matlib.info(matKey);
    const tile = opts.tile ?? set.tileMetres;
    worldUV(geo, tile, opts.uv);
    vertexDirt(geo, opts.dirt === false ? { dirtStrength: 0, dust: 0, drift: 0.08 } : (opts.dirt || {}));
    sanitize(geo);
    let a = this.batches.get(matKey);
    if (!a) { a = []; this.batches.set(matKey, a); }
    a.push(geo);
    this.tris += geo.index.count / 3;
    return geo;
  }

  /** Bevelled box helper: the workhorse of the entire kit. */
  box(matKey, cx, cy, cz, w, h, d, opts = {}) {
    const g = bevelBox(w, h, d, opts.bevel ?? 0.025);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (opts.rot) q.setFromEuler(new THREE.Euler(opts.rot[0] || 0, opts.rot[1] || 0, opts.rot[2] || 0, 'YXZ'));
    else if (opts.rotY) q.setFromEuler(new THREE.Euler(0, opts.rotY, 0));
    m.compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    this.push(matKey, g, opts);
    if (opts.collide !== false) this.collideBox(cx, cy, cz, w, h, d, opts.rotY || (opts.rot && opts.rot[1]) || 0);
    return g;
  }

  /** Free-form geometry with an explicit transform. */
  place(matKey, geo, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], opts = {}) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')),
      new THREE.Vector3(...scale));
    const g = geo.clone();
    g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    return this.push(matKey, g, opts);
  }

  /** Register a repeat. Geometry is authored once in local space. */
  instance(key, matKey, geoFactory, matrix, color = null) {
    let e = this.inst.get(key);
    if (!e) {
      const geo = geoFactory();
      const set = this.matlib.info(matKey);
      worldUV(geo, set.tileMetres, {});
      sanitize(geo);
      e = { geo, matKey, mats: [], colors: [] };
      this.inst.set(key, e);
    }
    e.mats.push(matrix);
    e.colors.push(color);
    return e;
  }

  collideBox(cx, cy, cz, w, h, d, rotY = 0) {
    // AABB of the (possibly rotated) box — broadphase only, so the conservative
    // bound is the right trade.
    const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
    const ew = (w * c + d * s) / 2, ed = (w * s + d * c) / 2;
    this.colliders.push(new THREE.Box3(
      new THREE.Vector3(cx - ew, cy - h / 2, cz - ed),
      new THREE.Vector3(cx + ew, cy + h / 2, cz + ed)));
  }

  addMesh(mesh) { this.loose.push(mesh); return mesh; }

  /** Realise everything into `root`; returns the meshes bullets may hit. */
  build(root, name = 'level') {
    const targets = [];
    for (const [matKey, list] of this.batches) {
      if (!list.length) continue;
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) { console.warn(`world: merge failed for "${matKey}"`); continue; }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.matlib.get(matKey));
      mesh.name = `${name}:${matKey}`;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      root.add(mesh); targets.push(mesh);
      for (const g of list) if (g !== merged) g.dispose();
    }
    for (const [key, e] of this.inst) {
      if (!e.mats.length) continue;
      const im = new THREE.InstancedMesh(e.geo, this.matlib.get(e.matKey), e.mats.length);
      im.name = `${name}:inst:${key}`;
      im.castShadow = true; im.receiveShadow = true;
      let anyColor = false;
      for (let i = 0; i < e.mats.length; i++) {
        im.setMatrixAt(i, e.mats[i]);
        if (e.colors[i]) { im.setColorAt(i, e.colors[i]); anyColor = true; }
      }
      if (anyColor) {
        for (let i = 0; i < e.mats.length; i++) if (!e.colors[i]) im.setColorAt(i, WHITE);
        im.instanceColor.needsUpdate = true;
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = true;
      im.computeBoundingSphere?.();
      root.add(im); targets.push(im);
      this.tris += (e.geo.index.count / 3) * e.mats.length;
    }
    for (const m of this.loose) { root.add(m); if (m.isMesh) targets.push(m); }
    return targets;
  }
}
const WHITE = new THREE.Color(1, 1, 1);

// ---------------------------------------------------------------------------
// transform helper
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function mat(px, py, pz, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_v.set(px, py, pz), _q.setFromEuler(_e), _s.set(sx, sy, sz));
}

export function rand(seed) { return mulberry32(seed); }
