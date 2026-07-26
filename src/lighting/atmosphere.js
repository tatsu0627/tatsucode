import * as THREE from 'three';
import { FOG, SKY, SUN } from '../core/artdirection.js';

/**
 * HEIGHT FOG WITH SUN INSCATTERING.
 *
 * Three's built-in fog is a single uniform-density term with a flat colour. That
 * reads as a grey wash and gives no vertical separation, which is exactly wrong
 * for a dusty compound where the haze pools on the ground.
 *
 * We replace the four fog ShaderChunks globally so *every* built-in material
 * picks this up with no cooperation required from the world/render modules:
 *
 *   fog_pars_vertex / fog_vertex     — additionally carry world position
 *   fog_pars_fragment / fog_fragment — analytic exponential-height fog integral
 *                                      plus a Henyey-Greenstein inscatter tint
 *
 * The optical depth along a view ray through a medium whose density falls off
 * exponentially with height has a closed form:
 *
 *   od = rho0 * exp(-k*(camY - h0)) * (1 - exp(-k*dy)) / (k*dy) * dist
 *
 * which we then shape with 1 - exp(-od^2) to keep the exponential-squared
 * character the art bible specifies.
 *
 * Uniform values live in `sharedFogUniforms` — one object shared by reference
 * across every material, so setTimeOfDay() only has to write it once. Defaults
 * are also stamped into ShaderLib so a material that is created *after* our
 * per-material patch pass still renders correct fog on its first frame.
 */

const fogParsVertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3  vFogWorldPosition;
#endif
`;

const fogVertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	// viewMatrix has no scale, so its inverse rotation is the transpose:
	// ( v * mat3( viewMatrix ) ) == transpose( mat3( viewMatrix ) ) * v
	vFogWorldPosition = cameraPosition + mvPosition.xyz * mat3( viewMatrix );
#endif
`;

const fogParsFragment = /* glsl */`
#ifdef USE_FOG

	uniform vec3  fogColor;
	varying float vFogDepth;
	varying vec3  vFogWorldPosition;

	uniform vec3  hfSunDirection;      // unit vector TOWARD the sun
	uniform vec3  hfInscatterColor;
	uniform vec3  hfAwayColor;
	uniform float hfDensity;
	uniform float hfHeightFalloff;
	uniform float hfGroundLevel;
	uniform float hfInscatterStrength;
	uniform float hfAnisotropy;
	uniform float hfGain;
	uniform float hfMaxOpacity;

	float hfIgn( vec2 p ) {
		return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
	}

	vec3 applyHeightFog( vec3 color, vec3 worldPos ) {

		vec3  v    = worldPos - cameraPosition;
		float dist = length( v );
		if ( dist < 1e-4 ) return color;
		vec3  dir  = v / dist;

		float k  = max( hfHeightFalloff, 1e-4 );
		float dy = v.y;

		float baseline = exp( -k * ( cameraPosition.y - hfGroundLevel ) );

		float heightIntegral;
		float kdy = k * dy;
		if ( abs( kdy ) > 1e-3 ) {
			heightIntegral = ( 1.0 - exp( -kdy ) ) / kdy;
		} else {
			heightIntegral = 1.0 - 0.5 * kdy;      // series expansion, avoids 0/0
		}
		heightIntegral = max( heightIntegral, 0.0 );

		float od = hfDensity * dist * baseline * heightIntegral;
		float fogFactor = 1.0 - exp( - od * od );
		fogFactor = clamp( fogFactor, 0.0, hfMaxOpacity );

		// Directional inscatter: Henyey-Greenstein normalised to 1 in the sun
		// direction so hfInscatterStrength stays an artist-legible 0..1 knob.
		float cosT = dot( dir, hfSunDirection );
		float g    = clamp( hfAnisotropy, 0.0, 0.95 );
		float g2   = g * g;
		float hg   = ( 1.0 - g2 ) / pow( max( 1.0 + g2 - 2.0 * g * cosT, 1e-4 ), 1.5 );
		hg *= ( 1.0 - g ) * ( 1.0 - g ) / ( 1.0 + g );
		float sunAmount = clamp( hg, 0.0, 1.0 );

		// Cool away from the sun, neutral across, warm into it.
		vec3 tint = mix( hfAwayColor, fogColor, smoothstep( -0.55, 0.15, cosT ) );
		tint = mix( tint, hfInscatterColor, sunAmount * hfInscatterStrength );
		tint *= 1.0 + sunAmount * hfGain;

		color = mix( color, tint, fogFactor );

		// Kill 8-bit banding across the huge smooth fog ramps.
		color += ( hfIgn( gl_FragCoord.xy ) - 0.5 ) * 0.0035 * fogFactor;

		return color;
	}

#endif
`;

const fogFragment = /* glsl */`
#ifdef USE_FOG
	gl_FragColor.rgb = applyHeightFog( gl_FragColor.rgb, vFogWorldPosition );
#endif
`;

/** Shared-by-reference uniform objects. Mutate `.value`, never replace. */
export const sharedFogUniforms = {
  hfSunDirection:      { value: new THREE.Vector3(0, 1, 0) },
  hfInscatterColor:    { value: new THREE.Color(FOG.inscatterColor) },
  hfAwayColor:         { value: new THREE.Color(0xffffff) },
  hfDensity:           { value: FOG.density },
  hfHeightFalloff:     { value: FOG.heightFalloff },
  hfGroundLevel:       { value: FOG.groundLevel },
  hfInscatterStrength: { value: FOG.inscatterStrength },
  hfAnisotropy:        { value: 0.62 },
  hfGain:              { value: 0.55 },
  hfMaxOpacity:        { value: 1.0 },
};

// "Away" colour: the fog colour pulled toward the cool zenith of the sky. This
// is what gives the shadow-side of the compound its blue separation.
{
  const away = new THREE.Color(FOG.color);
  const zen = new THREE.Color(SKY.zenith);
  away.lerp(zen, 0.42).multiplyScalar(0.86);
  sharedFogUniforms.hfAwayColor.value.copy(away);
}

let installed = false;

/**
 * Swap the global fog chunks and stamp defaults into every ShaderLib entry that
 * has fog uniforms. Must be called before the first frame is rendered.
 */
export function installHeightFog(scene) {
  if (!installed) {
    THREE.ShaderChunk.fog_pars_vertex = fogParsVertex;
    THREE.ShaderChunk.fog_vertex = fogVertex;
    THREE.ShaderChunk.fog_pars_fragment = fogParsFragment;
    THREE.ShaderChunk.fog_fragment = fogFragment;

    for (const key of Object.keys(THREE.ShaderLib)) {
      const u = THREE.ShaderLib[key].uniforms;
      if (!u || !u.fogColor) continue;
      for (const name of Object.keys(sharedFogUniforms)) {
        if (!u[name]) u[name] = { value: cloneUniformValue(sharedFogUniforms[name].value) };
      }
    }
    installed = true;
  }

  // scene.fog only exists to make three define USE_FOG / FOG_EXP2 and to keep
  // fogColor refreshed; the density term below is never read by our chunk.
  scene.fog = new THREE.FogExp2(FOG.color, FOG.density);
  return scene.fog;
}

function cloneUniformValue(v) {
  if (v && v.isColor) return v.clone();
  if (v && v.isVector3) return v.clone();
  return v;
}

/** Point every fog uniform of `material` at the shared objects. */
export function bindFogUniforms(shader) {
  for (const name of Object.keys(sharedFogUniforms)) {
    shader.uniforms[name] = sharedFogUniforms[name];
  }
}

/** Refresh the ShaderLib defaults so late-created materials are still correct. */
export function syncFogDefaults() {
  for (const key of Object.keys(THREE.ShaderLib)) {
    const u = THREE.ShaderLib[key].uniforms;
    if (!u || !u.fogColor) continue;
    for (const name of Object.keys(sharedFogUniforms)) {
      const src = sharedFogUniforms[name].value;
      if (!u[name]) { u[name] = { value: cloneUniformValue(src) }; continue; }
      const dst = u[name].value;
      if (dst && dst.copy) dst.copy(src); else u[name].value = src;
    }
  }
}

/** Default anisotropy for the aerial-perspective term, derived from the sun. */
export function defaultFogAnisotropy() {
  return THREE.MathUtils.clamp(0.5 + 0.35 * Math.sin(THREE.MathUtils.degToRad(SUN.elevation)), 0.4, 0.8);
}
