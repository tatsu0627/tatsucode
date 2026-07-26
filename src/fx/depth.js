import * as THREE from 'three';

/**
 * SCENE DEPTH SOURCE for soft (depth-faded) particles.
 *
 * The single loudest tell of cheap real-time VFX is a smoke card slicing
 * through the floor with a razor edge. Fixing it needs the opaque scene depth
 * available while the particles shade, so every soft particle can compare its
 * own view-space Z against whatever is behind it and dissolve over the last few
 * centimetres instead of clipping.
 *
 * Two ways to get that depth, in order of preference:
 *
 *   1. The render module hands us its G-buffer / prepass depth via
 *      `fx.setSceneDepth(texture, camera)`. Free — it already has one.
 *   2. We render our own half-resolution depth-only prepass here. Costs a
 *      second scene traversal, so it only runs on frames where a soft particle
 *      is actually alive, and the FX root is hidden while it draws.
 *
 * Either way the particle shaders consume `uDepth` plus `uNear`/`uFar` and
 * reconstruct view-space Z with three's `perspectiveDepthToViewZ`.
 */
export class SceneDepth {
  constructor(scale = 0.5) {
    this.scale = scale;
    this.rt = null;
    this.texture = null;
    this.external = false;
    this.enabled = true;
    this._w = 0;
    this._h = 0;
    this._flat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this._flat.fog = false;
    // A 1x1 "infinitely far" fallback so the shaders always have a bound
    // sampler even before the first prepass — never a black screen.
    const far = new Uint8Array([255, 255, 255, 255]);
    this._fallback = new THREE.DataTexture(far, 1, 1, THREE.RGBAFormat);
    this._fallback.needsUpdate = true;
    this.texture = this._fallback;
  }

  /** Render module override: hand us a depth texture it already produces. */
  setExternal(texture) {
    if (texture) { this.external = true; this.texture = texture; }
    else { this.external = false; this.texture = this.rt ? this.rt.depthTexture : this._fallback; }
  }

  _ensure(renderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.floor(size.x * this.scale));
    const h = Math.max(2, Math.floor(size.y * this.scale));
    if (this.rt && this._w === w && this._h === h) return;
    if (this.rt) this.rt.dispose();
    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;
    this.rt = new THREE.WebGLRenderTarget(w, h, {
      depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this._w = w; this._h = h;
    if (!this.external) this.texture = depthTexture;
  }

  /**
   * Depth-only prepass. `hide` is the FX root — transparent effects must not
   * write into the depth we are about to fade them against.
   */
  render(renderer, scene, camera, hide) {
    if (this.external || !this.enabled) return;
    this._ensure(renderer);
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAutoClear = renderer.autoClear;
    const hidden = [];
    for (let i = 0; i < hide.length; i++) {
      if (hide[i] && hide[i].visible) { hide[i].visible = false; hidden.push(hide[i]); }
    }
    scene.overrideMaterial = this._flat;
    renderer.setRenderTarget(this.rt);
    renderer.autoClear = false;
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
    this.texture = this.rt.depthTexture;
  }

  dispose() {
    if (this.rt) this.rt.dispose();
    this._flat.dispose();
    this._fallback.dispose();
  }
}

/** GLSL shared by every soft particle shader. */
export const DEPTH_FADE_GLSL = /* glsl */`
uniform sampler2D uDepth;
uniform vec2 uCamRange;      // near, far
uniform float uSoftness;     // fade distance in metres, 0 disables

float fxSceneViewZ(vec2 screenUv) {
  float d = texture2D(uDepth, screenUv).x;
  // perspectiveDepthToViewZ, inlined so this compiles standalone.
  float nz = d * 2.0 - 1.0;
  return (2.0 * uCamRange.x * uCamRange.y) / (uCamRange.y + uCamRange.x - nz * (uCamRange.y - uCamRange.x));
}

// particleZ: positive view-space distance of the fragment being shaded.
float fxDepthFade(vec4 clipPos, float particleZ) {
  if (uSoftness <= 0.0) return 1.0;
  vec2 uv = clipPos.xy / clipPos.w * 0.5 + 0.5;
  float sceneZ = fxSceneViewZ(uv);
  return clamp((sceneZ - particleZ) / uSoftness, 0.0, 1.0);
}
`;
