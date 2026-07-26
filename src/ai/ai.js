import * as THREE from 'three';
import {
  createSoldier, EYE_LOCAL, STANCE_HIP_Y, WEAPON_ANCHORS,
  SKELETON, BONE_LENGTHS,
} from './soldier.js';
import { solveTwoBone, damp } from './rig.js';

/**
 * Owns enemy agents: rigs, animation, perception, hitboxes.
 *
 * CONTRACT
 *   agents      — array of {root, hitboxes:[{box, mesh, multiplier}],
 *                 health, alive}
 *   spawnWave(n)
 *
 * Hitboxes are what the combat module raycasts against, and they are refreshed
 * in lateUpdate() — after the animation layer has posed the rig — so a shot is
 * tested against where the character actually is this frame rather than where
 * it was last frame.
 */

const STANCE = { patrol: 0, alert: 1, engage: 2, dead: 3 };

const TUNING = {
  health: 100,
  visionRange: 55,
  visionHalfAngle: Math.PI * 0.42,
  turnRate: 3.2,
  memory: 6.0,           // seconds of hunting after losing sight

  // --- weapon ------------------------------------------------------------
  // Tuned so a firefight is survivable. Six agents firing accurately would
  // erase the player in well under a second, which is not a fight, it is a
  // cutscene. Long reaction, short bursts, long pauses and generous spread
  // give the player time to break line of sight and answer back.
  reactionMin: 0.80,     // seconds between acquiring and first shot
  reactionMax: 1.80,
  fireRpm: 480,
  burstMin: 2,
  burstMax: 4,
  burstPauseMin: 1.90,
  burstPauseMax: 3.40,
  spread: 0.085,         // radians; deliberately loose
  damage: 6,
  // At most this many agents may fire at once. Without a cap, a garrison that
  // all has line of sight converges into a single lethal volley and the player
  // dies before they can react — measured, not guessed: the first tuning killed
  // the player during the movement test. Holding the rest in suppression is how
  // squad shooters keep a fight readable.
  maxConcurrentFire: 2,
  muzzleVelocity: 780,
  maxEngageRange: 48,
};

// ---------------------------------------------------------------------------
// Animation constants
//
// Derived from the skeleton rather than retyped, so a change to the rig cannot
// silently desync the foot-planting maths from the actual bone offsets.
// ---------------------------------------------------------------------------
const _thighOff = SKELETON.find(s => s[0] === 'thighL')[2];
const HIP_TO_THIGH_X = _thighOff[0];         //  0.095
const HIP_TO_THIGH_Y = _thighOff[1];         // -0.045
const LEG_LEN = BONE_LENGTHS.thigh + BONE_LENGTHS.shin;
/** Ankle height, relative to the hips bone, with the legs locked straight. */
const FOOT_REST_Y = HIP_TO_THIGH_Y - LEG_LEN;
/** Toe forward reach, used to pitch a floating foot back down onto the ground. */
const TOE_LEVER = 0.150;

// Hand orientations, expressed in the weapon's own space: the firing hand rolls
// back with the pistol grip, the support hand lies along the handguard.
const GRIP_ROT_R = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.34, 0.10, 0.06));
const GRIP_ROT_L = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.15, 0.0, -0.55));

const _tgt = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const _hq = new THREE.Quaternion();

// Slack pose the rig melts into as it falls, so the standing weight shift and
// the weapon-hold do not stay frozen on a corpse.
const _slackEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _slackQ = (x, y, z) => new THREE.Quaternion().setFromEuler(_slackEuler.set(x, y, z));
const SLACK = {
  upperArmL: _slackQ(0.16, 0, -0.78), lowerArmL: _slackQ(-0.22, 0, 0),
  upperArmR: _slackQ(0.16, 0, 0.78), lowerArmR: _slackQ(-0.22, 0, 0),
  thighL: _slackQ(-0.10, 0, 0.12), shinL: _slackQ(0.20, 0, 0),
  thighR: _slackQ(-0.06, 0, -0.09), shinR: _slackQ(0.13, 0, 0),
  spine: _slackQ(0.10, 0, 0), chest: _slackQ(0.06, 0, 0),
  clavL: _slackQ(0, 0, -0.10), clavR: _slackQ(0, 0, 0.10),
};

const POSTS = [
  [-6.5, -9.0, 2.2], [5.5, -1.0, -1.1], [-12.0, 3.0, 1.6], [12.0, -6.0, -2.4],
  [-2.0, -18.0, 0.2], [8.0, 8.0, 3.0], [-16.0, -10.0, 0.9], [2.0, -26.0, 0.4],
];

export class AiModule {
  constructor() {
    this.agents = [];
    this._tmp = new THREE.Vector3();
    this._toPlayer = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this._muzzle = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._budgetCursor = 0;
  }

  async init(engine) {
    this.engine = engine;
    let n = 6;
    try {
      const v = parseInt(new URLSearchParams(location.search).get('enemies') ?? '', 10);
      if (Number.isFinite(v)) n = v;
    } catch { /* no location in non-browser contexts */ }
    this._waveSize = n;
    this.spawnWave(n);
  }

  spawnWave(count) {
    for (let i = 0; i < count; i++) {
      const [x, z, yaw] = POSTS[i % POSTS.length];
      const jitter = i >= POSTS.length ? (Math.random() - 0.5) * 3 : 0;
      this._spawn(x + jitter, z + jitter, yaw, i);
    }
  }

  _spawn(x, z, yaw, index) {
    const soldier = createSoldier({ kit: index % 3, scale: 0.99 + Math.random() * 0.03 });
    soldier.root.position.set(x, 0, z);
    soldier.root.rotation.y = yaw;
    this.engine.scene.add(soldier.root);
    // Character materials are created outside the world library, so they need
    // the cascade injection explicitly or they render several times too bright.
    this.engine.modules.get('lighting')?.registerObject?.(soldier.root);

    const agent = {
      ...soldier,
      health: TUNING.health,
      alive: true,
      stance: STANCE.patrol,
      yaw,
      targetYaw: yaw,
      phase: Math.random() * Math.PI * 2,
      lastSeen: new THREE.Vector3(),
      hasSeen: false,
      memoryT: 0,
      deathT: 0,
      hitFlash: 0,
      _sees: false,
      _aimMix: 0,
      _reaction: TUNING.reactionMin +
        Math.random() * (TUNING.reactionMax - TUNING.reactionMin),
      reactionT: 0,
      fireCd: 0,
      burstLeft: 0,
      burstPause: 0,
    };

    // A node at the weapon's muzzle so shots and flashes originate from the
    // barrel rather than from the agent's centre.
    const muzzleNode = new THREE.Object3D();
    muzzleNode.position.copy(WEAPON_ANCHORS.muzzle);
    soldier.weaponMount.add(muzzleNode);
    agent.muzzleNode = muzzleNode;
    agent.onDamage = () => {
      agent.hitFlash = 1;
      agent.stance = STANCE.engage;
      agent.memoryT = TUNING.memory;
    };
    agent.onDeath = () => { agent.alive = false; agent.stance = STANCE.dead; agent.deathT = 0; };

    this.agents.push(agent);
    return agent;
  }

  /** Clear the garrison and repopulate it, for a fresh match. */
  reset() {
    for (const a of this.agents) this.engine.scene.remove(a.root);
    this.agents.length = 0;
    this._budgetCursor = 0;
    this.spawnWave(this._waveSize ?? 6);
  }

  /** Line of sight from the agent's eye to the player, blocked by level geo. */
  _canSee(agent, playerPos) {
    const world = this.engine.modules.get('world');
    const eye = this._tmp.copy(EYE_LOCAL).applyMatrix4(agent.root.matrixWorld);
    this._toPlayer.subVectors(playerPos, eye);
    const dist = this._toPlayer.length();
    if (dist > TUNING.visionRange || dist < 0.01) return false;
    this._toPlayer.divideScalar(dist);

    this._fwd.set(Math.sin(agent.yaw), 0, Math.cos(agent.yaw));
    if (this._fwd.dot(this._toPlayer) < Math.cos(TUNING.visionHalfAngle)) return false;

    const targets = world?.raycastTargets ?? [];
    if (!targets.length) return true;
    this._ray.set(eye, this._toPlayer);
    this._ray.far = dist - 0.2;
    return this._ray.intersectObjects(targets, false).length === 0;
  }

  update(dt, engine) {
    const player = engine.modules.get('player');
    const playerPos = engine.camera.position;
    const n = this.agents.length;
    if (!n) return;

    // Line-of-sight raycasts dominate the cost, so only a slice of the roster is
    // tested per frame; the rest run on their cached result.
    const perFrame = Math.max(1, Math.ceil(n / 3));
    for (let k = 0; k < perFrame; k++) {
      const a = this.agents[(this._budgetCursor + k) % n];
      if (a.alive) a._sees = this._canSee(a, playerPos);
    }
    this._budgetCursor = (this._budgetCursor + perFrame) % n;

    for (const a of this.agents) {
      if (!a.alive) { this._animateDeath(a, dt); continue; }

      a.hitFlash = Math.max(0, a.hitFlash - dt * 3);

      if (a._sees && !player?.dead) {
        a.stance = STANCE.engage;
        a.memoryT = TUNING.memory;
        a.lastSeen.copy(playerPos);
        a.hasSeen = true;
      } else if (a.memoryT > 0) {
        a.memoryT -= dt;
        a.stance = a.memoryT > 0 ? STANCE.alert : STANCE.patrol;
      }

      if (a.stance === STANCE.engage && a.hasSeen) {
        a.targetYaw = Math.atan2(a.lastSeen.x - a.root.position.x,
                                 a.lastSeen.z - a.root.position.z);
      } else {
        // Slow watch sweep, so idle guards are never perfectly static.
        a.phase += dt * 0.35;
        a.targetYaw += Math.sin(a.phase) * dt * 0.5;
      }

      let d = a.targetYaw - a.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a.yaw += THREE.MathUtils.clamp(d, -TUNING.turnRate * dt, TUNING.turnRate * dt);
      a.root.rotation.y = a.yaw;

      this._animateIdle(a, dt);
      this._updateWeapon(a, dt, playerPos, player);
    }
  }

  /**
   * Burst-fire discipline: acquire, hesitate, fire a short burst, pause, repeat.
   * Only fires with a live line of sight, so an agent cannot shoot the player
   * through the wall it lost them behind.
   */
  _updateWeapon(a, dt, playerPos, player) {
    a.fireCd = Math.max(0, a.fireCd - dt);
    a.burstPause = Math.max(0, a.burstPause - dt);

    const canEngage = a.stance === STANCE.engage && a._sees && !player?.dead;

    // Attack token: mid-burst agents keep firing, but a new burst may only
    // start if the squad is under its concurrent-fire cap.
    if (canEngage && a.burstLeft <= 0 && a.burstPause <= 0) {
      const firing = this.agents.reduce((n, x) => n + (x.alive && x.burstLeft > 0 ? 1 : 0), 0);
      if (firing >= TUNING.maxConcurrentFire) return;
    }
    if (!canEngage) {
      // Losing sight resets the hesitation, so re-acquiring is not instant.
      a.reactionT = 0;
      a.burstLeft = 0;
      return;
    }

    const dist = Math.hypot(playerPos.x - a.root.position.x, playerPos.z - a.root.position.z);
    if (dist > TUNING.maxEngageRange) return;

    if (a.reactionT < a._reaction) { a.reactionT += dt; return; }
    if (a.burstPause > 0 || a.fireCd > 0) return;

    if (a.burstLeft <= 0) {
      a.burstLeft = Math.round(TUNING.burstMin +
        Math.random() * (TUNING.burstMax - TUNING.burstMin));
    }

    this._fire(a, playerPos);
    a.burstLeft--;
    a.fireCd = 60 / TUNING.fireRpm;
    if (a.burstLeft <= 0) {
      a.burstPause = TUNING.burstPauseMin +
        Math.random() * (TUNING.burstPauseMax - TUNING.burstPauseMin);
    }
  }

  _fire(a, playerPos) {
    const engine = this.engine;
    a.muzzleNode.getWorldPosition(this._muzzle);

    // Aim at the player's centre of mass, then scatter.
    this._aim.set(playerPos.x, playerPos.y - 0.25, playerPos.z).sub(this._muzzle).normalize();
    const ang = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * TUNING.spread;
    this._side.set(-this._aim.z, 0, this._aim.x).normalize();
    this._up.crossVectors(this._side, this._aim).normalize();
    this._aim.addScaledVector(this._side, Math.cos(ang) * rad)
      .addScaledVector(this._up, Math.sin(ang) * rad)
      .normalize();

    engine.modules.get('combat')?.fireShot?.({
      origin: this._muzzle, dir: this._aim,
      weapon: { damage: TUNING.damage, muzzleVelocity: TUNING.muzzleVelocity, name: 'AK' },
      shooter: a,
    });
    engine.modules.get('fx')?.muzzleFlash?.(this._muzzle, this._aim, 0.85);
    engine.modules.get('audio')?.play?.('fire', { position: this._muzzle });
  }

  /**
   * The standing pose.
   *
   * A soldier at a post is never symmetrical: the weight sits on one leg, the
   * pelvis tips and turns under a torso that counter-rotates against it, the
   * shoulders ride the breath, and both hands are committed to the weapon. All
   * of that is driven from three signals — breath (fast), weight shift (slow,
   * asymmetric, occasionally swapping legs) and aim mix (stance) — layered onto
   * the rest pose.
   *
   * Cost per agent: a handful of sin/cos, one exp per damp, and two analytic
   * two-bone IK solves. No allocation, no clips, no skinning.
   */
  _animateIdle(a, dt) {
    const b = a.bones;
    if (!b || !b.hips) return;
    const eng = a.stance === STANCE.engage;

    a.phase += dt * (eng ? 2.1 : 1.2);
    a._aimMix = THREE.MathUtils.lerp(a._aimMix, eng ? 1 : 0, Math.min(1, dt * 6));
    const mix = a._aimMix;

    let P = a._pose;
    if (!P) {
      P = a._pose = {
        side: Math.random() < 0.5 ? -1 : 1,
        shift: 0,
        timer: 1 + Math.random() * 5,
      };
    }
    // Standing on one leg tires; a real sentry swaps every few seconds.
    P.timer -= dt;
    if (P.timer <= 0) { P.side = -P.side; P.timer = 4.0 + Math.random() * 5.0; }
    // Engaging squares the stance up, so the shift flattens out as they aim.
    const sh = P.shift = damp(P.shift, P.side * (1 - mix * 0.6), 1.7, dt);

    const breathe = Math.sin(a.phase) * (eng ? 0.012 : 0.022);

    // ---- legs: weight on one side, feet planted --------------------------
    // Load per leg, 0..1. +sh means the weight is on the character's left.
    const loadL = 0.5 + sh * 0.5;
    const loadR = 0.5 - sh * 0.5;
    // The loaded leg locks out, the free leg softens. Engaging drops the whole
    // body a little lower and braces both knees.
    const flex = 0.045 + mix * 0.17 + breathe * 0.35;
    const kneeL = flex + (1 - loadL) * 0.17;
    const kneeR = flex + (1 - loadR) * 0.17;
    // Bladed stance: support-side foot leads, firing-side foot trails.
    const stagger = 0.05 + mix * 0.17;
    // Negative thigh pitch swings the leg forward; -0.45*knee keeps the ankle
    // roughly under the hip instead of trailing behind it.
    const thighLx = -kneeL * 0.45 - stagger;
    const thighRx = -kneeR * 0.45 + stagger * 0.6;

    const hipRoll = sh * 0.055;      // pelvis drops on the free side
    const hipTurn = -sh * 0.10 * (1 - mix * 0.6);
    const cz = Math.cos(hipRoll), sz = Math.sin(hipRoll);

    // Vertical reach of each leg, and therefore how far the hips must drop for
    // the lower foot to stay welded to the ground. Getting this wrong is what
    // makes procedural characters skate or sink.
    const reachL = BONE_LENGTHS.thigh * Math.cos(thighLx) +
                   BONE_LENGTHS.shin * Math.cos(thighLx + kneeL);
    const reachR = BONE_LENGTHS.thigh * Math.cos(thighRx) +
                   BONE_LENGTHS.shin * Math.cos(thighRx + kneeR);
    const footLy = (HIP_TO_THIGH_X * sz + HIP_TO_THIGH_Y * cz) - reachL;
    const footRy = (-HIP_TO_THIGH_X * sz + HIP_TO_THIGH_Y * cz) - reachR;
    const lowest = Math.min(footLy, footRy);

    b.hips.position.set(sh * 0.022, STANCE_HIP_Y + (FOOT_REST_Y - lowest), 0);
    b.hips.rotation.set(0, hipTurn, hipRoll);

    b.thighL.rotation.set(thighLx, 0.05, (1 - loadL) * 0.06);
    b.shinL.rotation.set(kneeL, 0, 0);
    b.thighR.rotation.set(thighRx, -0.05, -(1 - loadR) * 0.06);
    b.shinR.rotation.set(kneeR, 0, 0);
    // Sole stays parallel to the ground; the unloaded foot pitches onto its toe
    // to close the millimetre or two of daylight left under it.
    b.footL.rotation.set(
      -(thighLx + kneeL) - Math.min((footLy - lowest) / TOE_LEVER, 0.12), 0.10, 0);
    b.footR.rotation.set(
      -(thighRx + kneeR) - Math.min((footRy - lowest) / TOE_LEVER, 0.12), -0.10, 0);

    // ---- torso: counter-rotation against the hips ------------------------
    const spineX = 0.055 + breathe + mix * 0.075;
    const chestX = -0.03 - breathe * 0.5 + mix * 0.03;
    b.spine.rotation.set(spineX, sh * 0.045, -sh * 0.030);
    b.chest.rotation.set(chestX, sh * 0.055 * (1 - mix * 0.8), -sh * 0.018);
    if (b.neck) b.neck.rotation.set(-0.02, -sh * 0.03, -sh * 0.02);
    if (b.head) {
      b.head.rotation.set(
        -0.02 + Math.sin(a.phase * 0.7) * 0.03 * (1 - mix * 0.7),
        Math.sin(a.phase * 0.43) * 0.10 * (1 - mix * 0.8) - mix * 0.05,
        mix * 0.07 + sh * 0.02);   // cheek rolls onto the stock when aiming
    }

    // Shoulders ride the breath, and the support shoulder rolls forward behind
    // the weapon while the firing shoulder squares up to take the stock.
    const shrug = 0.012 + breathe * 0.45;
    if (b.clavL) b.clavL.rotation.set(0, -0.05 - mix * 0.20, shrug + sh * 0.020);
    if (b.clavR) b.clavR.rotation.set(0, 0.03 + mix * 0.09, -shrug + sh * 0.020);

    // ---- weapon ----------------------------------------------------------
    const wm = a.weaponMount;
    if (!wm) return;
    // Pitch to the target, cancelling whatever lean the torso just applied so
    // the barrel stays on line instead of following the chest down.
    let aimX = 0.02;
    if (eng && a.hasSeen) {
      const dx = a.lastSeen.x - a.root.position.x;
      const dz = a.lastSeen.z - a.root.position.z;
      const dy = a.lastSeen.y - (a.root.position.y + 1.42);
      aimX = THREE.MathUtils.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.45, 0.45);
    }
    aimX -= spineX + chestX;
    // Patrol carry: butt on the hip, muzzle down and across the body.
    // Shouldered: butt in the shoulder pocket, weapon on the firing side.
    wm.rotation.set(
      THREE.MathUtils.lerp(0.52, aimX, mix) + breathe * 0.35,
      THREE.MathUtils.lerp(0.20, 0.0, mix),
      THREE.MathUtils.lerp(0.16, 0.04, mix));
    wm.position.set(
      THREE.MathUtils.lerp(-0.055, -0.085, mix),
      THREE.MathUtils.lerp(0.020, 0.190, mix),
      THREE.MathUtils.lerp(0.230, 0.290, mix));

    // ---- hands onto the weapon -------------------------------------------
    // Solved in world space against the mount's fresh matrix, so the arms track
    // this frame's weapon rather than last frame's.
    wm.updateWorldMatrix(true, false);
    const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);

    // Firing elbow drops down, out and back; the support elbow tucks under the
    // weapon. Passing the negated elbow direction as the pole is what
    // solveTwoBone's bendSign=-1 convention expects.
    _tgt.copy(WEAPON_ANCHORS.wristR).applyMatrix4(wm.matrixWorld);
    _pole.set(0.55 * cy + 0.25 * sy, 0.78, -0.55 * sy + 0.25 * cy);
    solveTwoBone(b.upperArmR, b.lowerArmR, _tgt, _pole,
      BONE_LENGTHS.upperArm, BONE_LENGTHS.lowerArm, -1);

    _tgt.copy(WEAPON_ANCHORS.wristL).applyMatrix4(wm.matrixWorld);
    _pole.set(-0.25 * cy - 0.15 * sy, 0.88, 0.25 * sy - 0.15 * cy);
    solveTwoBone(b.upperArmL, b.lowerArmL, _tgt, _pole,
      BONE_LENGTHS.upperArm, BONE_LENGTHS.lowerArm, -1);

    // Wrists take their orientation from the weapon, not the forearm. The mount
    // and both arms hang off the same chest bone, so the whole thing resolves in
    // local quaternion algebra — no world matrices, no matrix decomposition.
    if (b.handR) {
      _hq.copy(b.clavR.quaternion).multiply(b.upperArmR.quaternion)
        .multiply(b.lowerArmR.quaternion).invert()
        .multiply(_wq.copy(wm.quaternion).multiply(GRIP_ROT_R));
      b.handR.quaternion.copy(_hq);
    }
    if (b.handL) {
      _hq.copy(b.clavL.quaternion).multiply(b.upperArmL.quaternion)
        .multiply(b.lowerArmL.quaternion).invert()
        .multiply(_wq.copy(wm.quaternion).multiply(GRIP_ROT_L));
      b.handL.quaternion.copy(_hq);
    }

    a.root.position.y = 0;
  }

  /** Fall with momentum rather than snapping to a pose. */
  _animateDeath(a, dt) {
    if (a.deathT >= 1) return;
    a.deathT = Math.min(1, a.deathT + dt * 1.6);
    const ease = 1 - Math.pow(1 - a.deathT, 3);
    a.root.rotation.x = ease * -1.42;
    // Rotating the root by 1.42 rad already lays the body down; the old 0.42
    // sink then buried the head half a metre underground. A hand's width of
    // settle is all a body on its back needs.
    a.root.position.y = -ease * (STANCE_HIP_Y * 0.09);
    if (a.weaponMount) a.weaponMount.rotation.x = 0.55 + ease * 0.8;

    // Melt the standing pose. Without this the corpse keeps its weight on one
    // leg and its hands welded to the weapon all the way to the floor, which
    // reads as a felled statue rather than a body.
    const b = a.bones;
    if (!b) return;
    const t = 1 - Math.exp(-7 * dt);
    for (const name in SLACK) {
      const bone = b[name];
      if (bone) bone.quaternion.slerp(SLACK[name], t);
    }
    if (b.head) {
      b.head.rotation.set(ease * 0.5, b.head.rotation.y * (1 - t), b.head.rotation.z * (1 - t));
    }
    if (b.hips) {
      b.hips.position.set(b.hips.position.x * (1 - t),
        damp(b.hips.position.y, STANCE_HIP_Y, 7, dt), 0);
      b.hips.quaternion.slerp(_hq.identity(), t);
    }
  }

  /**
   * Refresh world-space hitboxes after the rig has been posed. Combat traces
   * against these, so they have to reflect this frame's pose, not last frame's.
   */
  lateUpdate() {
    for (const a of this.agents) {
      if (!a.alive) continue;
      for (const hb of a.hitboxes) {
        if (!hb.bone) continue;
        hb.bone.updateWorldMatrix(true, false);
        hb.box.copy(hb.local).applyMatrix4(hb.bone.matrixWorld);
      }
    }
  }
}
