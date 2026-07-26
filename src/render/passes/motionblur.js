import * as THREE from 'three';
import { FullscreenPass } from '../postchain.js';
import { GLSL_NOISE } from '../shaderlib.js';

/**
 * Camera-velocity motion blur.
 *
 * Reconstruction filter over the velocity buffer: taps are spread along the
 * pixel's motion vector and rejected when they come from geometry that is
 * clearly behind the centre sample, which is what stops the background from
 * smearing across a stationary foreground silhouette.
 *
 * The tap pattern is offset per-pixel with interleaved gradient noise; without
 * that, a 12-tap blur bands into visible ghost copies of high-contrast edges.
 * TAA then eats the residual noise.
 *
 * Viewmodel pixels are masked out — the weapon is camera-locked, so blurring it
 * with the camera's own motion is simply wrong.
 */
export function createMotionBlurPass({ samples = 12 } = {}) {
  const pass = new FullscreenPass({
    name: 'MotionBlur',
    defines: { SAMPLES: samples },
    uniforms: {
      tDiffuse: { value: null },
      tVelocity: { value: null },
      tDepth: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uResolution: { value: new THREE.Vector2() },
      uStrength: { value: 0.55 },
      uMaxBlur: { value: 0.045 },
      uFrame: { value: 0 },
    },
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tVelocity;
      uniform highp sampler2D tDepth;
      uniform vec2 uTexel;
      uniform vec2 uResolution;
      uniform float uStrength;
      uniform float uMaxBlur;
      uniform float uFrame;
      varying vec2 vUv;

      ${GLSL_NOISE}

      void main() {
        vec4 v = texture2D( tVelocity, vUv );
        vec3 center = texture2D( tDiffuse, vUv ).rgb;

        // Camera-locked geometry does not move on screen.
        vec2 velocity = v.xy * uStrength * ( 1.0 - v.b );

        float len = length( velocity );
        if ( len < uTexel.x * 0.75 ) {
          gl_FragColor = vec4( center, 1.0 );
          return;
        }

        if ( len > uMaxBlur ) velocity *= uMaxBlur / len;

        float centerDepth = texture2D( tDepth, vUv ).x;
        float jitter = interleavedGradientNoise( gl_FragCoord.xy + uFrame * 5.588238 );

        vec3 acc = vec3( 0.0 );
        float wsum = 0.0;

        for ( int i = 0; i < SAMPLES; i++ ) {
          float t = ( ( float( i ) + jitter ) / float( SAMPLES ) ) - 0.5;
          vec2 uv = vUv + velocity * t;
          if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) continue;

          float d = texture2D( tDepth, uv ).x;
          // Reject samples that sit clearly behind the centre pixel.
          float depthWeight = 1.0 - smoothstep( 0.0, 0.004, d - centerDepth );
          float w = mix( 0.25, 1.0, depthWeight );

          acc += texture2D( tDiffuse, uv ).rgb * w;
          wsum += w;
        }

        gl_FragColor = vec4( wsum > 0.0 ? acc / wsum : center, 1.0 );
      }
    `,
  });
  return pass;
}
