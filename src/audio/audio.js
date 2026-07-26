import * as THREE from 'three';

/**
 * Owns the WebAudio graph: procedural weapon/impact SFX, ambience, reverb.
 * 
 * CONTRACT
 *   Must lazily create AudioContext on first user gesture (browser policy).
 *   play(name, opts)    — fire-and-forget one-shot, positional if opts.position.
 *   setEnvironment(name)— swaps convolver impulse (indoor/outdoor/tunnel).
 *   Silent no-op when the context is suspended; never throw into the frame loop.
 */
export class AudioModule {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  async init(engine) { this.engine = engine; }
  play(name, opts) {}
  setEnvironment(name) {}
  update(dt) {}
}
