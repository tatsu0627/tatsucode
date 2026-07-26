import * as THREE from 'three';
import { FullscreenPass } from '../postchain.js';
import { GLSL_ACES, GLSL_COLOR, GLSL_NOISE } from '../shaderlib.js';

/**
 * The composite / output stage: exposure -> ACES -> grain -> chromatic
 * aberration -> vignette -> sRGB, in exactly the order POST.order specifies.
 *
 * These are folded into one shader rather than four passes because each one is
 * a handful of ALU on an already-bandwidth-bound fullscreen quad; four separate
 * HDR round trips would cost more than the effects themselves. The ordering
 * semantics are preserved exactly — in particular the chromatic split samples
 * three tonemapped values, so it is genuinely operating on the tonemapped image
 * and not on HDR radiance.
 *
 * Chromatic aberration is radial and scales with r^2, so it is literally zero
 * at the centre of frame and only ever a fraction of a pixel at the corners.
 * A uniform RGB split across the whole frame is the single most recognisable
 * "WebGL demo" tell.
 */
export function createCompositePass() {
  return new FullscreenPass({
    name: 'Composite',
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2() },
      uTexel: { value: new THREE.Vector2() },
      uExposure: { value: 1.05 },
      uGrain: { value: 0.035 },
      uChromatic: { value: 0.0016 },
      uVignetteStrength: { value: 0.34 },
      uVignetteSmooth: { value: 0.55 },
      uContrast: { value: 1.0 },
      uSaturation: { value: 1.0 },
      uShadowLift: { value: 0.0 },
      uShadowTint: { value: new THREE.Color(1, 1, 1) },
      uTime: { value: 0 },
      uDither: { value: 0 },
    },
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 uResolution;
      uniform float uExposure;
      uniform float uGrain;
      uniform float uChromatic;
      uniform float uVignetteStrength;
      uniform float uVignetteSmooth;
      uniform float uContrast;
      uniform float uSaturation;
      uniform float uShadowLift;
      uniform vec3 uShadowTint;
      uniform float uTime;
      uniform float uDither;
      varying vec2 vUv;

      ${GLSL_COLOR}
      ${GLSL_ACES}
      ${GLSL_NOISE}

      vec3 tonemapAt( vec2 uv ) {
        vec3 hdr = max( texture2D( tDiffuse, uv ).rgb, vec3( 0.0 ) );
        return ACESFilmic( hdr * uExposure );
      }

      void main() {
        vec2 uv = vUv;
        vec2 centred = uv - 0.5;
        float r2 = dot( centred, centred ) * 4.0;   // 0 at centre, ~1 at edge mid

        // --- tonemap (+ chromatic aberration, edges only) ---
        vec3 color;
        if ( uChromatic > 0.0 ) {
          vec2 offset = centred * uChromatic * r2;
          color = vec3(
            tonemapAt( uv + offset ).r,
            tonemapAt( uv ).g,
            tonemapAt( uv - offset ).b
          );
        } else {
          color = tonemapAt( uv );
        }

        // --- shadow lift ---
        // Placed immediately after the tonemap and before grain, so the grain
        // sits on top of the lifted blacks rather than being the only thing
        // living down there. (1-x)^4 confines it to roughly the bottom stop.
        if ( uShadowLift > 0.0 ) {
          vec3 toe = vec3( 1.0 ) - clamp( color, 0.0, 1.0 );
          color += uShadowLift * uShadowTint * ( toe * toe * toe * toe );
        }

        // --- look trim ---
        // NOTE: these belong in POST in the art bible once it grows the keys;
        // they are read from POST.look with these values as the fallback.
        if ( uSaturation != 1.0 ) {
          float l = luminance( color );
          color = mix( vec3( l ), color, uSaturation );
        }
        if ( uContrast != 1.0 ) {
          color = clamp( ( color - 0.5 ) * uContrast + 0.5, 0.0, 1.0 );
        }

        // --- film grain ---
        // Strongest in the midtones, as on real stock; grain in the deep
        // shadows just reads as sensor noise.
        float g = hash12( gl_FragCoord.xy + vec2( uTime * 61.7, uTime * 37.3 ) ) - 0.5;
        float lum = luminance( color );
        float response = mix( 0.3, 1.0, 1.0 - abs( lum * 2.0 - 1.0 ) );
        color += g * uGrain * response;

        // --- vignette ---
        float d = length( centred ) * 1.41421356;
        color *= 1.0 - uVignetteStrength * smoothstep( uVignetteSmooth, 1.0, d );

        color = clamp( color, 0.0, 1.0 );
        color = linearToSRGB( color );

        // Only the final pass in the chain dithers, immediately before the
        // 8-bit write. Ordered dither here would be quantised twice.
        if ( uDither > 0.0 ) {
          float n = interleavedGradientNoise( gl_FragCoord.xy );
          color += ( n - 0.5 ) / 255.0;
        }

        gl_FragColor = vec4( color, 1.0 );
      }
    `,
  });
}
