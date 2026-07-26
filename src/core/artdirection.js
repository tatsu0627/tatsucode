/**
 * ART DIRECTION BIBLE — single source of truth for the look.
 *
 * Every module that creates geometry, lights, or materials MUST read from here
 * rather than hardcoding values. Parallel work on the world, the lighting and
 * the post chain only composes into one coherent image if all three agree on
 * scale, exposure and the physical meaning of the numbers.
 *
 * SCENE: "Blacksite" — a fortified desert compound at late-afternoon golden
 * hour. Warm low sun raking across cold concrete and sand, heavy haze in the
 * air, strong directional shadows. The mood reference is the harsh, sun-bleached
 * palette of a modern military shooter: desaturated base, warm key, cool bounce.
 */

// ---------------------------------------------------------------------------
// UNITS
// ---------------------------------------------------------------------------
// One world unit is one metre. Nothing may deviate from this — the physically
// based lighting, the fog falloff and the camera near/far all assume it.
export const METRE = 1;
export const EYE_HEIGHT = 1.68;       // standing camera height
export const CROUCH_HEIGHT = 1.05;
export const PLAYER_RADIUS = 0.35;

// ---------------------------------------------------------------------------
// EXPOSURE / TONEMAPPING
// ---------------------------------------------------------------------------
// The renderer runs ACES filmic at this exposure. Light intensities below are
// authored against it; do not "fix" a dark material by raising exposure.
export const EXPOSURE = 1.05;

// ---------------------------------------------------------------------------
// SUN — the key light. Low, warm, and strong enough to blow out sky-facing
// surfaces slightly, which is what sells golden hour.
// ---------------------------------------------------------------------------
export const SUN = {
  // Azimuth/elevation in degrees. Low elevation gives long raking shadows and
  // lets the volumetric shafts read against the architecture.
  azimuth: 118,
  elevation: 10.5,
  color: 0xffd9a8,
  intensity: 5.2,
  // Shadow cascades: near cascade is tight for viewmodel-adjacent contact
  // shadows, far cascade covers the play space.
  cascades: [8, 24, 70, 180],
  shadowMapSize: 2048,
  shadowBias: -0.0004,
  normalBias: 0.02,
};

// Ambient / sky contribution. Cool to contrast the warm key — this separation
// is most of what makes a scene read as "lit" rather than "flat".
export const SKY = {
  zenith: 0x6f9fd8,
  horizon: 0xd8c4a4,
  ground: 0x4a3f33,
  // Deliberately low. The PMREM environment map generated from this same sky
  // already supplies image-based ambient; a hemisphere light on top of it
  // double-counts the ambient term and flattens the image until nothing has a
  // clear light side and shadow side. This is a small directional fill only.
  ambientIntensity: 0.34,
  // How much the IBL contributes. The sun is the key and must dominate.
  environmentIntensity: 0.7,
  turbidity: 6.2,
  rayleigh: 1.4,
  mieCoefficient: 0.008,
  mieDirectionalG: 0.82,
};

// ---------------------------------------------------------------------------
// ATMOSPHERE — haze is doing enormous work here. Depth cueing separates
// foreground/midground/background and is the cheapest "expensive" look there is.
// ---------------------------------------------------------------------------
export const FOG = {
  color: 0xc9b79a,
  density: 0.016,           // exponential-squared
  heightFalloff: 0.055,     // denser near the ground
  groundLevel: -1.0,
  inscatterColor: 0xffcf9b, // sun-facing haze goes warm
  inscatterStrength: 0.7,
};

export const VOLUMETRIC = {
  enabled: true,
  density: 0.035,
  steps: 48,
  jitter: true,             // blue-noise offset, required or banding is visible
  anisotropy: 0.72,
};

// ---------------------------------------------------------------------------
// PALETTE — albedo values only. Physically plausible: real-world albedo almost
// never goes below 0.02 or above 0.9. Anything outside that reads as fake.
// ---------------------------------------------------------------------------
export const PALETTE = {
  concrete:     0x8f8b83,
  concreteDark: 0x605d58,
  sand:         0xbfa984,
  sandDark:     0x8d7a5c,
  rust:         0x7a4a2c,
  steel:        0x8a8f94,
  paintedGreen: 0x5a6350,
  paintedTan:   0xa8916b,
  asphalt:      0x565350,
  woodCrate:    0x9b7a4e,
  sandbag:      0xa89573,
  glass:        0x2a3238,
};

// PBR authoring rules every material must follow:
//  - metalness is 0 or 1, never in between (except at rust/paint transitions)
//  - roughness never below 0.08 (nothing in the real world is a perfect mirror)
//  - every surface gets normal + roughness variation; flat roughness is the
//    single biggest giveaway of amateur real-time art
export const PBR = {
  minRoughness: 0.08,
  envMapIntensity: 1.0,
  // Detail normal tiling for close-up surface breakup.
  detailNormalScale: 0.35,
  detailNormalTiling: 12.0,
};

// ---------------------------------------------------------------------------
// CAMERA / VIEWMODEL
// ---------------------------------------------------------------------------
export const CAMERA = {
  fovHip: 80,
  fovAds: 55,
  fovSprint: 86,
  near: 0.02,
  far: 1200,
  // The viewmodel renders with its own narrower FOV on a separate layer so it
  // never intersects world geometry — standard FPS practice.
  viewmodelFov: 58,
  viewmodelLayer: 1,
};

// ---------------------------------------------------------------------------
// POST CHAIN — ordering matters and is fixed. Agents may tune values, not order.
// ---------------------------------------------------------------------------
export const POST = {
  order: ['gbuffer', 'ssao', 'lighting', 'ssr', 'volumetric', 'taa', 'motionblur',
          'bloom', 'dof', 'tonemap', 'grain', 'chromatic', 'vignette', 'sharpen'],
  bloom: { threshold: 1.5, strength: 0.28, radius: 0.6 },
  ssao: { radius: 1.2, intensity: 1.5, bias: 0.025 },
  motionBlur: { strength: 0.55, samples: 12 },
  dof: { enabled: true, focusDistance: 14, aperture: 0.30, maxBlur: 0.0035 },
  grain: { strength: 0.035 },      // subtle; heavy grain reads as a filter, not film
  chromatic: { strength: 0.0016 }, // barely perceptible at the edges only
  vignette: { strength: 0.22, smoothness: 0.6 },
  sharpen: { strength: 0.14 },     // counteracts TAA softness without ringing thin edges
  // Shadow lift, applied after the tonemap. ACES has a hard toe, and shadowed
  // asphalt under this sun was measuring 4-6/255 with no separation left in it
  // — a black hole in the lower third of the frame. Every shipping game grade
  // lifts the black point off zero for exactly this reason; film never reaches
  // it either. `strength` is where absolute black lands, and the lift falls off
  // as (1-x)^4 so it never touches midtones or highlights.
  //
  // The tint is the point as much as the lift: the only light reaching a
  // shadowed surface here is sky, so those pixels should read cool against the
  // warm key. A neutral grey lift would raise the level and still look wrong.
  grade: { shadowLift: 0.055, shadowTint: 0x9fb6d8 },
};

// Degrees -> the sun's world-space direction, shared by lighting and any shader
// that needs it (volumetrics, fog inscatter, sky).
export function sunDirection() {
  const az = (SUN.azimuth * Math.PI) / 180;
  const el = (SUN.elevation * Math.PI) / 180;
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.sin(el),
    z: Math.cos(el) * Math.cos(az),
  };
}
