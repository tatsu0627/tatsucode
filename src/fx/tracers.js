import * as THREE from 'three';
import { DEPTH_FADE_GLSL } from './depth.js';

/**
 * TRACERS — the visible fraction of rounds in flight.
 *
 * A cylindrical billboard (a ribbon that always turns its flat side to the
 * camera about the flight axis) sliding from muzzle to impact at the round's
 * real muzzle velocity, so a tracer and the bullet that made it arrive
 * together. HDR-bright at the head so the bloom threshold catches it, falling
 * off along the tail, and it retracts into the impact point instead of
 * blinking out.
 *
 * One instanced draw call, fixed ring, GPU-simulated: the CPU writes six floats
 * at spawn and never looks at it again.
 */

const VERT = /* glsl */`
attribute vec3 tPos;
attribute vec3 tDir;
attribute vec4 tA;   // spawnTime, life, speed, totalDist
attribute vec4 tB;   // length, halfWidth, brightness, seed
attribute vec3 tCol;

uniform float uTime;

varying vec2  vUv;
varying vec3  vCol;
varying float vAlpha;
varying float vViewZ;
varying vec4  vClip;

#include <fog_pars_vertex>

void main() {
  float t = uTime - tA.x;
  if (t < 0.0 || t >= tA.y) { vAlpha = 0.0; gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  float head = min(t * tA.z, tA.w);
  float tail = max(head - tB.x, 0.0);
  if (tail >= tA.w - 0.001) { vAlpha = 0.0; gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  // Retract into the impact rather than popping off.
  tail = max(tail, head - tB.x);

  float f = position.y + 0.5;             // 0 at tail, 1 at head
  vec3 center = tPos + tDir * mix(tail, head, f);
  vec3 toCam = normalize(cameraPosition - center);
  vec3 side = cross(tDir, toCam);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  // Head-on tracers would collapse to nothing; keep a minimum core.
  float w = tB.y * mix(0.45, 1.0, sl) ;
  center += side * (position.x * 2.0 * w);

  float u = t / tA.y;
  vAlpha = tB.z * (1.0 - smoothstep(0.35, 1.0, u));
  vCol = tCol;
  vUv = vec2(position.x + 0.5, f);

  vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
  vViewZ = -mvPosition.z;
  vClip = projectionMatrix * mvPosition;
  gl_Position = vClip;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
varying vec2  vUv;
varying vec3  vCol;
varying float vAlpha;
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
  float xsec = 1.0 - abs(vUv.x * 2.0 - 1.0);
  xsec = pow(clamp(xsec, 0.0, 1.0), 1.6);
  // Hot at the head, exponential falloff down the tail.
  float along = pow(clamp(vUv.y, 0.0, 1.0), 2.6);
  float a = xsec * (0.22 + along) * vAlpha;
  if (a < 0.004) discard;
  a *= fxDepthFade(vClip, vViewZ);
  if (a < 0.004) discard;

  vec3 col = vCol * (0.5 + along * 2.2);
  gl_FragColor = vec4(col, a);

  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb *= (1.0 - fogFactor);
  #endif

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class TracerSystem {
  constructor({ capacity = 64 } = {}) {
    this.capacity = capacity;
    this.cursor = 0;
    this.spawned = 0;
    this.latestDeath = -1;
    this._dirtyMin = Infinity;
    this._dirtyMax = -Infinity;

    const n = capacity;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aDir = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aB = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    geo.setAttribute('tPos', this.aPos);
    geo.setAttribute('tDir', this.aDir);
    geo.setAttribute('tA', this.aA);
    geo.setAttribute('tB', this.aB);
    geo.setAttribute('tCol', this.aCol);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.uniforms = {
      uTime: { value: 0 },
      uDepth: { value: null },
      uCamRange: { value: new THREE.Vector2(0.02, 1200) },
      uSoftness: { value: 0.12 },
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
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: true,
      toneMapped: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 21;
    this.mesh.visible = false;
    this.mesh.name = 'fx:tracers';
  }

  /**
   * @param {THREE.Vector3} from  muzzle
   * @param {THREE.Vector3} to    impact point
   * @param {number} speed        m/s (the round's real muzzle velocity)
   */
  spawn(from, to, speed, time, color, width = 0.028, length = 6.5, brightness = 1) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.spawned++;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz) || 0.001;
    const i3 = i * 3, i4 = i * 4;
    this.aPos.array[i3] = from.x; this.aPos.array[i3 + 1] = from.y; this.aPos.array[i3 + 2] = from.z;
    this.aDir.array[i3] = dx / dist; this.aDir.array[i3 + 1] = dy / dist; this.aDir.array[i3 + 2] = dz / dist;
    const travel = dist / speed;
    const life = travel + length / speed + 0.02;
    this.aA.array[i4] = time; this.aA.array[i4 + 1] = life;
    this.aA.array[i4 + 2] = speed; this.aA.array[i4 + 3] = dist;
    this.aB.array[i4] = Math.min(length, dist * 0.85);
    this.aB.array[i4 + 1] = width;
    this.aB.array[i4 + 2] = brightness;
    this.aB.array[i4 + 3] = Math.random();
    this.aCol.array[i3] = color.r; this.aCol.array[i3 + 1] = color.g; this.aCol.array[i3 + 2] = color.b;
    if (time + life > this.latestDeath) this.latestDeath = time + life;
    if (i < this._dirtyMin) this._dirtyMin = i;
    if (i > this._dirtyMax) this._dirtyMax = i;
  }

  update(time) {
    this.uniforms.uTime.value = time;
    if (this._dirtyMin <= this._dirtyMax) {
      const start = this._dirtyMin, count = this._dirtyMax - this._dirtyMin + 1;
      const attrs = [this.aPos, this.aDir, this.aA, this.aB, this.aCol];
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i];
        a.clearUpdateRanges();
        a.addUpdateRange(start * a.itemSize, count * a.itemSize);
        a.needsUpdate = true;
      }
      this._dirtyMin = Infinity; this._dirtyMax = -Infinity;
    }
    this.geometry.instanceCount = Math.min(this.spawned, this.capacity);
    this.mesh.visible = this.geometry.instanceCount > 0 && time < this.latestDeath;
  }

  setDepth(texture, near, far) {
    this.uniforms.uDepth.value = texture;
    this.uniforms.uCamRange.value.set(near, far);
  }

  clear() { this.aA.array.fill(0); this.latestDeath = -1; this._dirtyMin = 0; this._dirtyMax = this.capacity - 1; }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
