import * as THREE from 'three';
import { EYE_HEIGHT, CROUCH_HEIGHT, PLAYER_RADIUS, CAMERA } from '../core/artdirection.js';
import { Input } from './input.js';
import { WorldCollision, makeContactAcc, resetContactAcc } from './collision.js';
import { ViewEffects } from './vieweffects.js';
import { clamp, saturate, lerp, damp, easeInOut, easeOutCubic } from './mathx.js';

/**
 * Owns input, movement, collision response and the camera transform.
 *
 * CONTRACT (read by weapons/ui/audio/combat — do not break)
 *   enabled             — when false the module must not touch the camera (capture
 *                         mode relies on this).
 *   setPose(pos, look)  — teleport for capture mode.
 *   state               — {onGround, sprinting, crouching, ads, velocity:Vector3,
 *                         speed} read by weapons (sway), ui (HUD), audio (steps).
 *   health, maxHealth   — combat writes damage here; ui reads it.
 *   camera shake is applied via addShake(trauma) so recoil/explosions compose.
 *
 * ALSO EXPOSED (additive, safe to ignore)
 *   state.adsMix/sprintMix/sliding/mantling/vaulting/airborne/stepped
 *   state.eyeHeight, state.groundNormal, state.moveIntent
 *   position            — FEET position. camera = position + eyeHeight + view fx.
 *   yaw, pitch          — look angles in radians, WITHOUT weapon recoil.
 *   applyDamage(n, info), heal(n), respawn()
 *   tuning              — every movement constant, live-editable.
 *
 * MOVEMENT MODEL
 *   Source-style: friction is applied first, then a projected acceleration that
 *   can only ever add speed *up to* the wish speed along the wish direction.
 *   The consequence is the thing that makes these controllers feel good — you
 *   keep momentum you already have, strafing does not brake you, and stopping
 *   has a short, controlled skid instead of an instant halt. A lerp-to-target
 *   velocity cannot produce any of that.
 */

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

export const TUNING = {
  // --- speeds (m/s) -------------------------------------------------------
  walkSpeed: 4.40,
  sprintSpeed: 6.70,
  crouchSpeed: 2.05,
  adsSpeed: 2.75,
  backMul: 0.80,          // walking backwards is slower, as it should be
  strafeMul: 0.93,

  // --- acceleration -------------------------------------------------------
  // Source formula: accelSpeed = accel * wishSpeed * dt, clamped to the deficit.
  // accel 11 at walk speed reaches top speed in ~90ms: responsive, not twitchy.
  accel: 11.0,
  airAccel: 16.0,
  airWishCap: 0.95,       // m/s of wish speed usable in air — this is air control
  friction: 5.6,
  stopSpeed: 1.90,        // below this, friction uses a constant drop -> crisp stop

  // --- gravity / jump -----------------------------------------------------
  gravity: 21.0,
  fallGravityMul: 1.18,   // heavier on the way down; makes the arc read as snappy
  jumpSpeed: 6.05,        // -> 0.87m apex, ~0.58s hang time
  crouchJumpMul: 0.84,
  coyoteTime: 0.11,
  jumpBuffer: 0.14,
  jumpCooldown: 0.10,

  // --- capsule ------------------------------------------------------------
  radius: PLAYER_RADIUS,
  standHeight: 1.80,
  crouchHeight: 1.22,
  slideHeight: 0.98,
  stepHeight: 0.42,
  snapDistance: 0.36,     // how far down we stick to the floor on descents

  // --- crouch / slide -----------------------------------------------------
  crouchDownLambda: 15.0, // fast down (drop into cover NOW)
  crouchUpLambda: 9.0,    // slower up (weight)
  slideEye: 0.80,
  slideBoost: 1.26,
  slideMaxSpeed: 9.2,
  slideMinSpeed: 2.55,
  slideMaxTime: 1.15,
  slideFriction: 1.05,
  slideSteer: 3.2,
  slideCooldown: 0.45,
  slideDownhillGain: 12.0,

  // --- mantle -------------------------------------------------------------
  mantleMinHeight: 0.42,
  mantleMaxHeight: 1.55,
  mantleReach: 0.55,
  mantleExitSpeed: 1.9,
  vaultMaxHeight: 1.00,   // below this we try to carry over the obstacle

  // --- look ---------------------------------------------------------------
  sensitivity: 0.0021,    // rad per mouse count at hip FOV
  adsSensScale: 1.0,      // 1.0 = scale by FOV ratio (monitor-distance matched)
  pitchLimit: 88.5 * DEG,

  // --- fov ----------------------------------------------------------------
  fovLambdaIn: 11.0,
  fovLambdaOut: 9.0,
  sprintFovLambda: 6.5,
};

export class PlayerModule {
  constructor() {
    this.enabled = true;
    this.state = {
      onGround: true, sprinting: false, crouching: false, ads: false,
      velocity: new THREE.Vector3(), speed: 0,
      // additive extras
      adsMix: 0, sprintMix: 0, sliding: false, mantling: false, vaulting: false,
      airborne: false, stepped: false, moveIntent: false,
      eyeHeight: EYE_HEIGHT, groundNormal: new THREE.Vector3(0, 1, 0),
      wishDir: new THREE.Vector3(), airTime: 0,
    };
    this.health = 100;
    this.maxHealth = 100;
    this.dead = false;
    this._trauma = 0;

    this.tuning = TUNING;
    this.position = new THREE.Vector3(0, 0, 0);   // FEET
    this.velocity = this.state.velocity;
    this.yaw = 0;
    this.pitch = 0;

    this.input = new Input();
    this.collision = new WorldCollision();
    this.view = new ViewEffects();

    this._eyeHeight = EYE_HEIGHT;
    this._capsuleHeight = TUNING.standHeight;
    this._fov = CAMERA.fovHip;
    this._adsMix = 0;
    this._sprintMix = 0;
    this._crouchToggle = false;
    this._coyote = 0;
    this._jumpBuf = 0;
    this._jumpCd = 0;
    this._slide = null;
    this._slideCd = 0;
    this._mantle = null;
    this._mantleView = { pitch: 0, roll: 0 };
    this._prevSpeed = 0;
    this._accelAlong = 0;
    this._contacts = makeContactAcc();
    this._look = { x: 0, y: 0 };
    this._flinch = new THREE.Vector2();

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._wish = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  // -------------------------------------------------------------------------
  async init(engine) {
    this.engine = engine;

    const world = engine.has('world') ? engine.get('world') : null;
    const spawn = world?.spawnPoints?.[0];
    if (spawn?.pos) {
      // spawnPoints are authored as camera/eye positions in the stub (y≈1.7).
      // Treat anything at roughly eye height as an eye position, otherwise as feet.
      const y = spawn.pos[1];
      this.position.set(spawn.pos[0], y > EYE_HEIGHT * 0.7 ? y - EYE_HEIGHT : y, spawn.pos[2]);
      this.yaw = spawn.yaw || 0;
    }

    this.collision.sync(world, 999);

    const capturing = new URLSearchParams(location.search).has('shot');
    if (!capturing) this.input.attach(engine.canvas);
    this._capturing = capturing;

    this.view.onFootstep = (info) => {
      const audio = engine.has('audio') ? engine.get('audio') : null;
      audio?.play?.('footstep', {
        position: this.engine.camera.position,
        speed: info.speed,
        sprinting: info.sprinting,
        crouching: info.crouching,
        foot: info.foot,
        surface: 'concrete',
      });
    };

    engine.camera.rotation.order = 'YXZ';
    engine.camera.fov = CAMERA.fovHip;
    engine.camera.near = CAMERA.near;
    engine.camera.far = CAMERA.far;
    // Layer 1 is the viewmodel; the main camera must not draw it in the world pass.
    engine.camera.layers.set(0);
    engine.camera.updateProjectionMatrix();

    this._applyCamera(0);
  }

  // ---- contract surface ---------------------------------------------------

  /** Teleport for capture mode. `pos` is a CAMERA (eye) position. */
  setPose(pos, look) {
    const cam = this.engine.camera;
    cam.position.fromArray(pos);
    cam.lookAt(this._v.fromArray(look));
    // Keep the simulation consistent so re-enabling does not snap.
    this.position.set(pos[0], pos[1] - this._eyeHeight, pos[2]);
    const d = this._v.fromArray(look).sub(cam.position).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.velocity.set(0, 0, 0);
    this.view.reset();
  }

  addShake(trauma) {
    this._trauma = Math.min(1, this._trauma + trauma);
    this.view.addTrauma(trauma);
  }

  applyDamage(amount, info) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - amount);
    this.addShake(clamp(amount / 55, 0.06, 0.5));
    // Directional flinch: the view kicks away from the hit.
    if (info?.direction) {
      const d = info.direction;
      const right = this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const side = right.x * d.x + right.z * d.z;
      this._flinch.x += clamp(amount / 40, 0, 0.6) * 0.09;
      this._flinch.y += -side * clamp(amount / 40, 0, 0.6) * 0.07;
    } else {
      this._flinch.x += clamp(amount / 40, 0, 0.6) * 0.06;
    }
    if (this.health <= 0) this.dead = true;
  }

  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); if (this.health > 0) this.dead = false; }

  respawn() {
    const world = this.engine.has('world') ? this.engine.get('world') : null;
    const spawn = world?.spawnPoints?.[0];
    if (spawn?.pos) {
      const y = spawn.pos[1];
      this.position.set(spawn.pos[0], y > EYE_HEIGHT * 0.7 ? y - EYE_HEIGHT : y, spawn.pos[2]);
      this.yaw = spawn.yaw || 0;
    }
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
    this.dead = false;
    this._slide = null; this._mantle = null;
    this.view.reset();
  }

  /** World-space aim ray. Includes view kick, excludes nothing — the crosshair
   *  sits on the camera axis, so the bullet must too. */
  getAimRay(outOrigin, outDir) {
    const cam = this.engine.camera;
    outOrigin.copy(cam.position);
    cam.getWorldDirection(outDir);
    return { origin: outOrigin, dir: outDir };
  }

  // ---- frame --------------------------------------------------------------
  update(dt, engine) {
    if (!this.enabled) { this.input.endFrame(); return; }
    if (dt <= 0) return;
    const T = this.tuning;

    const world = engine.has('world') ? engine.get('world') : null;
    this.collision.sync(world, dt);

    const weapons = engine.has('weapons') ? engine.get('weapons') : null;

    // ---- look ------------------------------------------------------------
    this.input.consumeLook(this._look);
    // Match on-screen travel across FOVs so ADS does not feel like a different
    // mouse. This is the "monitor distance matched" convention.
    const fovScale = Math.tan(this._fov * 0.5 * DEG) / Math.tan(CAMERA.fovHip * 0.5 * DEG);
    const sens = T.sensitivity * lerp(1, fovScale, T.adsSensScale);
    let dYaw = -this._look.x * sens;
    let dPitch = -this._look.y * sens;

    // Pulling down against recoil eats the accumulated climb rather than
    // stacking with its recovery — without this, spraying then compensating
    // whips the camera to the floor when the recoil recenters.
    if (weapons?.compensateLook) {
      const eaten = weapons.compensateLook(dPitch, dYaw);
      if (eaten) { dPitch -= eaten.pitch || 0; dYaw -= eaten.yaw || 0; }
    }
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -T.pitchLimit, T.pitchLimit);
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    // ---- movement basis ---------------------------------------------------
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this._fwd.set(-sy, 0, -cy);
    this._right.set(cy, 0, -sy);

    const inp = this.input;
    let ax = (inp.down('right') ? 1 : 0) - (inp.down('left') ? 1 : 0);
    let az = (inp.down('forward') ? 1 : 0) - (inp.down('back') ? 1 : 0);
    if (this.dead) { ax = 0; az = 0; }
    const moveIntent = ax !== 0 || az !== 0;

    // ---- intents ----------------------------------------------------------
    if (inp.justPressed('crouchToggle')) this._crouchToggle = !this._crouchToggle;
    const wantCrouch = inp.down('crouch') || this._crouchToggle;
    const wantSprint = inp.down('sprint') && az > 0 && !this.dead;

    let wantAds = inp.mouse.right && !this.dead;
    if (weapons?.canAds && !weapons.canAds()) wantAds = false;
    if (this._slide || this._mantle) wantAds = false;

    // Sprint and ADS are mutually exclusive; the last thing you asked for wins.
    let sprinting = wantSprint && !wantAds && !wantCrouch && !this._mantle;

    // ---- weapon input dispatch -------------------------------------------
    if (weapons) {
      const triggerDown = inp.mouse.left && !this.dead && !sprinting && !this._mantle;
      if (weapons.setTrigger) weapons.setTrigger(triggerDown);
      else if (triggerDown) weapons.fire?.();
      if (inp.mouse.left && sprinting) sprinting = false;   // firing breaks sprint
      if (inp.justPressed('reload')) weapons.reload?.();
      if (inp.justPressed('inspect')) weapons.inspect?.();
      if (inp.justPressed('fireMode')) weapons.cycleFireMode?.();
    }

    // ---- timers -----------------------------------------------------------
    this._jumpCd = Math.max(0, this._jumpCd - dt);
    this._slideCd = Math.max(0, this._slideCd - dt);
    if (inp.justPressed('jump')) this._jumpBuf = T.jumpBuffer;
    else this._jumpBuf = Math.max(0, this._jumpBuf - dt);

    // ---- mantle -----------------------------------------------------------
    if (this._mantle) {
      this._updateMantle(dt);
      this._finishFrame(dt, ax, az, moveIntent, sprinting, wantCrouch, wantAds, weapons);
      return;
    }
    if (this._jumpBuf > 0 && this._jumpCd <= 0 && az >= 0) {
      const ledge = this._tryFindLedge(ax, az);
      if (ledge) {
        this._startMantle(ledge);
        this._jumpBuf = 0;
        this._finishFrame(dt, ax, az, moveIntent, sprinting, wantCrouch, wantAds, weapons);
        return;
      }
    }

    const wasGround = this.state.onGround;

    // ---- slide state ------------------------------------------------------
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (!this._slide && wantCrouch && sprinting !== false && inp.down('sprint')
      && wasGround && horizSpeed > T.sprintSpeed * 0.72 && this._slideCd <= 0 && !this.dead) {
      this._startSlide();
    }
    if (this._slide) {
      this._slide.t += dt;
      const spd = Math.hypot(this.velocity.x, this.velocity.z);
      const stopWanted = !wantCrouch && this._canStand(T.standHeight);
      if (this._slide.t > T.slideMaxTime || spd < T.slideMinSpeed || stopWanted || !wasGround) {
        this._endSlide();
      }
    }
    const sliding = !!this._slide;
    if (sliding) sprinting = false;

    // ---- pose selection ---------------------------------------------------
    const crouching = sliding ? true : (wantCrouch || !this._canStand(T.standHeight));
    this._crouchToggle = this._crouchToggle && crouching;

    // ---- wish direction ---------------------------------------------------
    const wish = this._wish.set(0, 0, 0);
    if (moveIntent) {
      wish.addScaledVector(this._fwd, az * (az < 0 ? T.backMul : 1));
      wish.addScaledVector(this._right, ax * T.strafeMul);
      if (wish.lengthSq() > 1) wish.normalize();
    }

    // Wish speed by pose. Sprint only counts when actually pushing forward.
    let wishSpeed = T.walkSpeed;
    if (sliding) wishSpeed = 0;
    else if (crouching) wishSpeed = T.crouchSpeed;
    else if (sprinting) wishSpeed = T.sprintSpeed;
    else if (this._adsMix > 0.35) wishSpeed = lerp(T.walkSpeed, T.adsSpeed, saturate((this._adsMix - 0.35) / 0.65));
    wishSpeed *= wish.length() || 0;
    const wishDir = wish.lengthSq() > 1e-8 ? wish.normalize() : wish;

    // ---- integrate --------------------------------------------------------
    const grounded = wasGround;
    if (grounded) {
      // On a slope, walk *along* the surface rather than into it, otherwise
      // ramps eat your speed and you stutter up them.
      if (this.state.groundNormal.y < 0.999 && wishDir.lengthSq() > 0) {
        const n = this.state.groundNormal;
        const d = wishDir.dot(n);
        wishDir.addScaledVector(n, -d);
        if (wishDir.lengthSq() > 1e-8) wishDir.normalize();
      }
      if (sliding) {
        this._slideMove(dt, ax);
      } else {
        this._friction(dt, T.friction, T.stopSpeed);
        this._accelerate(dt, wishDir, wishSpeed, T.accel);
      }
    } else {
      // Air control: the wish speed is capped hard, so you can steer but not
      // accelerate freely. This is the Quake/Source rule and it is the reason
      // air movement feels controlled instead of like flying.
      this._accelerate(dt, wishDir, Math.min(wishSpeed, T.airWishCap), T.airAccel);
    }

    // ---- jump -------------------------------------------------------------
    this._coyote = grounded ? T.coyoteTime : Math.max(0, this._coyote - dt);
    if (this._jumpBuf > 0 && this._coyote > 0 && this._jumpCd <= 0 && !this.dead) {
      let jv = T.jumpSpeed * (crouching && !sliding ? T.crouchJumpMul : 1);
      if (sliding) {
        // Slide-hop: keep the momentum, that is the whole point.
        this._endSlide(true);
        const s = Math.hypot(this.velocity.x, this.velocity.z);
        if (s > 1e-4) {
          const boost = Math.min(T.slideMaxSpeed, s + 0.6) / s;
          this.velocity.x *= boost; this.velocity.z *= boost;
        }
      }
      this.velocity.y = jv;
      this._jumpBuf = 0;
      this._coyote = 0;
      this._jumpCd = T.jumpCooldown;
      this.state.onGround = false;
      this._noSnapTimer = 0.12;
      this.engine.has('audio') && this.engine.get('audio').play?.('jump', {});
    }

    // ---- gravity ----------------------------------------------------------
    const g = T.gravity * (this.velocity.y < 0 ? T.fallGravityMul : 1);
    if (!grounded || this.velocity.y > 0) this.velocity.y -= g * dt;
    else this.velocity.y = Math.min(this.velocity.y, 0);

    // ---- collide & move ---------------------------------------------------
    const targetCapsule = sliding ? T.slideHeight : crouching ? T.crouchHeight : T.standHeight;
    this._updateCapsuleHeight(dt, targetCapsule);

    const acc = resetContactAcc(this._contacts);
    const r = T.radius, h = this._capsuleHeight;

    // Horizontal first (with stair stepping), then vertical. Splitting the axes
    // is what lets you slide along a wall instead of sticking to it.
    this._v.set(this.velocity.x * dt, 0, this.velocity.z * dt);
    this.collision.moveHorizontal(this.position, this._v, r, h, grounded ? T.stepHeight : 0.06, acc);
    this._v.set(0, this.velocity.y * dt, 0);
    this.collision.move(this.position, this._v, r, h, acc);

    // Clip velocity against every surface we touched.
    for (let i = 0; i < acc.normals.length; i += 3) {
      const nx = acc.normals[i], ny = acc.normals[i + 1], nz = acc.normals[i + 2];
      const d = this.velocity.x * nx + this.velocity.y * ny + this.velocity.z * nz;
      if (d < 0) {
        this.velocity.x -= nx * d;
        this.velocity.y -= ny * d;
        this.velocity.z -= nz * d;
      }
    }

    // ---- ground state / snapping -----------------------------------------
    this._noSnapTimer = Math.max(0, (this._noSnapTimer || 0) - dt);
    let onGround = acc.grounded;
    if (!onGround && wasGround && this.velocity.y <= 0.2 && this._noSnapTimer <= 0) {
      const gy = this.collision.probeGround(this.position, r, T.snapDistance);
      if (gy !== null && this.position.y - gy <= T.snapDistance) {
        this.position.y = gy;
        onGround = true;
        this.velocity.y = Math.min(this.velocity.y, 0);
        acc.groundNormal.set(0, 1, 0);
      }
    }

    if (onGround) {
      this.state.groundNormal.copy(acc.groundNormal);
      if (!wasGround) {
        const impact = this.view.land_(-this._lastFallSpeed || 0);
        if (impact > 0) {
          this.addShake(impact * 0.30);
          this.engine.has('audio') && this.engine.get('audio').play?.('land', { impact });
        }
        this.state.airTime = 0;
      }
      this._lastFallSpeed = 0;
      this.state.airTime = 0;
    } else {
      this.state.groundNormal.set(0, 1, 0);
      this._lastFallSpeed = Math.min(this._lastFallSpeed || 0, this.velocity.y);
      this.state.airTime += dt;
    }
    this.state.onGround = onGround;

    // ---- publish + camera -------------------------------------------------
    this.state.sliding = sliding;
    this.state.stepped = acc.stepped;
    this._finishFrame(dt, ax, az, moveIntent, sprinting && onGround, crouching, wantAds, weapons);
  }

  // -------------------------------------------------------------------------
  _finishFrame(dt, ax, az, moveIntent, sprinting, crouching, wantAds, weapons) {
    const T = this.tuning;
    const st = this.state;
    const mantling = !!this._mantle;

    const horiz = Math.hypot(this.velocity.x, this.velocity.z);
    st.speed = horiz;
    st.sprinting = !!sprinting && horiz > T.walkSpeed * 0.92;
    st.crouching = !!crouching || !!this._slide;
    st.sliding = !!this._slide;
    st.mantling = mantling;
    st.vaulting = mantling && this._mantle.vault;
    st.airborne = !st.onGround;
    st.moveIntent = moveIntent;
    st.wishDir.copy(this._wish);

    // Acceleration along facing, for the head-lag effect.
    const alongNow = this.velocity.x * this._fwd.x + this.velocity.z * this._fwd.z;
    this._accelAlong = dt > 1e-6 ? (alongNow - (this._prevAlong || 0)) / dt : 0;
    this._prevAlong = alongNow;

    // ---- ADS / sprint mixes ----------------------------------------------
    const adsTarget = wantAds && !mantling && !this._slide ? 1 : 0;
    // Prefer the weapon's own ADS timeline so the FOV zoom and the sight
    // lining up are the same event, not two things that nearly agree.
    const wAds = weapons?.adsT;
    this._adsMix = (typeof wAds === 'number')
      ? wAds
      : damp(this._adsMix, adsTarget, adsTarget > this._adsMix ? 13 : 11, dt);
    st.ads = adsTarget === 1;
    st.adsMix = this._adsMix;

    const sprintTarget = st.sprinting ? 1 : 0;
    this._sprintMix = damp(this._sprintMix, sprintTarget, sprintTarget > this._sprintMix ? 5.0 : 8.0, dt);
    st.sprintMix = this._sprintMix;

    // ---- eye height -------------------------------------------------------
    let eyeTarget = EYE_HEIGHT;
    if (this._slide) eyeTarget = T.slideEye;
    else if (crouching) eyeTarget = CROUCH_HEIGHT;
    if (mantling) {
      const u = saturate(this._mantle.t / this._mantle.dur);
      eyeTarget = lerp(CROUCH_HEIGHT, EYE_HEIGHT, easeInOut(saturate((u - 0.35) / 0.65)));
    }
    const lam = eyeTarget < this._eyeHeight ? T.crouchDownLambda : T.crouchUpLambda;
    this._eyeHeight = damp(this._eyeHeight, eyeTarget, lam, dt);
    st.eyeHeight = this._eyeHeight;

    // ---- view effects -----------------------------------------------------
    this.view.update({
      dt,
      speed: horiz,
      onGround: st.onGround,
      sprinting: st.sprinting,
      crouching: st.crouching,
      sliding: st.sliding,
      ads: this._adsMix,
      strafeAxis: ax,
      forwardAxis: az,
      yaw: this.yaw,
      moveIntent,
      accelAlong: this._accelAlong,
    });
    this._trauma = this.view.trauma;

    // Hit flinch decays fast and hard.
    this._flinch.multiplyScalar(Math.exp(-9 * dt));

    this._applyCamera(dt);
    this.input.endFrame();
  }

  _applyCamera(dt) {
    const cam = this.engine.camera;
    const T = this.tuning;
    const weapons = this.engine.has('weapons') ? this.engine.get('weapons') : null;

    const rp = weapons?.recoilPitch || 0;
    const ry = weapons?.recoilYaw || 0;

    cam.rotation.order = 'YXZ';
    cam.rotation.set(
      clamp(this.pitch + rp + this.view.pitch + this._mantleView.pitch + this._flinch.x, -1.553, 1.553),
      this.yaw + ry + this.view.yaw + this._flinch.y,
      this.view.roll + this._mantleView.roll,
      'YXZ',
    );
    cam.position.set(this.position.x, this.position.y + this._eyeHeight, this.position.z);
    // The bob offset is in view space so it rolls and pitches with the camera.
    this._v.copy(this.view.posOffset).applyQuaternion(cam.quaternion);
    cam.position.add(this._v);

    // ---- FOV --------------------------------------------------------------
    const base = lerp(CAMERA.fovHip, CAMERA.fovSprint, this._sprintMix);
    let target = lerp(base, CAMERA.fovAds, this._adsMix);
    // A hair of extra FOV with raw speed; reads as effort, not as a zoom.
    target += clamp((this.state.speed - T.walkSpeed) * 0.55, 0, 2.2) * (1 - this._adsMix);
    const lam = target < this._fov ? T.fovLambdaIn : T.sprintFovLambda;
    this._fov = dt > 0 ? damp(this._fov, target, lam, dt) : target;
    if (Math.abs(cam.fov - this._fov) > 1e-4) {
      cam.fov = this._fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
  }

  // ---- movement primitives ------------------------------------------------

  /**
   * Source friction: constant drop below stopSpeed (crisp halt), proportional
   * above it (long skid at speed). One formula, two behaviours.
   */
  _friction(dt, friction, stopSpeed) {
    const v = this.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.05) { v.x = 0; v.z = 0; return; }
    const control = speed < stopSpeed ? stopSpeed : speed;
    const drop = control * friction * dt;
    const scale = Math.max(0, speed - drop) / speed;
    v.x *= scale; v.z *= scale;
  }

  /** Source acceleration: can only add speed up to wishSpeed ALONG wishDir. */
  _accelerate(dt, wishDir, wishSpeed, accel) {
    if (wishSpeed <= 0) return;
    const v = this.velocity;
    const current = v.x * wishDir.x + v.z * wishDir.z;
    const add = wishSpeed - current;
    if (add <= 0) return;
    let accelSpeed = accel * wishSpeed * dt;
    if (accelSpeed > add) accelSpeed = add;
    v.x += wishDir.x * accelSpeed;
    v.z += wishDir.z * accelSpeed;
  }

  // ---- slide --------------------------------------------------------------
  _startSlide() {
    const T = this.tuning;
    const v = this.velocity;
    const s = Math.hypot(v.x, v.z);
    if (s > 1e-4) {
      const target = Math.min(T.slideMaxSpeed, Math.max(s, T.sprintSpeed) * T.slideBoost);
      const k = target / s;
      v.x *= k; v.z *= k;
    }
    this._slide = { t: 0, dirX: v.x, dirZ: v.z };
    this.view.addTrauma(0.10);
    this.engine.has('audio') && this.engine.get('audio').play?.('slide', {});
  }

  _endSlide(keepSpeed = false) {
    if (!this._slide) return;
    this._slide = null;
    this._slideCd = this.tuning.slideCooldown;
    if (!keepSpeed) {
      // Bleed a little on exit so slide-cancel is not free speed.
      this.velocity.x *= 0.86;
      this.velocity.z *= 0.86;
    }
  }

  _slideMove(dt, strafeAxis) {
    const T = this.tuning;
    const v = this.velocity;
    this._friction(dt, T.slideFriction, 0.6);
    // Downhill slides accelerate — the ground normal does the work.
    const n = this.state.groundNormal;
    if (n.y < 0.999) {
      v.x += n.x * T.slideDownhillGain * dt;
      v.z += n.z * T.slideDownhillGain * dt;
    }
    // Limited steering keeps it a commitment, not a free turn.
    if (strafeAxis !== 0) {
      const s = Math.hypot(v.x, v.z);
      v.x += this._right.x * strafeAxis * T.slideSteer * dt;
      v.z += this._right.z * strafeAxis * T.slideSteer * dt;
      const s2 = Math.hypot(v.x, v.z);
      if (s2 > 1e-5 && s2 > s) { v.x *= s / s2; v.z *= s / s2; }  // steer, don't accelerate
    }
  }

  // ---- crouch clearance ---------------------------------------------------
  _canStand(height) {
    return !this.collision.overlaps(this.position, this.tuning.radius * 0.98, height);
  }

  _updateCapsuleHeight(dt, target) {
    if (target <= this._capsuleHeight) { this._capsuleHeight = target; return; }
    const grown = damp(this._capsuleHeight, target, this.tuning.crouchUpLambda * 1.4, dt);
    if (!this.collision.overlaps(this.position, this.tuning.radius * 0.98, grown)) {
      this._capsuleHeight = grown;
    }
  }

  // ---- mantle / vault -----------------------------------------------------
  _tryFindLedge(ax, az) {
    const T = this.tuning;
    // Prefer the facing direction; fall back to the movement direction so you
    // can mantle while strafing along a wall.
    let dx = this._fwd.x, dz = this._fwd.z;
    if (az === 0 && ax !== 0) { dx = this._right.x * ax; dz = this._right.z * ax; }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;

    const ledge = this.collision.findLedge(
      this.position, dx, dz, T.radius, T.standHeight,
      { minHeight: T.mantleMinHeight, maxHeight: T.mantleMaxHeight, reach: T.mantleReach, clearHeight: T.crouchHeight },
    );
    if (!ledge) return null;
    ledge.dirX = dx; ledge.dirZ = dz;

    // Vault: for a low obstacle, try to carry all the way over it rather than
    // stopping on top. Only if the far side is actually clear.
    if (ledge.height <= T.vaultMaxHeight) {
      const far = this._v2.set(
        this.position.x + dx * (T.radius + T.mantleReach + 0.62),
        ledge.target.y,
        this.position.z + dz * (T.radius + T.mantleReach + 0.62),
      );
      if (!this.collision.overlaps(far, T.radius * 0.92, T.crouchHeight)) {
        ledge.target.copy(far);
        ledge.vault = true;
      }
    }
    return ledge;
  }

  _startMantle(ledge) {
    this._mantle = {
      t: 0,
      dur: 0.30 + ledge.height * 0.24 + (ledge.vault ? 0.10 : 0),
      from: this.position.clone(),
      to: ledge.target.clone(),
      height: ledge.height,
      vault: !!ledge.vault,
      dirX: ledge.dirX, dirZ: ledge.dirZ,
    };
    this.velocity.set(0, 0, 0);
    this.state.onGround = false;
    this.view.addTrauma(0.06);
    this.engine.has('audio') && this.engine.get('audio').play?.('mantle', { height: ledge.height });
  }

  _updateMantle(dt) {
    const m = this._mantle;
    m.t += dt;
    const u = saturate(m.t / m.dur);
    // Go up first, then across. Doing both at once looks like a lift, not a pull-up.
    const uy = easeOutCubic(saturate(u / 0.60));
    const ux = easeInOut(saturate((u - 0.30) / 0.70));
    this.position.set(
      lerp(m.from.x, m.to.x, ux),
      lerp(m.from.y, m.to.y, uy),
      lerp(m.from.z, m.to.z, ux),
    );
    // The camera looks down at the ledge on the way up, then levels off.
    const arc = Math.sin(u * Math.PI);
    this._mantleView.pitch = -arc * 0.115 - Math.sin(u * Math.PI * 2) * 0.03;
    this._mantleView.roll = arc * 3.2 * DEG;

    if (u >= 1) {
      this._mantle = null;
      this._mantleView.pitch = 0;
      this._mantleView.roll = 0;
      const exit = this.tuning.mantleExitSpeed * (m.vault ? 1.25 : 1);
      this.velocity.set(m.dirX * exit, m.vault ? -0.5 : 0, m.dirZ * exit);
      this.state.onGround = false;
      this._noSnapTimer = 0.05;
      this._jumpCd = 0.12;
    }
  }
}
