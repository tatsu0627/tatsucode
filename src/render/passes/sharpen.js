import * as THREE from 'three';
import { FullscreenPass } from '../postchain.js';
import { GLSL_NOISE } from '../shaderlib.js';

/**
 * Contrast-adaptive sharpening (AMD CAS), plus the final dither.
 *
 * Runs on the tonemapped, sRGB-encoded image — sharpening in linear light
 * over-sharpens highlights and under-sharpens shadows.
 *
 * CAS rather than an unsharp mask because it scales its kernel by local
 * contrast: flat areas (sky, fog, concrete) are left alone instead of having
 * their noise amplified, while genuinely soft edges get the strength back that
 * the TAA resolve took away. An unsharp mask at this strength would put a
 * visible halo on every railing.
 *
 * The dither is the last thing that happens before the 8-bit framebuffer write.
 * Without it, the fog and sky gradients in this scene band very visibly — that
 * one line is the difference between "cheap" and "clean" on a big soft gradient.
 */
export function createSharpenPass() {
  return new FullscreenPass({
    name: 'SharpenOutput',
    uniforms: {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uResolution: { value: new THREE.Vector2() },
      uSharpness: { value: 0.28 },
      uDither: { value: 1 },
    },
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uTexel;
      uniform float uSharpness;
      uniform float uDither;
      varying vec2 vUv;

      ${GLSL_NOISE}

      vec3 tap( vec2 o ) { return texture2D( tDiffuse, vUv + o * uTexel ).rgb; }

      void main() {
        vec3 a = tap( vec2( -1.0, -1.0 ) );
        vec3 b = tap( vec2(  0.0, -1.0 ) );
        vec3 c = tap( vec2(  1.0, -1.0 ) );
        vec3 d = tap( vec2( -1.0,  0.0 ) );
        vec3 e = tap( vec2(  0.0,  0.0 ) );
        vec3 f = tap( vec2(  1.0,  0.0 ) );
        vec3 g = tap( vec2( -1.0,  1.0 ) );
        vec3 h = tap( vec2(  0.0,  1.0 ) );
        vec3 i = tap( vec2(  1.0,  1.0 ) );

        vec3 mnRGB = min( min( min( d, e ), min( f, b ) ), h );
        vec3 mnRGB2 = min( mnRGB, min( min( a, c ), min( g, i ) ) );
        mnRGB += mnRGB2;

        vec3 mxRGB = max( max( max( d, e ), max( f, b ) ), h );
        vec3 mxRGB2 = max( mxRGB, max( max( a, c ), max( g, i ) ) );
        mxRGB += mxRGB2;

        vec3 rcpM = 1.0 / max( mxRGB, vec3( 1e-4 ) );
        vec3 amp = clamp( min( mnRGB, 2.0 - mxRGB ) * rcpM, 0.0, 1.0 );
        amp = sqrt( amp );

        float peak = -1.0 / mix( 10.0, 5.5, clamp( uSharpness, 0.0, 1.0 ) );
        vec3 w = amp * peak;
        vec3 rcpW = 1.0 / ( 1.0 + 4.0 * w );

        vec3 color = clamp( ( ( b + d + f + h ) * w + e ) * rcpW, 0.0, 1.0 );

        if ( uDither > 0.0 ) {
          // Triangular PDF from two offset IGN samples: flatter noise floor
          // than a single uniform sample, no visible pattern.
          float n1 = interleavedGradientNoise( gl_FragCoord.xy );
          float n2 = interleavedGradientNoise( gl_FragCoord.xy + vec2( 17.0, 41.0 ) );
          color += ( n1 - n2 ) / 255.0;
        }

        gl_FragColor = vec4( color, 1.0 );
      }
    `,
  });
}
