import * as THREE from 'three';
import { DEPTH_FADE_GLSL } from './depth.js';

/**
 * GPU-INSTANCED, GPU-SIMULATED PARTICLES.
 *
 * One draw call per system. The CPU never touches a particle after it is
 * spawned: position, velocity, size, roll, colour ramp and opacity are all
 * evaluated in the vertex shader from the spawn state, using the closed-form
 * solution of ballistic motion with linear drag
 *
 *     p(t) = p0 + v0 * (1 - e^-kt)/k  +  g * (t - (1 - e^-kt)/k) / k
 *
 * so a particle costs exactly one instanced quad and zero per-frame JS work.
 * Storage is a fixed ring buffer sized at construction — allocation happens
 * once, at boot, and never again. Dead instances are collapsed behind the far
 * plane by the vertex shader, so overdraw drops as a burst dies out.
 *
 * `emit()` reads from a caller-owned scratch descriptor (see EMIT below) rather
 * than an object literal, which keeps the spawn path allocation-free too.
 */

// Shared emit descriptor. Fill, call emit(), refill. Never stored.
export const EMIT = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  r: 1, g: 1, b: 1,
  life: 1,
  size0: 0.1,
  size1: 0.2,
  drag: 0,
  gravity: 1,
  seed: 0,
  spin: 0,
  stretch: 0,
  turbulence: 0,
  fadeIn: 0.05,
  opacity: 1,
  age: 0,          // pre-age the particle (used to seed a burst mid-flight)
};

export function resetEmit() {
  EMIT.x = EMIT.y = EMIT.z = 0;
  EMIT.vx = EMIT.vy = EMIT.vz = 0;
  EMIT.r = EMIT.g = EMIT.b = 1;
  EMIT.life = 1; EMIT.size0 = 0.1; EMIT.size1 = 0.2;
  EMIT.drag = 0; EMIT.gravity = 1; EMIT.seed = Math.random();
  EMIT.spin = 0; EMIT.stretch = 0; EMIT.turbulence = 0;
  EMIT.fadeIn = 0.05; EMIT.opacity = 1; EMIT.age = 0;
  return EMIT;
}

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec3 iCol;
attribute vec4 iA;   // spawnTime, life, size0, size1
attribute vec4 iB;   // drag, gravityScale, seed, spin
attribute vec4 iC;   // stretch, turbulence, fadeIn, opacity

uniform float uTime;
uniform float uSizeScale;
uniform float uStretchMode;
uniform float uMaxStretch;
uniform vec2  uFade;      // fadeOutStart (0..1), fadeOutPower
uniform vec3  uWind;

varying vec2  vUv;
varying vec3  vColor;
varying float vAlpha;
varying float vAge;
varying float vViewZ;
varying float vRadius;
varying vec4  vClip;
varying vec2  vRot;

#include <fog_pars_vertex>

void main() {
  float t = uTime - iA.x;
  float life = max(iA.y, 0.0001);
  if (t < 0.0 || t >= life) {
    // Collapse dead instances behind the far plane; they cost no fragments.
    vAlpha = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float u = t / life;

  // --- closed-form ballistics with linear drag ---
  float k = iB.x;
  vec3 g = vec3(0.0, -9.81 * iB.y, 0.0);
  vec3 p, vel;
  if (k > 0.001) {
    float ek = exp(-k * t);
    float e  = (1.0 - ek) / k;
    p   = iPos + iVel * e + g * (t - e) / k;
    vel = iVel * ek + g * (1.0 - ek) / k;
  } else {
    p   = iPos + iVel * t + 0.5 * g * t * t;
    vel = iVel + g * t;
  }

  // Wind + a cheap curl so rising smoke never looks like it is on rails.
  float s = iB.z * 6.2831853;
  p += uWind * (0.5 * t * t) * iC.y;
  p += vec3(sin(s + t * 1.6), sin(s * 1.7 + t * 0.9) * 0.45, cos(s * 1.3 + t * 1.35))
       * iC.y * t * 0.6;

  float grow = 1.0 - pow(1.0 - u, 2.2);
  float size = mix(iA.z, iA.w, grow) * uSizeScale;

  float aIn  = iC.z > 0.0 ? clamp(u / iC.z, 0.0, 1.0) : 1.0;
  float aOut = pow(1.0 - smoothstep(uFade.x, 1.0, u), uFade.y);
  vAlpha = aIn * aOut * iC.w;
  vColor = iCol;
  vAge   = u;

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);

  float ang = s + iB.w * t;
  float ca = cos(ang), sa = sin(ang);
  vec2 c = position.xy;
  vec2 off;
  if (uStretchMode > 0.5) {
    // Velocity-stretched billboard: long axis follows screen-space motion.
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    float sp = length(vv.xy);
    vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = size * (1.0 + min(sp * iC.x, uMaxStretch));
    off = perp * (c.x * size) + dir * (c.y * len);
    vRadius = size * 0.5;
    vRot = vec2(1.0, 0.0);
  } else {
    off = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca) * size;
    vRadius = size * 0.5;
    vRot = vec2(ca, sa);
  }
  mvPosition.xy += off;

  vViewZ = -mvPosition.z;
  vUv = uv;
  vClip = projectionMatrix * mvPosition;
  gl_Position = vClip;

  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform sampler2D uRamp;
uniform float uUseRamp;
uniform float uLit;
uniform float uBump;
uniform float uAdditive;
uniform float uEmissive;
uniform vec3  uSunDirView;
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform vec3  uUpView;

varying vec2  vUv;
varying vec3  vColor;
varying float vAlpha;
varying float vAge;
varying float vViewZ;
varying float vRadius;
varying vec4  vClip;
varying vec2  vRot;

${DEPTH_FADE_GLSL}

#include <fog_pars_fragment>

  // The height-fog chunk installed by src/lighting/atmosphere.js replaces
  // three's fog_pars_fragment and declares fogColor but not these, so a shader
  // written against stock fog fails to compile — which silently killed every
  // particle, decal and tracer in the game.
  #ifdef USE_FOG
    uniform float fogDensity;
    uniform float fogNear;
    uniform float fogFar;
  #endif

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vAlpha;
  if (a < 0.004) discard;

  vec3 col = vColor;
  if (uUseRamp > 0.5) col *= texture2D(uRamp, vec2(clamp(vAge, 0.0, 1.0), 0.5)).rgb;

  vec2 q = vUv * 2.0 - 1.0;
  float r2 = min(dot(q, q), 1.0);
  float bulge = sqrt(max(0.0, 1.0 - r2));

  if (uLit > 0.5) {
    // Treat the billboard as a sphere and perturb that normal with the baked
    // density gradient, so the puff lights like a volume rather than a disc.
    vec3 sphereN = vec3(q, bulge);
    vec3 bump = tex.rgb * 2.0 - 1.0;
    vec2 br = vec2(bump.x * vRot.x - bump.y * vRot.y, bump.x * vRot.y + bump.y * vRot.x);
    vec3 n = normalize(sphereN + vec3(br * uBump, 0.0));

    float ndl = dot(n, uSunDirView);
    float wrapd = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
    // Forward scattering through the thin edges of the puff.
    float through = pow(clamp(-ndl * 0.5 + 0.5, 0.0, 1.0), 3.0) * (1.0 - tex.a * 0.75);
    float up = clamp(dot(n, uUpView) * 0.5 + 0.5, 0.0, 1.0);
    vec3 lit = uAmbient * mix(0.4, 1.2, up) + uSunColor * (wrapd * 0.95 + through * 0.8);
    col *= lit;
  }
  col *= uEmissive;

  // --- soft particle depth fade -------------------------------------------
  // Push the sample point toward the camera by the sphere bulge so the fade
  // wraps around geometry the way a real volume would.
  float pz = vViewZ - bulge * vRadius;
  a *= fxDepthFade(vClip, pz);
  // Dissolve rather than clip when the camera is inside the particle.
  a *= smoothstep(uCamRange.x, uCamRange.x + 0.55, vViewZ);
  if (a < 0.004) discard;

  gl_FragColor = vec4(col, a);

  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    if (uAdditive > 0.5) gl_FragColor.rgb *= (1.0 - fogFactor);
    else gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function fogUniforms() {
  return {
    fogDensity: { value: 0.00025 },
    fogNear: { value: 1 },
    fogFar: { value: 2000 },
    fogColor: { value: new THREE.Color(0xffffff) },
  };
}

export class ParticleSystem {
  /**
   * @param {object} o
   * @param {number} o.capacity        hard instance cap (ring buffer size)
   * @param {THREE.Texture} o.map      RGB = bump normal (lit) or white, A = mask
   * @param {boolean} o.additive
   * @param {boolean} o.lit            sun-shaded volumetric look (smoke/dust)
   * @param {number}  o.softness       depth-fade distance in metres (0 = off)
   */
  constructor(o) {
    this.name = o.name || 'particles';
    this.capacity = o.capacity;
    this.additive = !!o.additive;
    this.lit = !!o.lit;
    this.softness = o.softness ?? 0.0;
    this.cursor = 0;
    this.spawned = 0;
    this.alive = 0;
    this.latestDeath = -1;
    this._dirtyMin = Infinity;
    this._dirtyMax = -Infinity;
    this._deaths = new Float32Array(this.capacity);

    const n = this.capacity;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    // Everything starts dead (life 0) so nothing shows before the first emit.
    for (let i = 0; i < n; i++) this.aA.array[i * 4 + 1] = 0;
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iCol', this.aCol);
    geo.setAttribute('iA', this.aA);
    geo.setAttribute('iB', this.aB);
    geo.setAttribute('iC', this.aC);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.uniforms = Object.assign(fogUniforms(), {
      uTime: { value: 0 },
      uSizeScale: { value: o.sizeScale ?? 1 },
      uStretchMode: { value: o.stretch ? 1 : 0 },
      uMaxStretch: { value: o.maxStretch ?? 14 },
      uFade: { value: new THREE.Vector2(o.fadeStart ?? 0.45, o.fadePower ?? 1.0) },
      uWind: { value: new THREE.Vector3(0.35, 0.05, -0.2) },
      uMap: { value: o.map },
      uRamp: { value: o.ramp || o.map },
      uUseRamp: { value: o.ramp ? 1 : 0 },
      uLit: { value: this.lit ? 1 : 0 },
      uBump: { value: o.bump ?? 0.9 },
      uAdditive: { value: this.additive ? 1 : 0 },
      uEmissive: { value: o.emissive ?? 1 },
      uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.88, 0.72) },
      uAmbient: { value: new THREE.Color(0.30, 0.36, 0.46) },
      uUpView: { value: new THREE.Vector3(0, 1, 0) },
      uDepth: { value: null },
      uCamRange: { value: new THREE.Vector2(0.02, 1200) },
      uSoftness: { value: this.softness },
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: this.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
      fog: true,
      toneMapped: true,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = o.renderOrder ?? 10;
    this.mesh.visible = false;
    this.mesh.name = `fx:${this.name}`;
  }

  /** Emit one particle from the shared EMIT descriptor. */
  emit(time) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.spawned++;

    const p = this.aPos.array, v = this.aVel.array, c = this.aCol.array;
    const A = this.aA.array, B = this.aB.array, C = this.aC.array;
    const i3 = i * 3, i4 = i * 4;
    p[i3] = EMIT.x; p[i3 + 1] = EMIT.y; p[i3 + 2] = EMIT.z;
    v[i3] = EMIT.vx; v[i3 + 1] = EMIT.vy; v[i3 + 2] = EMIT.vz;
    c[i3] = EMIT.r; c[i3 + 1] = EMIT.g; c[i3 + 2] = EMIT.b;
    const spawn = time - EMIT.age;
    A[i4] = spawn; A[i4 + 1] = EMIT.life; A[i4 + 2] = EMIT.size0; A[i4 + 3] = EMIT.size1;
    B[i4] = EMIT.drag; B[i4 + 1] = EMIT.gravity; B[i4 + 2] = EMIT.seed; B[i4 + 3] = EMIT.spin;
    C[i4] = EMIT.stretch; C[i4 + 1] = EMIT.turbulence; C[i4 + 2] = EMIT.fadeIn; C[i4 + 3] = EMIT.opacity;

    this._deaths[i] = spawn + EMIT.life;
    if (this._deaths[i] > this.latestDeath) this.latestDeath = this._deaths[i];
    if (i < this._dirtyMin) this._dirtyMin = i;
    if (i > this._dirtyMax) this._dirtyMax = i;
    return i;
  }

  _flush() {
    if (this._dirtyMin > this._dirtyMax) return;
    const start = this._dirtyMin, count = this._dirtyMax - this._dirtyMin + 1;
    const attrs = [this.aPos, this.aVel, this.aCol, this.aA, this.aB, this.aC];
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      a.clearUpdateRanges();
      a.addUpdateRange(start * a.itemSize, count * a.itemSize);
      a.needsUpdate = true;
    }
    this._dirtyMin = Infinity;
    this._dirtyMax = -Infinity;
  }

  update(time, frame) {
    this.uniforms.uTime.value = time;
    this._flush();
    this.geometry.instanceCount = Math.min(this.spawned, this.capacity);
    this.mesh.visible = this.geometry.instanceCount > 0 && time < this.latestDeath;
    // Live count is only needed for budget reporting and the depth-prepass
    // gate, so it is sampled rather than recomputed every frame.
    if ((frame & 7) === 0) {
      let n = 0;
      const d = this._deaths, m = this.geometry.instanceCount;
      for (let i = 0; i < m; i++) if (d[i] > time) n++;
      this.alive = n;
    }
  }

  setDepth(texture, near, far) {
    this.uniforms.uDepth.value = texture;
    this.uniforms.uCamRange.value.set(near, far);
  }

  setLighting(sunDirView, sunColor, ambient, upView) {
    this.uniforms.uSunDirView.value.copy(sunDirView);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uAmbient.value.copy(ambient);
    this.uniforms.uUpView.value.copy(upView);
  }

  clear() {
    const A = this.aA.array;
    for (let i = 0; i < this.capacity; i++) A[i * 4 + 1] = 0;
    this._deaths.fill(-1);
    this.latestDeath = -1;
    this._dirtyMin = 0; this._dirtyMax = this.capacity - 1;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
