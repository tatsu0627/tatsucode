import * as THREE from 'three';

/**
 * TRANSIENT LIGHT POOL.
 *
 * A muzzle flash that does not light the wall next to it is a sticker. These
 * are real THREE.PointLights that actually illuminate the scene for the frame
 * or two the flash lasts.
 *
 * They are created once and never added to or removed from the scene, because
 * changing the number of visible lights forces three to recompile every
 * material in the frame — a guaranteed hitch at exactly the moment the player
 * pulls the trigger. Idle lights sit at intensity 0 instead.
 *
 * Intensities are in candela against the art-direction sun (irradiance 4.2), so
 * a 120cd flash reads roughly three times the sun at one metre and falls off as
 * 1/d² like the real thing.
 */
export class LightPool {
  constructor(scene, count = 3) {
    this.slots = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 2);
      l.castShadow = false;
      l.name = `fx:light${i}`;
      scene.add(l);
      this.slots.push({ light: l, age: 0, life: 0, peak: 0, shape: 1 });
    }
  }

  /**
   * @param {number} shape  1 = linear decay (explosion), 3 = hard pulse (muzzle)
   */
  flash(pos, color, peak, distance, life, shape = 1) {
    let best = this.slots[0], bestRemain = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const remain = s.life > 0 ? (s.life - s.age) * s.peak : -1;
      if (remain < bestRemain) { bestRemain = remain; best = s; }
    }
    best.light.position.copy(pos);
    best.light.color.copy(color);
    best.light.distance = distance;
    best.age = 0;
    best.life = life;
    best.peak = peak;
    best.shape = shape;
    best.light.intensity = peak;
    return best;
  }

  update(dt) {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.life <= 0) continue;
      s.age += dt;
      if (s.age >= s.life) { s.life = 0; s.light.intensity = 0; continue; }
      const u = s.age / s.life;
      s.light.intensity = s.peak * Math.pow(1 - u, s.shape);
    }
  }

  clear() {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].life = 0;
      this.slots[i].light.intensity = 0;
    }
  }
}
