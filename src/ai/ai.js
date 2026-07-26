import * as THREE from 'three';

/**
 * Owns enemy agents: navigation, decision making, animation, hitboxes.
 * 
 * CONTRACT
 *   agents              — array of agent objects, each exposing
 *                         {root, hitboxes:[{box, mesh, multiplier}], health, alive}
 *   hitboxes are what combat raycasts against; keep them updated in lateUpdate
 *   after animation has posed the rig.
 *   spawnWave(n)        — used by the game loop / debug UI.
 */
export class AiModule {
  constructor() {
    this.agents = [];
  }

  async init(engine) { this.engine = engine; }
  spawnWave(n) {}
  update(dt) {}
  lateUpdate(dt) {}
}
