import * as THREE from 'three';

/**
 * Owns the frame's draw call and the entire post-processing chain.
 * 
 * CONTRACT
 *   render(dt, engine)  — REQUIRED. Draws engine.scene with engine.camera. If this
 *                         module does not draw, nothing appears on screen.
 *   quality             — {preset:'low'|'high'|'ultra'} read by other modules to
 *                         scale their own cost (particle counts, shadow res).
 *   needsVelocity       — true if the chain consumes a velocity buffer; the world
 *                         module must then keep previous-frame matrices.
 *   passes              — map of pass name -> enabled flag, for the debug UI.
 */
export class RenderModule {
  constructor() {
    this.quality = { preset: 'ultra' };
    this.needsVelocity = true;
    this.passes = {};
  }

  async init(engine) {
    this.engine = engine;
  }

  render(dt, engine) {
    engine.renderer.clear();
    engine.renderer.render(engine.scene, engine.camera);
  }

  resize(w, h) {}
}
