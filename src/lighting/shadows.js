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
// the thing it has to clear: a surface's depth changes by
// texel / tan(sunElevation) across a single shadow texel, which no constant
// depth bias survives. Offsetting the lookup along the surface normal does,
// and it has to scale with both the texel size and the PCF kernel's reach.
//
// These are sized for SUN.elevation ~34 degrees, where that factor is about
// 1.5x. They were nearly double at the old 10.5-degree sun, where it was 5.4x
// — which is a reason to keep the sun off the horizon quite apart from how the
// level reads.
const NORMAL_BIAS_TEXELS = 1.1;
// ...but only up to a point. Past this the shadow visibly leaves the object's
// base, and peter-panning reads as worse than a little acne.
const MAX_NORMAL_BIAS_METRES = 0.15;

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
   * Give a material the cascade shader injection.
   *
   * Casters deliberately keep three's default front-face shadow rendering.
   * Back-face casting (`material.shadowSide = BackSide`) is the textbook fix
   * for self-shadow acne on closed geometry, and it was tried here — but it
   * moves the recorded depth to the far side of the object, which eats the
   * shadow from the caster's base outward by that object's own thickness along
   * the light. At this sun elevation a 1.2 m crate is ~1.8 m thick measured
   * along the light while casting a shadow only ~1.3 m long, so its shadow was
   * consumed entirely. Buildings kept theirs; every compact prop lost one.
   *
   * Acne is handled instead by the texel-sized normal bias in _tuneBias(),
   * which is what the PCF kernel radii there are matched to.
   */
  setupMaterial(material) { this.csm.setupMaterial(material); }

  dispose() { this.csm.remove(); this.csm.dispose(); }
}
