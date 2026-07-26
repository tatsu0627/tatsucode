/**
 * Small gameplay math kit shared by the player controller and the weapon rig.
 *
 * Everything here is FRAME-RATE INDEPENDENT. The engine clamps dt to 1/15s, so
 * an explicit-Euler spring at the stiffnesses we want (omega up to ~90 rad/s)
 * would blow up on a hitch; every integrator below either sub-steps or uses a
 * closed-form solution.
 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function smoothstep(a, b, x) {
  const t = saturate((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
}

/** Cubic ease used for pose blends; flat at both ends, no overshoot. */
export function easeInOut(t) {
  t = saturate(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t) { t = saturate(t); return 1 - Math.pow(1 - t, 3); }
export function easeInCubic(t) { t = saturate(t); return t * t * t; }

/** Slight overshoot then settle — good for a magazine seating or a bolt slam. */
export function easeOutBack(t, overshoot = 1.7) {
  t = saturate(t);
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
}

/**
 * Exponential approach. `lambda` is the rate in 1/s: after 1/lambda seconds the
 * remaining error is 1/e. This is the correct way to write "lerp toward target"
 * so it does not change speed with framerate.
 */
export function damp(current, target, lambda, dt) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export function dampAngle(current, target, lambda, dt) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-lambda * dt));
}

export function moveTowards(current, target, maxDelta) {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

const SPRING_MAX_H = 1 / 360;

/**
 * Damped harmonic oscillator, scalar.
 *   omega — undamped angular frequency (rad/s). Higher = snappier.
 *   zeta  — damping ratio. <1 overshoots (punchy), 1 is critical, >1 is sluggish.
 * Sub-stepped so a 66ms hitch cannot make it explode.
 */
export class Spring {
  constructor(omega = 20, zeta = 1, value = 0) {
    this.omega = omega; this.zeta = zeta;
    this.value = value; this.vel = 0;
  }
  set(v, vel = 0) { this.value = v; this.vel = vel; return this; }
  /** Instantaneous velocity impulse — this is how a recoil "kick" should enter. */
  impulse(v) { this.vel += v; return this; }
  update(dt, target = 0) {
    const steps = Math.max(1, Math.ceil(dt / SPRING_MAX_H));
    const h = dt / steps;
    const k = this.omega * this.omega;
    const c = 2 * this.zeta * this.omega;
    for (let i = 0; i < steps; i++) {
      // semi-implicit Euler: velocity first, then position, stays stable
      this.vel += (-k * (this.value - target) - c * this.vel) * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
}

/** Three independent springs sharing omega/zeta, driven against a Vector3. */
export class Spring3 {
  constructor(omega = 20, zeta = 1) {
    this.x = new Spring(omega, zeta);
    this.y = new Spring(omega, zeta);
    this.z = new Spring(omega, zeta);
  }
  get omega() { return this.x.omega; }
  setParams(omega, zeta) {
    for (const s of [this.x, this.y, this.z]) { s.omega = omega; s.zeta = zeta; }
    return this;
  }
  set(v) { this.x.set(v.x); this.y.set(v.y); this.z.set(v.z); return this; }
  impulse(x, y, z) { this.x.impulse(x); this.y.impulse(y); this.z.impulse(z); return this; }
  update(dt, target, out) {
    out.set(
      this.x.update(dt, target.x),
      this.y.update(dt, target.y),
      this.z.update(dt, target.z),
    );
    return out;
  }
}

/** Uniformly distributed point inside a unit disc — for spread cones. */
export function randomInDisc(out) {
  const r = Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  out.x = Math.cos(a) * r;
  out.y = Math.sin(a) * r;
  return out;
}
