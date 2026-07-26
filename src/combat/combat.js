import * as THREE from 'three';

/**
 * Resolves shots, damage, and physical impact response.
 * 
 * CONTRACT
 *   fireShot({origin, dir, weapon, shooter}) — traces against world.raycastTargets
 *        and ai hitboxes, applies damage, and asks fx for the impact response.
 *        Returns the hit record or null.
 *   applyDamage(target, amount, hitInfo)
 *   Impact effects must be requested via engine.get('fx'), never spawned here, so
 *   VFX budget stays in one place.
 */
export class CombatModule {
  constructor() {
    this.shotsFired = 0;
  }

  async init(engine) { this.engine = engine; }

  fireShot({ origin, dir, weapon, shooter }) {
    this.shotsFired++;
    return null;
  }

  applyDamage(target, amount, hitInfo) {}
  update(dt) {}
}
