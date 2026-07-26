import * as THREE from 'three';

/**
 * RIGID DEBRIS + SHELL CASINGS.
 *
 * Sparks and dust are fine as shader-simulated billboards, but chunks and brass
 * have to *land*. These are real bodies: gravity, air drag, bounce with
 * restitution, tangential friction, tumbling that spins down, and a sleep state
 * once the energy is gone so a settled pile costs nothing but a matrix write.
 *
 * All of it is one THREE.InstancedMesh per flavour — one draw call, a fixed
 * pool, and preallocated scratch objects so the step loop allocates nothing.
 *
 * Collision is deliberately cheap: each body remembers the floor height found
 * by a single downward ray at spawn time, plus the plane of the surface it was
 * knocked off for its first half second, which is enough for chips to skitter
 * off a wall and settle on the ground without a broadphase.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();

/** Irregular low-poly chip: a jittered octahedron, flattened on one axis. */
export function chipGeometry(seed = 1) {
  const g = new THREE.OctahedronGeometry(0.5, 0);
  const pos = g.attributes.position;
  let h = seed * 9973;
  const rnd = () => { h = (Math.imul(h, 1103515245) + 12345) & 0x7fffffff; return h / 0x7fffffff; };
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) * (0.6 + rnd() * 0.9),
      pos.getY(i) * (0.3 + rnd() * 0.55),
      pos.getZ(i) * (0.6 + rnd() * 0.9));
  }
  g.computeVertexNormals();
  return g;
}

export function casingGeometry() {
  // ~9mm brass: 9.6mm across, 19mm long. Real units matter — a casing that is
  // secretly 5cm long reads as a toy no matter how it bounces.
  const g = new THREE.CylinderGeometry(0.0048, 0.0042, 0.019, 8, 1, false);
  g.rotateZ(Math.PI * 0.5); // long axis along local X so spin looks right
  return g;
}

export class DebrisSystem {
  constructor({ name, capacity, geometry, material, restitution = 0.34,
                friction = 0.55, drag = 0.6, sleepSpeed = 0.28, castShadow = false,
                colorJitter = 0.18, spinDamp = 1.4 }) {
    this.name = name;
    this.capacity = capacity;
    this.restitution = restitution;
    this.friction = friction;
    this.drag = drag;
    this.sleepSpeed = sleepSpeed;
    this.spinDamp = spinDamp;
    this.colorJitter = colorJitter;
    this.cursor = 0;
    this.alive = 0;
    this.highWater = 0;

    const n = capacity;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.qx = new Float32Array(n); this.qy = new Float32Array(n);
    this.qz = new Float32Array(n); this.qw = new Float32Array(n);
    this.wx = new Float32Array(n); this.wy = new Float32Array(n); this.wz = new Float32Array(n);
    this.sx = new Float32Array(n); this.sy = new Float32Array(n); this.sz = new Float32Array(n);
    this.rad = new Float32Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.floorY = new Float32Array(n);
    this.state = new Uint8Array(n);      // 0 dead, 1 flying, 2 asleep
    // Surface plane the chip was knocked off, active briefly after spawn.
    this.pnx = new Float32Array(n); this.pny = new Float32Array(n);
    this.pnz = new Float32Array(n); this.pnd = new Float32Array(n);
    this.ptl = new Float32Array(n);

    this.mesh = new THREE.InstancedMesh(geometry, material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
    this.mesh.name = `fx:debris:${name}`;
    if (colorJitter > 0) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    // Park every slot at zero scale so nothing shows before first spawn.
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {object} s  spawn state: x,y,z, vx,vy,vz, size, life, floorY,
   *                    planeNx/Ny/Nz/D (optional), tint (THREE.Color, optional)
   */
  spawn(s) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (i >= this.highWater) this.highWater = i + 1;
    this.px[i] = s.x; this.py[i] = s.y; this.pz[i] = s.z;
    this.vx[i] = s.vx; this.vy[i] = s.vy; this.vz[i] = s.vz;
    const a = Math.random() * 6.283, b = Math.random() * 6.283, c = Math.random() * 6.283;
    _q.setFromEuler(_e.set(a, b, c));
    this.qx[i] = _q.x; this.qy[i] = _q.y; this.qz[i] = _q.z; this.qw[i] = _q.w;
    const spin = s.spin ?? 14;
    this.wx[i] = (Math.random() - 0.5) * spin;
    this.wy[i] = (Math.random() - 0.5) * spin;
    this.wz[i] = (Math.random() - 0.5) * spin;
    const sz = s.size;
    this.sx[i] = sz * (0.7 + Math.random() * 0.7);
    this.sy[i] = sz * (0.5 + Math.random() * 0.7);
    this.sz[i] = sz * (0.7 + Math.random() * 0.7);
    if (s.uniform) { this.sy[i] = sz; this.sx[i] = sz; this.sz[i] = sz; }
    this.rad[i] = Math.max(this.sx[i], this.sy[i], this.sz[i]) * 0.5;
    this.age[i] = 0;
    this.life[i] = s.life;
    this.floorY[i] = s.floorY;
    this.state[i] = 1;
    if (s.planeNy !== undefined) {
      this.pnx[i] = s.planeNx; this.pny[i] = s.planeNy; this.pnz[i] = s.planeNz;
      this.pnd[i] = s.planeD; this.ptl[i] = 0.55;
    } else {
      this.ptl[i] = 0;
    }
    if (this.mesh.instanceColor) {
      const j = this.colorJitter;
      const f = 1 - j * 0.5 + Math.random() * j;
      if (s.tint) { _c.copy(s.tint); } else { _c.setRGB(1, 1, 1); }
      this.mesh.instanceColor.array[i * 3] = _c.r * f;
      this.mesh.instanceColor.array[i * 3 + 1] = _c.g * f;
      this.mesh.instanceColor.array[i * 3 + 2] = _c.b * f;
      this.mesh.instanceColor.needsUpdate = true;
    }
    return i;
  }

  update(dt) {
    if (this.highWater === 0) return;
    const n = this.highWater;
    let alive = 0;
    const dragF = Math.exp(-this.drag * dt);
    const spinF = Math.exp(-this.spinDamp * dt);
    for (let i = 0; i < n; i++) {
      const st = this.state[i];
      if (st === 0) continue;
      this.age[i] += dt;
      const t = this.age[i], life = this.life[i];
      if (t >= life) {
        this.state[i] = 0;
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      alive++;

      if (st === 1) {
        this.vy[i] -= 9.81 * dt;
        this.vx[i] *= dragF; this.vy[i] *= dragF; this.vz[i] *= dragF;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        this.pz[i] += this.vz[i] * dt;

        // Impact-surface plane, only while the chip is still near the wall.
        if (this.ptl[i] > 0) {
          this.ptl[i] -= dt;
          const d = this.pnx[i] * this.px[i] + this.pny[i] * this.py[i] +
                    this.pnz[i] * this.pz[i] - this.pnd[i];
          if (d < this.rad[i]) {
            const push = this.rad[i] - d;
            this.px[i] += this.pnx[i] * push;
            this.py[i] += this.pny[i] * push;
            this.pz[i] += this.pnz[i] * push;
            const vn = this.vx[i] * this.pnx[i] + this.vy[i] * this.pny[i] + this.vz[i] * this.pnz[i];
            if (vn < 0) {
              const j = -(1 + this.restitution) * vn;
              this.vx[i] += this.pnx[i] * j;
              this.vy[i] += this.pny[i] * j;
              this.vz[i] += this.pnz[i] * j;
              this.wx[i] *= 0.6; this.wy[i] *= 0.6; this.wz[i] *= 0.6;
            }
          }
        }

        // Ground.
        const fy = this.floorY[i] + this.rad[i] * 0.75;
        if (this.py[i] <= fy) {
          this.py[i] = fy;
          if (this.vy[i] < 0) {
            const speed = Math.abs(this.vy[i]);
            this.vy[i] = speed * this.restitution;
            const f = 1 - this.friction;
            this.vx[i] *= f; this.vz[i] *= f;
            this.wx[i] *= 0.55; this.wy[i] *= 0.75; this.wz[i] *= 0.55;
            const horiz = Math.hypot(this.vx[i], this.vz[i]);
            if (speed < this.sleepSpeed && horiz < this.sleepSpeed) {
              this.state[i] = 2;
              this.vx[i] = this.vy[i] = this.vz[i] = 0;
              this.wx[i] = this.wy[i] = this.wz[i] = 0;
              this.py[i] = this.floorY[i] + this.sy[i] * 0.35;
            }
          }
        }

        const wl = Math.hypot(this.wx[i], this.wy[i], this.wz[i]);
        if (wl > 1e-4) {
          _dq.setFromAxisAngle(_p.set(this.wx[i] / wl, this.wy[i] / wl, this.wz[i] / wl), wl * dt);
          _q.set(this.qx[i], this.qy[i], this.qz[i], this.qw[i]).premultiply(_dq).normalize();
          this.qx[i] = _q.x; this.qy[i] = _q.y; this.qz[i] = _q.z; this.qw[i] = _q.w;
        }
        this.wx[i] *= spinF; this.wy[i] *= spinF; this.wz[i] *= spinF;
      }

      // Shrink out over the last 0.6s rather than vanishing.
      const rem = life - t;
      const k = rem < 0.6 ? rem / 0.6 : 1;
      _p.set(this.px[i], this.py[i], this.pz[i]);
      _q.set(this.qx[i], this.qy[i], this.qz[i], this.qw[i]);
      _s.set(this.sx[i] * k, this.sy[i] * k, this.sz[i] * k);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.alive = alive;
    this.mesh.count = this.highWater;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = alive > 0;
  }

  clear() {
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.highWater; i++) { this.state[i] = 0; this.mesh.setMatrixAt(i, _m); }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alive = 0;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
