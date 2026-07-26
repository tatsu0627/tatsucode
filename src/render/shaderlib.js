/**
 * Shared GLSL fragments for the post chain.
 *
 * Everything here assumes:
 *   - a linear HDR working space (HalfFloat render targets) until the composite pass
 *   - a hardware depth texture bound as `tDepth`, sampled with `.x` (window depth 0..1)
 *   - view-space normals packed as `n * 0.5 + 0.5` in the G-buffer RGB
 *
 * Uniform declarations are NOT included so each pass can name its own; the
 * snippets below only define functions that take everything as arguments.
 */

/** Depth helpers. Requires the caller to supply near/far. */
export const GLSL_DEPTH = /* glsl */ `
float linearizeDepth( const in float d, const in float near, const in float far ) {
  // window depth -> positive view-space distance along -Z
  return ( near * far ) / ( far - d * ( far - near ) );
}
float viewZFromDepth( const in float d, const in float near, const in float far ) {
  return -linearizeDepth( d, near, far );
}
`;

/**
 * Reconstruct a homogeneous world position from UV + window depth.
 * Deliberately does NOT divide by w: keeping it homogeneous lets the caller
 * chain another projection (reprojection) without blowing up at the far plane.
 */
export const GLSL_RECONSTRUCT = /* glsl */ `
vec4 worldFromDepthH( const in vec2 uv, const in float depth, const in mat4 invViewProj ) {
  vec4 clip = vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
  return invViewProj * clip;
}
vec3 viewFromDepth( const in vec2 uv, const in float depth, const in mat4 invProj ) {
  vec4 clip = vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
  vec4 v = invProj * clip;
  return v.xyz / v.w;
}
`;

/** Colour space / perceptual helpers. */
export const GLSL_COLOR = /* glsl */ `
float luminance( const in vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

vec3 RGBToYCoCg( const in vec3 c ) {
  return vec3(
     0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
     0.5  * c.r             - 0.5  * c.b,
    -0.25 * c.r + 0.5 * c.g - 0.25 * c.b
  );
}
vec3 YCoCgToRGB( const in vec3 c ) {
  return vec3( c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z );
}

// Reversible range compression (Lottes). Keeps HDR fireflies from smearing
// through any filter that averages neighbours.
vec3 rangeCompress( const in vec3 c ) {
  return c / ( 1.0 + max( max( c.r, c.g ), c.b ) );
}
vec3 rangeExpand( const in vec3 c ) {
  return c / max( 1e-4, 1.0 - max( max( c.r, c.g ), c.b ) );
}

vec3 linearToSRGB( const in vec3 c ) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow( max( c, vec3( 1e-5 ) ), vec3( 0.41666 ) ) - 0.055;
  return mix( lo, hi, step( vec3( 0.0031308 ), c ) );
}
`;

/**
 * ACES filmic, matching three's ACESFilmicToneMapping (Stephen Hill's fit).
 * Reimplemented here rather than using renderer.toneMapping because the
 * composite pass owns exposure and needs the tonemapped result *before*
 * grain / chromatic / vignette, per POST.order in the art bible.
 */
export const GLSL_ACES = /* glsl */ `
const mat3 ACESInputMat = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777
);
const mat3 ACESOutputMat = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602
);
vec3 RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 ACESFilmic( vec3 color ) {
  color *= 1.0 / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit( color );
  color = ACESOutputMat * color;
  return clamp( color, 0.0, 1.0 );
}
`;

/** Cheap high quality hash noise, used for grain and sampling jitter. */
export const GLSL_NOISE = /* glsl */ `
float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}
vec2 hash22( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}
// Interleaved gradient noise — the standard temporal-friendly dither kernel.
float interleavedGradientNoise( vec2 pix ) {
  return fract( 52.9829189 * fract( dot( pix, vec2( 0.06711056, 0.00583715 ) ) ) );
}
`;

/** The vertex shader every fullscreen pass uses. */
export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/** Halton low-discrepancy sequence, used for the TAA jitter pattern. */
export function halton(index, base) {
  let f = 1;
  let r = 0;
  let i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

/** N jitter offsets in [-0.5, 0.5] pixel units. */
export function haltonJitterSequence(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push([halton(i, 2) - 0.5, halton(i, 3) - 0.5]);
  }
  return out;
}
