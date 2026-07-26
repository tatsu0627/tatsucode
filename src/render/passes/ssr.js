import * as THREE from 'three';
import { FullscreenPass } from '../postchain.js';
import { GLSL_DEPTH, GLSL_RECONSTRUCT, GLSL_NOISE } from '../shaderlib.js';

/**
 * Screen-space reflections.
 *
 * OFF BY DEFAULT — see the note in render.js. Kept because it is correct and
 * cheap to re-enable once the world module publishes a roughness/metalness
 * G-buffer, but it cannot be trusted without one.
 *
 * View-space ray march with a coarse pass plus a binary refinement, a thickness
 * test so rays do not tunnel behind thin geometry, and fades on screen edge,
 * ray length, and rays pointing back at the camera (where screen space simply
 * has no information).
 *
 * `uSelector` biases the effect toward up-facing surfaces — the wet-ground case
 * that reads well without per-pixel roughness. At 0 it applies everywhere,
 * which without a roughness buffer means reflecting rough concrete like a
 * mirror, so don't.
 */
export function createSsrPass({ steps = 24, refineSteps = 5 } = {}) {
  return new FullscreenPass({
    name: 'SSR',
    defines: { STEPS: steps, REFINE_STEPS: refineSteps },
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      tNormal: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uResolution: { value: new THREE.Vector2() },
      uProj: { value: new THREE.Matrix4() },
      uInvProj: { value: new THREE.Matrix4() },
      uViewMatrix: { value: new THREE.Matrix4() },
      uNear: { value: 0.02 },
      uFar: { value: 1200 },
      uMaxDistance: { value: 24 },
      uThickness: { value: 0.35 },
      uIntensity: { value: 0.55 },
      uSelector: { value: 1 },
      uFrame: { value: 0 },
    },
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform highp sampler2D tDepth;
      uniform sampler2D tNormal;
      uniform vec2 uTexel;
      uniform vec2 uResolution;
      uniform mat4 uProj;
      uniform mat4 uInvProj;
      uniform mat4 uViewMatrix;
      uniform float uNear;
      uniform float uFar;
      uniform float uMaxDistance;
      uniform float uThickness;
      uniform float uIntensity;
      uniform float uSelector;
      uniform float uFrame;
      varying vec2 vUv;

      ${GLSL_DEPTH}
      ${GLSL_RECONSTRUCT}
      ${GLSL_NOISE}

      float sceneViewZ( vec2 uv ) {
        return -linearizeDepth( texture2D( tDepth, uv ).x, uNear, uFar );
      }

      vec2 projectUv( vec3 viewPos ) {
        vec4 clip = uProj * vec4( viewPos, 1.0 );
        return ( clip.xy / clip.w ) * 0.5 + 0.5;
      }

      void main() {
        vec3 base = texture2D( tDiffuse, vUv ).rgb;
        float rawDepth = texture2D( tDepth, vUv ).x;

        if ( rawDepth >= 1.0 ) { gl_FragColor = vec4( base, 1.0 ); return; }

        vec3 N = normalize( texture2D( tNormal, vUv ).xyz * 2.0 - 1.0 );
        vec3 P = viewFromDepth( vUv, rawDepth, uInvProj );
        vec3 V = normalize( P );
        vec3 R = normalize( reflect( V, N ) );

        // Surface selector: world-space up-facing only, unless disabled.
        vec3 worldN = normalize( ( vec4( N, 0.0 ) * uViewMatrix ).xyz );
        float surfaceMask = mix( 1.0, smoothstep( 0.82, 0.96, worldN.y ), uSelector );
        if ( surfaceMask <= 0.001 ) { gl_FragColor = vec4( base, 1.0 ); return; }

        float jitter = interleavedGradientNoise( gl_FragCoord.xy + uFrame * 7.919 );
        float stepLen = uMaxDistance / float( STEPS );

        vec3 rayPos = P + N * 0.03 + R * stepLen * ( 0.5 + jitter * 0.5 );
        vec3 hitPos = rayPos;
        bool hit = false;

        for ( int i = 0; i < STEPS; i++ ) {
          rayPos += R * stepLen;
          if ( rayPos.z > -uNear ) break;

          vec2 uv = projectUv( rayPos );
          if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) break;

          float sz = sceneViewZ( uv );
          float delta = sz - rayPos.z;           // >0 once the ray is behind geometry
          if ( delta > 0.0 && delta < uThickness + stepLen ) { hit = true; hitPos = rayPos; break; }
        }

        if ( !hit ) { gl_FragColor = vec4( base, 1.0 ); return; }

        // Binary refinement back along the last step.
        vec3 lo = hitPos - R * stepLen;
        vec3 hi = hitPos;
        for ( int i = 0; i < REFINE_STEPS; i++ ) {
          vec3 mid = ( lo + hi ) * 0.5;
          vec2 uv = projectUv( mid );
          float sz = sceneViewZ( uv );
          if ( sz - mid.z > 0.0 ) hi = mid; else lo = mid;
        }
        vec3 finalPos = hi;
        vec2 hitUv = projectUv( finalPos );

        float sz = sceneViewZ( hitUv );
        if ( sz - finalPos.z > uThickness ) { gl_FragColor = vec4( base, 1.0 ); return; }

        // Fades.
        vec2 edge = smoothstep( vec2( 0.0 ), vec2( 0.12 ), hitUv ) *
                    smoothstep( vec2( 0.0 ), vec2( 0.12 ), 1.0 - hitUv );
        float edgeFade = edge.x * edge.y;
        float distFade = 1.0 - smoothstep( 0.5, 1.0, distance( finalPos, P ) / uMaxDistance );
        float backFade = smoothstep( 0.0, 0.35, -R.z * 0.5 + 0.5 );
        float fresnel = pow( clamp( 1.0 - dot( -V, N ), 0.0, 1.0 ), 4.0 );
        fresnel = mix( 0.04, 1.0, fresnel );

        vec3 reflected = texture2D( tDiffuse, hitUv ).rgb;
        float w = edgeFade * distFade * backFade * fresnel * surfaceMask * uIntensity;

        gl_FragColor = vec4( base + reflected * w, 1.0 );
      }
    `,
  });
}
