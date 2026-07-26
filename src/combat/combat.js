import * as THREE from 'three';

/**
 * Resolves shots, damage, and physical impact response.
 *
 * CONTRACT
 *   fireShot({origin, dir, weapon, shooter}) — traces against
 *        world.raycastTargets and ai hitboxes, applies damage, and asks fx for
 *        the impact response. Returns the hit record or null.
 *   applyDamage(target, amount, hitInfo)
 *
 * Impact effects are always requested through engine.get('fx') and never
 * spawned here, so the particle budget stays owned in one place.
 */

// Damage multiplier by hitbox tag. Head is lethal in two rounds at full damage,
// which is roughly where a modern military shooter sits.
const MULTIPLIER = { head: 3.6, chest: 1.0, stomach: 1.1, limb: 0.72 };

// Damage falls off with range. Below `near` the weapon does full damage, beyond
// `far` it does `floor` of it, interpolated in between.
const FALLOFF = { near: 28, far: 75, floor: 0.55 };

export class CombatModule {
  constructor() {
    this.shotsFired = 0;
    this.hits = 0;

    this._ray = new THREE.Raycaster();
    this._ray.far = 400;
    this._end = new THREE.Vector3();
    this._point = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._box = new THREE.Box3();
  }

  async init(engine) {
    this.engine = engine;
  }

  /**
   * Trace a shot. Characters are tested first against their hitboxes, then the
   * world; whichever is nearer wins, so an enemy standing against a wall cannot
   * be shot through it and a wall cannot be shot through an enemy.
   */
  fireShot({ origin, dir, weapon, shooter }) {
    this.shotsFired++;
    const engine = this.engine;
    const world = engine.modules.get('world');
    const ai = engine.modules.get('ai');
    const fx = engine.modules.get('fx');

    this._ray.set(origin, dir);

    // Shots from anyone but the player are resolved against the player instead
    // of against the AI roster — otherwise an agent firing would hit its own
    // squad and never the person it is shooting at.
    if (shooter && shooter !== 'player') {
      return this._resolveAgainstPlayer({ origin, dir, weapon, shooter, world, fx });
    }

    // --- characters --------------------------------------------------------
    let best = null;
    for (const agent of ai?.agents ?? []) {
      if (!agent.alive) continue;
      for (const hb of agent.hitboxes ?? []) {
        const box = hb.box ?? this._box.setFromObject(hb.mesh);
        const t = this._ray.ray.intersectBox(box, this._point);
        if (!t) continue;
        const d = origin.distanceTo(this._point);
        if (!best || d < best.distance) {
          best = {
            distance: d, agent, hitbox: hb,
            point: this._point.clone(),
            normal: dir.clone().negate(),
            tag: hb.tag ?? 'chest',
            multiplier: hb.multiplier ?? MULTIPLIER[hb.tag] ?? 1,
          };
        }
      }
    }

    // --- world -------------------------------------------------------------
    const targets = world?.raycastTargets ?? [];
    const worldHits = targets.length ? this._ray.intersectObjects(targets, false) : [];
    const worldHit = worldHits.length ? worldHits[0] : null;

    if (worldHit && (!best || worldHit.distance < best.distance)) {
      const surface = worldHit.object?.userData?.surface ?? 'concrete';
      const n = worldHit.face
        ? this._normal.copy(worldHit.face.normal)
            .transformDirection(worldHit.object.matrixWorld)
        : this._normal.copy(dir).negate();
      fx?.impact?.(worldHit.point, n, surface);
      this._tracer(fx, origin, worldHit.point, weapon);
      return { kind: 'world', point: worldHit.point, normal: n.clone(), surface, distance: worldHit.distance };
    }

    if (best) {
      this.hits++;
      const damage = this._damageAt(weapon?.damage ?? 24, best.distance) * best.multiplier;
      const killed = this.applyDamage(best.agent, damage, best);
      if (killed) engine.modules.get('game')?.onKill?.(best.agent, { ...best, weapon });
      fx?.impact?.(best.point, best.normal, 'flesh');
      this._tracer(fx, origin, best.point, weapon);
      engine.modules.get('ui')?.hitmarker?.(killed ? 'kill' : (best.tag === 'head' ? 'head' : 'body'));
      engine.modules.get('audio')?.play?.('hitmarker');
      return { kind: 'character', ...best, damage, killed };
    }

    // Nothing hit: still draw the tracer out to its maximum range so the shot
    // reads as having gone somewhere.
    this._end.copy(origin).addScaledVector(dir, 120);
    this._tracer(fx, origin, this._end, weapon);
    return null;
  }

  /**
   * Resolve an AI shot. The player has no mesh, so it is tested as an upright
   * box around the camera; the world is traced too and whichever is nearer
   * wins, so an agent cannot shoot the player through a wall.
   */
  _resolveAgainstPlayer({ origin, dir, weapon, shooter, world, fx }) {
    const player = this.engine.modules.get('player');
    const targets = world?.raycastTargets ?? [];
    const worldHit = targets.length ? this._ray.intersectObjects(targets, false)[0] : null;

    let playerHit = null;
    if (player && !player.dead) {
      const feet = player.position;
      this._box.min.set(feet.x - 0.42, feet.y, feet.z - 0.42);
      this._box.max.set(feet.x + 0.42, feet.y + 1.80, feet.z + 0.42);
      if (this._ray.ray.intersectBox(this._box, this._point)) {
        playerHit = { point: this._point.clone(), distance: origin.distanceTo(this._point) };
      }
    }

    if (worldHit && (!playerHit || worldHit.distance < playerHit.distance)) {
      const surface = worldHit.object?.userData?.surface ?? 'concrete';
      const n = worldHit.face
        ? this._normal.copy(worldHit.face.normal).transformDirection(worldHit.object.matrixWorld)
        : this._normal.copy(dir).negate();
      fx?.impact?.(worldHit.point, n, surface);
      this._tracer(fx, origin, worldHit.point, weapon);
      return { kind: 'world', point: worldHit.point, surface, shooter };
    }

    if (playerHit) {
      const damage = this._damageAt(weapon?.damage ?? 14, playerHit.distance);
      // Direction is passed through so the player's flinch and the HUD's
      // damage indicator both point back at whoever fired.
      player.applyDamage?.(damage, { direction: dir.clone(), source: shooter });
      this._tracer(fx, origin, playerHit.point, weapon);
      return { kind: 'player', damage, shooter, distance: playerHit.distance };
    }

    this._end.copy(origin).addScaledVector(dir, 90);
    this._tracer(fx, origin, this._end, weapon);
    return null;
  }

  _damageAt(base, distance) {
    if (distance <= FALLOFF.near) return base;
    if (distance >= FALLOFF.far) return base * FALLOFF.floor;
    const t = (distance - FALLOFF.near) / (FALLOFF.far - FALLOFF.near);
    return base * THREE.MathUtils.lerp(1, FALLOFF.floor, t);
  }

  /** Only a fraction of rounds are visibly traced, as with real ammunition. */
  _tracer(fx, from, to, weapon) {
    if (!fx || Math.random() > 0.28) return;
    fx.tracer?.(from, to, weapon?.muzzleVelocity ?? 880, 1);
  }

  applyDamage(target, amount, hitInfo) {
    if (!target || !target.alive) return false;
    target.health -= amount;
    if (target.health <= 0) {
      target.alive = false;
      target.onDeath?.(hitInfo);
      return true;
    }
    target.onDamage?.(amount, hitInfo);
    return false;
  }

  update() {}
}
