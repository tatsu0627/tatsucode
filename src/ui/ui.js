import * as THREE from 'three';

/**
 * Owns all DOM overlay: HUD, menus, hitmarkers, killfeed.
 * 
 * CONTRACT
 *   Renders into #ui-root. Must never poll other modules in a tight loop; read
 *   state once per frame in update().
 *   hitmarker(kind)     — 'body' | 'head' | 'kill', called by combat.
 *   setCrosshairSpread(px)
 *   Everything must be hidden when engine.captureMode is set unless the shot asks
 *   for HUD, so screenshots judge the render, not the overlay.
 */
export class UiModule {
  constructor() {
    this.root = null;
  }

  async init(engine) {
    this.engine = engine;
    this.root = document.getElementById('ui-root');
  }

  hitmarker(kind) {}
  setCrosshairSpread(px) {}
  update(dt) {}
}
