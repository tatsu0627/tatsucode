import * as THREE from 'three';
import { CAMERA } from '../core/artdirection.js';
import { buildCarbine } from './model.js';

/**
 * Owns the first-person viewmodel, weapon state and firing.
 *
 * CONTRACT
 *   setVisible(bool)    — capture mode toggles the viewmodel.
 *   current             — {name, ammo, magSize, reserve, rpm, damage, spread}
 *                         read by ui.
 *   fire() / reload()   — fire() delegates hit resolution to
 *                         combat.fireShot({origin, dir, weapon, shooter}).
 *
 * The viewmodel is parented to the camera and drawn on CAMERA.viewmodelLayer
 * with its own narrower FOV, so it can never clip into world geometry — the
 * standard first-person approach.
 *
 * Everything that moves the weapon is a critically-damped spring rather than a
 * lerp toward a target. Springs carry velocity, so the weapon overshoots and
 * settles the way mass does; a lerp arrives and stops dead, which is most of
 * why amateur viewmodels feel weightless.
 */

const SPEC = {
  name: 'M4A1',
  magSize: 30,
  reserve: 210,
  rpm: 780,
  damage: 24,
  muzzleVelocity: 880,
  spreadHip: 0.021,
  spreadAds: 0.0035,
  spreadBloom: 0.0032,
  spreadDecay: 3.4,
  recoilPitch: 0.0125,
  recoilYaw: 0.0042,
  recoilKick: 0.022,
  reloadTime: 2.15,
};

// Rest and sighted poses in camera space. The ADS pose has to put the optic
// exactly on the camera axis or the sight picture is subtly, persistently wrong.
const POSE_HIP = { pos: new THREE.Vector3(0.152, -0.132, -0.345), rot: new THREE.Euler(0.02, -0.055, 0.015) };
const POSE_ADS = { pos: new THREE.Vector3(0.0, -0.196, -0.255), rot: new THREE.Euler(0, 0, 0) };
const POSE_SPRINT = { pos: new THREE.Vector3(0.195, -0.175, -0.330), rot: new THREE.Euler(-0.22, 0.55, 0.20) };

/** Damped spring step toward a target. Carries velocity, so it settles. */
function spring(cur, vel, target, stiffness, damping, dt) {
  const a = (target - cur) * stiffness - vel * damping;
  const v = vel + a * dt;
  return [cur + v * dt, v];
}

export class WeaponsModule {
  constructor() {
    this.visible = true;
    this.current = {
      name: SPEC.name, ammo: SPEC.magSize, magSize: SPEC.magSize,
      reserve: SPEC.reserve, rpm: SPEC.rpm, damage: SPEC.damage,
      spread: SPEC.spreadHip, reloading: false,
    };

    this._cooldown = 0;
    this._reloadT = 0;
    this._bloom = 0;
    this._triggerHeld = false;

    this._sway = { x: 0, y: 0, vx: 0, vy: 0 };
    this._kick = { z: 0, vz: 0, pitch: 0, vpitch: 0 };
    this._bobT = 0;
    this._poseMix = { ads: 0, sprint: 0 };

    this._tmpPos = new THREE.Vector3();
    this._tmpEuler = new THREE.Euler();
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();
    this._ejectDir = new THREE.Vector3();
    this._prevYaw = 0;
    this._prevPitch = 0;
  }

  async init(engine) {
    this.engine = engine;

    const { root, nodes } = buildCarbine();
    this.model = root;
    this.nodes = nodes;

    this.rig = new THREE.Group();
    this.rig.name = 'viewmodel';
    this.rig.add(root);
    engine.camera.add(this.rig);
    // The camera is not in the scene graph by default, and a viewmodel parented
    // to a detached camera would never be traversed for rendering.
    if (!engine.camera.parent) engine.scene.add(engine.camera);

    const layer = CAMERA.viewmodelLayer ?? 1;
    this.rig.traverse(o => o.layers.set(layer));

    // Same as the characters: without the cascade injection the viewmodel is
    // lit by every cascade at once and blows out.
    engine.modules.get('lighting')?.registerObject?.(this.rig);

    this._addViewmodelLights(engine, layer);

    this.rig.position.copy(POSE_HIP.pos);
    this.rig.rotation.copy(POSE_HIP.rot);
  }

  /**
   * A dedicated key/fill rig for the viewmodel, parented to the camera and
   * restricted to the viewmodel layer so it never touches the world.
   *
   * Real firearm finishes are close to black, and the weapon spends most of its
   * time facing away from the sun, so leaving it to world lighting alone leaves
   * it an unreadable silhouette for much of the level. Every first-person game
   * lights its viewmodel separately for exactly this reason — it is a
   * readability decision, not a physical one.
   */
  _addViewmodelLights(engine, layer) {
    const key = new THREE.DirectionalLight(0xffe9cf, 2.1);
    key.position.set(0.6, 0.9, 0.4);          // over the player's left shoulder
    key.target.position.set(0, -0.2, -1);
    key.layers.set(layer);
    key.target.layers.set(layer);

    // Cool fill from below-right stops the underside going to solid black and
    // separates the magazine and grip from the receiver.
    const fill = new THREE.DirectionalLight(0x9fb6d8, 0.85);
    fill.position.set(-0.7, -0.5, 0.6);
    fill.target.position.set(0, 0, -1);
    fill.layers.set(layer);
    fill.target.layers.set(layer);

    // A touch of ambient so no facet is ever fully unlit.
    const amb = new THREE.AmbientLight(0xb9c4d2, 0.55);
    amb.layers.set(layer);

    engine.camera.add(key, key.target, fill, fill.target, amb);
    this._lights = { key, fill, amb };
  }

  setVisible(v) {
    this.visible = v;
    if (this.rig) this.rig.visible = v;
  }

  get spread() {
    const p = this.engine?.modules.get('player');
    const ads = p?.state?.adsMix ?? 0;
    const base = THREE.MathUtils.lerp(SPEC.spreadHip, SPEC.spreadAds, ads);
    const moving = Math.min(1, (p?.state?.speed ?? 0) / 5) * 0.5;
    return base * (1 + moving) + this._bloom;
  }

  fire() {
    const c = this.current;
    if (this._cooldown > 0 || c.reloading) return false;
    if (c.ammo <= 0) { this.reload(); return false; }

    c.ammo--;
    this._cooldown = 60 / SPEC.rpm;

    const engine = this.engine;
    const cam = engine.camera;

    // Aim from the camera, not the muzzle. The muzzle sits below and left of
    // the view axis; firing from it makes close-range shots miss whatever the
    // crosshair is on. The muzzle position is used only for the visual effect.
    this._origin.copy(cam.position);
    cam.getWorldDirection(this._dir);

    const s = this.spread;
    if (s > 0) {
      // sqrt radius keeps the sample uniform over the disc instead of bunching
      // at the centre.
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * s;
      this._right.crossVectors(this._dir, cam.up).normalize();
      this._up.crossVectors(this._right, this._dir).normalize();
      this._dir.addScaledVector(this._right, Math.cos(a) * r)
        .addScaledVector(this._up, Math.sin(a) * r)
        .normalize();
    }

    engine.modules.get('combat')?.fireShot?.({
      origin: this._origin, dir: this._dir,
      weapon: { damage: SPEC.damage, muzzleVelocity: SPEC.muzzleVelocity, name: SPEC.name },
      shooter: 'player',
    });

    const fx = engine.modules.get('fx');
    if (fx) {
      this.nodes.muzzle.getWorldPosition(this._muzzleWorld);
      fx.muzzleFlash?.(this._muzzleWorld, this._dir, 1);
      this._ejectDir.set(1, 0.55, 0.15).applyQuaternion(cam.quaternion).multiplyScalar(2.4);
      fx.ejectCasing?.(this._muzzleWorld, this._ejectDir);
    }
    engine.modules.get('audio')?.play?.('fire', { position: this._muzzleWorld });

    this._kick.vz += SPEC.recoilKick * 42;
    this._kick.vpitch += SPEC.recoilPitch * 30;
    this._bloom = Math.min(SPEC.spreadBloom * 6, this._bloom + SPEC.spreadBloom);

    const p = engine.modules.get('player');
    if (p) {
      const ads = p.state?.adsMix ?? 0;
      const scale = THREE.MathUtils.lerp(1, 0.62, ads);
      p.pitch += SPEC.recoilPitch * scale;
      p.yaw += (Math.random() - 0.5) * 2 * SPEC.recoilYaw * scale;
      p.addShake?.(0.055 * scale);
    }
    return true;
  }

  reload() {
    const c = this.current;
    if (c.reloading || c.ammo >= c.magSize || c.reserve <= 0) return;
    c.reloading = true;
    this._reloadT = 0;
    this.engine?.modules.get('audio')?.play?.('reload');
  }

  _finishReload() {
    const c = this.current;
    const take = Math.min(c.magSize - c.ammo, c.reserve);
    c.ammo += take;
    c.reserve -= take;
    c.reloading = false;
  }

  update(dt, engine) {
    if (!this.rig) return;
    const p = engine.modules.get('player');
    const st = p?.state;

    this._cooldown = Math.max(0, this._cooldown - dt);
    this._bloom = Math.max(0, this._bloom - SPEC.spreadBloom * SPEC.spreadDecay * dt);
    this.current.spread = this.spread;

    if (p?.enabled && p.input) {
      const held = p.input.isDown?.('fire') ?? false;
      if (held) this.fire();
      this._triggerHeld = held;
      if (p.input.pressed?.('reload')) this.reload();
    }

    if (this.current.reloading) {
      this._reloadT += dt;
      const t = this._reloadT / SPEC.reloadTime;
      // Magazine out, fresh magazine in, then the charging handle is run.
      const mag = this.nodes.magazine;
      if (t < 0.30) mag.position.y = 0.036 - (t / 0.30) * 0.22;
      else if (t < 0.62) mag.position.y = 0.036 - 0.22;
      else if (t < 0.86) mag.position.y = 0.036 - (1 - (t - 0.62) / 0.24) * 0.22;
      else mag.position.y = 0.036;

      const ch = this.nodes.charging;
      ch.position.z = (t > 0.88 && t < 0.96)
        ? 0.052 + Math.sin((t - 0.88) / 0.08 * Math.PI) * 0.055
        : 0.052;

      if (this._reloadT >= SPEC.reloadTime) this._finishReload();
    }

    // ---- pose blend --------------------------------------------------------
    const adsTarget = st?.adsMix ?? 0;
    const sprintTarget = (st?.sprintMix ?? 0) * (1 - adsTarget);
    this._poseMix.ads += (adsTarget - this._poseMix.ads) * Math.min(1, dt * 14);
    this._poseMix.sprint += (sprintTarget - this._poseMix.sprint) * Math.min(1, dt * 10);

    this._tmpPos.copy(POSE_HIP.pos).lerp(POSE_ADS.pos, this._poseMix.ads);
    this._tmpPos.lerp(POSE_SPRINT.pos, this._poseMix.sprint);
    const rx = THREE.MathUtils.lerp(POSE_HIP.rot.x, POSE_ADS.rot.x, this._poseMix.ads);
    const ry = THREE.MathUtils.lerp(POSE_HIP.rot.y, POSE_ADS.rot.y, this._poseMix.ads);
    const rz = THREE.MathUtils.lerp(POSE_HIP.rot.z, POSE_ADS.rot.z, this._poseMix.ads);
    this._tmpEuler.set(
      THREE.MathUtils.lerp(rx, POSE_SPRINT.rot.x, this._poseMix.sprint),
      THREE.MathUtils.lerp(ry, POSE_SPRINT.rot.y, this._poseMix.sprint),
      THREE.MathUtils.lerp(rz, POSE_SPRINT.rot.z, this._poseMix.sprint),
    );

    // ---- sway: the weapon trails the look direction ------------------------
    const yaw = p?.yaw ?? 0, pitch = p?.pitch ?? 0;
    let dYaw = yaw - this._prevYaw;
    const dPitch = pitch - this._prevPitch;
    // Unwrap so a yaw crossing +/-PI does not spike the spring.
    if (dYaw > Math.PI) dYaw -= Math.PI * 2;
    else if (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this._prevYaw = yaw;
    this._prevPitch = pitch;

    const swayScale = THREE.MathUtils.lerp(0.085, 0.022, this._poseMix.ads);
    [this._sway.x, this._sway.vx] = spring(this._sway.x, this._sway.vx,
      THREE.MathUtils.clamp(-dYaw * 6, -0.7, 0.7) * swayScale, 220, 22, dt);
    [this._sway.y, this._sway.vy] = spring(this._sway.y, this._sway.vy,
      THREE.MathUtils.clamp(dPitch * 6, -0.7, 0.7) * swayScale, 220, 22, dt);

    [this._kick.z, this._kick.vz] = spring(this._kick.z, this._kick.vz, 0, 260, 20, dt);
    [this._kick.pitch, this._kick.vpitch] = spring(this._kick.pitch, this._kick.vpitch, 0, 200, 17, dt);

    // ---- bob, driven by gait rather than by raw elapsed time ----------------
    const speed = st?.speed ?? 0;
    const grounded = st?.onGround ?? true;
    let bobX = 0, bobY = 0;
    if (grounded && speed > 0.4) {
      this._bobT += dt * (2.6 + speed * 0.55);
      const amp = Math.min(1, speed / 5.5) * THREE.MathUtils.lerp(0.011, 0.003, this._poseMix.ads);
      bobX = Math.cos(this._bobT) * amp;
      bobY = -Math.abs(Math.sin(this._bobT)) * amp * 0.85;
    } else {
      // Idle breathing — a perfectly still weapon reads as a static prop.
      this._bobT += dt * 1.3;
      const amp = THREE.MathUtils.lerp(0.0018, 0.0005, this._poseMix.ads);
      bobX = Math.cos(this._bobT * 0.7) * amp;
      bobY = Math.sin(this._bobT) * amp;
    }

    this.rig.position.set(
      this._tmpPos.x + this._sway.x + bobX,
      this._tmpPos.y + this._sway.y + bobY,
      this._tmpPos.z + this._kick.z,
    );
    this.rig.rotation.set(
      this._tmpEuler.x + this._kick.pitch + this._sway.y * 1.6,
      this._tmpEuler.y + this._sway.x * 2.0,
      this._tmpEuler.z + this._sway.x * 1.2,
    );

    const firing = this._cooldown > 0;
    this.nodes.trigger.rotation.x = 0.1 + (this._triggerHeld ? 0.28 : 0);
    this.nodes.bolt.position.z = -0.020 + (firing ? Math.min(0.03, this._cooldown * 3) : 0);
  }
}
