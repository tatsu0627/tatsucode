import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERT, GLSL_RECONSTRUCT } from '../shaderlib.js';

/**
 * Screen-space velocity buffer.
 *
 *   rg — per-frame UV motion (thisFrameUV - lastFrameUV)
 *   b  — 1.0 where the viewmodel covers the pixel (camera-locked, so it must be
 *        excluded from motion blur / DOF / velocity dilation)
 *
 * Velocity is reconstructed from the depth buffer by unprojecting with this
 * frame's (jittered) inverse view-projection — jittered because that is what
 * the depth buffer was rendered with — and then reprojecting the result with
 * BOTH this frame's and last frame's UNJITTERED view-projections. Keeping the
 * position homogeneous through the transforms means the far plane (sky)
 * reprojects correctly instead of blowing up on the divide.
 *
 * Projecting the current frame explicitly, rather than taking the fragment's
 * own vUv as its current position, is the whole point. vUv is where the
 * fragment landed under this frame's sub-pixel jitter, so differencing it
 * against an unjittered previous position reports the jitter itself as motion:
 * a systematic half-pixel of velocity on a completely stationary camera, in a
 * different direction every frame. That fed motion blur, which demonstrably
 * smeared a still frame: ablating it on the weapon vantage moved the frame's
 * mean luminance by ten points and turned a soft viewmodel crisp.
 *
 * It also shifted TAA's history lookup — `prevUv = uv - velocity` was off by
 * half a pixel every frame, so history was resampled at a fractional offset on
 * every pass, and repeated bilinear resampling at a fractional offset is a
 * low-pass filter. That is a softness cost.
 *
 * It is worth being precise about what this did NOT do, because the first
 * version of this note claimed otherwise: it did not stop TAA accumulating.
 * uScale is 1, so velocity is in UV units; half a pixel at 1600 wide is
 * 0.0003, and multiplied by uVelocityBoost (12) that moves the blend weight
 * from 0.080 to 0.084. A 4% nudge is not history rejection. Whatever leaves
 * edges looking under-resolved, this was not the cause.
 *
 * KNOWN LIMITATION: this covers camera motion, which is essentially all of the
 * motion in a first-person shooter, plus an explicit zero for the viewmodel.
 * Independently moving rigid bodies (AI, doors, debris) do not write their own
 * motion vectors — TAA falls back to its neighbourhood clamp for those, which
 * costs a little sharpness on a fast-moving silhouette but does not ghost.
 * Doing it properly needs an MRT G-buffer with per-object previous matrices,
 * which in turn needs every material in the scene to cooperate; the world and
 * AI modules are owned by other agents.
 */
export class VelocityPass {
  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.name = 'velocity';

    this.material = new THREE.ShaderMaterial({
      name: 'VelocityReconstruct',
      uniforms: {
        tDepth: { value: null },
        uInvViewProj: { value: new THREE.Matrix4() },
        uViewProj: { value: new THREE.Matrix4() },
        uPrevViewProj: { value: new THREE.Matrix4() },
        uScale: { value: 1 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform highp sampler2D tDepth;
        uniform mat4 uInvViewProj;
        uniform mat4 uViewProj;
        uniform mat4 uPrevViewProj;
        uniform float uScale;
        varying vec2 vUv;

        ${GLSL_RECONSTRUCT}

        void main() {
          float depth = texture2D( tDepth, vUv ).x;
          vec4 worldH = worldFromDepthH( vUv, depth, uInvViewProj );
          vec4 currClip = uViewProj * worldH;
          vec4 prevClip = uPrevViewProj * worldH;
          vec2 currUv = ( currClip.xy / currClip.w ) * 0.5 + 0.5;
          vec2 prevUv = ( prevClip.xy / prevClip.w ) * 0.5 + 0.5;
          vec2 velocity = ( currUv - prevUv ) * uScale;
          // Guard against the degenerate case behind either camera.
          if ( prevClip.w <= 0.0 || currClip.w <= 0.0 ) velocity = vec2( 0.0 );
          gl_FragColor = vec4( velocity, 0.0, 1.0 );
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this._fsQuad = new FullScreenQuad(this.material);

    // Camera-locked geometry (the viewmodel) has zero screen velocity by
    // definition. Stamping it explicitly is what stops the weapon from
    // smearing every time the player turns.
    this.viewmodelTagMaterial = new THREE.ShaderMaterial({
      name: 'VelocityViewmodelTag',
      uniforms: {},
      vertexShader: /* glsl */ `
        #include <common>
        #include <skinning_pars_vertex>
        void main() {
          #include <beginnormal_vertex>
          #include <defaultnormal_vertex>
          #include <begin_vertex>
          #include <skinbase_vertex>
          #include <skinning_vertex>
          #include <project_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        void main() { gl_FragColor = vec4( 0.0, 0.0, 1.0, 1.0 ); }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      fog: false,
    });
  }

  setSize(w, h) {
    this.target.setSize(w, h);
  }

  /**
   * @param {THREE.Texture} depthTexture — from the G-buffer prepass
   * @param {THREE.Matrix4} invViewProj — inverse of this frame's jittered VP
   * @param {THREE.Matrix4} viewProj — this frame's UNJITTERED VP
   * @param {THREE.Matrix4} prevViewProj — last frame's unjittered VP
   * @param {?THREE.Camera} viewmodelCamera — null to skip the viewmodel tag
   */
  render(renderer, scene, depthTexture, invViewProj, viewProj, prevViewProj, viewmodelCamera) {
    this.material.uniforms.tDepth.value = depthTexture;
    this.material.uniforms.uInvViewProj.value.copy(invViewProj);
    this.material.uniforms.uViewProj.value.copy(viewProj);
    this.material.uniforms.uPrevViewProj.value.copy(prevViewProj);

    renderer.setRenderTarget(this.target);
    this._fsQuad.render(renderer);

    if (viewmodelCamera) {
      const prevBackground = scene.background;
      const prevOverride = scene.overrideMaterial;
      const prevAutoClear = renderer.autoClear;
      scene.background = null;
      scene.overrideMaterial = this.viewmodelTagMaterial;
      renderer.autoClear = false;
      renderer.render(scene, viewmodelCamera);
      scene.overrideMaterial = prevOverride;
      scene.background = prevBackground;
      renderer.autoClear = prevAutoClear;
    }
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.viewmodelTagMaterial.dispose();
    this._fsQuad.dispose();
  }
}
