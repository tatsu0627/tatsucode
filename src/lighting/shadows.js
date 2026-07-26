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
 */
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
    const base = Math.max(texel(0), 1e-6);

    for (let i = 0; i < lights.length; i++) {
      const shadow = lights[i].shadow;
      const scale = Math.max(1, texel(i) / base);

      // Depth bias lives in normalised light-space depth; the light frustum
      // depth range is constant across cascades, so scaling by texel ratio
      // converts the authored value into "same slope tolerance everywhere".
      shadow.bias = SUN.shadowBias * (1 + (scale - 1) * 0.55);

      // Normal bias is in world units: pushing the receiver out by ~1.5 texels
      // along its normal is the standard cure for the remaining acne without
      // detaching contact shadows.
      shadow.normalBias = SUN.normalBias * scale;

      // Penumbra width in texels. Keep the near cascade tight so contact
      // shadows under crates and sandbags stay crisp, widen further out.
      shadow.radius = i === 0 ? 1.35 : 1.35 + i * 0.85;

      shadow.needsUpdate = true;
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

  setupMaterial(material) { this.csm.setupMaterial(material); }

  dispose() { this.csm.remove(); this.csm.dispose(); }
}
