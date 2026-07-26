import * as THREE from 'three';

/**
 * Owns input, movement, collision response and the camera transform.
 * 
 * CONTRACT
 *   enabled             — when false the module must not touch the camera (capture
 *                         mode relies on this).
 *   setPose(pos, look)  — teleport for capture mode.
 *   state               — {onGround, sprinting, crouching, ads, velocity:Vector3,
 *                         speed} read by weapons (sway), ui (HUD), audio (steps).
 *   health, maxHealth   — combat writes damage here; ui reads it.
 *   camera shake is applied via addShake(trauma) so recoil/explosions compose.
 */
export class PlayerModule {
  constructor() {
    this.enabled = true;
    this.state = {
      onGround: true, sprinting: false, crouching: false, ads: false,
      velocity: new THREE.Vector3(), speed: 0,
    };
    this.health = 100;
    this.maxHealth = 100;
    this._trauma = 0;
  }

  async init(engine) {
    this.engine = engine;
    const spawn = engine.get('world').spawnPoints[0];
    engine.camera.position.fromArray(spawn.pos);
  }

  setPose(pos, look) {
    this.engine.camera.position.fromArray(pos);
    this.engine.camera.lookAt(new THREE.Vector3().fromArray(look));
  }

  addShake(trauma) { this._trauma = Math.min(1, this._trauma + trauma); }

  update(dt) {
    if (!this.enabled) return;
    this._trauma = Math.max(0, this._trauma - dt * 1.5);
  }
}
