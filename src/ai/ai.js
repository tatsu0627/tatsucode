import * as THREE from 'three';
import { createSoldier, EYE_LOCAL, STANCE_HIP_Y } from './soldier.js';

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
    this._budgetCursor = 0;
  }

  async init(engine) {
    this.engine = engine;
    let n = 6;
    try {
      const v = parseInt(new URLSearchParams(location.search).get('enemies') ?? '', 10);
      if (Number.isFinite(v)) n = v;
    } catch { /* no location in non-browser contexts */ }
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
    };
    agent.onDamage = () => {
      agent.hitFlash = 1;
      agent.stance = STANCE.engage;
      agent.memoryT = TUNING.memory;
    };
    agent.onDeath = () => { agent.alive = false; agent.stance = STANCE.dead; agent.deathT = 0; };

    this.agents.push(agent);
    return agent;
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
    }
  }

  /** Breathing and weapon-ready pose. A perfectly still character reads as a prop. */
  _animateIdle(a, dt) {
    a.phase += dt * (a.stance === STANCE.engage ? 2.1 : 1.2);
    const b = a.bones;
    const breathe = Math.sin(a.phase) * (a.stance === STANCE.engage ? 0.012 : 0.022);

    if (b.spine) b.spine.rotation.x = 0.06 + breathe;
    if (b.chest) b.chest.rotation.x = -0.03 - breathe * 0.5;
    if (b.head) {
      b.head.rotation.x = -0.02 + Math.sin(a.phase * 0.7) * 0.03;
      b.head.rotation.y = Math.sin(a.phase * 0.43) * 0.10;
    }
    if (a.weaponMount) {
      // Weapon comes up to the shoulder when engaged and rests low otherwise.
      const up = a.stance === STANCE.engage ? 1 : 0;
      a._aimMix = THREE.MathUtils.lerp(a._aimMix, up, Math.min(1, dt * 6));
      a.weaponMount.rotation.x = THREE.MathUtils.lerp(0.55, 0.02, a._aimMix) + breathe * 0.4;
      a.weaponMount.position.y = THREE.MathUtils.lerp(-0.12, 0.02, a._aimMix);
    }
    a.root.position.y = Math.sin(a.phase * 2) * 0.004;
  }

  /** Fall with momentum rather than snapping to a pose. */
  _animateDeath(a, dt) {
    if (a.deathT >= 1) return;
    a.deathT = Math.min(1, a.deathT + dt * 1.6);
    const ease = 1 - Math.pow(1 - a.deathT, 3);
    a.root.rotation.x = ease * -1.42;
    a.root.position.y = -ease * (STANCE_HIP_Y * 0.42);
    if (a.bones?.head) a.bones.head.rotation.x = ease * 0.5;
    if (a.weaponMount) a.weaponMount.rotation.x = 0.55 + ease * 0.8;
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
