import * as THREE from 'three';

/**
 * Capsule-vs-AABB collision for the player controller.
 *
 * The world hands us `world.colliders` — an array of THREE.Box3 (or {box, mesh}).
 * We flatten those into a typed array and index them in a uniform XZ grid so the
 * per-frame cost is proportional to what the player is standing next to, not to
 * the level size.
 *
 * The player capsule is always VERTICAL, which makes the closest-point query
 * against an axis-aligned box exact and branch-cheap: the horizontal distance is
 * independent of the segment parameter, so we only have to pick the best `y`.
 * No iterative GJK, no tunnelling, no false negatives on corners.
 *
 * Position convention: `pos` is the FEET (bottom of the capsule). The capsule
 * occupies [pos.y, pos.y + height] with the given radius.
 */

const CELL = 3.0;

export class WorldCollision {
  constructor() {
    this.boxes = new Float32Array(0);   // [minx,miny,minz,maxx,maxy,maxz] * n
    this.count = 0;
    this.grid = new Map();
    this.groundY = 0;                   // implicit infinite floor, see sync()
    this.hasGroundPlane = true;
    this.slopeCos = Math.cos(THREE.MathUtils.degToRad(46)); // walkable limit

    this._src = null;
    this._srcLen = -1;
    this._resyncTimer = 0;
    this._stamp = new Int32Array(0);
    this._stampId = 0;
    this._cand = [];

    // Contact results from the last resolve()
    this.normals = [];
    this.grounded = false;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundY_hit = 0;
    this.hitWall = false;
  }

  /**
   * Pull the collider list from the world module. Cheap when nothing changed —
   * the world is authored by another module that may still be growing it, so we
   * poll the length every frame and do a full rebuild at most twice a second.
   */
  sync(world, dt = 0) {
    const src = world?.colliders;
    if (!src) return;
    this._resyncTimer -= dt;
    if (src === this._src && src.length === this._srcLen && this._resyncTimer > 0) return;
    this._src = src;
    this._srcLen = src.length;
    this._resyncTimer = 0.5;

    if (typeof world.groundY === 'number') this.groundY = world.groundY;

    const n = src.length;
    if (this.boxes.length < n * 6) this.boxes = new Float32Array(Math.max(64, n * 2) * 6);
    const b = this.boxes;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const e = src[i];
      const box = e?.isBox3 ? e : (e?.box || e?.aabb);
      if (!box || !box.min || !box.max) continue;
      const o = k * 6;
      b[o] = box.min.x; b[o + 1] = box.min.y; b[o + 2] = box.min.z;
      b[o + 3] = box.max.x; b[o + 4] = box.max.y; b[o + 5] = box.max.z;
      k++;
    }
    this.count = k;
    if (this._stamp.length < k) this._stamp = new Int32Array(Math.max(64, k * 2));
    this._rebuildGrid();
  }

  _rebuildGrid() {
    this.grid.clear();
    const b = this.boxes;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const x0 = Math.floor(b[o] / CELL), x1 = Math.floor(b[o + 3] / CELL);
      const z0 = Math.floor(b[o + 2] / CELL), z1 = Math.floor(b[o + 5] / CELL);
      // A pathological world-sized collider would spam every cell; skip indexing
      // those and always test them (there are never many).
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4096) {
        let big = this.grid.get('big');
        if (!big) this.grid.set('big', (big = []));
        big.push(i);
        continue;
      }
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = x * 73856093 ^ z * 19349663;
          let cell = this.grid.get(key);
          if (!cell) this.grid.set(key, (cell = []));
          cell.push(i);
        }
      }
    }
  }

  /** Candidate box indices whose AABB may overlap the given XZ rectangle. */
  _query(minx, minz, maxx, maxz) {
    const out = this._cand;
    out.length = 0;
    const id = ++this._stampId;
    const stamp = this._stamp;
    const big = this.grid.get('big');
    if (big) for (let i = 0; i < big.length; i++) { stamp[big[i]] = id; out.push(big[i]); }
    const x0 = Math.floor(minx / CELL), x1 = Math.floor(maxx / CELL);
    const z0 = Math.floor(minz / CELL), z1 = Math.floor(maxz / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const cell = this.grid.get(x * 73856093 ^ z * 19349663);
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const idx = cell[i];
          if (stamp[idx] === id) continue;
          stamp[idx] = id;
          out.push(idx);
        }
      }
    }
    return out;
  }

  /**
   * Push `pos` out of every box it overlaps. Runs a few relaxation passes so
   * inside corners converge instead of ping-ponging. Fills this.normals with the
   * separating directions so the caller can clip velocity against them.
   */
  resolve(pos, radius, height) {
    this.normals.length = 0;
    this.grounded = false;
    this.hitWall = false;
    this.groundNormal.set(0, 1, 0);

    const r = radius;
    const r2 = r * r;
    let bestUp = -1;

    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const segA = pos.y + r;
      const segB = Math.max(segA, pos.y + height - r);
      const cand = this._query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
      const b = this.boxes;

      for (let ci = 0; ci < cand.length; ci++) {
        const o = cand[ci] * 6;
        const bx0 = b[o], by0 = b[o + 1], bz0 = b[o + 2];
        const bx1 = b[o + 3], by1 = b[o + 4], bz1 = b[o + 5];
        if (by0 > segB + r || by1 < segA - r) continue;

        const cx = pos.x < bx0 ? bx0 : pos.x > bx1 ? bx1 : pos.x;
        const cz = pos.z < bz0 ? bz0 : pos.z > bz1 ? bz1 : pos.z;
        let sy, by;
        if (by1 < segA) { sy = segA; by = by1; }
        else if (by0 > segB) { sy = segB; by = by0; }
        else {
          const mid = (by0 + by1) * 0.5;
          sy = mid < segA ? segA : mid > segB ? segB : mid;
          by = sy < by0 ? by0 : sy > by1 ? by1 : sy;
        }
        const dx = pos.x - cx, dy = sy - by, dz = pos.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r2) continue;

        let nx, ny, nz, depth;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          nx = dx / d; ny = dy / d; nz = dz / d;
          depth = r - d;
        } else {
          // Capsule axis is inside the box: separate along the cheapest axis.
          const pxa = pos.x - bx0 + r, pxb = bx1 - pos.x + r;
          const pza = pos.z - bz0 + r, pzb = bz1 - pos.z + r;
          const pya = segB - (by0 - r), pyb = by1 + r - segA;
          let m = pxa; nx = -1; ny = 0; nz = 0;
          if (pxb < m) { m = pxb; nx = 1; ny = 0; nz = 0; }
          if (pza < m) { m = pza; nx = 0; ny = 0; nz = -1; }
          if (pzb < m) { m = pzb; nx = 0; ny = 0; nz = 1; }
          if (pya < m) { m = pya; nx = 0; ny = -1; nz = 0; }
          if (pyb < m) { m = pyb; nx = 0; ny = 1; nz = 0; }
          depth = m;
        }
        if (depth <= 1e-6) continue;

        pos.x += nx * depth;
        pos.y += ny * depth;
        pos.z += nz * depth;
        moved = true;

        if (ny > this.slopeCos) {
          this.grounded = true;
          if (ny > bestUp) { bestUp = ny; this.groundNormal.set(nx, ny, nz); }
        } else if (ny < 0.5) {
          this.hitWall = true;
        }
        this._pushNormal(nx, ny, nz);
      }
      if (!moved) break;
    }

    // Implicit ground plane so the player can never fall out of an unfinished level.
    if (this.hasGroundPlane && pos.y < this.groundY) {
      pos.y = this.groundY;
      this.grounded = true;
      if (bestUp < 1) this.groundNormal.set(0, 1, 0);
      this._pushNormal(0, 1, 0);
    }
    return this.grounded;
  }

  _pushNormal(x, y, z) {
    for (let i = 0; i < this.normals.length; i += 3) {
      if (this.normals[i] * x + this.normals[i + 1] * y + this.normals[i + 2] * z > 0.999) return;
    }
    this.normals.push(x, y, z);
  }

  /** True if a capsule placed here would intersect anything. */
  overlaps(pos, radius, height) {
    const r = radius, r2 = r * r;
    const segA = pos.y + r;
    const segB = Math.max(segA, pos.y + height - r);
    if (this.hasGroundPlane && pos.y < this.groundY - 1e-4) return true;
    const cand = this._query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
    const b = this.boxes;
    for (let ci = 0; ci < cand.length; ci++) {
      const o = cand[ci] * 6;
      const bx0 = b[o], by0 = b[o + 1], bz0 = b[o + 2];
      const bx1 = b[o + 3], by1 = b[o + 4], bz1 = b[o + 5];
      if (by0 > segB + r || by1 < segA - r) continue;
      const cx = pos.x < bx0 ? bx0 : pos.x > bx1 ? bx1 : pos.x;
      const cz = pos.z < bz0 ? bz0 : pos.z > bz1 ? bz1 : pos.z;
      let sy, by;
      if (by1 < segA) { sy = segA; by = by1; }
      else if (by0 > segB) { sy = segB; by = by0; }
      else {
        const mid = (by0 + by1) * 0.5;
        sy = mid < segA ? segA : mid > segB ? segB : mid;
        by = sy < by0 ? by0 : sy > by1 ? by1 : sy;
      }
      const dx = pos.x - cx, dy = sy - by, dz = pos.z - cz;
      if (dx * dx + dy * dy + dz * dz < r2 - 1e-8) return true;
    }
    return false;
  }

  /**
   * Substepped translate + resolve. Substep length is capped well below the
   * capsule radius, which is what makes tunnelling impossible regardless of how
   * fast the player is moving or how long the frame was.
   */
  move(pos, delta, radius, height, acc) {
    const dist = Math.hypot(delta.x, delta.y, delta.z);
    if (dist < 1e-9) { this.resolve(pos, radius, height); if (acc) this._accumulate(acc); return; }
    const steps = Math.min(24, Math.max(1, Math.ceil(dist / (radius * 0.5))));
    const inv = 1 / steps;
    for (let i = 0; i < steps; i++) {
      pos.x += delta.x * inv;
      pos.y += delta.y * inv;
      pos.z += delta.z * inv;
      this.resolve(pos, radius, height);
      if (acc) this._accumulate(acc);
    }
  }

  _accumulate(acc) {
    for (let i = 0; i < this.normals.length; i += 3) {
      let dup = false;
      for (let j = 0; j < acc.normals.length; j += 3) {
        if (acc.normals[j] * this.normals[i] + acc.normals[j + 1] * this.normals[i + 1]
          + acc.normals[j + 2] * this.normals[i + 2] > 0.999) { dup = true; break; }
      }
      if (!dup) acc.normals.push(this.normals[i], this.normals[i + 1], this.normals[i + 2]);
    }
    if (this.grounded) {
      acc.grounded = true;
      if (this.groundNormal.y > acc.groundNormal.y) acc.groundNormal.copy(this.groundNormal);
    }
    if (this.hitWall) acc.hitWall = true;
  }

  /**
   * Horizontal move with stair stepping. Tries the flat move first; if it made
   * meaningfully less progress than asked for, retries as up → across → down.
   * This is the classic Quake/Source approach and it is the difference between
   * a controller that glides over kerbs and one that snags on every 8cm lip.
   */
  moveHorizontal(pos, delta, radius, height, stepHeight, acc) {
    _accUsed = 0;
    const start = _v1.copy(pos);
    const flat = _v2.copy(pos);
    const flatAcc = _mkAcc();
    this.move(flat, delta, radius, height, flatAcc);

    const wanted = Math.hypot(delta.x, delta.z);
    const got = Math.hypot(flat.x - start.x, flat.z - start.z);
    if (wanted < 1e-6 || got > wanted - 1e-3 || stepHeight <= 0) {
      pos.copy(flat);
      _mergeAcc(acc, flatAcc);
      return;
    }

    // Stepped attempt.
    const up = _v3.copy(start);
    const upAcc = _mkAcc();
    this.move(up, _v4.set(0, stepHeight, 0), radius, height, upAcc);
    const risen = up.y - start.y;
    if (risen < 0.01) { pos.copy(flat); _mergeAcc(acc, flatAcc); return; }

    const stepAcc = _mkAcc();
    this.move(up, delta, radius, height, stepAcc);
    const stepGot = Math.hypot(up.x - start.x, up.z - start.z);
    if (stepGot <= got + 1e-4) { pos.copy(flat); _mergeAcc(acc, flatAcc); return; }

    const downAcc = _mkAcc();
    this.move(up, _v4.set(0, -(risen + 0.02), 0), radius, height, downAcc);
    if (!downAcc.grounded) { pos.copy(flat); _mergeAcc(acc, flatAcc); return; }

    pos.copy(up);
    // Only the horizontal contacts from the stepped path are meaningful; the
    // vertical ones would kill upward velocity for no reason.
    _mergeAcc(acc, stepAcc);
    acc.grounded = true;
    acc.stepped = true;
    if (downAcc.groundNormal.y > acc.groundNormal.y) acc.groundNormal.copy(downAcc.groundNormal);
  }

  /**
   * Distance down to the nearest supporting surface under the capsule, up to
   * maxDist. Used to keep the player glued to stairs/slopes on the way down
   * instead of launching off every edge.
   */
  probeGround(pos, radius, maxDist) {
    let bestY = -Infinity;
    if (this.hasGroundPlane && this.groundY <= pos.y + 1e-3) bestY = this.groundY;
    const r = radius;
    const cand = this._query(pos.x - r, pos.z - r, pos.x + r, pos.z + r);
    const b = this.boxes;
    const lo = pos.y - maxDist;
    for (let ci = 0; ci < cand.length; ci++) {
      const o = cand[ci] * 6;
      const top = b[o + 4];
      if (top > pos.y + 1e-3 || top < lo || top <= bestY) continue;
      const cx = pos.x < b[o] ? b[o] : pos.x > b[o + 3] ? b[o + 3] : pos.x;
      const cz = pos.z < b[o + 2] ? b[o + 2] : pos.z > b[o + 5] ? b[o + 5] : pos.z;
      const dx = pos.x - cx, dz = pos.z - cz;
      if (dx * dx + dz * dz > r * r) continue;
      bestY = top;
    }
    if (bestY === -Infinity) return null;
    return bestY;
  }

  /**
   * Look for a chest-height ledge in front of the player that we could pull up
   * onto. Returns {target, height} or null. Requires a clear standing volume at
   * the destination, otherwise you mantle into a ceiling.
   */
  findLedge(pos, dirX, dirZ, radius, standHeight, opts = {}) {
    const minH = opts.minHeight ?? 0.42;
    const maxH = opts.maxHeight ?? 1.55;
    const reach = opts.reach ?? 0.55;
    const clearHeight = opts.clearHeight ?? standHeight;

    const px = pos.x + dirX * (radius + reach);
    const pz = pos.z + dirZ * (radius + reach);
    const r = radius * 0.85;
    const cand = this._query(px - r, pz - r, px + r, pz + r);
    const b = this.boxes;

    let top = -Infinity;
    for (let ci = 0; ci < cand.length; ci++) {
      const o = cand[ci] * 6;
      const cx = px < b[o] ? b[o] : px > b[o + 3] ? b[o + 3] : px;
      const cz = pz < b[o + 2] ? b[o + 2] : pz > b[o + 5] ? b[o + 5] : pz;
      const dx = px - cx, dz = pz - cz;
      if (dx * dx + dz * dz > r * r) continue;
      if (b[o + 4] > top) top = b[o + 4];
    }
    if (top === -Infinity) return null;
    const h = top - pos.y;
    if (h < minH || h > maxH) return null;

    const dest = new THREE.Vector3(px, top + 0.03, pz);
    if (this.overlaps(dest, radius * 0.92, clearHeight)) return null;
    // The path over the lip has to be clear too — check a point just above the edge.
    const overEdge = _v1.set(pos.x + dirX * (radius + reach * 0.4), top + 0.05, pos.z + dirZ * (radius + reach * 0.4));
    if (this.overlaps(overEdge, radius * 0.65, clearHeight * 0.85)) return null;
    return { target: dest, height: h };
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

const _accPool = [];
let _accUsed = 0;
function _mkAcc() {
  if (_accUsed >= _accPool.length) {
    _accPool.push({ normals: [], grounded: false, hitWall: false, stepped: false, groundNormal: new THREE.Vector3(0, 1, 0) });
  }
  const a = _accPool[_accUsed++];
  a.normals.length = 0; a.grounded = false; a.hitWall = false; a.stepped = false;
  a.groundNormal.set(0, 1, 0);
  return a;
}
function _mergeAcc(dst, src) {
  if (!dst) return;
  for (let i = 0; i < src.normals.length; i += 3) {
    let dup = false;
    for (let j = 0; j < dst.normals.length; j += 3) {
      if (dst.normals[j] * src.normals[i] + dst.normals[j + 1] * src.normals[i + 1]
        + dst.normals[j + 2] * src.normals[i + 2] > 0.999) { dup = true; break; }
    }
    if (!dup) dst.normals.push(src.normals[i], src.normals[i + 1], src.normals[i + 2]);
  }
  if (src.grounded) {
    dst.grounded = true;
    if (src.groundNormal.y > dst.groundNormal.y) dst.groundNormal.copy(src.groundNormal);
  }
  if (src.hitWall) dst.hitWall = true;
}

/** Caller-side accumulator factory (reset per frame by the player controller). */
export function makeContactAcc() {
  return { normals: [], grounded: false, hitWall: false, stepped: false, groundNormal: new THREE.Vector3(0, 1, 0) };
}
export function resetContactAcc(a) {
  a.normals.length = 0; a.grounded = false; a.hitWall = false; a.stepped = false;
  a.groundNormal.set(0, 1, 0);
  return a;
}
