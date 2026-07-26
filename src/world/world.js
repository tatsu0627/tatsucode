import * as THREE from 'three';
import { MaterialLibrary } from './materials.js';
import { buildLevel, SPAWNS } from './level.js';

/**
 * Owns level geometry, materials, and static props.
 *
 * CONTRACT
 *   root                — THREE.Group added to engine.scene holding all level geo.
 *   colliders           — array of THREE.Box3 used by the player controller and
 *                         combat raycasts for broadphase.
 *   raycastTargets      — array of Meshes that bullets/decals may hit.
 *   spawnPoints         — array of {pos:[x,y,z], yaw:number} for player + AI.
 *   getMaterial(name)   — shared material lookup so other modules reuse, not clone.
 *
 * Every texture is generated procedurally at startup (see texgen.js); nothing is
 * downloaded. Generation is the largest single startup cost, so the library is
 * built once, cached, and scaled down on lower quality presets.
 */
export class WorldModule {
  constructor() {
    this.root = null;
    this.colliders = [];
    this.raycastTargets = [];
    this.spawnPoints = SPAWNS;
    this.materials = new Map();
    this.matlib = null;
    this.stats = { tris: 0, drawCalls: 0, texMs: 0 };
  }

  async init(engine) {
    this.engine = engine;
    this.root = new THREE.Group();
    this.root.name = 'world';
    engine.scene.add(this.root);

    // Texture resolution follows the render quality preset — the generators are
    // pure CPU work, so this is most of the difference between a fast and a slow
    // boot.
    const preset = engine.modules.get('render')?.quality?.preset ?? 'ultra';
    let scale = preset === 'low' ? 0.5 : preset === 'high' ? 0.75 : 1;

    // Texture synthesis is pure CPU work and dominates startup. The screenshot
    // harness runs under SwiftShader, where full-resolution generation pushes
    // boot into the minutes and makes the review loop unusable — so captures
    // default to half resolution. Override with ?tex=1 for a final quality pass.
    const params = new URLSearchParams(location.search);
    if (params.has('shot')) scale = parseFloat(params.get('tex') || '0.5');

    this.matlib = new MaterialLibrary(engine.renderer, { scale }).buildAll();
    this.materials = this.matlib.map;

    const { targets, colliders, tris } = buildLevel(this.matlib, this.root);
    this.raycastTargets = targets;
    this.colliders = colliders;
    this.stats.tris = Math.round(tris);
    this.stats.drawCalls = targets.length;
    this.stats.texMs = Math.round(this.matlib.tex.stats.ms);

    // Surface type drives which impact effect the combat module plays.
    for (const m of targets) {
      const key = (m.material?.name || '').toLowerCase();
      m.userData.surface =
        /sandbag|sand/.test(key) ? 'sand' :
        /wood/.test(key) ? 'wood' :
        /corrugated|steel|rusted|container|grating|chainlink/.test(key) ? 'metal' :
        /tarp/.test(key) ? 'cloth' : 'concrete';
    }

    console.info(`world: ${this.stats.tris} tris, ${this.stats.drawCalls} draws, ` +
                 `textures ${this.stats.texMs}ms`);
  }

  getMaterial(name) { return this.materials.get(name); }

  update() {}
}
