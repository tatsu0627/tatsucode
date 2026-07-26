import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERT } from './shaderlib.js';

/**
 * A minimal HDR post chain, replacing three's EffectComposer.
 *
 * Why not EffectComposer:
 *   - it owns its ping-pong targets, so there is no way to guarantee that the
 *     depth texture the whole chain depends on never becomes a write target
 *     (third-party passes call renderer.clear() with autoClearDepth on);
 *   - TAA needs to redirect the read buffer to its own history target without
 *     an extra full-screen blit every frame.
 *
 * The Pass protocol is identical to three's, so GTAOPass / UnrealBloomPass and
 * friends drop straight in:
 *   pass.enabled, pass.needsSwap, pass.renderToScreen, pass.setSize(w,h)
 *   pass.render( renderer, writeBuffer, readBuffer, dt )
 *
 * Extension: after render() a pass may set `pass.redirectRead` to a render
 * target. The chain then makes that the read buffer and recycles the old read
 * buffer as the write buffer, with no copy. Used by TAA.
 */
export class PostChain {
  constructor(renderer) {
    this.renderer = renderer;
    this.passes = [];
    this.width = 1;
    this.height = 1;

    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.rt1 = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rt2 = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rt1.texture.name = 'post.a';
    this.rt2.texture.name = 'post.b';

    this.readBuffer = this.rt1;
    this.writeBuffer = this.rt2;
  }

  add(pass) {
    this.passes.push(pass);
    pass.setSize?.(this.width, this.height);
    return pass;
  }

  setSize(w, h) {
    this.width = w;
    this.height = h;
    this.rt1.setSize(w, h);
    this.rt2.setSize(w, h);
    for (const p of this.passes) p.setSize?.(w, h);
  }

  swap() {
    const prevRead = this.readBuffer;
    this.readBuffer = this.writeBuffer;
    // The write slot must always be one of the two chain-owned buffers. If the
    // read slot was an external target (TAA's history), recycling it as the
    // write target would let a later pass stomp the history.
    this.writeBuffer =
      prevRead === this.rt1 || prevRead === this.rt2
        ? prevRead
        : this.readBuffer === this.rt1
          ? this.rt2
          : this.rt1;
  }

  _lastEnabledIndex() {
    for (let i = this.passes.length - 1; i >= 0; i--) {
      if (this.passes[i].enabled) return i;
    }
    return -1;
  }

  /**
   * @param {number} dt
   * @param {THREE.Texture} sourceTexture — the HDR scene colour to seed the chain.
   */
  render(dt, sourceTexture) {
    // Seed: the scene target is never allowed into the ping-pong (its depth
    // attachment must survive the whole frame), so blit it in once.
    this.readBuffer = this.rt1;
    this.writeBuffer = this.rt2;
    this._blit(sourceTexture, this.rt1);

    const last = this._lastEnabledIndex();
    if (last === -1) {
      this._blit(sourceTexture, null);
      return;
    }

    for (let i = 0; i < this.passes.length; i++) {
      const pass = this.passes[i];
      if (!pass.enabled) continue;

      pass.renderToScreen = i === last;
      pass.redirectRead = null;
      pass.render(this.renderer, this.writeBuffer, this.readBuffer, dt);

      if (pass.redirectRead) {
        const old = this.readBuffer;
        this.readBuffer = pass.redirectRead;
        this.writeBuffer = old === this.rt1 || old === this.rt2 ? old : this.rt1;
      } else if (pass.needsSwap) {
        this.swap();
      }
    }
  }

  _blit(texture, target) {
    if (!this._copyQuad) {
      this._copyMaterial = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          void main() { gl_FragColor = texture2D( tDiffuse, vUv ); }
        `,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
      });
      this._copyQuad = new FullScreenQuad(this._copyMaterial);
    }
    this._copyMaterial.uniforms.tDiffuse.value = texture;
    this.renderer.setRenderTarget(target);
    this._copyQuad.render(this.renderer);
  }

  dispose() {
    this.rt1.dispose();
    this.rt2.dispose();
    this._copyQuad?.dispose();
    this._copyMaterial?.dispose();
    for (const p of this.passes) p.dispose?.();
  }
}

/** Convenience base for the custom fullscreen passes in this folder. */
export class FullscreenPass extends Pass {
  constructor(shader) {
    super();
    this.material = new THREE.ShaderMaterial({
      name: shader.name ?? 'FullscreenPass',
      defines: Object.assign({}, shader.defines),
      uniforms: THREE.UniformsUtils.clone(shader.uniforms),
      vertexShader: shader.vertexShader ?? FULLSCREEN_VERT,
      fragmentShader: shader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.uniforms = this.material.uniforms;
    this._fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    if (this.uniforms.tDiffuse) this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._fsQuad.render(renderer);
  }

  setSize(w, h) {
    if (this.uniforms.uResolution) this.uniforms.uResolution.value.set(w, h);
    if (this.uniforms.uTexel) this.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  dispose() {
    this.material.dispose();
    this._fsQuad.dispose();
  }
}
