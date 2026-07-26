import * as THREE from 'three';
import { DEPTH_FADE_GLSL } from './depth.js';

/**
 * PROJECTED DECALS — bullet holes, blood splatter, scorch marks.
 *
 * One instanced draw call for the whole set. Each decal is an oriented quad
 * built in the vertex shader from a per-instance tangent basis derived from the
 * surface normal at the hit, offset a few millimetres along that normal.
 *
 * Two things stop these reading as stickers:
 *
 *   1. The atlas carries a crater HEIGHT in its green channel. The fragment
 *      shader differences it into a tangent-space normal, rotates it into world
 *      space with the decal's own basis and shades it against the sun, so the
 *      lip of the hole catches the light and the void goes dark. The hole
 *      genuinely darkens and reshades the surface instead of painting on it.
 *   2. The scene depth (same source the soft particles use) clips fragments
 *      whose underlying geometry is not near the decal plane, so a decal placed
 *      on the edge of a crate does not hang off into thin air.
 *
 * Budget: a fixed ring. When the ring is about to wrap onto a slot, that slot
 * has already been told to fade — oldest-first, over ~0.6s, never a pop.
 */

const VERT = /* glsl */`
attribute vec3 dPos;
attribute vec3 dRight;   // half-extent tangent
attribute vec3 dUp;      // half-extent bitangent
attribute vec3 dNrm;
attribute vec4 dA;       // spawnTime, maxAge, fadeStart(-1 = none), atlasIndex
attribute vec3 dCol;

uniform float uTime;
uniform float uFadeDur;
uniform float uAtlasDim;

varying vec2  vUv;
varying vec3  vCol;
varying float vAlpha;
varying vec3  vN;
varying vec3  vT;
varying vec3  vB;
varying float vViewZ;
varying vec4  vClip;

#include <fog_pars_vertex>

void main() {
  float age = uTime - dA.x;
  float maxAge = dA.y;
  if (maxAge <= 0.0 || age < 0.0 || age > maxAge) {
    vAlpha = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float a = smoothstep(0.0, 0.03, age);
  // Natural end-of-life fade.
  a *= 1.0 - smoothstep(maxAge - 3.0, maxAge, age);
  // Budget eviction fade, started by the CPU when this slot became the oldest.
  if (dA.z >= 0.0) a *= 1.0 - clamp((uTime - dA.z) / uFadeDur, 0.0, 1.0);
  if (a <= 0.002) { vAlpha = 0.0; gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  vAlpha = a;
  vCol = dCol;
  vN = normalize(dNrm);
  vT = normalize(dRight);
  vB = normalize(dUp);

  vec3 wp = dPos + dRight * (position.x * 2.0) + dUp * (position.y * 2.0);
  vec4 mvPosition = modelViewMatrix * vec4(wp, 1.0);
  vViewZ = -mvPosition.z;

  float idx = floor(dA.w + 0.5);
  vec2 cell = vec2(mod(idx, uAtlasDim), floor(idx / uAtlasDim));
  vUv = (uv + cell) / uAtlasDim;

  vClip = projectionMatrix * mvPosition;
  gl_Position = vClip;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
uniform sampler2D uAtlas;
uniform float uTexel;
uniform float uBump;
uniform float uThickness;
uniform float uDepthClip;
uniform vec3  uSunDir;      // world space, pointing FROM surface TO sun
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform float uHoleDark;
uniform float uOpacity;

varying vec2  vUv;
varying vec3  vCol;
varying float vAlpha;
varying vec3  vN;
varying vec3  vT;
varying vec3  vB;
varying float vViewZ;
varying vec4  vClip;

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
  vec4 tex = texture2D(uAtlas, vUv);
  float cov = tex.a * vAlpha * uOpacity;
  if (cov < 0.004) discard;

  // Reject fragments whose underlying surface is not on the decal plane. The
  // depth source is half-res, so this is a soft band rather than a hard test.
  if (uDepthClip > 0.5) {
    vec2 suv = vClip.xy / vClip.w * 0.5 + 0.5;
    float sceneZ = fxSceneViewZ(suv);
    cov *= 1.0 - smoothstep(uThickness * 0.5, uThickness, abs(sceneZ - vViewZ));
    if (cov < 0.004) discard;
  }

  // Crater normal from the baked height field.
  float h0 = texture2D(uAtlas, vUv).g;
  float hx = texture2D(uAtlas, vUv + vec2(uTexel, 0.0)).g;
  float hy = texture2D(uAtlas, vUv + vec2(0.0, uTexel)).g;
  vec3 n = normalize(vN - (vT * (hx - h0) + vB * (hy - h0)) * uBump);

  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 light = uAmbient + uSunColor * ndl;

  float hole = tex.r;
  float rim  = tex.b;
  // Void goes near-black and swallows the light; spall ring keeps the surface
  // tint and is lit, so the hole reads as depth rather than paint.
  vec3 col = mix(vCol * light, vec3(0.012, 0.010, 0.009), clamp(hole * uHoleDark, 0.0, 1.0));
  col += vCol * light * rim * 0.55;

  gl_FragColor = vec4(col, cov);

  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _t = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _alt = new THREE.Vector3(1, 0, 0);

export class DecalSystem {
  constructor({ name, capacity, atlas, atlasDim = 2, texel = 1 / 256, maxAge = 90,
                bump = 1.6, holeDark = 1.0, thickness = 0.35, opacity = 1,
                renderOrder = 2, evictLead = 6, fadeDur = 0.6 }) {
    this.name = name;
    this.capacity = capacity;
    this.cursor = 0;
    this.spawned = 0;
    this.maxAge = maxAge;
    this.evictLead = Math.min(evictLead, Math.max(1, capacity - 1));
    this._dirtyMin = Infinity;
    this._dirtyMax = -Infinity;

    const n = capacity;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aRight = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aUp = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aNrm = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('dPos', this.aPos);
    geo.setAttribute('dRight', this.aRight);
    geo.setAttribute('dUp', this.aUp);
    geo.setAttribute('dNrm', this.aNrm);
    geo.setAttribute('dA', this.aA);
    geo.setAttribute('dCol', this.aCol);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.uniforms = {
      uTime: { value: 0 },
      uFadeDur: { value: fadeDur },
      uAtlasDim: { value: atlasDim },
      uAtlas: { value: atlas },
      uTexel: { value: texel },
      uBump: { value: bump },
      uThickness: { value: thickness },
      uDepthClip: { value: 1 },
      uHoleDark: { value: holeDark },
      uOpacity: { value: opacity },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.86, 0.68) },
      uAmbient: { value: new THREE.Color(0.28, 0.32, 0.40) },
      uDepth: { value: null },
      uCamRange: { value: new THREE.Vector2(0.02, 1200) },
      uSoftness: { value: 0 },
      fogDensity: { value: 0.00025 },
      fogNear: { value: 1 },
      fogFar: { value: 2000 },
      fogColor: { value: new THREE.Color(0xffffff) },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      side: THREE.FrontSide,
      fog: true,
      toneMapped: true,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.mesh.name = `fx:decal:${name}`;
  }

  /**
   * @param {THREE.Vector3} point   world hit point
   * @param {THREE.Vector3} normal  world surface normal
   * @param {number} size           half-extent in metres
   * @param {THREE.Color|{r,g,b}} tint
   * @param {number} time
   * @param {number} roll           radians, randomise so repeats are invisible
   * @param {number} variant        atlas cell
   * @param {number} life           seconds (defaults to this.maxAge)
   */
  spawn(point, normal, size, tint, time, roll, variant, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.spawned++;

    _n.copy(normal);
    if (_n.lengthSq() < 1e-8) _n.set(0, 1, 0);
    _n.normalize();
    // Stable tangent basis; swap the reference axis near the poles.
    const ref = Math.abs(_n.y) > 0.94 ? _alt : _up;
    _t.crossVectors(ref, _n).normalize();
    _b.crossVectors(_n, _t).normalize();
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rx = _t.x * cr + _b.x * sr, ry = _t.y * cr + _b.y * sr, rz = _t.z * cr + _b.z * sr;
    const ux = -_t.x * sr + _b.x * cr, uy = -_t.y * sr + _b.y * cr, uz = -_t.z * sr + _b.z * cr;

    const i3 = i * 3, i4 = i * 4;
    const off = 0.008 + size * 0.02;
    this.aPos.array[i3] = point.x + _n.x * off;
    this.aPos.array[i3 + 1] = point.y + _n.y * off;
    this.aPos.array[i3 + 2] = point.z + _n.z * off;
    this.aRight.array[i3] = rx * size; this.aRight.array[i3 + 1] = ry * size; this.aRight.array[i3 + 2] = rz * size;
    this.aUp.array[i3] = ux * size; this.aUp.array[i3 + 1] = uy * size; this.aUp.array[i3 + 2] = uz * size;
    this.aNrm.array[i3] = _n.x; this.aNrm.array[i3 + 1] = _n.y; this.aNrm.array[i3 + 2] = _n.z;
    this.aA.array[i4] = time;
    this.aA.array[i4 + 1] = life ?? this.maxAge;
    this.aA.array[i4 + 2] = -1;
    this.aA.array[i4 + 3] = variant;
    this.aCol.array[i3] = tint.r; this.aCol.array[i3 + 1] = tint.g; this.aCol.array[i3 + 2] = tint.b;

    this._touch(i);

    // Tell the slot that is `evictLead` spawns from being recycled to start
    // fading now, so the ring never overwrites something still on screen.
    const victim = (i + this.evictLead) % this.capacity;
    if (this.aA.array[victim * 4 + 1] > 0 && this.aA.array[victim * 4 + 2] < 0) {
      this.aA.array[victim * 4 + 2] = time;
      this._touch(victim);
    }
    return i;
  }

  _touch(i) {
    if (i < this._dirtyMin) this._dirtyMin = i;
    if (i > this._dirtyMax) this._dirtyMax = i;
  }

  update(time) {
    this.uniforms.uTime.value = time;
    if (this._dirtyMin <= this._dirtyMax) {
      const start = this._dirtyMin, count = this._dirtyMax - this._dirtyMin + 1;
      const attrs = [this.aPos, this.aRight, this.aUp, this.aNrm, this.aA, this.aCol];
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i];
        a.clearUpdateRanges();
        a.addUpdateRange(start * a.itemSize, count * a.itemSize);
        a.needsUpdate = true;
      }
      this._dirtyMin = Infinity;
      this._dirtyMax = -Infinity;
    }
    this.geometry.instanceCount = Math.min(this.spawned, this.capacity);
    this.mesh.visible = this.geometry.instanceCount > 0;
  }

  get count() { return Math.min(this.spawned, this.capacity); }

  setDepth(texture, near, far, enabled) {
    this.uniforms.uDepth.value = texture;
    this.uniforms.uCamRange.value.set(near, far);
    this.uniforms.uDepthClip.value = enabled ? 1 : 0;
  }

  setLighting(sunDirWorld, sunColor, ambient) {
    this.uniforms.uSunDir.value.copy(sunDirWorld);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uAmbient.value.copy(ambient);
  }

  clear() {
    this.aA.array.fill(0);
    this.spawned = 0;
    this.cursor = 0;
    this._dirtyMin = 0; this._dirtyMax = this.capacity - 1;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
