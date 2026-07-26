// One-shot generator for module stubs. Each stub documents the contract that
// the owning subagent must preserve; implementations replace the bodies.
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const stubs = {
  'src/render/render.js': {
    cls: 'RenderModule',
    doc: `Owns the frame's draw call and the entire post-processing chain.

CONTRACT
  render(dt, engine)  — REQUIRED. Draws engine.scene with engine.camera. If this
                        module does not draw, nothing appears on screen.
  quality             — {preset:'low'|'high'|'ultra'} read by other modules to
                        scale their own cost (particle counts, shadow res).
  needsVelocity       — true if the chain consumes a velocity buffer; the world
                        module must then keep previous-frame matrices.
  passes              — map of pass name -> enabled flag, for the debug UI.`,
    body: `    this.quality = { preset: 'ultra' };
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

  resize(w, h) {}`,
  },

  'src/world/world.js': {
    cls: 'WorldModule',
    doc: `Owns level geometry, materials, and static props.

CONTRACT
  root                — THREE.Group added to engine.scene holding all level geo.
  colliders           — array of THREE.Box3 (or {box, mesh}) used by the player
                        controller and combat raycasts for broadphase.
  raycastTargets      — array of Meshes that bullets/decals may hit.
  spawnPoints         — array of {pos:[x,y,z], yaw:number} for player + AI.
  getMaterial(name)   — shared material lookup so other modules reuse, not clone.`,
    body: `    this.root = null;
    this.colliders = [];
    this.raycastTargets = [];
    this.spawnPoints = [{ pos: [0, 1.7, 12], yaw: 0 }];
    this.materials = new Map();
  }

  async init(engine) {
    this.engine = engine;
    this.root = new THREE.Group();
    this.root.name = 'world';
    engine.scene.add(this.root);

    // Placeholder ground so the scene is never empty before the world lands.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);
    this.raycastTargets.push(ground);
  }

  getMaterial(name) { return this.materials.get(name); }

  update(dt) {}`,
  },

  'src/lighting/lighting.js': {
    cls: 'LightingModule',
    doc: `Owns sun, sky, shadows, environment IBL, fog and volumetrics.

CONTRACT
  sun                 — the primary DirectionalLight (combat/fx read its dir).
  envMap              — PMREM-filtered environment texture applied to the scene.
  setTimeOfDay(t)     — t in [0,1]; repositions sun and regenerates sky + IBL.
  addLocalLight(...)  — registers a point/spot light within the light budget.
  Volumetrics render as a post pass; expose params on this.volumetric so the
  render module can read density/steps without importing this file.`,
    body: `    this.sun = null;
    this.envMap = null;
    this.volumetric = { enabled: true, density: 0.02, steps: 48 };
  }

  async init(engine) {
    this.engine = engine;

    this.sun = new THREE.DirectionalLight(0xfff2e0, 3.0);
    this.sun.position.set(-30, 40, -20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 200;
    const s = 40;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    this.sun.shadow.camera.updateProjectionMatrix();
    engine.scene.add(this.sun, this.sun.target);

    engine.scene.add(new THREE.HemisphereLight(0x9fc0e8, 0x40382e, 0.6));
  }

  setTimeOfDay(t) {}
  update(dt) {}`,
  },

  'src/player/player.js': {
    cls: 'PlayerModule',
    doc: `Owns input, movement, collision response and the camera transform.

CONTRACT
  enabled             — when false the module must not touch the camera (capture
                        mode relies on this).
  setPose(pos, look)  — teleport for capture mode.
  state               — {onGround, sprinting, crouching, ads, velocity:Vector3,
                        speed} read by weapons (sway), ui (HUD), audio (steps).
  health, maxHealth   — combat writes damage here; ui reads it.
  camera shake is applied via addShake(trauma) so recoil/explosions compose.`,
    body: `    this.enabled = true;
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
  }`,
  },

  'src/weapons/weapons.js': {
    cls: 'WeaponsModule',
    doc: `Owns the first-person viewmodel, weapon state and firing input.

CONTRACT
  setVisible(bool)    — capture mode toggles the viewmodel.
  current             — {name, ammo, magSize, reserve, rpm, damage, spread,
                         recoil} read by ui.
  fire() / reload()   — called by input; fire() must call
                        combat.fireShot({origin, dir, weapon}) rather than
                        resolving hits itself.
  The viewmodel renders in a separate near-plane layer (layer 1) so the render
  module can draw it without world clipping.`,
    body: `    this.visible = true;
    this.current = {
      name: 'M4', ammo: 30, magSize: 30, reserve: 210,
      rpm: 780, damage: 24, spread: 0.006,
    };
  }

  async init(engine) { this.engine = engine; }
  setVisible(v) { this.visible = v; }
  fire() {}
  reload() {}
  update(dt) {}`,
  },

  'src/combat/combat.js': {
    cls: 'CombatModule',
    doc: `Resolves shots, damage, and physical impact response.

CONTRACT
  fireShot({origin, dir, weapon, shooter}) — traces against world.raycastTargets
       and ai hitboxes, applies damage, and asks fx for the impact response.
       Returns the hit record or null.
  applyDamage(target, amount, hitInfo)
  Impact effects must be requested via engine.get('fx'), never spawned here, so
  VFX budget stays in one place.`,
    body: `    this.shotsFired = 0;
  }

  async init(engine) { this.engine = engine; }

  fireShot({ origin, dir, weapon, shooter }) {
    this.shotsFired++;
    return null;
  }

  applyDamage(target, amount, hitInfo) {}
  update(dt) {}`,
  },

  'src/fx/fx.js': {
    cls: 'FxModule',
    doc: `Owns every particle, decal, tracer and debris instance.

CONTRACT
  impact(point, normal, surfaceType)  — sparks/dust/decal for a bullet hit.
  tracer(from, to, speed)
  muzzleFlash(matrix, scale)
  explosion(point, radius)
  All systems must be instanced/pooled with a hard budget; expose this.budget
  so the render module can scale it by quality preset.`,
    body: `    this.budget = { particles: 4096, decals: 256, tracers: 64 };
  }

  async init(engine) { this.engine = engine; }
  impact(point, normal, surfaceType) {}
  tracer(from, to, speed) {}
  muzzleFlash(matrix, scale) {}
  explosion(point, radius) {}
  update(dt) {}`,
  },

  'src/ai/ai.js': {
    cls: 'AiModule',
    doc: `Owns enemy agents: navigation, decision making, animation, hitboxes.

CONTRACT
  agents              — array of agent objects, each exposing
                        {root, hitboxes:[{box, mesh, multiplier}], health, alive}
  hitboxes are what combat raycasts against; keep them updated in lateUpdate
  after animation has posed the rig.
  spawnWave(n)        — used by the game loop / debug UI.`,
    body: `    this.agents = [];
  }

  async init(engine) { this.engine = engine; }
  spawnWave(n) {}
  update(dt) {}
  lateUpdate(dt) {}`,
  },

  'src/ui/ui.js': {
    cls: 'UiModule',
    doc: `Owns all DOM overlay: HUD, menus, hitmarkers, killfeed.

CONTRACT
  Renders into #ui-root. Must never poll other modules in a tight loop; read
  state once per frame in update().
  hitmarker(kind)     — 'body' | 'head' | 'kill', called by combat.
  setCrosshairSpread(px)
  Everything must be hidden when engine.captureMode is set unless the shot asks
  for HUD, so screenshots judge the render, not the overlay.`,
    body: `    this.root = null;
  }

  async init(engine) {
    this.engine = engine;
    this.root = document.getElementById('ui-root');
  }

  hitmarker(kind) {}
  setCrosshairSpread(px) {}
  update(dt) {}`,
  },

  'src/audio/audio.js': {
    cls: 'AudioModule',
    doc: `Owns the WebAudio graph: procedural weapon/impact SFX, ambience, reverb.

CONTRACT
  Must lazily create AudioContext on first user gesture (browser policy).
  play(name, opts)    — fire-and-forget one-shot, positional if opts.position.
  setEnvironment(name)— swaps convolver impulse (indoor/outdoor/tunnel).
  Silent no-op when the context is suspended; never throw into the frame loop.`,
    body: `    this.ctx = null;
    this.enabled = true;
  }

  async init(engine) { this.engine = engine; }
  play(name, opts) {}
  setEnvironment(name) {}
  update(dt) {}`,
  },
};

for (const [path, { cls, doc, body }] of Object.entries(stubs)) {
  if (existsSync(path)) { console.log('skip (exists)', path); continue; }
  mkdirSync(dirname(path), { recursive: true });
  const src = `import * as THREE from 'three';\n\n/**\n * ${doc.split('\n').join('\n * ')}\n */\nexport class ${cls} {\n  constructor() {\n${body}\n}\n`;
  writeFileSync(path, src);
  console.log('wrote', path);
}
