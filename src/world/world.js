import * as THREE from 'three';

/**
 * Owns level geometry, materials, and static props.
 * 
 * CONTRACT
 *   root                — THREE.Group added to engine.scene holding all level geo.
 *   colliders           — array of THREE.Box3 (or {box, mesh}) used by the player
 *                         controller and combat raycasts for broadphase.
 *   raycastTargets      — array of Meshes that bullets/decals may hit.
 *   spawnPoints         — array of {pos:[x,y,z], yaw:number} for player + AI.
 *   getMaterial(name)   — shared material lookup so other modules reuse, not clone.
 */
export class WorldModule {
  constructor() {
    this.root = null;
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

  update(dt) {}
}
