import * as THREE from 'three';

/**
 * Owns the first-person viewmodel, weapon state and firing input.
 * 
 * CONTRACT
 *   setVisible(bool)    — capture mode toggles the viewmodel.
 *   current             — {name, ammo, magSize, reserve, rpm, damage, spread,
 *                          recoil} read by ui.
 *   fire() / reload()   — called by input; fire() must call
 *                         combat.fireShot({origin, dir, weapon}) rather than
 *                         resolving hits itself.
 *   The viewmodel renders in a separate near-plane layer (layer 1) so the render
 *   module can draw it without world clipping.
 */
export class WeaponsModule {
  constructor() {
    this.visible = true;
    this.current = {
      name: 'M4', ammo: 30, magSize: 30, reserve: 210,
      rpm: 780, damage: 24, spread: 0.006,
    };
  }

  async init(engine) { this.engine = engine; }
  setVisible(v) { this.visible = v; }
  fire() {}
  reload() {}
  update(dt) {}
}
