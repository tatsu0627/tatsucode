import * as THREE from 'three';

/**
 * RIG PRIMITIVES
 *
 * Geometry helpers used to author the soldier, plus the analytic two-bone IK
 * solver the locomotion layer relies on for foot planting.
 *
 * Convention for the whole character rig:
 *   - the character faces +Z (matches Object3D.lookAt)
 *   - every bone's local axes are aligned with the character rest frame
 *     (Y up, Z forward), and a bone's geometry extends along -Y toward its child
 *   - so `bone.rotation.x < 0` swings that limb forward, and a knee/elbow bends
 *     with a POSITIVE x rotation on the lower bone (which is anatomically
 *     backwards for the knee and forwards for the elbow — see ELBOW_SIGN)
 */

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Rounded box via the box-SDF trick: build a subdivided box, then for every
 * vertex push it out from the clamped inner box by the corner radius. Gives
 * true rounded edges with correct normals, unlike a scaled sphere.
 */
export function roundedBox(w, h, d, r = 0.012, seg = 3) {
  r = Math.min(r, w * 0.49, h * 0.49, d * 0.49);
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position;
  const ix = w * 0.5 - r, iy = h * 0.5 - r, iz = d * 0.5 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(
      Math.max(-ix, Math.min(ix, v.x)),
      Math.max(-iy, Math.min(iy, v.y)),
      Math.max(-iz, Math.min(iz, v.z)),
    );
    v.sub(c);
    const len = v.length();
    if (len > 1e-6) v.multiplyScalar(r / len);
    pos.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Limb segment: a capsule spanning y=0 (joint) down to y=-len, tapered from
 * rTop to rBot with an optional muscle bulge. Human limbs are cones, not
 * cylinders — getting this taper right is most of what stops a rig reading
 * as a stack of tubes.
 */
export function limb(len, rTop, rBot, bulge = 0.08, radial = 10, cap = 4) {
  const mid = Math.max(0.001, len - rTop - rBot);
  const g = new THREE.CapsuleGeometry(1, mid, cap, radial);
  const pos = g.attributes.position;
  const half = mid * 0.5;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Normalised position along the segment: 0 at top, 1 at bottom.
    const t = THREE.MathUtils.clamp((half - y) / (mid || 1), -0.4, 1.4);
    const tc = THREE.MathUtils.clamp(t, 0, 1);
    const r = THREE.MathUtils.lerp(rTop, rBot, tc) * (1 + bulge * Math.sin(Math.PI * tc));
    // Cap hemispheres keep their own vertical proportion so the ends stay round.
    const yScale = y > half ? rTop : y < -half ? rBot : 1;
    x *= r;
    z *= r;
    y = y > half ? half + (y - half) * yScale
      : y < -half ? -half + (y + half) * yScale
      : y;
    pos.setXYZ(i, x, y, z);
  }
  g.translate(0, -half - rTop, 0);
  g.computeVertexNormals();
  return g;
}

/** Squashed sphere — deltoids, joint caps, helmet dome, skull mass. */
export function blob(rx, ry, rz, wSeg = 12, hSeg = 9) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  g.scale(rx, ry, rz);
  return g;
}

/** Partial dome (helmet shell). thetaLength < PI keeps it open at the bottom. */
export function dome(rx, ry, rz, thetaLength = Math.PI * 0.62, wSeg = 16, hSeg = 8) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg, 0, Math.PI * 2, 0, thetaLength);
  g.scale(rx, ry, rz);
  return g;
}

export function cyl(rTop, rBot, h, radial = 10, open = false) {
  return new THREE.CylinderGeometry(rTop, rBot, h, radial, 1, open);
}

/** Torus arc — sling loops, optic housing rings, helmet rails. */
export function arc(radius, tube, arcAngle = Math.PI * 2, seg = 8, tubeSeg = 6) {
  return new THREE.TorusGeometry(radius, tube, tubeSeg, seg, arcAngle);
}

/**
 * Bend a geometry around the X axis — used to curve magazines and the
 * cummerbund so nothing on the character is a straight extruded slab.
 */
export function bendZ(geo, amount, axisLen) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / axisLen;
    pos.setZ(i, pos.getZ(i) + amount * t * t);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Wrap a flat panel onto a cylinder of the given radius about the Y axis. */
export function wrapY(geo, radius) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const a = x / radius;
    const r = radius + z;
    pos.setXYZ(i, Math.sin(a) * r, pos.getY(i), Math.cos(a) * r - radius);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Two-bone analytic IK
// ---------------------------------------------------------------------------

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _xAxis = new THREE.Vector3();
const _yAxis = new THREE.Vector3();
const _zAxis = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _inv = new THREE.Matrix4();

/**
 * Solve a two-bone chain so `lower`'s child lands on `targetWorld`.
 *
 * upper/lower are bones following the rig convention (geometry down -Y).
 * `poleWorld` is a world-space direction the joint should bend toward
 * (forward for a knee, backward for an elbow). `bendSign` is +1 when a positive
 * lower.rotation.x is the correct bend direction (knees), -1 for elbows.
 *
 * Returns the reach ratio (>=1 means the chain was over-extended and the target
 * could not be reached), which callers use to soften over-stretch.
 */
export function solveTwoBone(upper, lower, targetWorld, poleWorld, L1, L2, bendSign = 1) {
  const parent = upper.parent;
  if (!parent) return 0;

  parent.updateWorldMatrix(true, false);
  _inv.copy(parent.matrixWorld).invert();

  // Target and pole in the upper bone's parent space.
  const target = _v1.copy(targetWorld).applyMatrix4(_inv);
  const pole = _v2.copy(poleWorld).transformDirection(_inv).normalize();

  const origin = upper.position;
  const toTarget = _v3.subVectors(target, origin);
  const maxReach = (L1 + L2) * 0.9985;
  let dist = toTarget.length();
  const reachRatio = dist / Math.max(1e-5, L1 + L2);
  if (dist < 1e-5) { toTarget.set(0, -1, 0); dist = 1e-5; }
  if (dist > maxReach) { toTarget.multiplyScalar(maxReach / dist); dist = maxReach; }
  const minReach = Math.abs(L1 - L2) * 1.02 + 1e-4;
  if (dist < minReach) { toTarget.multiplyScalar(minReach / dist); dist = minReach; }
  toTarget.normalize();

  // Interior knee/elbow angle from the law of cosines.
  const cosKnee = THREE.MathUtils.clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1);
  const bend = Math.PI - Math.acos(cosKnee);
  const cosHip = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
  const alpha = Math.acos(cosHip);

  // Build a frame whose -Y is the direction to the target and whose +Z is the
  // pole (bend) direction, then tilt the upper bone off the target line by alpha.
  _yAxis.copy(toTarget).multiplyScalar(-1);
  _zAxis.copy(pole).addScaledVector(_yAxis, -pole.dot(_yAxis));
  if (_zAxis.lengthSq() < 1e-8) {
    _zAxis.set(0, 0, 1).addScaledVector(_yAxis, -_yAxis.z);
    if (_zAxis.lengthSq() < 1e-8) _zAxis.set(1, 0, 0);
  }
  _zAxis.normalize();
  _xAxis.crossVectors(_yAxis, _zAxis).normalize();
  _zAxis.crossVectors(_xAxis, _yAxis).normalize();

  // Rotate the bone direction by -alpha*bendSign about the frame's X so the
  // chain closes onto the target with the joint pointing along the pole.
  _q.setFromAxisAngle(_xAxis, -alpha * bendSign);
  _yAxis.applyQuaternion(_q);
  _zAxis.crossVectors(_xAxis, _yAxis).normalize();
  _xAxis.crossVectors(_yAxis, _zAxis).normalize();

  _m.makeBasis(_xAxis, _yAxis, _zAxis);
  upper.quaternion.setFromRotationMatrix(_m);
  lower.rotation.set(bend * bendSign, 0, 0);
  upper.updateMatrix();
  lower.updateMatrix();
  return reachRatio;
}

/**
 * Orient a bone so its local ∓Y axis points at a world position.
 * `sign = -1` aims the bone's -Y (the direction its geometry extends, i.e. it
 * points the limb at the target); `sign = +1` aims +Y (used for the spine).
 * `upHint` is a world-space twist reference.
 */
export function pointBone(bone, worldTarget, sign = -1, upHint = null) {
  const parent = bone.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  _inv.copy(parent.matrixWorld).invert();
  const t = _v1.copy(worldTarget).applyMatrix4(_inv);
  const dir = _v2.subVectors(t, bone.position);
  if (dir.lengthSq() < 1e-9) return;
  dir.normalize().multiplyScalar(sign);
  _yAxis.copy(dir);
  if (upHint) _v3.copy(upHint).transformDirection(_inv);
  else _v3.set(0, 0, 1);
  _zAxis.copy(_v3).addScaledVector(_yAxis, -_v3.dot(_yAxis));
  if (_zAxis.lengthSq() < 1e-8) {
    _zAxis.set(1, 0, 0).addScaledVector(_yAxis, -_yAxis.x);
    if (_zAxis.lengthSq() < 1e-8) _zAxis.set(0, 0, 1);
  }
  _zAxis.normalize();
  _xAxis.crossVectors(_yAxis, _zAxis).normalize();
  _zAxis.crossVectors(_xAxis, _yAxis).normalize();
  _m.makeBasis(_xAxis, _yAxis, _zAxis);
  bone.quaternion.setFromRotationMatrix(_m);
  bone.updateMatrix();
}

const _wq = new THREE.Quaternion();

/** Force an object's world rotation, expressed through its parent. */
export function setWorldQuaternion(obj, worldQuat) {
  const p = obj.parent;
  if (!p) { obj.quaternion.copy(worldQuat); return; }
  p.updateWorldMatrix(true, false);
  p.getWorldQuaternion(_wq).invert();
  obj.quaternion.copy(_wq).multiply(worldQuat);
}

// ---------------------------------------------------------------------------
// Small math utilities used across the AI modules
// ---------------------------------------------------------------------------

/** Frame-rate independent exponential smoothing. */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function dampAngle(current, target, lambda, dt) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Critically-damped spring, used for recoil and hit reactions. */
export class Spring {
  constructor(stiffness = 120, damping = 18) {
    this.value = 0; this.vel = 0;
    this.k = stiffness; this.d = damping;
  }
  kick(v) { this.vel += v; return this; }
  step(dt, target = 0) {
    // Sub-step so a large dt cannot make the spring explode.
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.012)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (target - this.value) * this.k - this.vel * this.d;
      this.vel += a * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
}

export class Spring3 {
  constructor(stiffness = 120, damping = 18) {
    this.value = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.k = stiffness; this.d = damping;
    this._t = new THREE.Vector3();
  }
  kick(x, y, z) { this.vel.x += x; this.vel.y += y; this.vel.z += z; return this; }
  step(dt, target = null) {
    const t = target || this._t.set(0, 0, 0);
    const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.012)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel.x += ((t.x - this.value.x) * this.k - this.vel.x * this.d) * h;
      this.vel.y += ((t.y - this.value.y) * this.k - this.vel.y * this.d) * h;
      this.vel.z += ((t.z - this.value.z) * this.k - this.vel.z * this.d) * h;
      this.value.addScaledVector(this.vel, h);
    }
    return this.value;
  }
}
