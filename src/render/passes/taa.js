import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERT, GLSL_COLOR } from '../shaderlib.js';

/**
 * Temporal anti-aliasing.
 *
 * The camera's projection matrix is jittered by a sub-pixel Halton(2,3) offset
 * every frame (see RenderModule._applyJitter); this pass accumulates those
 * samples into a history buffer, reprojected with the velocity buffer.
 *
 * Ingredients, all of which matter:
 *   - history sampled with Catmull-Rom, not bilinear. Bilinear history is the
 *     single biggest cause of "TAA makes everything mushy".
 *   - velocity dilated to the closest-depth neighbour, so a silhouette pulls its
 *     own motion vector instead of the background's.
 *   - variance clipping in YCoCg (Salvi / Karis) rather than a min-max box:
 *     a box clamp on a high-contrast edge either ghosts or flickers.
 *   - reversible range compression around the whole blend, so a single very
 *     bright HDR sample cannot smear a bright trail through the neighbourhood.
 *   - a static-camera mode that raises the feedback weight and widens the clip
 *     box. When nothing is moving there is nothing to ghost, and the extra
 *     history converges the jitter pattern into real supersampling — which is
 *     what makes the still screenshots resolve cleanly.
 */
export class TAAPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;

    const rtOpts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    this.historyA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.historyB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.historyA.texture.name = 'taa.historyA';
    this.historyB.texture.name = 'taa.historyB';
    this._flip = false;

    this.material = new THREE.ShaderMaterial({
      name: 'TAAResolve',
      uniforms: {
        tDiffuse: { value: null },
        tHistory: { value: null },
        tVelocity: { value: null },
        tDepth: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uResolution: { value: new THREE.Vector2() },
        uFeedback: { value: 0.92 },
        uClampGamma: { value: 1.25 },
        uVelocityBoost: { value: 12.0 },
        uReset: { value: 1 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tHistory;
        uniform sampler2D tVelocity;
        uniform highp sampler2D tDepth;
        uniform vec2 uTexel;
        uniform vec2 uResolution;
        uniform float uFeedback;
        uniform float uClampGamma;
        uniform float uVelocityBoost;
        uniform float uReset;
        varying vec2 vUv;

        ${GLSL_COLOR}

        // 5-bilinear-tap Catmull-Rom. Keeps the history sharp under reprojection.
        vec3 sampleHistory( vec2 uv ) {
          vec2 samplePos = uv * uResolution;
          vec2 texPos1 = floor( samplePos - 0.5 ) + 0.5;
          vec2 f = samplePos - texPos1;

          vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) );
          vec2 w1 = 1.0 + f * f * ( -2.5 + 1.5 * f );
          vec2 w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) );
          vec2 w3 = f * f * ( -0.5 + 0.5 * f );

          vec2 w12 = w1 + w2;
          vec2 offset12 = w2 / max( w12, vec2( 1e-5 ) );

          vec2 texPos0  = ( texPos1 - 1.0 ) * uTexel;
          vec2 texPos3  = ( texPos1 + 2.0 ) * uTexel;
          vec2 texPos12 = ( texPos1 + offset12 ) * uTexel;

          vec3 result = vec3( 0.0 );
          float wsum = 0.0;
          float w;

          w = w12.x * w0.y;  result += texture2D( tHistory, vec2( texPos12.x, texPos0.y  ) ).rgb * w; wsum += w;
          w = w0.x  * w12.y; result += texture2D( tHistory, vec2( texPos0.x,  texPos12.y ) ).rgb * w; wsum += w;
          w = w12.x * w12.y; result += texture2D( tHistory, vec2( texPos12.x, texPos12.y ) ).rgb * w; wsum += w;
          w = w3.x  * w12.y; result += texture2D( tHistory, vec2( texPos3.x,  texPos12.y ) ).rgb * w; wsum += w;
          w = w12.x * w3.y;  result += texture2D( tHistory, vec2( texPos12.x, texPos3.y  ) ).rgb * w; wsum += w;

          return max( result / max( wsum, 1e-5 ), vec3( 0.0 ) );
        }

        vec3 clipAABB( vec3 aabbMin, vec3 aabbMax, vec3 p, vec3 q ) {
          vec3 center  = 0.5 * ( aabbMax + aabbMin );
          vec3 extents = 0.5 * ( aabbMax - aabbMin ) + 1e-5;
          vec3 offset  = q - center;
          vec3 ts = abs( offset / extents );
          float t = max( ts.x, max( ts.y, ts.z ) );
          return t > 1.0 ? center + offset / t : q;
        }

        void main() {
          vec2 uv = vUv;

          // --- velocity, dilated to the closest depth in a 3x3 neighbourhood ---
          vec4 vTexel = texture2D( tVelocity, uv );
          float viewmodel = vTexel.b;

          vec2 bestUv = uv;
          float bestDepth = 1.0;
          for ( int y = -1; y <= 1; y++ ) {
            for ( int x = -1; x <= 1; x++ ) {
              vec2 o = vec2( float( x ), float( y ) ) * uTexel;
              float d = texture2D( tDepth, uv + o ).x;
              if ( d < bestDepth ) { bestDepth = d; bestUv = uv + o; }
            }
          }
          vec2 velocity = mix( texture2D( tVelocity, bestUv ).xy, vTexel.xy, viewmodel );
          vec2 prevUv = uv - velocity;

          // --- current frame neighbourhood statistics (range compressed YCoCg) ---
          vec3 m1 = vec3( 0.0 );
          vec3 m2 = vec3( 0.0 );
          vec3 centerY = vec3( 0.0 );
          vec3 current = vec3( 0.0 );

          for ( int y = -1; y <= 1; y++ ) {
            for ( int x = -1; x <= 1; x++ ) {
              vec2 o = vec2( float( x ), float( y ) ) * uTexel;
              vec3 c = rangeCompress( max( texture2D( tDiffuse, uv + o ).rgb, vec3( 0.0 ) ) );
              vec3 y3 = RGBToYCoCg( c );
              m1 += y3;
              m2 += y3 * y3;
              if ( x == 0 && y == 0 ) { centerY = y3; current = c; }
            }
          }

          vec3 mu = m1 / 9.0;
          vec3 sigma = sqrt( max( vec3( 0.0 ), m2 / 9.0 - mu * mu ) );
          vec3 boxMin = mu - uClampGamma * sigma;
          vec3 boxMax = mu + uClampGamma * sigma;

          // --- history ---
          vec3 history = rangeCompress( sampleHistory( prevUv ) );
          vec3 historyY = clipAABB( boxMin, boxMax, centerY, RGBToYCoCg( history ) );
          history = max( YCoCgToRGB( historyY ), vec3( 0.0 ) );

          // --- blend weight ---
          float blend = 1.0 - uFeedback;

          // disocclusion: nothing to reproject from
          bool offscreen = prevUv.x < 0.0 || prevUv.y < 0.0 || prevUv.x > 1.0 || prevUv.y > 1.0;
          if ( offscreen ) blend = 1.0;

          // fast motion trusts the current frame more; reprojection error grows
          // with velocity and the eye cannot resolve the detail anyway.
          blend = clamp( blend + length( velocity ) * uVelocityBoost, blend, 1.0 );
          blend = mix( blend, 1.0, uReset );

          vec3 result = rangeExpand( mix( history, current, blend ) );
          gl_FragColor = vec4( result, 1.0 );
        }
      `,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this.uniforms = this.material.uniforms;
    this._fsQuad = new FullScreenQuad(this.material);

    this._copyMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D( tDiffuse, vUv ); }`,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this._copyQuad = new FullScreenQuad(this._copyMaterial);
  }

  setSize(w, h) {
    this.historyA.setSize(w, h);
    this.historyB.setSize(w, h);
    this.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.uniforms.uResolution.value.set(w, h);
    this.reset();
  }

  reset() {
    this.uniforms.uReset.value = 1;
  }

  render(renderer, writeBuffer, readBuffer) {
    const read = this._flip ? this.historyB : this.historyA;
    const write = this._flip ? this.historyA : this.historyB;
    this._flip = !this._flip;

    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tHistory.value = read.texture;

    renderer.setRenderTarget(write);
    this._fsQuad.render(renderer);

    this.uniforms.uReset.value = 0;

    // Hand the resolved frame straight to the next pass with no copy.
    this.redirectRead = write;

    if (this.renderToScreen) {
      this._copyMaterial.uniforms.tDiffuse.value = write.texture;
      renderer.setRenderTarget(null);
      this._copyQuad.render(renderer);
    }
  }

  dispose() {
    this.historyA.dispose();
    this.historyB.dispose();
    this.material.dispose();
    this._copyMaterial.dispose();
    this._fsQuad.dispose();
    this._copyQuad.dispose();
  }
}
