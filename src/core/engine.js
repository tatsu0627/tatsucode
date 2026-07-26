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

    // Capture mode reads pixels straight off the canvas via toDataURL, which
    // requires the drawing buffer to survive past the frame. It costs
    // performance, so it is only enabled when a screenshot is being taken.
    const capturing = new URLSearchParams(location.search).has('shot');

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // we resolve AA in the post chain (TAA/SMAA)
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: capturing,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The post chain owns tonemapping: its composite pass applies ACES at the
    // end, on HDR values. Leaving the renderer's tonemapper on would tonemap
    // the scene a second time on its way into the HDR buffer, flattening
    // contrast before the chain ever sees it.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    // PCFShadowMap, NOT PCFSoftShadowMap. r185 only maps PCFShadowMap and
    // VSMShadowMap to a define; every other value — including
    // PCFSoftShadowMap — falls through to SHADOWMAP_TYPE_BASIC, which is one
    // unfiltered depth comparison with no kernel and no `shadow.radius`. It
    // fails silently: shadows still render, so the rig looks configured, but
    // at a 10.5-degree sun the per-texel acne on ground planes averages out to
    // a flat ~13/255 veil over the whole frame and no shadow has a readable
    // shape. PCFShadowMap is the Vogel-disk path (5 hardware-PCF taps rotated
    // per pixel by interleaved gradient noise) that src/lighting/shadows.js
    // tunes its radii against.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
