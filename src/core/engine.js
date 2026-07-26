import * as THREE from 'three';

/**
 * Engine — owns the WebGL context, the frame loop, and the module graph.
 *
 * Modules are plain objects registered with `engine.add(name, module)`.
 * A module may implement any of:
 *   async init(engine)      — called once, in registration order, before the loop starts
 *   update(dt, engine)      — called every frame, fixed order, before render
 *   lateUpdate(dt, engine)  — called every frame, after all update() calls
 *   resize(w, h, engine)    — called on viewport change
 *
 * Modules reach each other through `engine.get(name)`. Keep the surface small
 * and documented at the top of each module file.
 */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.modules = new Map();
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.frame = 0;
    this.paused = false;

    // Frame-time smoothing so gameplay springs don't explode on a hitch.
    this.maxDelta = 1 / 15;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // we resolve AA in the post chain (TAA/SMAA)
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();

    // 16:9-agnostic; FOV is driven by the player module (ADS zoom changes it).
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.02, 2000);
    this.camera.rotation.order = 'YXZ';

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  add(name, module) {
    if (this.modules.has(name)) throw new Error(`Engine: duplicate module "${name}"`);
    this.modules.set(name, module);
    return module;
  }

  get(name) {
    const m = this.modules.get(name);
    if (!m) throw new Error(`Engine: missing module "${name}"`);
    return m;
  }

  has(name) { return this.modules.has(name); }

  async init() {
    for (const m of this.modules.values()) {
      if (m.init) await m.init(this);
    }
    this._onResize();
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of this.modules.values()) {
      if (m.resize) m.resize(w, h, this);
    }
  }

  start() {
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), this.maxDelta);
      if (this.paused) return;
      this.elapsed += dt;
      this.frame++;

      for (const m of this.modules.values()) if (m.update) m.update(dt, this);
      for (const m of this.modules.values()) if (m.lateUpdate) m.lateUpdate(dt, this);

      // The render module is responsible for the actual draw (post chain).
      const render = this.modules.get('render');
      if (render && render.render) render.render(dt, this);
      else { this.renderer.clear(); this.renderer.render(this.scene, this.camera); }
    };
    loop();
  }

  stop() { cancelAnimationFrame(this._raf); }
}
