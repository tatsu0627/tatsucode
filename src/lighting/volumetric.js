import * as THREE from 'three';
import { VOLUMETRIC, FOG, SUN } from '../core/artdirection.js';

/**
 * RAYMARCHED VOLUMETRIC LIGHTING (god rays through dusty air).
 *
 * Front-to-back single-scattering raymarch, depth-aware (the march terminates on
 * the scene's depth buffer) and shadow-aware (each sample tests the cascaded
 * shadow maps, so a doorway or a container gap carves a real shaft out of the
 * medium). Integration is the energy-conserving analytic form
 *
 *     Sint = ( S - S * exp( -sigmaE * ds ) ) / sigmaE
 *     T   *= exp( -sigmaE * ds )
 *
 * rather than naive rectangle summation, which is what makes low step counts
 * still look smooth.
 *
 * Banding control (non-negotiable, per the art direction): every ray's start
 * offset is jittered by a 32x32 void-and-cluster BLUE NOISE tile, rotated each
 * frame by the golden ratio so the residual noise is both spatially and
 * temporally decorrelated. Any TAA in the post chain will resolve it to zero;
 * without TAA it reads as fine film-grain-like dither instead of hard rings.
 *
 * ---------------------------------------------------------------------------
 * INTERFACE FOR THE RENDER MODULE — see LightingModule's header for the full
 * contract. In brief:
 *
 *   const vol = engine.get('lighting').volumetric;
 *   vol.overlay.visible = false;                    // take over compositing
 *   vol.renderNow(renderer, scene, camera);         // before your lighting pass
 *   vol.texture                                     // RGBA16F, rgb = inscatter
 *                                                   //          a   = transmittance
 *   finalColor = sceneColor * vol.texture.a + vol.texture.rgb;
 *
 * `vol.texture` is at `vol.resolutionScale` of the backbuffer; sample it with
 * plain bilinear filtering (it is band-limited by design).
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Blue noise — void-and-cluster (Ulichney 1993). 32x32 is enough for a per-pixel
// ray offset and generates in a few milliseconds at startup.
// ---------------------------------------------------------------------------
function makeBlueNoiseTexture(size = 32) {
  const n = size * size;
  const rank = new Int32Array(n).fill(-1);
  const binary = new Uint8Array(n);
  const energy = new Float32Array(n);

  const sigma = 1.9;
  const rad = 4;
  const kern = [];
  for (let dy = -rad; dy <= rad; dy++) {
    for (let dx = -rad; dx <= rad; dx++) {
      kern.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))]);
    }
  }

  const wrap = x => ((x % size) + size) % size;
  const splat = (p, s) => {
    const px = p % size;
    const py = (p / size) | 0;
    for (let i = 0; i < kern.length; i++) {
      const k = kern[i];
      energy[wrap(py + k[1]) * size + wrap(px + k[0])] += s * k[2];
    }
  };

  let seed = 0x9e3779b9;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };

  const initialCount = Math.max(1, Math.round(n * 0.1));
  let ones = 0;
  while (ones < initialCount) {
    const p = Math.min(n - 1, (rnd() * n) | 0);
    if (!binary[p]) { binary[p] = 1; splat(p, 1); ones++; }
  }

  const tightestCluster = () => {
    let b = -1, e = -Infinity;
    for (let p = 0; p < n; p++) if (binary[p] && energy[p] > e) { e = energy[p]; b = p; }
    return b;
  };
  const largestVoid = () => {
    let b = -1, e = Infinity;
    for (let p = 0; p < n; p++) if (!binary[p] && energy[p] < e) { e = energy[p]; b = p; }
    return b;
  };

  // Phase 0 — relax the random seed pattern into a blue-noise distribution.
  for (let i = 0; i < 2 * n; i++) {
    const c = tightestCluster();
    binary[c] = 0; splat(c, -1);
    const v = largestVoid();
    if (v === c) { binary[c] = 1; splat(c, 1); break; }
    binary[v] = 1; splat(v, 1);
  }

  const proto = binary.slice();
  const protoEnergy = energy.slice();

  // Phase 1 — rank the seed points downward by removing tightest clusters.
  for (let r = ones - 1; r >= 0; r--) {
    const c = tightestCluster();
    binary[c] = 0; splat(c, -1);
    rank[c] = r;
  }

  // Phase 2 — rank the remainder upward by filling largest voids.
  binary.set(proto);
  energy.set(protoEnergy);
  for (let r = ones; r < n; r++) {
    const v = largestVoid();
    if (v < 0) break;
    binary[v] = 1; splat(v, 1);
    rank[v] = r;
  }

  const data = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    data[p] = Math.max(0, Math.min(255, Math.floor((rank[p] + 0.5) * 256 / n)));
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------

const MAX_VOL_LIGHTS = 3;

const quadVertex = /* glsl */`
  uniform mat4 uInvProjection;
  varying vec2 vUv;
  varying vec3 vViewRay;      // view-space ray with z == -1
  varying float vInvRayLen;   // 1 / length( vViewRay )

  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4( position.xy, 0.0, 1.0 );

    vec4 p = uInvProjection * vec4( position.xy, 1.0, 1.0 );
    vec3 ray = p.xyz / p.w;
    ray /= -ray.z;
    vViewRay = ray;
    vInvRayLen = 1.0 / length( ray );
  }
`;

const marchFragment = /* glsl */`
  precision highp float;
  precision highp sampler2DShadow;

  varying vec2 vUv;
  varying vec3 vViewRay;
  varying float vInvRayLen;

  uniform sampler2D tDepth;
  uniform sampler2D tBlueNoise;
  uniform vec2  uResolution;
  uniform mat4  uCameraMatrixWorld;
  uniform float uCameraNear;
  uniform float uCameraFar;

  uniform vec3  uSunDirection;   // unit, TOWARD the sun
  uniform vec3  uSunRadiance;    // sun colour * intensity, linear
  uniform vec3  uAmbient;        // sky ambient inscatter, linear

  uniform float uDensity;
  uniform float uAnisotropy;
  uniform float uMaxDistance;
  uniform float uHeightFalloff;
  uniform float uGroundLevel;
  uniform float uExtinction;
  uniform float uStrength;
  uniform float uFrame;

  uniform vec4  uCsmSplits;      // view-axis distance where each cascade ends
  uniform vec4  uCsmBias;
  uniform mat4  uCsmMatrix0;
  uniform mat4  uCsmMatrix1;
  uniform mat4  uCsmMatrix2;
  uniform mat4  uCsmMatrix3;
  uniform sampler2DShadow uCsmMap0;
  uniform sampler2DShadow uCsmMap1;
  uniform sampler2DShadow uCsmMap2;
  uniform sampler2DShadow uCsmMap3;

  #if VOL_LIGHTS > 0
    uniform vec3  uVolLightPos[ VOL_LIGHTS ];
    uniform vec3  uVolLightColor[ VOL_LIGHTS ];
    uniform float uVolLightRange[ VOL_LIGHTS ];
  #endif

  const float ONE_OVER_FOURPI = 0.07957747154594767;

  float hgPhase( float cosTheta, float g ) {
    float g2 = g * g;
    float d = max( 1.0 + g2 - 2.0 * g * cosTheta, 1e-4 );
    return ONE_OVER_FOURPI * ( 1.0 - g2 ) / ( d * sqrt( d ) );
  }

  float shadowLookup( sampler2DShadow smap, mat4 mtx, vec3 p, float bias ) {
    vec4 sc = mtx * vec4( p, 1.0 );
    sc.xyz /= sc.w;
    sc.z += bias;
    if ( sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 ) return 1.0;
    return texture( smap, sc.xyz );
  }

  float sunVisibility( vec3 p, float viewAxisDist ) {
    if ( viewAxisDist < uCsmSplits.x ) return shadowLookup( uCsmMap0, uCsmMatrix0, p, uCsmBias.x );
    if ( viewAxisDist < uCsmSplits.y ) return shadowLookup( uCsmMap1, uCsmMatrix1, p, uCsmBias.y );
    if ( viewAxisDist < uCsmSplits.z ) return shadowLookup( uCsmMap2, uCsmMatrix2, p, uCsmBias.z );
    if ( viewAxisDist < uCsmSplits.w ) return shadowLookup( uCsmMap3, uCsmMatrix3, p, uCsmBias.w );
    return 1.0;
  }

  float blueNoise() {
    ivec2 c = ivec2( mod( gl_FragCoord.xy, 32.0 ) );
    float n = texelFetch( tBlueNoise, c, 0 ).r;
    // Golden-ratio temporal rotation keeps successive frames decorrelated so a
    // temporal resolve converges instead of ping-ponging between two patterns.
    return fract( n + uFrame * 0.6180339887498949 );
  }

  void main() {
    float rawDepth = texture2D( tDepth, vUv ).x;

    // View-axis distance to the nearest opaque surface along this pixel's ray.
    float viewAxis = ( rawDepth >= 0.999999 )
      ? uCameraFar
      : ( uCameraNear * uCameraFar ) / ( uCameraFar - rawDepth * ( uCameraFar - uCameraNear ) );

    vec3 camPos = uCameraMatrixWorld[ 3 ].xyz;
    vec3 viewPos = vViewRay * viewAxis;
    vec3 worldEnd = ( uCameraMatrixWorld * vec4( viewPos, 1.0 ) ).xyz;
    vec3 rd = normalize( worldEnd - camPos );

    float sceneDist = viewAxis / vInvRayLen;      // radial distance to the surface
    float marchEnd = min( sceneDist, uMaxDistance );
    if ( marchEnd <= 0.05 ) { gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 ); return; }

    float stepLen = marchEnd / float( VOL_STEPS );
    float jitter = blueNoise();
    float t = stepLen * jitter + 0.02;

    float cosSun = dot( rd, uSunDirection );
    float phaseSun = hgPhase( cosSun, uAnisotropy );

    vec3 scattered = vec3( 0.0 );
    float transmittance = 1.0;

    for ( int i = 0; i < VOL_STEPS; i ++ ) {
      if ( t >= marchEnd ) break;

      vec3 p = camPos + rd * t;

      // Height-modulated density: the dust pools on the deck.
      float h = exp( -uHeightFalloff * ( p.y - uGroundLevel ) );
      float sigmaS = uDensity * clamp( h, 0.0, 4.0 );

      if ( sigmaS > 1e-6 ) {
        float sigmaE = max( sigmaS * uExtinction, 1e-5 );

        float vis = sunVisibility( p, t * vInvRayLen );
        vec3 lum = uSunRadiance * ( vis * phaseSun ) + uAmbient;

        #if VOL_LIGHTS > 0
        for ( int l = 0; l < VOL_LIGHTS; l ++ ) {
          vec3 lv = uVolLightPos[ l ] - p;
          float d2 = dot( lv, lv );
          float r2 = uVolLightRange[ l ] * uVolLightRange[ l ];
          float win = clamp( 1.0 - d2 / r2, 0.0, 1.0 );
          win *= win;
          lum += uVolLightColor[ l ] * ( win / max( d2, 0.25 ) ) * ONE_OVER_FOURPI;
        }
        #endif

        vec3 S = lum * sigmaS;
        float stepT = exp( -sigmaE * stepLen );
        vec3 Sint = ( S - S * stepT ) / sigmaE;
        scattered += transmittance * Sint;
        transmittance *= stepT;
        if ( transmittance < 0.008 ) break;
      }

      t += stepLen;
    }

    gl_FragColor = vec4( scattered * uStrength, transmittance );
  }
`;

const compositeFragment = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D tVolumetric;
  uniform vec2 uTexel;
  uniform float uIntensity;

  void main() {
    // 4 bilinear taps on the half-texel diagonals == a smooth 16-sample tent,
    // which removes the last of the raymarch noise before it hits the screen.
    vec4 v =
      texture2D( tVolumetric, vUv + vec2(  0.5,  0.5 ) * uTexel ) +
      texture2D( tVolumetric, vUv + vec2( -0.5,  0.5 ) * uTexel ) +
      texture2D( tVolumetric, vUv + vec2(  0.5, -0.5 ) * uTexel ) +
      texture2D( tVolumetric, vUv + vec2( -0.5, -0.5 ) * uTexel );
    v *= 0.25;

    gl_FragColor = vec4( v.rgb * uIntensity, 1.0 );

    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // Alpha carries transmittance; the blend equation is
    //   dst = src.rgb * ONE + dst.rgb * src.a
    gl_FragColor.a = clamp( v.a, 0.0, 1.0 );
  }
`;

function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0, 3, -1, 0, -1, 3, 0,
  ]), 3));
  return g;
}

export class VolumetricPass {
  constructor(opts = {}) {
    this.enabled = VOLUMETRIC.enabled;
    this.density = VOLUMETRIC.density;
    this.steps = VOLUMETRIC.steps;
    this.anisotropy = VOLUMETRIC.anisotropy;
    this.jitter = VOLUMETRIC.jitter;

    this.resolutionScale = opts.resolutionScale ?? 0.5;
    this.maxDistance = opts.maxDistance ?? 78.0;
    this.extinction = opts.extinction ?? 0.35;
    this.strength = opts.strength ?? 0.14;
    this.intensity = opts.intensity ?? 1.0;

    this._frame = 0;
    this._lastRenderedFrame = -1;
    this._width = 2;
    this._height = 2;
    this._ready = false;

    this.blueNoise = makeBlueNoiseTexture(32);

    // --- render targets ----------------------------------------------------
    this.depthTexture = new THREE.DepthTexture(2, 2, THREE.UnsignedIntType);
    this.depthTexture.minFilter = THREE.NearestFilter;
    this.depthTexture.magFilter = THREE.NearestFilter;
    this.depthTarget = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: this.depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.target = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.target.texture.name = 'volumetric';

    // --- march material ----------------------------------------------------
    this.uniforms = {
      tDepth:            { value: this.depthTexture },
      tBlueNoise:        { value: this.blueNoise },
      uResolution:       { value: new THREE.Vector2(2, 2) },
      uInvProjection:    { value: new THREE.Matrix4() },
      uCameraMatrixWorld:{ value: new THREE.Matrix4() },
      uCameraNear:       { value: 0.1 },
      uCameraFar:        { value: 1000 },
      uSunDirection:     { value: new THREE.Vector3(0, 1, 0) },
      uSunRadiance:      { value: new THREE.Color(0xffffff) },
      uAmbient:          { value: new THREE.Color(0x000000) },
      uDensity:          { value: this.density },
      uAnisotropy:       { value: this.anisotropy },
      uMaxDistance:      { value: this.maxDistance },
      uHeightFalloff:    { value: FOG.heightFalloff * 1.4 },
      uGroundLevel:      { value: FOG.groundLevel },
      uExtinction:       { value: this.extinction },
      uStrength:         { value: this.strength },
      uFrame:            { value: 0 },
      uCsmSplits:        { value: new THREE.Vector4(8, 24, 70, 180) },
      uCsmBias:          { value: new THREE.Vector4(0, 0, 0, 0) },
      uCsmMatrix0:       { value: new THREE.Matrix4() },
      uCsmMatrix1:       { value: new THREE.Matrix4() },
      uCsmMatrix2:       { value: new THREE.Matrix4() },
      uCsmMatrix3:       { value: new THREE.Matrix4() },
      uCsmMap0:          { value: null },
      uCsmMap1:          { value: null },
      uCsmMap2:          { value: null },
      uCsmMap3:          { value: null },
      uVolLightPos:      { value: [] },
      uVolLightColor:    { value: [] },
      uVolLightRange:    { value: [] },
    };

    this.marchMaterial = new THREE.ShaderMaterial({
      name: 'VolumetricMarch',
      defines: { VOL_STEPS: this.steps, VOL_LIGHTS: 0 },
      uniforms: this.uniforms,
      vertexShader: quadVertex,
      fragmentShader: marchFragment,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });

    this._quadScene = new THREE.Scene();
    this._quadCamera = new THREE.Camera();
    this._quad = new THREE.Mesh(fullscreenTriangle(), this.marchMaterial);
    this._quad.frustumCulled = false;
    this._quadScene.add(this._quad);

    // --- in-scene composite overlay (fallback when no post chain exists) ----
    this.compositeUniforms = {
      tVolumetric: { value: this.target.texture },
      uTexel:      { value: new THREE.Vector2(0.5, 0.5) },
      uIntensity:  { value: this.intensity },
    };
    this.compositeMaterial = new THREE.ShaderMaterial({
      name: 'VolumetricComposite',
      uniforms: this.compositeUniforms,
      vertexShader: quadVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendEquation: THREE.AddEquation,
      fog: false,
    });
    // The composite vertex shader ignores the model matrix, so this uniform is
    // only here to satisfy the shared vertex program.
    this.compositeMaterial.uniforms.uInvProjection = { value: new THREE.Matrix4() };

    this.overlay = new THREE.Mesh(fullscreenTriangle(), this.compositeMaterial);
    this.overlay.name = 'volumetric-overlay';
    this.overlay.frustumCulled = false;
    this.overlay.renderOrder = 10000;
    this.overlay.matrixAutoUpdate = false;

    this._prepassMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
    this._prepassCamera = new THREE.PerspectiveCamera();
    this._hidden = [];
  }

  get texture() { return this.target.texture; }

  setSize(width, height) {
    const w = Math.max(2, Math.floor(width * this.resolutionScale));
    const h = Math.max(2, Math.floor(height * this.resolutionScale));
    if (w === this._width && h === this._height) return;
    this._width = w;
    this._height = h;
    this.depthTarget.setSize(w, h);
    this.target.setSize(w, h);
    this.uniforms.uResolution.value.set(w, h);
    this.compositeUniforms.uTexel.value.set(1 / w, 1 / h);
  }

  setSteps(steps) {
    if (steps === this.marchMaterial.defines.VOL_STEPS) return;
    this.steps = steps;
    this.marchMaterial.defines.VOL_STEPS = steps;
    this.marchMaterial.needsUpdate = true;
  }

  /** @param {Array<{position:THREE.Vector3, color:THREE.Color, intensity:number, range:number}>} lights */
  setVolumetricLights(lights) {
    const used = Math.min(lights.length, MAX_VOL_LIGHTS);
    const pos = [], col = [], range = [];
    for (let i = 0; i < used; i++) {
      const l = lights[i];
      pos.push(l.position.clone());
      col.push(new THREE.Color().copy(l.color).multiplyScalar(l.intensity));
      range.push(l.range);
    }
    this.uniforms.uVolLightPos.value = pos;
    this.uniforms.uVolLightColor.value = col;
    this.uniforms.uVolLightRange.value = range;
    if (this.marchMaterial.defines.VOL_LIGHTS !== used) {
      this.marchMaterial.defines.VOL_LIGHTS = used;
      this.marchMaterial.needsUpdate = true;
    }
    this._volLights = lights.slice(0, used);
  }

  refreshVolumetricLights() {
    if (!this._volLights) return;
    const arr = this.uniforms.uVolLightColor.value;
    for (let i = 0; i < this._volLights.length; i++) {
      const l = this._volLights[i];
      arr[i].copy(l.color).multiplyScalar(l.intensity);
      this.uniforms.uVolLightPos.value[i].copy(l.position);
    }
  }

  /** Push the current cascade state into the march uniforms. */
  syncShadows(shadows) {
    const lights = shadows.lights;
    const splits = shadows.splitDistances;
    const u = this.uniforms;
    const mats = [u.uCsmMatrix0, u.uCsmMatrix1, u.uCsmMatrix2, u.uCsmMatrix3];
    const maps = [u.uCsmMap0, u.uCsmMap1, u.uCsmMap2, u.uCsmMap3];
    const split = u.uCsmSplits.value;
    const bias = u.uCsmBias.value;
    const comp = ['x', 'y', 'z', 'w'];

    let ready = true;
    for (let i = 0; i < 4; i++) {
      const src = lights[Math.min(i, lights.length - 1)];
      mats[i].value.copy(src.shadow.matrix);
      const map = src.shadow.map;
      maps[i].value = map ? map.depthTexture : null;
      if (!map || !map.depthTexture) ready = false;
      split[comp[i]] = splits[Math.min(i, splits.length - 1)] ?? 1e6;
      // A touch more bias than the surface shading uses: the medium has no
      // normal to offset along, so depth bias is the only tool available.
      bias[comp[i]] = src.shadow.bias * 2.5;
    }
    this._ready = ready;
  }

  /**
   * Render the depth prepass + the march. Safe to call once per frame; repeat
   * calls in the same frame are ignored (pass force=true to override).
   */
  renderNow(renderer, scene, camera, frameId, force = false) {
    if (!this.enabled || !this._ready) return false;
    if (!force && frameId !== undefined && frameId === this._lastRenderedFrame) return false;
    this._lastRenderedFrame = frameId;
    this._frame = (this._frame + 1) % 64;

    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevAutoClear = renderer.autoClear;

    // ---- depth prepass ----------------------------------------------------
    const cam = this._prepassCamera;
    cam.copy(camera);
    cam.layers.set(0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    this._hide(scene);
    scene.overrideMaterial = this._prepassMaterial;
    renderer.setRenderTarget(this.depthTarget);
    renderer.autoClear = false;
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    scene.overrideMaterial = prevOverride;
    this._restore();

    // ---- march ------------------------------------------------------------
    const u = this.uniforms;
    u.uInvProjection.value.copy(camera.projectionMatrixInverse);
    u.uCameraMatrixWorld.value.copy(camera.matrixWorld);
    u.uCameraNear.value = camera.near;
    u.uCameraFar.value = camera.far;
    u.uDensity.value = this.density;
    u.uAnisotropy.value = this.anisotropy;
    u.uMaxDistance.value = this.maxDistance;
    u.uExtinction.value = this.extinction;
    u.uStrength.value = this.strength;
    u.uFrame.value = this.jitter ? this._frame : 0;
    this.compositeUniforms.uIntensity.value = this.intensity;

    renderer.setRenderTarget(this.target);
    renderer.clear(true, false, false);
    renderer.render(this._quadScene, this._quadCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    return true;
  }

  _hide(scene) {
    this._hidden.length = 0;
    scene.traverse(o => {
      if (o === this.overlay || o.name === 'sky' || o.userData?.noDepthPrepass) {
        if (o.visible) { this._hidden.push(o); o.visible = false; }
      }
    });
  }

  _restore() {
    for (const o of this._hidden) o.visible = true;
    this._hidden.length = 0;
  }

  dispose() {
    this.depthTarget.dispose();
    this.target.dispose();
    this.marchMaterial.dispose();
    this.compositeMaterial.dispose();
    this.blueNoise.dispose();
    this._quad.geometry.dispose();
    this.overlay.geometry.dispose();
    this._prepassMaterial.dispose();
  }
}

export { SUN as _sunRef };
