import * as THREE from 'three';

/**
 * Owns every particle, decal, tracer and debris instance.
 * 
 * CONTRACT
 *   impact(point, normal, surfaceType)  — sparks/dust/decal for a bullet hit.
 *   tracer(from, to, speed)
 *   muzzleFlash(matrix, scale)
 *   explosion(point, radius)
 *   All systems must be instanced/pooled with a hard budget; expose this.budget
 *   so the render module can scale it by quality preset.
 */
export class FxModule {
  constructor() {
    this.budget = { particles: 4096, decals: 256, tracers: 64 };
  }

  async init(engine) { this.engine = engine; }
  impact(point, normal, surfaceType) {}
  tracer(from, to, speed) {}
  muzzleFlash(matrix, scale) {}
  explosion(point, radius) {}
  update(dt) {}
}
