import * as THREE from 'three';
import { SUN, SKY, VOLUMETRIC, sunDirection } from '../core/artdirection.js';
import { PhysicalSky, skyAmbientColors } from './sky.js';
import { SunShadows } from './shadows.js';
import { installHeightFog, sharedFogUniforms, syncFogDefaults } from './atmosphere.js';

/**
 * Owns sun, sky, shadows, environment IBL, fog and volumetrics.
 *
 * CONTRACT
 *   sun                 — the primary light rig (CSM, not a bare
 *                         DirectionalLight). `sunDir` is the unit vector from
 *                         the scene toward the sun, which combat/fx read.
 *   envMap              — PMREM-filtered environment applied to the scene.
 *   setTimeOfDay(t)     — t in [0,1]; repositions the sun and regenerates sky,
 *                         ambient and IBL.
 *   volumetric          — density/steps/anisotropy the render module reads for
 *                         its raymarch pass.
 *
 * Ordering note: this initialises after `world`, which is required — CSM must
 * call setupMaterial() on every material that should receive cascaded shadows,
 * and those materials do not exist until the world has been built.
 */
export class LightingModule {
  constructor() {
    this.sun = null;
    this.sunDir = new THREE.Vector3();
    this.envMap = null;
    this.volumetric = { ...VOLUMETRIC };
    this.shadows = null;
    this.sky = null;
    this.locals = [];
  }

  async init(engine) {
    this.engine = engine;
    const scene = engine.scene;

    // Height fog patches three's fog shader chunks globally, so it has to be
    // installed before any material compiles.
    installHeightFog(scene);

    const d = sunDirection();
    this.sunDir.set(d.x, d.y, d.z).normalize();

    this.sky = new PhysicalSky();
    this.sky.setSunDirection(this.sunDir);
    scene.add(this.sky.mesh);

    // CSM takes the direction the light *travels* — from the sun toward the
    // scene — which is the negation of the vector pointing at the sun.
    this.shadows = new SunShadows(
      engine.camera, scene, this.sunDir.clone().negate(),
      { shadowMapSize: SUN.shadowMapSize });
    this.sun = this.shadows.csm;

    this._applyAmbient();
    this._buildEnvironment();

    // Every world material needs the CSM shader injection to receive cascades.
    const world = engine.modules.get('world');
    if (world?.materials) {
      for (const m of world.materials.values()) this.shadows.setupMaterial(m);
    }

    this._addLocalLights(scene);
    syncFogDefaults();
  }

  /**
   * Sky-derived hemispheric ambient. A warm horizon over a cool zenith is what
   * separates the lit and shadowed sides of a surface once the key light is
   * blocked — a flat grey ambient would flatten the whole compound.
   */
  _applyAmbient() {
    const { above, below } = skyAmbientColors(this.sunDir);
    if (!this._hemi) {
      this._hemi = new THREE.HemisphereLight(above, below, SKY.ambientIntensity);
      this.engine.scene.add(this._hemi);
    } else {
      this._hemi.color.copy(above);
      this._hemi.groundColor.copy(below);
    }
    // Height fog tints warm toward the sun and cool away from it; without this
    // the inscattering points at a stale default and the haze reads flat.
    sharedFogUniforms.hfSunDirection.value.copy(this.sunDir);
  }

  /** Render the analytic sky into a PMREM cube so metal and glass reflect it. */
  _buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.engine.renderer);
    pmrem.compileEquirectangularShader();

    // The sky mesh lives in the main scene; PMREM needs its own, so hand it a
    // clone rather than reparenting the original out from under the renderer.
    const skyScene = new THREE.Scene();
    skyScene.add(this.sky.mesh.clone());

    const rt = pmrem.fromScene(skyScene, 0.04);
    this.envMap?.dispose?.();
    this.envMap = rt.texture;
    this.engine.scene.environment = this.envMap;
    this.engine.scene.environmentIntensity = 1.0;
    pmrem.dispose();
  }

  _addLocalLights(scene) {
    // Kept few and deliberately placed: every shadow-casting point light is a
    // full cubemap render, so they are a real budget item, not set dressing.
    const specs = [
      { pos: [-9.4, 2.7, -2.0], color: 0xbfd4ff, intensity: 9, distance: 12, shadow: true },
      { pos: [-16.0, 2.8, -9.0], color: 0xffd9a0, intensity: 6, distance: 10, shadow: false },
      { pos: [15.0, 5.2, -4.0], color: 0xfff0d0, intensity: 14, distance: 20, shadow: false },
      { pos: [5.5, 5.6, -2.0], color: 0xffe9c4, intensity: 12, distance: 16, shadow: false },
    ];
    for (const s of specs) {
      const l = new THREE.PointLight(s.color, s.intensity, s.distance, 2);
      l.position.fromArray(s.pos);
      if (s.shadow) {
        l.castShadow = true;
        l.shadow.mapSize.set(512, 512);
        l.shadow.bias = -0.003;
      }
      scene.add(l);
      this.locals.push(l);
    }
  }

  addLocalLight(light) {
    this.engine.scene.add(light);
    this.locals.push(light);
    return light;
  }

  setTimeOfDay(t) {
    const el = Math.sin(t * Math.PI) * 72;
    const az = 90 + t * 180;
    const e = (el * Math.PI) / 180, a = (az * Math.PI) / 180;
    this.sunDir.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
    this.sky.setSunDirection(this.sunDir);
    this.shadows.setLightDirection(this.sunDir.clone().negate());
    this._applyAmbient();
    this._buildEnvironment();
  }

  update() {
    // CSM re-fits its cascades to the camera frustum every frame.
    this.shadows?.update();
  }
}
