import { C, clamp, ease } from './theme.js';

/**
 * SCREEN EFFECTS — damage direction vignettes, regenerating-health blood edges,
 * flashbang whiteout, hit flash, low-health desaturation.
 *
 * Two delivery paths, deliberately:
 *   1. `engine.screenFX` — plain numbers the render module can sample inside its
 *      post chain (desaturation, whiteout, bloomBoost, chromaticBoost, pulse).
 *      This is the good path: it happens before tonemapping and looks right.
 *   2. DOM overlays — the fallback so the game still communicates while the post
 *      chain is being written by another agent. If the render module sets
 *      `engine.screenFX.handled = true`, the DOM duplicates switch themselves off.
 *
 * Nothing here writes to the DOM unless a value actually changed.
 */
export class ScreenFx {
  constructor(engine, root) {
    this.engine = engine;
    this.el = {
      bloodEdge: root.querySelector('.fx-blood'),
      white:     root.querySelector('.fx-white'),
      hit:       root.querySelector('.fx-hit'),
      desat:     root.querySelector('.fx-desat'),
      dirs:      [...root.querySelectorAll('.fx-dir')],
    };

    this.flash = 0;          // flashbang 0..1
    this.flashTail = 0;
    this.hit = 0;            // red hit flash 0..1
    this.lowHp = 0;          // 0..1 how hurt
    this.regen = 0;          // 1 while the blood edges are clearing
    this._dirs = this.el.dirs.map(() => ({ v: 0, ang: 0 }));
    this._written = {};

    engine.screenFX = engine.screenFX || {};
    Object.assign(engine.screenFX, {
      desaturation: 0, whiteout: 0, damage: 0, bloomBoost: 0,
      chromaticBoost: 0, vignetteBoost: 0, handled: false,
    });

    this._makeBloodTexture();
  }

  /**
   * The blood edge is a generated texture, not a plain radial gradient — real
   * damage vignettes have irregular, wet-looking lobes. A pure CSS gradient
   * reads as a filter; this reads as something on the lens.
   */
  _makeBloodTexture() {
    const W = 512, H = 288;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return;

    // Deterministic so the texture is identical between runs / screenshots.
    let seed = 0x9e3779b9;
    const rnd = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed >>> 0) % 100000) / 100000;
    };

    const blob = (x, y, r, a, col) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(${col},${a})`);
      rg.addColorStop(0.45, `rgba(${col},${a * 0.55})`);
      rg.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };

    // Lobes hugging the perimeter, larger at the corners where a lens would pool.
    for (let i = 0; i < 90; i++) {
      const t = i / 90;
      const ang = t * Math.PI * 2 + rnd() * 0.2;
      const ex = W / 2 + Math.cos(ang) * W * 0.62;
      const ey = H / 2 + Math.sin(ang) * H * 0.66;
      const inward = 0.04 + rnd() * 0.20;
      const x = ex + (W / 2 - ex) * inward;
      const y = ey + (H / 2 - ey) * inward;
      blob(x, y, 30 + rnd() * 105, 0.13 + rnd() * 0.24, '104,8,6');
    }
    // A few darker, tighter clots for texture variance.
    for (let i = 0; i < 34; i++) {
      const ang = rnd() * Math.PI * 2;
      const x = W / 2 + Math.cos(ang) * W * (0.40 + rnd() * 0.22);
      const y = H / 2 + Math.sin(ang) * H * (0.42 + rnd() * 0.24);
      blob(x, y, 12 + rnd() * 40, 0.22 + rnd() * 0.3, '68,3,3');
    }
    // Punch a clean centre so the sight picture is never obscured.
    g.globalCompositeOperation = 'destination-out';
    const clear = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.52);
    clear.addColorStop(0, 'rgba(0,0,0,1)');
    clear.addColorStop(0.42, 'rgba(0,0,0,0.92)');
    clear.addColorStop(0.78, 'rgba(0,0,0,0.16)');
    clear.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = clear;
    g.fillRect(0, 0, W, H);

    try {
      if (this.el.bloodEdge) {
        this.el.bloodEdge.style.backgroundImage = `url(${cv.toDataURL('image/png')})`;
      }
    } catch { /* tainted canvas can't happen here, but never throw from the HUD */ }
  }

  // ---- events ---------------------------------------------------------------

  /** angle: radians, 0 = attacker dead ahead, +ve clockwise on screen. */
  damage(angle, amount = 20) {
    this.hit = Math.min(1, this.hit + clamp(amount / 45, 0.25, 1));
    // Reuse the weakest slot so a fresh hit always gets a visible arc.
    let slot = 0, min = Infinity;
    for (let i = 0; i < this._dirs.length; i++) {
      if (this._dirs[i].v < min) { min = this._dirs[i].v; slot = i; }
    }
    this._dirs[slot].v = 1;
    this._dirs[slot].ang = angle;
  }

  flashbang(strength = 1, duration = 4.5) {
    this.flash = Math.max(this.flash, strength);
    this.flashTail = Math.max(this.flashTail, duration);
    this._flashDur = duration;
  }

  // ---- frame ---------------------------------------------------------------

  update(dt, health01) {
    // Health-driven state. Blood edges bloom fast on damage, clear slowly as the
    // player recovers — the clearing is the feedback that regen is working.
    const hurt = clamp(1 - health01, 0, 1);
    const target = hurt <= 0.25 ? 0 : ease.inQuad((hurt - 0.25) / 0.75);
    this.lowHp += (target - this.lowHp) * (target > this.lowHp ? 1 - Math.exp(-14 * dt)
                                                              : 1 - Math.exp(-1.6 * dt));

    this.hit = Math.max(0, this.hit - dt * 4.2);

    if (this.flashTail > 0) {
      this.flashTail -= dt;
      // Hold near-white, then a long ramp out — a flashbang does not fade linearly.
      const p = 1 - clamp(this.flashTail / (this._flashDur || 4.5), 0, 1);
      this.flash = Math.pow(1 - p, 2.4) * (p < 0.06 ? 1 : 1);
      if (this.flashTail <= 0) this.flash = 0;
    }

    for (const d of this._dirs) d.v = Math.max(0, d.v - dt * 1.05);

    // ---- publish for the post chain ----------------------------------------
    const fx = this.engine.screenFX;
    fx.desaturation = clamp(this.lowHp * 0.85, 0, 1);
    fx.whiteout = this.flash;
    fx.damage = Math.max(this.hit, this.lowHp * 0.35);
    fx.bloomBoost = this.flash * 1.8;
    fx.chromaticBoost = this.hit * 0.6 + this.lowHp * 0.35;
    fx.vignetteBoost = this.lowHp * 0.4;
    fx.pulse = this.lowHp > 0.35 ? (Math.sin(performance.now() * 0.0042) * 0.5 + 0.5) : 0;

    if (fx.handled) { this._hideAll(); return; }

    // ---- DOM fallback (write only on change) --------------------------------
    const pulse = this.lowHp > 0.3
      ? 1 + 0.14 * Math.sin(performance.now() * 0.0042) : 1;
    this._set(this.el.bloodEdge, 'opacity', (this.lowHp * 0.92 * pulse).toFixed(3));
    this._set(this.el.hit, 'opacity', (this.hit * 0.55).toFixed(3));
    this._set(this.el.white, 'opacity', this.flash.toFixed(3));

    if (this.el.desat) {
      const s = this.lowHp;
      this._set(this.el.desat, 'opacity', s > 0.02 ? '1' : '0');
      if (s > 0.02) {
        this._set(this.el.desat, 'backdropFilter',
          `saturate(${(1 - s * 0.72).toFixed(2)}) contrast(${(1 + s * 0.10).toFixed(2)})`);
      }
    }

    for (let i = 0; i < this._dirs.length; i++) {
      const d = this._dirs[i], el = this.el.dirs[i];
      if (!el) continue;
      const a = ease.outCubic(clamp(d.v, 0, 1));
      this._set(el, 'opacity', (a * 0.85).toFixed(3));
      if (a > 0.001) {
        this._set(el, 'transform',
          `translate(-50%,-50%) rotate(${(d.ang * 180 / Math.PI).toFixed(1)}deg)`);
      }
    }
  }

  _hideAll() {
    this._set(this.el.bloodEdge, 'opacity', '0');
    this._set(this.el.hit, 'opacity', '0');
    this._set(this.el.white, 'opacity', '0');
    this._set(this.el.desat, 'opacity', '0');
    for (const el of this.el.dirs) this._set(el, 'opacity', '0');
  }

  _set(el, prop, value) {
    if (!el) return;
    const key = (el.dataset.fxid || (el.dataset.fxid = Math.random().toString(36).slice(2))) + prop;
    if (this._written[key] === value) return;
    this._written[key] = value;
    el.style[prop] = value;
  }
}
