import * as THREE from 'three';

/**
 * Owns sun, sky, shadows, environment IBL, fog and volumetrics.
 * 
 * CONTRACT
 *   sun                 — the primary DirectionalLight (combat/fx read its dir).
 *   envMap              — PMREM-filtered environment texture applied to the scene.
 *   setTimeOfDay(t)     — t in [0,1]; repositions sun and regenerates sky + IBL.
 *   addLocalLight(...)  — registers a point/spot light within the light budget.
 *   Volumetrics render as a post pass; expose params on this.volumetric so the
 *   render module can read density/steps without importing this file.
 */
export class LightingModule {
  constructor() {
    this.sun = null;
    this.envMap = null;
    this.volumetric = { enabled: true, density: 0.02, steps: 48 };
  }

  async init(engine) {
    this.engine = engine;

    this.sun = new THREE.DirectionalLight(0xfff2e0, 3.0);
    this.sun.position.set(-30, 40, -20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 200;
    const s = 40;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    this.sun.shadow.camera.updateProjectionMatrix();
    engine.scene.add(this.sun, this.sun.target);

    engine.scene.add(new THREE.HemisphereLight(0x9fc0e8, 0x40382e, 0.6));
  }

  setTimeOfDay(t) {}
  update(dt) {}
}
