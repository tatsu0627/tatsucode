import * as THREE from 'three';
import { SKY, FOG, SUN } from '../core/artdirection.js';

/**
 * PHYSICAL SKY — Preetham analytic daylight model.
 *
 * Adapted from three/examples/jsm/objects/Sky.js (Preetham et al., "A Practical
 * Analytic Model for Daylight"). We do not use the stock class directly because
 * we need four things it does not offer:
 *
 *   1. A ground hemisphere. The stock sky is black below the horizon, which
 *      makes a PMREM of it produce a "studio from above, void from below" IBL.
 *      A desert compound needs warm sand bounce from below or every downward
 *      facing surface reads as dead black.
 *   2. A horizon haze band that blends into FOG.color, so the analytic sky and
 *      the height fog meet at the horizon instead of showing a hard seam where
 *      the ground plane ends.
 *   3. A tameable sun disc (the stock one is ~7e5 nits and clips to a hard white
 *      dot without a bloom pass in front of it).
 *   4. Ordered dithering on output — an 8-bit backbuffer shows very obvious
 *      banding across a smooth sky gradient otherwise.
 *
 * Everything is driven from SKY.* / SUN.* in the art bible.
 */

const skyVertex = /* glsl */`
  uniform vec3  sunPosition;
  uniform float rayleigh;
  uniform float turbidity;
  uniform float mieCoefficient;

  varying vec3  vWorldPosition;
  varying vec3  vSunDirection;
  varying float vSunfade;
  varying vec3  vBetaR;
  varying vec3  vBetaM;
  varying float vSunE;

  const float e  = 2.718281828459045;
  const float pi = 3.141592653589793;

  // Preetham primaries.
  const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
  const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );

  const float cutoffAngle = 1.6110731556870734;
  const float steepness   = 1.5;
  const float EE          = 1000.0;

  float sunIntensity( float zenithAngleCos ) {
    zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
    return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
  }

  vec3 totalMie( float T ) {
    float c = ( 0.2 * T ) * 10E-18;
    return 0.434 * c * MieConst;
  }

  void main() {
    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
    vWorldPosition = worldPosition.xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    gl_Position.z = gl_Position.w; // pin to the far plane

    vSunDirection = normalize( sunPosition );
    vSunE = sunIntensity( vSunDirection.y );
    vSunfade = 1.0 - clamp( 1.0 - exp( sunPosition.y / 450000.0 ), 0.0, 1.0 );

    float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );
    vBetaR = totalRayleigh * rayleighCoefficient;
    vBetaM = totalMie( turbidity ) * mieCoefficient;
  }
`;

const skyFragment = /* glsl */`
  varying vec3  vWorldPosition;
  varying vec3  vSunDirection;
  varying vec3  vBetaR;
  varying vec3  vBetaM;
  varying float vSunE;

  uniform float mieDirectionalG;
  uniform float skyIntensity;
  uniform float sunDiscIntensity;
  uniform float showSunDisc;
  uniform vec3  groundColor;
  uniform vec3  hazeColor;
  uniform float hazeIntensity;
  uniform float hazeFalloff;
  uniform float ditherStrength;

  const float pi = 3.141592653589793;
  const float rayleighZenithLength = 8.4E3;
  const float mieZenithLength      = 1.25E3;
  const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
  const float ONE_OVER_FOURPI      = 0.07957747154594767;

  float rayleighPhase( float cosTheta ) {
    return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) );
  }

  float hgPhase( float cosTheta, float g ) {
    float g2 = g * g;
    float inv = 1.0 / pow( max( 1.0 - 2.0 * g * cosTheta + g2, 1e-4 ), 1.5 );
    return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inv );
  }

  // Interleaved gradient noise — cheap, blue-noise-like, kills gradient banding.
  float ign( vec2 p ) {
    return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
  }

  void main() {
    vec3 direction = normalize( vWorldPosition - cameraPosition );
    float upDot = direction.y;

    // ---- Preetham in-scattering, evaluated on the upper hemisphere ----------
    float zenithAngle = acos( max( 0.0, upDot ) );
    float inv = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
    float sR = rayleighZenithLength * inv;
    float sM = mieZenithLength * inv;

    vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );

    float cosTheta = dot( direction, vSunDirection );
    vec3 betaRTheta = vBetaR * rayleighPhase( cosTheta * 0.5 + 0.5 );
    vec3 betaMTheta = vBetaM * hgPhase( cosTheta, mieDirectionalG );

    vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
    Lin *= mix(
      vec3( 1.0 ),
      pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 0.5 ) ),
      clamp( pow( 1.0 - vSunDirection.y, 5.0 ), 0.0, 1.0 )
    );

    vec3 L0 = vec3( 0.1 ) * Fex;

    // Sun disc — widened a touch and energy-scaled so it reads as a hazy golden
    // hour sun rather than a clipped white pixel when no bloom pass is present.
    float sunAngular = 0.99975;
    float disc = smoothstep( sunAngular, sunAngular + 0.00035, cosTheta ) * showSunDisc;
    L0 += ( vSunE * 19000.0 * Fex ) * disc * sunDiscIntensity;

    vec3 sky = ( Lin + L0 ) * 0.04;

    // ---- Ground hemisphere -------------------------------------------------
    // Sand bounce: albedo * (sky irradiance near horizon + direct sun). This is
    // what feeds warm light into the underside of everything through the IBL.
    vec3 horizonSky = Lin * 0.04;
    vec3 bounce = groundColor * ( horizonSky * 0.85 + vec3( 1.0, 0.82, 0.62 ) * max( vSunDirection.y, 0.0 ) * 1.35 );

    float horizonMix = smoothstep( -0.045, 0.02, upDot );
    vec3 color = mix( bounce, sky, horizonMix );

    // ---- Horizon haze: marry the sky to the height fog ---------------------
    float haze = exp( -max( upDot, 0.0 ) * hazeFalloff );
    haze *= smoothstep( -0.30, -0.02, upDot );   // fade out well below the horizon
    color = mix( color, hazeColor * hazeIntensity, haze );

    color *= skyIntensity;

    gl_FragColor = vec4( color, 1.0 );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // Ordered dither, applied in output space where the quantisation happens.
    gl_FragColor.rgb += ( ign( gl_FragCoord.xy ) - 0.5 ) * ditherStrength;
  }
`;

export class PhysicalSky {
  /**
   * @param {object} [opts]
   * @param {number} [opts.skyIntensity]  master radiance scale (see notes below)
   */
  constructor(opts = {}) {
    const haze = new THREE.Color(FOG.color);
    const ground = new THREE.Color(SKY.ground);

    this.uniforms = {
      turbidity:        { value: SKY.turbidity },
      rayleigh:         { value: SKY.rayleigh },
      mieCoefficient:   { value: SKY.mieCoefficient },
      mieDirectionalG:  { value: SKY.mieDirectionalG },
      sunPosition:      { value: new THREE.Vector3(0, 0.2, -1) },
      skyIntensity:     { value: opts.skyIntensity ?? 0.62 },
      sunDiscIntensity: { value: opts.sunDiscIntensity ?? 0.0075 },
      showSunDisc:      { value: 1 },
      groundColor:      { value: ground },
      hazeColor:        { value: haze },
      hazeIntensity:    { value: opts.hazeIntensity ?? 1.55 },
      hazeFalloff:      { value: opts.hazeFalloff ?? 11.0 },
      ditherStrength:   { value: 1.6 / 255.0 },
    };

    this.material = new THREE.ShaderMaterial({
      name: 'PhysicalSky',
      uniforms: this.uniforms,
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.mesh.name = 'sky';
    this.mesh.scale.setScalar(4000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;   // drawn before everything else
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  /** @param {THREE.Vector3} dir unit vector pointing FROM the scene TOWARD the sun */
  setSunDirection(dir) {
    this.uniforms.sunPosition.value.copy(dir).multiplyScalar(450000);
  }

  set showSunDisc(v) { this.uniforms.showSunDisc.value = v ? 1 : 0; }
  get showSunDisc() { return this.uniforms.showSunDisc.value === 1; }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Approximate hemispherical irradiance of the sky above/below, sampled on the
 * CPU from the same analytic model so other systems (fog tint, volumetric
 * ambient) stay consistent with the IBL without reading back the GPU.
 * Cheap 2-band approximation, good enough for tinting.
 */
export function skyAmbientColors(sunDir) {
  const el = Math.max(sunDir.y, 0.0);
  // Zenith stays cool; the horizon warms hard as the sun drops.
  const warm = Math.pow(1.0 - el, 2.2);
  const zenith = new THREE.Color(SKY.zenith);
  const horizon = new THREE.Color(SKY.horizon);
  const above = zenith.clone().lerp(horizon, warm * 0.55);
  const below = new THREE.Color(SKY.ground)
    .multiply(new THREE.Color(SUN.color))
    .multiplyScalar(2.0 + el);
  return { above, below };
}
