import * as THREE from 'three';
import { ParticleSystem, EMIT, resetEmit } from './particles.js';
import { DecalSystem } from './decals.js';
import { TracerSystem } from './tracers.js';
import { DebrisSystem, chipGeometry, casingGeometry } from './debris.js';
import { LightPool } from './lights.js';
import { ShockwaveSystem } from './shockwave.js';
import { SceneDepth } from './depth.js';
import { fxProfile } from './surfaces.fx.js';
import {
  puffTexture, sparkTexture, flashTexture, rampTexture,
  bulletHoleAtlas, bloodAtlas, scorchTexture,
} from './textures.js';

/**
 * Owns every particle, decal, tracer and debris instance.
 *
 * CONTRACT
 *   impact(point, normal, surfaceType)  — sparks/dust/decal for a bullet hit.
 *   tracer(from, to, speed)
 *   muzzleFlash(matrix, scale)
 *   explosion(point, radius)
 *   All systems are instanced and pooled against `budget`, which the render
 *   module scales by quality preset.
 *
 * Every system draws from a fixed ring buffer, so a sustained firefight costs a
 * constant amount of memory and never allocates mid-frame. Smoke and dust are
 * depth-faded against a half-res depth prepass — without that, particle cards
 * slice into geometry with a hard straight edge, which is the single most
 * obvious giveaway of cheap real-time VFX.
 */
// Reused colour instances: LightPool and DecalSystem both call .copy() on these,
// which requires a real THREE.Color rather than a plain {r,g,b} literal.
const SPARK_LIGHT = new THREE.Color(1.0, 0.70, 0.30);
const MUZZLE_LIGHT = new THREE.Color(1.0, 0.72, 0.35);
const BLAST_LIGHT = new THREE.Color(1.0, 0.55, 0.20);
const SCORCH_TINT = new THREE.Color(0.10, 0.09, 0.08);
// Tracers are hot and slightly green-yellow at the core. TracerSystem reads
// .r/.g/.b directly and has no null default, so this must be a real Color.
const TRACER_COLOR = new THREE.Color(2.4, 1.75, 0.55);

export class FxModule {
  constructor() {
    this.budget = { particles: 4096, decals: 256, tracers: 64, debris: 256 };
    this.systems = [];
    this.time = 0;
    this._v = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  async init(engine) {
    this.engine = engine;
    const scene = engine.scene;
    const preset = engine.modules.get('render')?.quality?.preset ?? 'ultra';
    const k = preset === 'low' ? 0.35 : preset === 'high' ? 0.7 : 1;
    for (const key of Object.keys(this.budget)) {
      this.budget[key] = Math.max(32, Math.round(this.budget[key] * k));
    }

    this.depth = new SceneDepth(0.5);

    const cap = this.budget.particles;

    // Lit, soft-edged, slow: dust and smoke read as volume, not as cards.
    this.dust = new ParticleSystem({
      name: 'dust', capacity: Math.round(cap * 0.45), map: puffTexture(128),
      lit: true, softness: 0.55, sizeScale: 1, fadeStart: 0.35, bump: 0.95,
      ramp: rampTexture([[0, 0xb9ae9c], [1, 0x6a635a]]),
    });
    this.smoke = new ParticleSystem({
      name: 'smoke', capacity: Math.round(cap * 0.25), map: puffTexture(128, { erosion: 0.5, seed: 91 }),
      lit: true, softness: 0.8, sizeScale: 1, fadeStart: 0.5, bump: 1.1,
    });
    // Additive, stretched, HDR-bright so the bloom threshold catches them.
    this.sparks = new ParticleSystem({
      name: 'sparks', capacity: Math.round(cap * 0.3), map: sparkTexture(64),
      additive: true, stretch: true, maxStretch: 16, softness: 0.12, emissive: 2.4,
    });
    this.flash = new ParticleSystem({
      name: 'flash', capacity: 64, map: flashTexture(128),
      additive: true, softness: 0, emissive: 6.0, renderOrder: 12,
    });

    this.holes = new DecalSystem({
      name: 'holes', capacity: this.budget.decals, atlas: bulletHoleAtlas(256),
      atlasDim: 2, maxAge: 90, bump: 1.7,
    });
    this.blood = new DecalSystem({
      name: 'blood', capacity: Math.round(this.budget.decals * 0.35), atlas: bloodAtlas(256),
      atlasDim: 2, maxAge: 45, bump: 0.6, holeDark: 0,
    });
    this.scorch = new DecalSystem({
      name: 'scorch', capacity: 24, atlas: scorchTexture(128), atlasDim: 1,
      maxAge: 120, bump: 0.4, holeDark: 0.6,
    });

    this.tracers = new TracerSystem({ capacity: this.budget.tracers });
    this.shock = new ShockwaveSystem({ capacity: 6 });
    this.lights = new LightPool(scene, preset === 'low' ? 2 : 4);

    const chipMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.0 });
    this.chips = new DebrisSystem({
      name: 'chips', capacity: this.budget.debris, geometry: chipGeometry(3),
      material: chipMat, castShadow: false,
    });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.34, metalness: 1.0 });
    this.casings = new DebrisSystem({
      name: 'casings', capacity: 64, geometry: casingGeometry(),
      material: brassMat, restitution: 0.42, castShadow: true, colorJitter: 0.05,
    });

    this.systems = [this.dust, this.smoke, this.sparks, this.flash,
                    this.holes, this.blood, this.scorch,
                    this.tracers, this.shock, this.chips, this.casings];

    for (const s of this.systems) if (s.mesh) scene.add(s.mesh);

    // Point every depth-faded system at the shared prepass texture.
    this._bindDepth();
  }

  _bindDepth() {
    for (const s of [this.dust, this.smoke, this.sparks]) {
      if (s?.uniforms?.uDepth) s.uniforms.uDepth.value = this.depth.texture;
    }
  }

  /** Bullet hit: sparks, dust, chips and a decal, chosen by surface type. */
  impact(point, normal, surfaceType = 'concrete') {
    const p = fxProfile(surfaceType);
    const t = this.time;
    const n = this._n.copy(normal).normalize();

    for (let i = 0; i < p.sparks; i++) {
      resetEmit();
      EMIT.x = point.x; EMIT.y = point.y; EMIT.z = point.z;
      const s = p.sparkSpeed * (0.4 + Math.random() * 0.9);
      EMIT.vx = n.x * s + (Math.random() - 0.5) * s * 0.8;
      EMIT.vy = n.y * s + (Math.random() - 0.5) * s * 0.8 + 0.6;
      EMIT.vz = n.z * s + (Math.random() - 0.5) * s * 0.8;
      EMIT.r = p.sparkColor.r; EMIT.g = p.sparkColor.g; EMIT.b = p.sparkColor.b;
      EMIT.life = p.sparkLife * (0.6 + Math.random() * 0.8);
      EMIT.size0 = 0.02; EMIT.size1 = 0.004;
      EMIT.gravity = 1.4; EMIT.drag = 0.7; EMIT.stretch = 1;
      EMIT.seed = Math.random() * 1000;
      this.sparks.emit(t);
    }

    for (let i = 0; i < p.dust; i++) {
      resetEmit();
      const j = 0.06;
      EMIT.x = point.x + (Math.random() - 0.5) * j;
      EMIT.y = point.y + (Math.random() - 0.5) * j;
      EMIT.z = point.z + (Math.random() - 0.5) * j;
      const s = 0.9 + Math.random() * 1.4;
      EMIT.vx = n.x * s + (Math.random() - 0.5) * 0.7;
      EMIT.vy = n.y * s + Math.random() * 0.5;
      EMIT.vz = n.z * s + (Math.random() - 0.5) * 0.7;
      EMIT.r = p.dustColor.r; EMIT.g = p.dustColor.g; EMIT.b = p.dustColor.b;
      EMIT.life = p.dustLife * (0.7 + Math.random() * 0.7);
      EMIT.size0 = p.dustSize[0] * (0.7 + Math.random() * 0.6);
      EMIT.size1 = p.dustSize[1] * (0.7 + Math.random() * 0.8);
      EMIT.gravity = 0.08; EMIT.drag = 2.6; EMIT.turbulence = 0.5;
      EMIT.spin = (Math.random() - 0.5) * 1.5;
      EMIT.seed = Math.random() * 1000;
      this.dust.emit(t);
    }

    for (let i = 0; i < (p.chunks || 0); i++) {
      const s = p.chunkSize * (0.5 + Math.random());
      this.chips.spawn({
        x: point.x, y: point.y, z: point.z,
        vx: n.x * 3 + (Math.random() - 0.5) * 3,
        vy: n.y * 3 + Math.random() * 2.5,
        vz: n.z * 3 + (Math.random() - 0.5) * 3,
        sx: s, sy: s * 0.7, sz: s * 0.9,
        life: 6 + Math.random() * 4,
        color: p.chunkColor, floorY: 0,
      });
    }

    if (p.decal) {
      const sys = p.decal === 'blood' ? this.blood : this.holes;
      sys.spawn(point, n, p.decalSize * (0.8 + Math.random() * 0.5),
                p.decalTint, t, Math.random() * Math.PI * 2,
                Math.floor(Math.random() * 4), p.decalLife);
    }

    if (p.lightPeak) {
      this.lights.flash(point, p.lightColor || SPARK_LIGHT,
                        p.lightPeak, 4.5, 0.09);
    }
  }

  tracer(from, to, speed = 900, brightness = 1) {
    this.tracers.spawn(from, to, speed, this.time, TRACER_COLOR, 0.028, 6.5, brightness);
  }

  /**
   * Muzzle flash: an additive multi-lobed card plus a genuine transient light,
   * so the surroundings actually brighten for the frame rather than the flash
   * floating unconnected in front of them.
   */
  muzzleFlash(position, direction, scale = 1) {
    const t = this.time;
    for (let i = 0; i < 3; i++) {
      resetEmit();
      EMIT.x = position.x; EMIT.y = position.y; EMIT.z = position.z;
      EMIT.r = 6.0; EMIT.g = 3.4; EMIT.b = 1.5;
      EMIT.life = 0.045 + i * 0.008;
      EMIT.size0 = (0.22 + i * 0.1) * scale;
      EMIT.size1 = (0.34 + i * 0.12) * scale;
      EMIT.gravity = 0; EMIT.drag = 0; EMIT.opacity = 1 - i * 0.22;
      EMIT.seed = Math.random() * 1000;
      this.flash.emit(t);
    }
    // A little smoke off the muzzle, drifting with the barrel direction.
    for (let i = 0; i < 2; i++) {
      resetEmit();
      EMIT.x = position.x; EMIT.y = position.y; EMIT.z = position.z;
      EMIT.vx = direction.x * 1.6 + (Math.random() - 0.5) * 0.4;
      EMIT.vy = direction.y * 1.6 + 0.35;
      EMIT.vz = direction.z * 1.6 + (Math.random() - 0.5) * 0.4;
      EMIT.r = 0.5; EMIT.g = 0.48; EMIT.b = 0.45;
      EMIT.life = 0.7 + Math.random() * 0.5;
      EMIT.size0 = 0.05; EMIT.size1 = 0.38;
      EMIT.gravity = -0.05; EMIT.drag = 3.0; EMIT.turbulence = 0.6;
      EMIT.seed = Math.random() * 1000;
      this.smoke.emit(t);
    }
    this.lights.flash(position, MUZZLE_LIGHT, 9 * scale, 7, 0.055);
  }

  ejectCasing(position, velocity) {
    this.casings.spawn({
      x: position.x, y: position.y, z: position.z,
      vx: velocity.x, vy: velocity.y, vz: velocity.z,
      sx: 1, sy: 1, sz: 1, life: 8, floorY: 0,
    });
  }

  explosion(point, radius = 4) {
    const t = this.time;
    this.shock.spawn(point, radius, 0.45, t);

    for (let i = 0; i < 26; i++) {
      resetEmit();
      EMIT.x = point.x; EMIT.y = point.y; EMIT.z = point.z;
      const s = 5 + Math.random() * 9;
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      EMIT.vx = d.x * s; EMIT.vy = d.y * s + 1.5; EMIT.vz = d.z * s;
      EMIT.r = 9.0; EMIT.g = 3.6; EMIT.b = 1.0;
      EMIT.life = 0.16 + Math.random() * 0.2;
      EMIT.size0 = 0.5; EMIT.size1 = 1.4;
      EMIT.gravity = -0.2; EMIT.drag = 2.2;
      EMIT.seed = Math.random() * 1000;
      this.flash.emit(t);
    }
    for (let i = 0; i < 34; i++) {
      resetEmit();
      EMIT.x = point.x; EMIT.y = point.y; EMIT.z = point.z;
      const s = 2 + Math.random() * 5;
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
      EMIT.vx = d.x * s; EMIT.vy = d.y * s + 2.2; EMIT.vz = d.z * s;
      EMIT.r = 0.26; EMIT.g = 0.24; EMIT.b = 0.22;
      EMIT.life = 2.4 + Math.random() * 2.0;
      EMIT.size0 = 0.6; EMIT.size1 = 3.6;
      EMIT.gravity = -0.35; EMIT.drag = 1.5; EMIT.turbulence = 0.9;
      EMIT.spin = (Math.random() - 0.5) * 1.2;
      EMIT.seed = Math.random() * 1000;
      this.smoke.emit(t);
    }
    for (let i = 0; i < 18; i++) {
      const s = 0.04 + Math.random() * 0.09;
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).normalize();
      this.chips.spawn({
        x: point.x, y: point.y + 0.2, z: point.z,
        vx: d.x * 9, vy: d.y * 9 + 3, vz: d.z * 9,
        sx: s, sy: s * 0.8, sz: s, life: 8, floorY: 0,
      });
    }
    this.scorch.spawn(point, new THREE.Vector3(0, 1, 0), radius * 0.55,
                      SCORCH_TINT, t, Math.random() * 6.28, 0);
    this.lights.flash(point, BLAST_LIGHT, 60, radius * 5, 0.35);
    this.engine.modules.get('player')?.addShake?.(Math.min(1, 6 / Math.max(1, radius)));
  }

  update(dt, engine) {
    this.time += dt;
    const t = this.time;

    // Keep the particle shaders' view-space sun and depth range current.
    const lighting = engine.modules.get('lighting');
    const cam = engine.camera;
    if (lighting?.sunDir) {
      this._v.copy(lighting.sunDir).transformDirection(cam.matrixWorldInverse);
      for (const s of [this.dust, this.smoke]) {
        s.uniforms.uSunDirView.value.copy(this._v);
      }
    }
    for (const s of [this.dust, this.smoke, this.sparks]) {
      s.uniforms.uCamRange.value.set(cam.near, cam.far);
    }

    this.dust.update(t, engine.frame);
    this.smoke.update(t, engine.frame);
    this.sparks.update(t, engine.frame);
    this.flash.update(t, engine.frame);
    this.holes.update(t);
    this.blood.update(t);
    this.scorch.update(t);
    this.tracers.update(t);
    this.shock.update(t);
    this.chips.update(dt);
    this.casings.update(dt);
    this.lights.update(dt);
  }

  /** Render module hook: run the depth prepass before the particles draw. */
  prepass(renderer, scene, camera) {
    if (this.depth?.enabled && !this.depth.external) {
      this.depth.render?.(renderer, scene, camera);
      this._bindDepth();
    }
  }
}
