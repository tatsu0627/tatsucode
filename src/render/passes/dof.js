import * as THREE from 'three';
import { FullscreenPass } from '../postchain.js';
import { GLSL_DEPTH, GLSL_NOISE } from '../shaderlib.js';

/**
 * Near-field depth of field.
 *
 * This is a shooter, not a photograph: blurring the distance would hide the
 * thing the player is trying to shoot. So only the near side of the circle of
 * confusion is kept, using the thin-lens shape CoC ∝ (focus/dist - 1). That
 * falls off hyperbolically — strong inside arm's reach, gone by a few metres,
 * exactly zero at and beyond the focal plane.
 *
 * Viewmodel pixels are excluded: their depth comes from the world behind them
 * (they are rendered with their own near-plane camera and never enter the
 * G-buffer), so their CoC would be meaningless.
 */
export function createDofPass({ samples = 16 } = {}) {
  return new FullscreenPass({
    name: 'NearFieldDOF',
    defines: { SAMPLES: samples },
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tVelocity: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uResolution: { value: new THREE.Vector2() },
      uNear: { value: 0.02 },
      uFar: { value: 1200 },
      uFocus: { value: 12 },
      uAperture: { value: 0.9 },
      uMaxBlur: { value: 0.007 },
      uFrame: { value: 0 },
    },
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform highp sampler2D tDepth;
      uniform sampler2D tVelocity;
      uniform vec2 uTexel;
      uniform vec2 uResolution;
      uniform float uNear;
      uniform float uFar;
      uniform float uFocus;
      uniform float uAperture;
      uniform float uMaxBlur;
      uniform float uFrame;
      varying vec2 vUv;

      ${GLSL_DEPTH}
      ${GLSL_NOISE}

      float cocAt( vec2 uv ) {
        float d = linearizeDepth( texture2D( tDepth, uv ).x, uNear, uFar );
        // Near side only. Thin-lens shape, clamped.
        return clamp( ( uFocus / max( d, 0.02 ) - 1.0 ) * uAperture * 0.055, 0.0, 1.0 );
      }

      void main() {
        vec3 center = texture2D( tDiffuse, vUv ).rgb;
        float viewmodel = texture2D( tVelocity, vUv ).b;

        float coc = cocAt( vUv ) * ( 1.0 - viewmodel );
        float radiusPx = coc * uMaxBlur * uResolution.y;

        if ( radiusPx < 0.75 ) {
          gl_FragColor = vec4( center, 1.0 );
          return;
        }

        float angleOffset = interleavedGradientNoise( gl_FragCoord.xy + uFrame * 3.1717 ) * 6.2831853;

        vec3 acc = center;
        float wsum = 1.0;

        // Golden-angle spiral — even coverage without a lookup table.
        for ( int i = 1; i <= SAMPLES; i++ ) {
          float fi = float( i );
          float r = sqrt( fi / float( SAMPLES ) );
          float a = fi * 2.39996323 + angleOffset;
          vec2 offset = vec2( cos( a ), sin( a ) ) * r * radiusPx * uTexel;
          vec2 uv = vUv + offset;

          float tapCoc = cocAt( uv );
          // A near, blurry sample must be allowed to spread onto sharper
          // neighbours, otherwise the foreground gets a hard cut-out edge.
          float w = smoothstep( 0.0, 0.35, max( tapCoc, coc ) - r * coc * 0.5 );

          acc += texture2D( tDiffuse, uv ).rgb * w;
          wsum += w;
        }

        gl_FragColor = vec4( acc / wsum, 1.0 );
      }
    `,
  });
}
