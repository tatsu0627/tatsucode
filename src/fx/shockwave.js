import * as THREE from 'three';

/**
 * SHOCKWAVE SHELL.
 *
 * A real refraction pass needs a copy of the scene colour, which lives in the
 * render module. What we can do without it — and what actually reads as a
 * pressure wave — is a multiplicative lens: the shell is blended with
 *
 *     result = dst * src + dst  =  dst * (1 + src)
 *
 * so it *brightens what is behind it in proportion to what is behind it*,
 * exactly like compressed air pushing more energy toward the eye. It is
 * HDR-correct (a bright background blooms harder through the wave than a dark
 * one) and costs one instanced sphere.
 *
 * The rim is a fresnel term, so the shell is invisible face-on and hot at the
 * silhouette, which is where a real blast wave shows.
 */

const VERT = /* glsl */`
attribute vec3 sPos;
attribute vec4 sA;   // spawnTime, life, maxRadius, seed

uniform float uTime;

varying float vFres;
varying float vAlpha;

void main() {
  float t = uTime - sA.x;
  if (t < 0.0 || t >= sA.y) { vAlpha = 0.0; gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float u = t / sA.y;
  // Fast out, decelerating — a blast front loses speed to the air.
  float r = sA.z * (1.0 - pow(1.0 - u, 2.4));
  // Slight lumpiness so it is not a perfect CG sphere.
  float lump = 1.0 + 0.08 * sin(position.x * 7.0 + sA.w * 9.0) * sin(position.z * 6.0 + sA.w * 4.0);
  vec3 wp = sPos + normalize(position) * r * lump;

  vec4 mvPosition = modelViewMatrix * vec4(wp, 1.0);
  vec3 nrm = normalize(normalMatrix * normalize(position));
  vec3 viewDir = normalize(-mvPosition.xyz);
  vFres = pow(1.0 - abs(dot(nrm, viewDir)), 3.5);
  vAlpha = (1.0 - u) * (1.0 - u);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAG = /* glsl */`
uniform vec3 uTint;
varying float vFres;
varying float vAlpha;
void main() {
  float k = vFres * vAlpha;
  if (k < 0.002) discard;
  gl_FragColor = vec4(uTint * k * 1.6, 1.0);
}
`;

export class ShockwaveSystem {
  constructor({ capacity = 6 } = {}) {
    this.capacity = capacity;
    this.cursor = 0;
    this.spawned = 0;
    this.latestDeath = -1;

    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.IcosahedronGeometry(1, 2);
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.normal = base.attributes.normal;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    geo.setAttribute('sPos', this.aPos);
    geo.setAttribute('sA', this.aA);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.uniforms = {
      uTime: { value: 0 },
      uTint: { value: new THREE.Color(1.0, 0.93, 0.82) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 18;
    this.mesh.visible = false;
    this.mesh.name = 'fx:shockwave';
  }

  spawn(point, radius, life, time) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.spawned++;
    this.aPos.array[i * 3] = point.x;
    this.aPos.array[i * 3 + 1] = point.y;
    this.aPos.array[i * 3 + 2] = point.z;
    this.aA.array[i * 4] = time;
    this.aA.array[i * 4 + 1] = life;
    this.aA.array[i * 4 + 2] = radius;
    this.aA.array[i * 4 + 3] = Math.random() * 10;
    this.aPos.needsUpdate = true;
    this.aA.needsUpdate = true;
    if (time + life > this.latestDeath) this.latestDeath = time + life;
  }

  update(time) {
    this.uniforms.uTime.value = time;
    this.geometry.instanceCount = Math.min(this.spawned, this.capacity);
    this.mesh.visible = this.geometry.instanceCount > 0 && time < this.latestDeath;
  }

  clear() { this.aA.array.fill(0); this.latestDeath = -1; this.aA.needsUpdate = true; }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
