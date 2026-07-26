import * as THREE from 'three';

/**
 * The match: objective, death, respawn, and win/lose.
 *
 * Everything below this was a sandbox — a player, a garrison, and no reason for
 * either to be there. This module supplies the reason and the consequences.
 *
 * CONTRACT
 *   state        — 'briefing' | 'active' | 'dead' | 'complete' | 'failed'
 *   score        — {kills, deaths, remaining}
 *   start()      — begin or restart a match
 *   onKill(agent)— called by combat when an agent dies
 *
 * It drives the existing HUD through ui.notify/kill/setObjective/setMarkers
 * rather than building a second overlay, so the mission reads through the same
 * furniture as everything else.
 */

const RESPAWN_DELAY = 3.0;      // seconds dead before redeploying
const LIVES = 3;

export class GameModule {
  constructor() {
    this.state = 'briefing';
    this.score = { kills: 0, deaths: 0, remaining: 0 };
    this.livesLeft = LIVES;
    this._deadT = 0;
    this._endT = 0;
    this._announced = new Set();
    this._tmp = new THREE.Vector3();
  }

  async init(engine) {
    this.engine = engine;
    this.start();
  }

  start() {
    const ai = this.engine.modules.get('ai');
    const ui = this.engine.modules.get('ui');
    const player = this.engine.modules.get('player');

    this.state = 'active';
    this.score = { kills: 0, deaths: 0, remaining: ai?.agents?.filter(a => a.alive).length ?? 0 };
    this.livesLeft = LIVES;
    this._deadT = 0;
    this._announced.clear();

    player?.respawn?.();
    ui?.setObjective?.('SECURE THE COMPOUND');
    ui?.notify?.('OBJECTIVE · ELIMINATE THE GARRISON', 3.4);
  }

  /** Called by combat when an agent is killed. */
  onKill(agent, hitInfo) {
    const ui = this.engine.modules.get('ui');
    this.score.kills++;
    ui?.kill?.({
      killer: 'PLAYER', victim: 'HOSTILE',
      weapon: hitInfo?.weapon?.name || '',
      headshot: hitInfo?.tag === 'head',
      byPlayer: true,
    });
  }

  _remaining() {
    const ai = this.engine.modules.get('ai');
    return (ai?.agents ?? []).reduce((n, a) => n + (a.alive ? 1 : 0), 0);
  }

  update(dt, engine) {
    const player = engine.modules.get('player');
    const ui = engine.modules.get('ui');
    if (!player) return;

    const remaining = this._remaining();
    this.score.remaining = remaining;

    // Progress callouts, once each — the difference between a shooting gallery
    // and a mission is knowing where you are in it.
    if (this.state === 'active') {
      const total = engine.modules.get('ai')?.agents?.length ?? 0;
      if (total && remaining <= Math.ceil(total / 2) && !this._announced.has('half')) {
        this._announced.add('half');
        ui?.notify?.(`${remaining} HOSTILES REMAINING`, 2.4);
      }
      if (remaining === 1 && !this._announced.has('last')) {
        this._announced.add('last');
        ui?.notify?.('LAST HOSTILE', 2.4);
      }
    }

    switch (this.state) {
      case 'active': {
        if (remaining === 0) {
          this.state = 'complete';
          this._endT = 0;
          ui?.notify?.('COMPOUND SECURE', 6);
          ui?.setObjective?.('COMPOUND SECURE');
          break;
        }
        if (player.dead) {
          this.state = 'dead';
          this.score.deaths++;
          this.livesLeft--;
          this._deadT = 0;
          ui?.notify?.(this.livesLeft > 0
            ? `KIA · REDEPLOYING · ${this.livesLeft} LEFT`
            : 'KIA · MISSION FAILED', 3.2);
        }
        break;
      }

      case 'dead': {
        this._deadT += dt;
        if (this._deadT >= RESPAWN_DELAY) {
          if (this.livesLeft > 0) {
            player.respawn?.();
            this.state = 'active';
            ui?.notify?.('REDEPLOYED', 2.0);
          } else {
            this.state = 'failed';
            this._endT = 0;
            ui?.setObjective?.('MISSION FAILED');
          }
        }
        break;
      }

      case 'complete':
      case 'failed': {
        // Hold the result briefly, then reset for another run.
        this._endT += dt;
        if (this._endT >= 8) {
          const ai = engine.modules.get('ai');
          ai?.reset?.();
          this.start();
        }
        break;
      }

      default: break;
    }
  }
}
