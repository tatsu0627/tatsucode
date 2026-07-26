import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { POST, EXPOSURE, CAMERA } from '../core/artdirection.js';
import { PostChain } from './postchain.js';
import { GBufferPass } from './gbuffer.js';
import { VelocityPass } from './passes/velocity.js';
import { TAAPass } from './passes/taa.js';
import { createSsrPass } from './passes/ssr.js';
import { createMotionBlurPass } from './passes/motionblur.js';
import { createDofPass } from './passes/dof.js';
import { createCompositePass } from './passes/composite.js';
import { createSharpenPass } from './passes/sharpen.js';
import { haltonJitterSequence } from './shaderlib.js';

/**
 * Owns the frame's draw call and the entire post-processing chain.
 *
 * CONTRACT
 *   render(dt, engine)  — REQUIRED. Draws engine.scene with engine.camera.
 *   quality             — {preset:'low'|'high'|'ultra'} read by other modules to
 *                         scale their own cost (particle counts, shadow res).
 *   needsVelocity       — true if the chain consumes a velocity buffer.
 *   passes              — map of pass name -> enabled flag, for the debug UI.
 *
 * FRAME STRUCTURE
 *   1. jitter the projection matrix (sub-pixel Halton offset for TAA)
 *   2. G-buffer prepass — view normals + depth, opaque geometry only
 *   3. beauty pass into an RGBA16F target, then the layer-1 viewmodel on top
 *      with a cleared depth buffer and its own narrower FOV
 *   4. velocity buffer — depth reprojection, plus a zero stamp on the viewmodel
 *   5. the post chain, in POST.order
 *
 * Everything from step 3 to the composite pass is linear HDR. Tone mapping
 * happens exactly once, in the composite pass, because three skips the
 * material-level tonemap when rendering into a render target.
 *
 * DEBUG
 *   ?post=ao|normal|depth|velocity|scene   — dump an intermediate buffer
 *   ?quality=low|high|ultra                — force a preset
 *   ?taa=0 / ?bloom=0 / ...                — disable an individual pass
 *   window.__ENGINE__.get('render').passes — live toggles
 */

const PRESETS = {
  low: {
    renderScale: 0.8,
    ssao: false,
    ssr: false,
    motionblur: false,
    dof: false,
    bloom: true,
    aoSamples: 8,
    mbSamples: 6,
    dofSamples: 8,
    ssrSteps: 12,
  },
  high: {
    renderScale: 1.0,
    ssao: true,
    ssr: false,
    motionblur: true,
    dof: true,
    bloom: true,
    aoSamples: 12,
    mbSamples: 10,
    dofSamples: 12,
    ssrSteps: 20,
  },
  ultra: {
    renderScale: 1.0,
    ssao: true,
    ssr: false,
    motionblur: true,
    dof: true,
    bloom: true,
    aoSamples: 16,
    mbSamples: 12,
    dofSamples: 16,
    ssrSteps: 28,
  },
};

export class RenderModule {
  constructor() {
    this.quality = { preset: 'ultra' };
    this.needsVelocity = true;

    // Every entry of POST.order that this module owns, individually toggleable.
    this.passes = {
      gbuffer: true,
      ssao: true,
      ssr: false,
      volumetric: true,
      taa: true,
      motionblur: true,
      bloom: true,
      dof: true,
      tonemap: true,
      grain: true,
      chromatic: true,
      vignette: true,
      sharpen: true,
    };

    this.debugView = null;

    this._frame = 0;
    this._w = 1;
    this._h = 1;
    this._pixelRatio = 1;
    this._ready = false;

    this._jitterSeq = haltonJitterSequence(16);
    this._projUnjittered = new THREE.Matrix4();
    this._viewProj = new THREE.Matrix4();
    this._invViewProj = new THREE.Matrix4();
    this._prevViewProj = new THREE.Matrix4();

    this._prevCamPos = new THREE.Vector3();
    this._prevCamQuat = new THREE.Quaternion();
    this._prevFov = 0;
    this._staticness = 0;
    this._hasViewmodel = false;
  }

  async init(engine) {
    this.engine = engine;
    const renderer = engine.renderer;

    this._readUrlOverrides();

    // ---- targets -----------------------------------------------------------
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.sceneRT.texture.name = 'scene.hdr';

    this.gbuffer = new GBufferPass();
    this.velocity = new VelocityPass();

    // ---- viewmodel camera --------------------------------------------------
    // Layer 1 renders with a narrower FOV against a cleared depth buffer, so
    // the weapon can never clip into world geometry. It is deliberately kept
    // out of the G-buffer: its depth belongs to a different projection and
    // would poison AO, DOF and reprojection. The velocity pass stamps it
    // separately instead.
    this.viewmodelCamera = new THREE.PerspectiveCamera(
      CAMERA.viewmodelFov ?? 58,
      1,
      CAMERA.near ?? 0.02,
      CAMERA.far ?? 1200,
    );
    this.viewmodelCamera.layers.set(CAMERA.viewmodelLayer ?? 1);
    this.viewmodelCamera.matrixAutoUpdate = false;

    // ---- chain -------------------------------------------------------------
    this.chain = new PostChain(renderer);

    // ssao
    this.gtao = new GTAOPass(engine.scene, engine.camera, 1, 1);
    this._adoptExternalGBuffer(this.gtao);
    this.gtao.updateGtaoMaterial({
      radius: POST.ssao?.radius ?? 0.55,
      // Small distanceExponent keeps samples bunched near the shading point:
      // this is contact occlusion, not a global-illumination substitute.
      distanceExponent: 1.4,
      thickness: 0.5,
      distanceFallOff: 1.0,
      // pow(ao, scale) — the art bible's ssao.intensity is exactly this curve.
      scale: POST.ssao?.intensity ?? 1.15,
      samples: 16,
      screenSpaceRadius: false,
    });
    this.gtao.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 1.5,
      normalPhi: 4.0,
      radius: 6,
      rings: 2,
      samples: 16,
    });
    this.gtao.blendIntensity = 1.0;
    this.chain.add(this.gtao);

    // ssr
    this.ssr = createSsrPass({ steps: 28 });
    this.chain.add(this.ssr);

    // volumetric — owned by the lighting module per its contract. We only
    // reserve the slot and adopt whatever it publishes.
    this._volumetricIndex = this.chain.passes.length;
    this._volumetricPass = null;

    // taa
    this.taa = new TAAPass();
    this.chain.add(this.taa);

    // motion blur
    this.motionBlur = createMotionBlurPass({ samples: 12 });
    this.motionBlur.uniforms.uStrength.value = POST.motionBlur?.strength ?? 0.55;
    this.chain.add(this.motionBlur);

    // bloom
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      POST.bloom?.strength ?? 0.38,
      POST.bloom?.radius ?? 0.62,
      POST.bloom?.threshold ?? 1.15,
    );
    this.chain.add(this.bloom);

    // dof
    this.dof = createDofPass({ samples: 16 });
    this.dof.uniforms.uFocus.value = POST.dof?.focusDistance ?? 12;
    this.dof.uniforms.uAperture.value = POST.dof?.aperture ?? 0.9;
    this.dof.uniforms.uMaxBlur.value = POST.dof?.maxBlur ?? 0.007;
    this.chain.add(this.dof);

    // tonemap + grain + chromatic + vignette
    this.composite = createCompositePass();
    this.chain.add(this.composite);

    // sharpen (+ final dither)
    this.sharpen = createSharpenPass();
    this.sharpen.uniforms.uSharpness.value = POST.sharpen?.strength ?? 0.28;
    this.chain.add(this.sharpen);

    this.setQuality(this.quality.preset);

    // Buffer handles, exposed for a debug UI.
    this.buffers = {
      scene: this.sceneRT,
      normal: this.gbuffer.target,
      depth: this.gbuffer.depthTexture,
      velocity: this.velocity.target,
    };

    this._ready = true;
    this.resize(window.innerWidth, window.innerHeight, engine);
  }

  // -------------------------------------------------------------------------

  _readUrlOverrides() {
    let params;
    try {
      params = new URLSearchParams(location.search);
    } catch {
      return;
    }
    const q = params.get('quality');
    if (q && PRESETS[q]) this.quality.preset = q;

    const view = params.get('post');
    if (view) this.debugView = view;

    for (const key of Object.keys(this.passes)) {
      const v = params.get(key);
      if (v !== null) this.passes[key] = v !== '0' && v !== 'false';
    }
  }

  /**
   * Point GTAOPass at our shared G-buffer instead of letting it render its own.
   * Saves a full extra scene pass, and guarantees AO, TAA and SSR all agree on
   * the same depth. Works around a bug in r185's setGBuffer(): it dereferences
   * this.normalRenderTarget unconditionally, so the internal target has to stay
   * alive — we just shrink it to 1x1 so it costs nothing.
   */
  _adoptExternalGBuffer(pass) {
    pass.setGBuffer(this.gbuffer.depthTexture, this.gbuffer.normalTexture);
    const baseSetSize = pass.setSize.bind(pass);
    pass.setSize = (w, h) => {
      baseSetSize(w, h);
      pass.normalRenderTarget.setSize(1, 1);
    };
    pass.normalRenderTarget.setSize(1, 1);
  }

  setQuality(preset) {
    const p = PRESETS[preset] ?? PRESETS.high;
    this.quality.preset = PRESETS[preset] ? preset : 'high';
    this._preset = p;

    this.passes.ssao = p.ssao;
    this.passes.ssr = p.ssr;
    this.passes.motionblur = p.motionblur;
    this.passes.dof = p.dof;
    this.passes.bloom = p.bloom;

    this.gtao?.updateGtaoMaterial({ samples: p.aoSamples });
    this._setDefine(this.motionBlur, 'SAMPLES', p.mbSamples);
    this._setDefine(this.dof, 'SAMPLES', p.dofSamples);
    this._setDefine(this.ssr, 'STEPS', p.ssrSteps);

    if (this._renderScale !== p.renderScale) {
      this._renderScale = p.renderScale;
      if (this._ready) this.resize(window.innerWidth, window.innerHeight, this.engine);
    }
  }

  _setDefine(pass, name, value) {
    if (!pass?.material) return;
    if (pass.material.defines[name] === value) return;
    pass.material.defines[name] = value;
    pass.material.needsUpdate = true;
  }

  resize(w, h, engine) {
    if (!this._ready) return;
    const renderer = (engine ?? this.engine).renderer;
    this._pixelRatio = renderer.getPixelRatio();

    const scale = this._renderScale ?? 1;
    const iw = Math.max(2, Math.round(w * this._pixelRatio * scale));
    const ih = Math.max(2, Math.round(h * this._pixelRatio * scale));
    if (iw === this._w && ih === this._h) return;

    this._w = iw;
    this._h = ih;

    this.sceneRT.setSize(iw, ih);
    this.gbuffer.setSize(iw, ih);
    this.velocity.setSize(iw, ih);
    this.chain.setSize(iw, ih);

    // Passes that need their own resolution uniforms but are not FullscreenPass.
    this.bloom.setSize?.(iw, ih);
    this.taa.setSize(iw, ih);
  }

  // -------------------------------------------------------------------------

  _syncToggles(engine) {
    const P = this.passes;
    this.gtao.enabled = !!P.ssao;
    this.ssr.enabled = !!P.ssr;
    this.taa.enabled = !!P.taa;
    this.motionBlur.enabled = !!P.motionblur;
    this.bloom.enabled = !!P.bloom;
    this.dof.enabled = !!P.dof;
    this.composite.enabled = !!P.tonemap;
    this.sharpen.enabled = !!P.sharpen;
    if (this._volumetricPass) this._volumetricPass.enabled = !!P.volumetric;

    const c = this.composite.uniforms;
    c.uGrain.value = P.grain ? (POST.grain?.strength ?? 0.035) : 0;
    c.uChromatic.value = P.chromatic ? (POST.chromatic?.strength ?? 0.0016) : 0;
    c.uVignetteStrength.value = P.vignette ? (POST.vignette?.strength ?? 0.34) : 0;
    c.uVignetteSmooth.value = POST.vignette?.smoothness ?? 0.55;
    c.uContrast.value = POST.look?.contrast ?? 1.03;
    c.uSaturation.value = POST.look?.saturation ?? 1.02;
    // Dither belongs to whichever pass writes the 8-bit framebuffer.
    c.uDither.value = this.sharpen.enabled ? 0 : 1;

    // The lighting module owns volumetrics; adopt its pass the moment it exists.
    if (!this._volumetricPass) {
      const lighting = engine.modules.get('lighting');
      const pass = lighting?.volumetricPass ?? lighting?.postPass ?? null;
      if (pass && typeof pass.render === 'function') {
        this._volumetricPass = pass;
        pass.setSize?.(this._w, this._h);
        this.chain.passes.splice(this._volumetricIndex, 0, pass);
      }
    }
  }

  _updateViewmodelCamera(engine, camera, jitterOn) {
    // Cheap poll: only pay for the traversal every 30 frames.
    if (this._frame % 30 === 0) {
      const layerMask = 1 << (CAMERA.viewmodelLayer ?? 1);
      let found = false;
      engine.scene.traverse((o) => {
        if (!found && o.visible && (o.isMesh || o.isSkinnedMesh || o.isInstancedMesh)) {
          if ((o.layers.mask & layerMask) !== 0) found = true;
        }
      });
      this._hasViewmodel = found;
    }

    const weapons = engine.modules.get('weapons');
    if (!this._hasViewmodel || weapons?.visible === false) return null;

    const cam = this.viewmodelCamera;
    cam.matrixWorld.copy(camera.matrixWorld);
    cam.matrixWorldInverse.copy(camera.matrixWorldInverse);
    cam.aspect = camera.aspect;
    cam.fov = CAMERA.viewmodelFov ?? 58;
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateProjectionMatrix();
    if (jitterOn) this._jitterProjection(cam.projectionMatrix);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    return cam;
  }

  _jitterProjection(proj) {
    proj.elements[8] += (this._jitterX * 2) / this._w;
    proj.elements[9] += (this._jitterY * 2) / this._h;
  }

  _updateStaticness(camera, dt) {
    const dPos = camera.position.distanceTo(this._prevCamPos);
    const dot = Math.abs(camera.quaternion.dot(this._prevCamQuat));
    const dRot = 2 * Math.acos(Math.min(1, dot));
    const dFov = Math.abs(camera.fov - this._prevFov);

    const cut = dPos > 3 || dRot > 1.2 || this._frame === 0;
    if (cut) this.taa.reset();

    const motion = dPos + dRot * 1.5 + dFov * 0.05;
    if (motion < 1e-5) this._staticness = Math.min(1, this._staticness + 0.1);
    else this._staticness = Math.max(0, this._staticness - Math.min(1, motion * 60));

    this._prevCamPos.copy(camera.position);
    this._prevCamQuat.copy(camera.quaternion);
    this._prevFov = camera.fov;

    return { dPos, dRot };
  }

  _updateUniforms(engine, dt) {
    const camera = engine.camera;
    const renderer = engine.renderer;
    const s = this._staticness;

    // TAA — a still camera has nothing to ghost, so lean much harder on the
    // history. That is what turns the jitter pattern into real supersampling
    // and resolves the stills cleanly.
    const t = this.taa.uniforms;
    t.tVelocity.value = this.velocity.target.texture;
    t.tDepth.value = this.gbuffer.depthTexture;
    t.uFeedback.value = THREE.MathUtils.lerp(0.9, 0.965, s);
    t.uClampGamma.value = THREE.MathUtils.lerp(1.15, 2.2, s);

    const m = this.motionBlur.uniforms;
    m.tVelocity.value = this.velocity.target.texture;
    m.tDepth.value = this.gbuffer.depthTexture;
    m.uStrength.value = POST.motionBlur?.strength ?? 0.55;
    m.uFrame.value = this._frame % 64;

    const d = this.dof.uniforms;
    d.tDepth.value = this.gbuffer.depthTexture;
    d.tVelocity.value = this.velocity.target.texture;
    d.uNear.value = camera.near;
    d.uFar.value = camera.far;
    d.uFocus.value = POST.dof?.focusDistance ?? 12;
    d.uAperture.value = POST.dof?.aperture ?? 0.9;
    d.uMaxBlur.value = POST.dof?.maxBlur ?? 0.007;
    d.uFrame.value = this._frame % 64;
    this.dof.enabled = this.passes.dof && (POST.dof?.enabled ?? true);

    if (this.ssr.enabled) {
      const r = this.ssr.uniforms;
      r.tDepth.value = this.gbuffer.depthTexture;
      r.tNormal.value = this.gbuffer.normalTexture;
      r.uProj.value.copy(camera.projectionMatrix);
      r.uInvProj.value.copy(camera.projectionMatrixInverse);
      r.uViewMatrix.value.copy(camera.matrixWorldInverse);
      r.uNear.value = camera.near;
      r.uFar.value = camera.far;
      r.uFrame.value = this._frame % 64;
    }

    const b = this.bloom;
    b.threshold = POST.bloom?.threshold ?? 1.15;
    b.strength = POST.bloom?.strength ?? 0.38;
    b.radius = POST.bloom?.radius ?? 0.62;

    const c = this.composite.uniforms;
    // The bible owns exposure; renderer.toneMappingExposure stays available as
    // a runtime multiplier for anything doing eye adaptation.
    c.uExposure.value = EXPOSURE * (renderer.toneMappingExposure ?? 1);
    c.uTime.value = (this._frame % 4096) * 0.0173;

    this.sharpen.uniforms.uSharpness.value = POST.sharpen?.strength ?? 0.28;
  }

  // -------------------------------------------------------------------------

  render(dt, engine) {
    const renderer = engine.renderer;
    const scene = engine.scene;
    const camera = engine.camera;

    if (!this._ready) {
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(scene, camera);
      return;
    }

    this._syncToggles(engine);

    if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
    if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();

    this._updateStaticness(camera, dt);

    // --- 1. jitter ----------------------------------------------------------
    camera.updateProjectionMatrix();
    this._projUnjittered.copy(camera.projectionMatrix);

    const jitterOn = this.taa.enabled;
    if (jitterOn) {
      const j = this._jitterSeq[this._frame % this._jitterSeq.length];
      this._jitterX = j[0];
      this._jitterY = j[1];
      this._jitterProjection(camera.projectionMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    } else {
      this._jitterX = 0;
      this._jitterY = 0;
    }

    this._viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._invViewProj.copy(this._viewProj).invert();
    if (this._frame === 0) this._prevViewProj.copy(this._viewProj);

    const vmCam = this._updateViewmodelCamera(engine, camera, jitterOn);

    // --- 2. G-buffer prepass ------------------------------------------------
    if (this.passes.gbuffer) this.gbuffer.render(renderer, scene, camera);

    // --- 3. beauty ----------------------------------------------------------
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    if (vmCam) {
      const bg = scene.background;
      scene.background = null;
      renderer.clearDepth();
      renderer.render(scene, vmCam);
      scene.background = bg;
    }

    // --- 4. velocity --------------------------------------------------------
    this.velocity.render(
      renderer,
      scene,
      this.gbuffer.depthTexture,
      this._invViewProj,
      this._prevViewProj,
      vmCam,
    );

    // --- 5. post chain ------------------------------------------------------
    this._updateUniforms(engine, dt);

    if (this.debugView) this._renderDebugView(renderer);
    else this.chain.render(dt, this.sceneRT.texture);

    // --- 6. restore & bookkeeping ------------------------------------------
    camera.projectionMatrix.copy(this._projUnjittered);
    camera.projectionMatrixInverse.copy(this._projUnjittered).invert();
    this._prevViewProj.multiplyMatrices(this._projUnjittered, camera.matrixWorldInverse);

    renderer.setRenderTarget(null);
    this._frame++;
  }

  _renderDebugView(renderer) {
    if (!this._debugQuad) {
      // A tiny material that can unpack whichever buffer is being inspected.
      this._debugMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tSrc: { value: null },
          uMode: { value: 0 },
          uNear: { value: 0.02 },
          uFar: { value: 1200 },
        },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform highp sampler2D tSrc;
          uniform float uMode;
          uniform float uNear;
          uniform float uFar;
          varying vec2 vUv;
          void main() {
            vec4 t = texture2D( tSrc, vUv );
            vec3 c;
            if ( uMode < 0.5 )       c = t.rgb;                                  // raw
            else if ( uMode < 1.5 )  c = vec3( pow( ( uNear * uFar ) / ( uFar - t.x * ( uFar - uNear ) ) / 40.0, 0.45 ) );
            else if ( uMode < 2.5 )  c = vec3( abs( t.rg ) * 40.0, t.b );        // velocity
            else                     c = pow( max( t.rgb, 0.0 ), vec3( 1.0 / 2.2 ) );
            gl_FragColor = vec4( c, 1.0 );
          }
        `,
        depthTest: false,
        depthWrite: false,
      });
      // Previously this derived the quad class from this.chain._copyQuad, which
      // the chain only creates lazily on its first blit — so the debug view threw
      // before it could draw anything. Use the imported class directly.
      this._debugQuad = new FullScreenQuad(this._debugMaterial);
    }

    const u = this._debugMaterial.uniforms;
    const cam = this.engine.camera;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;

    switch (this.debugView) {
      case 'ao':
        // Run just the AO half of the chain so the raw occlusion is visible.
        this.gtao.output = GTAOPass.OUTPUT.Denoise;
        this.gtao.renderToScreen = true;
        this.gtao.render(renderer, null, this.sceneRT, 0);
        this.gtao.output = GTAOPass.OUTPUT.Default;
        return;
      case 'normal':
        u.tSrc.value = this.gbuffer.normalTexture;
        u.uMode.value = 0;
        break;
      case 'depth':
        u.tSrc.value = this.gbuffer.depthTexture;
        u.uMode.value = 1;
        break;
      case 'velocity':
        u.tSrc.value = this.velocity.target.texture;
        u.uMode.value = 2;
        break;
      case 'scene':
      default:
        u.tSrc.value = this.sceneRT.texture;
        u.uMode.value = 3;
        break;
    }

    renderer.setRenderTarget(null);
    this._debugQuad.render(renderer);
  }

  dispose() {
    this.sceneRT.dispose();
    this.gbuffer.dispose();
    this.velocity.dispose();
    this.chain.dispose();
  }
}
