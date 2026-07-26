import * as THREE from 'three';
import { Spring, clamp, saturate, damp, lerp } from './mathx.js';
import { fbm1, perlin1 } from './noise.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Everything that moves the camera which is NOT the player's position or their
 * mouse. Output is additive: a view-space position offset plus pitch/yaw/roll
 * deltas that the controller composes on top of the look angles.
 *
 * DESIGN NOTES (these are the choices that make it feel like a game and not a
 * tech demo):
 *
 *  - Bob is driven by DISTANCE TRAVELLED, not by elapsed time. A time-based
 *    sine keeps bobbing when you walk into a wall and desyncs from footstep
 *    audio the moment your speed changes. Integrating phase against horizontal
 *    speed means one bob cycle is one stride, always, and the footstep event
 *    falls exactly on the low point of the dip.
 *
 *  - The landing dip is a spring given a velocity IMPULSE, not a lerp to a
 *    target. Impulses have an instantaneous onset (which is what an impact is)
 *    and an underdamped tail, so heavy landings visibly rebound.
 *
 *  - Shake is trauma², sampled from layered Perlin along time. Squaring makes
 *    small traumas nearly invisible and big ones violent, so a rifle shot and a
 *    grenade do not read as the same event.
 */
export class ViewEffects {
  constructor() {
    this.posOffset = new THREE.Vector3();
    this.pitch = 0;
    this.yaw = 0;
    this.roll = 0;

    // Footstep phase: advances π per footfall.
    this.stridePhase = 0;
    this.stepCount = 0;
    this.onFootstep = null;

    this.bobAmount = new Spring(9, 1.0);       // 0..1 envelope, smooths speed changes
    this.land = new Spring(24, 0.42);          // underdamped: real rebound
    this.rollSpring = new Spring(13, 0.85);
    this.leanSpring = new Spring(11, 0.9);
    this.pitchLead = new Spring(10, 0.9);      // accel/decel head lag

    this.breathT = 0;
    this.shakeT = 0;
    this.trauma = 0;
    this.traumaDecay = 1.55;

    this._prevYaw = 0;
    this._airTime = 0;
  }

  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); }

  /** Call the instant the controller detects a landing. */
  land_(fallSpeed) {
    // Below ~2.2 m/s a landing is a step, not an impact — no dip at all.
    const impact = saturate((fallSpeed - 2.2) / 9.5);
    if (impact <= 0) return 0;
    this.land.impulse(-impact * 5.6);
    return impact;
  }

  /**
   * ctx: {
   *   dt, speed (horizontal m/s), onGround, sprinting, crouching, sliding,
   *   ads (0..1), strafeAxis (-1..1), forwardAxis, yaw, mantle (0..1),
   *   moveIntent (bool), accelAlong (m/s² along facing)
   * }
   */
  update(ctx) {
    const dt = ctx.dt;
    const adsMix = ctx.ads;

    // ---- footstep-phase view bob ----------------------------------------
    const speed = ctx.speed;
    const moving = ctx.onGround && speed > 0.35 && ctx.moveIntent;
    if (moving) {
      // Stride lengthens with speed the way a real gait does, otherwise sprint
      // turns into a sewing machine.
      const stride = clamp(0.62 + speed * 0.075, 0.62, 1.18);
      this.stridePhase += (speed * dt / stride) * Math.PI;
      const step = Math.floor(this.stridePhase / Math.PI);
      if (step !== this.stepCount) {
        this.stepCount = step;
        this.onFootstep?.({ speed, sprinting: ctx.sprinting, crouching: ctx.crouching, foot: step & 1 });
      }
    } else {
      // Ease the phase back to a neutral footfall so stopping does not freeze
      // the camera mid-lurch.
      const target = Math.round(this.stridePhase / Math.PI) * Math.PI;
      this.stridePhase = damp(this.stridePhase, target, 7, dt);
      this.stepCount = Math.floor(this.stridePhase / Math.PI);
    }

    const speedRatio = clamp(speed / 4.4, 0, 1.8);
    const bobTarget = moving ? speedRatio : 0;
    const bobEnv = this.bobAmount.update(dt, bobTarget);

    const bobScale = (1 - adsMix * 0.78) * (ctx.crouching ? 0.62 : 1) * (ctx.sliding ? 0.2 : 1);
    const p = this.stridePhase;
    // Two dips per stride (one per foot) vertically; one lateral sway per stride.
    const bobV = -Math.cos(p * 2) * 0.021 * bobEnv * bobScale;
    const bobH = Math.sin(p) * 0.026 * bobEnv * bobScale;
    const bobRoll = Math.sin(p) * 0.85 * DEG * bobEnv * bobScale;
    const bobPitch = Math.sin(p * 2 + 0.55) * 0.30 * DEG * bobEnv * bobScale;

    // ---- landing dip ------------------------------------------------------
    const landV = this.land.update(dt, 0);

    // ---- breathing --------------------------------------------------------
    this.breathT += dt;
    const idle = 1 - saturate(speed / 1.4);
    // Two incommensurate rates plus a slow Perlin wander so it never loops.
    const bA = Math.sin(this.breathT * TAU * 0.26);
    const bB = Math.sin(this.breathT * TAU * 0.41 + 1.9);
    const bC = perlin1(this.breathT * 0.19 + 11.3);
    const breathAmt = (0.35 + idle * 0.65) * (1 + adsMix * 1.15);
    const breathPitch = (bA * 0.0021 + bC * 0.0016) * breathAmt;
    const breathYaw = (bB * 0.0015 + perlin1(this.breathT * 0.23 + 57.1) * 0.0013) * breathAmt;
    const breathPos = bA * 0.0035 * breathAmt;

    // ---- strafe / turn roll ----------------------------------------------
    let yawRate = (ctx.yaw - this._prevYaw);
    while (yawRate > Math.PI) yawRate -= TAU;
    while (yawRate < -Math.PI) yawRate += TAU;
    this._prevYaw = ctx.yaw;
    yawRate = dt > 1e-6 ? yawRate / dt : 0;

    const strafeRoll = -ctx.strafeAxis * 1.75 * DEG;
    const turnRoll = -clamp(yawRate, -4, 4) * 0.16 * DEG;
    const slideRoll = ctx.sliding ? -ctx.strafeAxis * 2.2 * DEG - 2.6 * DEG : 0;
    const rollTarget = (strafeRoll + turnRoll + slideRoll) * (1 - adsMix * 0.55);
    const roll = this.rollSpring.update(dt, rollTarget);

    // A few centimetres of lateral lean sells the roll; without it the roll
    // reads as a camera trick rather than body weight.
    const lean = this.leanSpring.update(dt, ctx.strafeAxis * 0.014 * (1 - adsMix * 0.7));

    // Head lags acceleration: pitch up slightly when accelerating forward.
    const lead = this.pitchLead.update(dt, clamp(-ctx.accelAlong * 0.0016, -0.02, 0.02) * (1 - adsMix * 0.6));

    // ---- trauma shake -----------------------------------------------------
    this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
    this.shakeT += dt;
    let shakePitch = 0, shakeYaw = 0, shakeRoll = 0, shakeX = 0, shakeY = 0;
    if (this.trauma > 0.0005) {
      const s = this.trauma * this.trauma * (1 - adsMix * 0.45);
      const t = this.shakeT * 19.0;
      shakePitch = fbm1(t) * s * 0.052;
      shakeYaw = fbm1(t + 37.13) * s * 0.048;
      shakeRoll = fbm1(t * 0.83 + 91.77) * s * 0.085;
      shakeX = fbm1(t * 1.21 + 143.9) * s * 0.020;
      shakeY = fbm1(t * 1.07 + 211.4) * s * 0.017;
    }

    // ---- compose ----------------------------------------------------------
    this.posOffset.set(
      bobH + lean + shakeX,
      bobV + landV * 0.17 + breathPos + shakeY,
      0,
    );
    this.pitch = bobPitch + landV * 0.115 + breathPitch + shakePitch + lead;
    this.yaw = breathYaw + shakeYaw;
    this.roll = roll + bobRoll + shakeRoll;
  }

  reset() {
    this.posOffset.set(0, 0, 0);
    this.pitch = this.yaw = this.roll = 0;
    this.trauma = 0;
    this.stridePhase = 0;
    this.land.set(0);
    this.rollSpring.set(0);
    this.leanSpring.set(0);
    this.pitchLead.set(0);
    this.bobAmount.set(0);
  }
}
