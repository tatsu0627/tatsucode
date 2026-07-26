import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { SUN } from '../core/artdirection.js';

/**
 * CASCADED SHADOW MAPS.
 *
 * three r185 ships `three/addons/csm/CSM.js`, so we use it rather than writing
 * cascades from scratch — but the stock configuration is not usable as-is:
 *
 *   - It splits the frustum with a "practical" scheme; the art bible dictates
 *     explicit cascade distances (SUN.cascades), so we drive it in 'custom' mode.
 *   - It writes a single shadow bias to every cascade. Bias has to scale with
 *     the world size of a shadow texel or you get acne in the far cascades and
 *     peter-panning in the near one. We rescale bias, normalBias and the PCF
 *     radius per cascade from the measured texel footprint.
 *   - `fade` is off by default, which leaves a hard ring where cascades meet.
 *
 * r185's PCF path is already a Vogel-disk kernel rotated per pixel by
 * interleaved gradient noise (5 hardware-PCF taps == 20 filtered taps), so the
 * penumbra is dithered rather than banded. Because the kernel radius is
 * `shadow.radius * texelSize` and texel size grows with the cascade, shadows
 * naturally soften with distance from the viewer — the cheap PCSS stand-in.
 *
 * All of that depends on `renderer.shadowMap.type === THREE.PCFShadowMap`.
 * r185 has no define for PCFSoftShadowMap and silently falls back to a single
 * unfiltered tap, which makes every radius here dead code. See
 * `src/core/engine.js`.
 */
// Shadow bias, in world metres rather than in whatever normalised unit each
// cascade's frustum happens to imply.
const DEPTH_BIAS_METRES = 0.03;

// Normal bias is sized from the cascade's own texel footprint, because that is
// the thing it has to clear. The sun sits at ~10 degrees, so the ground is
// nearly parallel to the light and the depth of the surface changes by
// texel / tan(elevation) across a single shadow texel — about 5.4x the texel
// width. No constant depth bias survives that; offsetting the lookup along the
// surface normal does, and it has to scale with both the texel size and the
// PCF kernel's reach.
const NORMAL_BIAS_TEXELS = 1.6;
// ...but only up to a point. Past this the shadow visibly leaves the object's
// base, and peter-panning reads as worse than a little acne.
const MAX_NORMAL_BIAS_METRES = 0.28;

export class SunShadows {
  /**
   * @param {THREE.Camera} camera
   * @param {THREE.Object3D} parent  usually the scene
   * @param {THREE.Vector3} lightDirection  direction the light TRAVELS (sun -> scene)
   */
  constructor(camera, parent, lightDirection, opts = {}) {
    const cascadeDistances = SUN.cascades.slice();
    const maxFar = cascadeDistances[cascadeDistances.length - 1];

    this.cascadeDistances = cascadeDistances;
    this.mapSize = opts.shadowMapSize ?? SUN.shadowMapSize;

    this.csm = new CSM({
      camera,
      parent,
      cascades: cascadeDistances.length,
      maxFar,
      mode: 'custom',
      customSplitsCallback: (amount, near, far, target) => {
        for (let i = 0; i < amount; i++) {
          target.push(Math.min(1, cascadeDistances[i] / far));
        }
        target[amount - 1] = 1;
      },
      shadowMapSize: this.mapSize,
      shadowBias: SUN.shadowBias,
      lightDirection: lightDirection.clone().normalize(),
      lightIntensity: SUN.intensity,
      lightNear: 1,
      lightFar: 600,
      lightMargin: 140,
    });

    this.csm.fade = true;

    for (const light of this.csm.lights) {
      light.color.set(SUN.color);
      light.intensity = SUN.intensity;
      light.shadow.mapSize.set(this.mapSize, this.mapSize);
      // Render back faces into the shadow map: the classic fix for acne on
      // closed geometry. Objects the world module marks single-sided still work
      // because three falls back to the material's own side when shadowSide is
      // unset — we only set it globally through the material pass.
      light.shadow.camera.near = 1;
      light.shadow.camera.far = 600;
    }

    this._lastFov = -1;
    this._lastAspect = -1;
    this._lastNear = -1;

    this.updateFrustums();
  }

  get lights() { return this.csm.lights; }
  get cascades() { return this.csm.cascades; }

  /** View-space distance (metres) at which each cascade ends. */
  get splitDistances() {
    const cam = this.csm.camera;
    const far = Math.min(cam.far, this.csm.maxFar);
    return this.csm.breaks.map(b => b * (far - cam.near));
  }

  setLightDirection(dir) {
    this.csm.lightDirection.copy(dir).normalize();
  }

  setIntensity(intensity, color) {
    for (const light of this.csm.lights) {
      light.intensity = intensity;
      if (color) light.color.copy(color);
    }
    this.csm.lightIntensity = intensity;
  }

  updateFrustums() {
    this.csm.updateFrustums();
    this._tuneBias();
  }

  /**
   * Bias and filter radius are meaningless as absolute numbers — they only mean
   * anything relative to the world size of one shadow texel. Cascade 0 keeps the
   * authored values from the art bible; every wider cascade scales with its own
   * texel footprint so we get neither acne (too little bias) nor detached
   * shadows (too much) at any range.
   */
  _tuneBias() {
    const lights = this.csm.lights;
    if (!lights.length) return;

    const texel = i => {
      const cam = lights[i].shadow.camera;
      return (cam.right - cam.left) / this.mapSize;
    };

    for (let i = 0; i < lights.length; i++) {
      const shadow = lights[i].shadow;
      const texelM = texel(i);

      // Penumbra width in texels. Keep the near cascade tight so contact
      // shadows under crates and sandbags stay crisp, widen further out. Set
      // before the normal bias, which has to clear the kernel's whole reach.
      shadow.radius = i === 0 ? 1.35 : 1.35 + i * 0.55;

      // Depth bias is expressed in METRES and converted per cascade
      // using that cascade's own depth range, so it stays constant in world
      // terms however wide the frustum gets.
      const cam = shadow.camera;
      const range = Math.max(1, cam.far - cam.near);
      shadow.bias = -(DEPTH_BIAS_METRES / range);

      // The lookup is offset along the surface normal by enough to clear the
      // PCF kernel's own footprint, which is what actually decides how far a
      // neighbouring texel's depth can be from this fragment's. SUN.normalBias
      // is the floor, so the art bible can still ask for more contact softening
      // than the geometry strictly needs.
      shadow.normalBias = Math.min(
        Math.max(SUN.normalBias, texelM * (shadow.radius + 1) * NORMAL_BIAS_TEXELS),
        MAX_NORMAL_BIAS_METRES);
    }
  }

  update() {
    const cam = this.csm.camera;
    if (cam.fov !== this._lastFov || cam.aspect !== this._lastAspect || cam.near !== this._lastNear) {
      this._lastFov = cam.fov;
      this._lastAspect = cam.aspect;
      this._lastNear = cam.near;
      this.updateFrustums();
    }
    this.csm.update();
  }

  /**
   * Give a material the cascade shader injection, and make it cast from its
   * back faces.
   *
   * shadowSide is the half of the acne fix that bias cannot do. A surface lit
   * at a grazing angle writes a depth into the shadow map that varies by far
   * more than any constant bias across one texel, so it shadows itself. Writing
   * only back faces moves the recorded depth to the far side of the object:
   * a closed box still occludes correctly, and a ground plane — whose front
   * face points at the sky — stops appearing in the shadow map at all, so it
   * cannot self-shadow. The ground is the surface this scene is mostly made of,
   * and it is the one where a ~10 degree sun makes constant bias hopeless.
   *
   * The cost is that genuinely single-sided caster geometry stops casting.
   * The level is built from closed boxes (see world/geo.js), so that is a
   * trade worth making here rather than a general truth.
   */
  setupMaterial(material) {
    this.csm.setupMaterial(material);
    if (material.shadowSide === null || material.shadowSide === undefined) {
      material.shadowSide = THREE.BackSide;
    }
  }

  dispose() { this.csm.remove(); this.csm.dispose(); }
}
