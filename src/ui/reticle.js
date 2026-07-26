import { C, outlinedText, ease, clamp, lerp } from './theme.js';

/**
 * RETICLE LAYER — everything that lives around the centre of the screen and
 * changes every frame: crosshair, hitmarkers, hit-direction arcs, damage
 * numbers, grenade indicators.
 *
 * These are drawn to a single canvas rather than to DOM nodes. Sub-pixel
 * animation of a dozen absolutely-positioned divs forces layer promotion and
 * paint churn every frame; one canvas is one composite. Rectangles are snapped
 * to device pixels so the crosshair is genuinely crisp at 1x, 1.5x, 2x and 3x
 * rather than a grey smear.
 *
 * The canvas is cleared only over the union of what was drawn last frame plus
 * what is being drawn now, so a mostly-idle HUD costs almost nothing.
 */
export class ReticleLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.dpr = 1;
    this.w = 1; this.h = 1;

    this.hitmarkers = [];   // {kind, t, life}
    this.dirs = [];         // {angle, t, life, amount}
    this.numbers = [];      // {x, y, vx, vy, amount, kind, t, life}
    this.grenades = new Map(); // id -> {pos, fuse, t}

    this._prevBounds = null;
    this._flash = 0;        // crosshair brighten on a confirmed hit
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._prevBounds = { x: 0, y: 0, w, h };
  }

  hitmarker(kind) {
    const life = kind === 'kill' ? 0.42 : kind === 'head' ? 0.24 : 0.18;
    this.hitmarkers.push({ kind, t: 0, life });
    if (this.hitmarkers.length > 8) this.hitmarkers.shift();
    this._flash = kind === 'kill' ? 1 : 0.6;
  }

  hitDirection(angle, amount = 20) {
    // Merge with a recent arc from roughly the same bearing so a burst of fire
    // reads as one sustained threat rather than a strobing fan of arcs.
    for (const d of this.dirs) {
      if (Math.abs(d.angle - angle) < 0.25 && d.t < d.life * 0.5) {
        d.t = 0; d.amount = Math.max(d.amount, amount); return;
      }
    }
    this.dirs.push({ angle, t: 0, life: 1.25, amount });
    if (this.dirs.length > 6) this.dirs.shift();
  }

  damageNumber(sx, sy, amount, kind = 'body') {
    this.numbers.push({
      x: sx, y: sy,
      vx: (Math.random() - 0.5) * 26,
      vy: -46 - Math.random() * 16,
      amount, kind, t: 0, life: 0.95,
    });
    if (this.numbers.length > 32) this.numbers.shift();
  }

  setGrenade(id, screen, distance, fuse) {
    this.grenades.set(id, { screen, distance, fuse });
  }
  clearGrenade(id) { this.grenades.delete(id); }

  clearAll() {
    this.hitmarkers.length = 0;
    this.dirs.length = 0;
    this.numbers.length = 0;
    this.grenades.clear();
  }

  // -------------------------------------------------------------------------

  update(dt) {
    const step = a => {
      for (let i = a.length - 1; i >= 0; i--) {
        a[i].t += dt;
        if (a[i].t >= a[i].life) a.splice(i, 1);
      }
    };
    step(this.hitmarkers); step(this.dirs);
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.vy += 62 * dt;            // gentle gravity so they arc, not float
      n.vx *= 1 - 2.0 * dt;
      if (n.t >= n.life) this.numbers.splice(i, 1);
    }
    this._flash = Math.max(0, this._flash - dt * 5.5);
  }

  /**
   * @param s {spread, ads, hidden, hipFire, lowAmmo}
   */
  draw(s) {
    const ctx = this.ctx, dpr = this.dpr;
    const cx = Math.round(this.w / 2), cy = Math.round(this.h / 2);

    // ---- clear only what we touched ----------------------------------------
    const reach = this._reach(s);
    const b = {
      x: clamp(cx - reach.x, 0, this.w), y: clamp(cy - reach.y, 0, this.h),
      w: Math.min(reach.x * 2, this.w), h: Math.min(reach.y * 2, this.h),
    };
    const p = this._prevBounds;
    const un = p ? {
      x: Math.min(b.x, p.x), y: Math.min(b.y, p.y),
      w: Math.max(b.x + b.w, p.x + p.w) - Math.min(b.x, p.x),
      h: Math.max(b.y + b.h, p.y + p.h) - Math.min(b.y, p.y),
    } : b;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(un.x - 2, un.y - 2, un.w + 4, un.h + 4);
    this._prevBounds = b;

    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    this._drawDirs(ctx, cx, cy);
    this._drawGrenades(ctx, cx, cy);
    if (!s.hidden) this._drawCrosshair(ctx, cx, cy, s);
    this._drawHitmarkers(ctx, cx, cy);
    this._drawNumbers(ctx);
  }

  /** Half-extent of everything currently on this layer, in CSS px. */
  _reach(s) {
    let r = 40 + (s.spread || 0);
    if (this.hitmarkers.length) r = Math.max(r, 46);
    if (this.dirs.length) r = Math.max(r, 190);
    if (this.grenades.size) r = Math.max(r, Math.max(this.w, this.h));
    let rx = r, ry = r;
    for (const n of this.numbers) {
      rx = Math.max(rx, Math.abs(n.x - this.w / 2) + 60);
      ry = Math.max(ry, Math.abs(n.y - this.h / 2) + 40);
    }
    return { x: rx, y: ry };
  }

  /** Device-pixel-snapped filled rect — the reason the crosshair looks sharp. */
  _rect(ctx, x, y, w, h, color, alpha = 1) {
    const d = this.dpr;
    const x0 = Math.round(x * d) / d, y0 = Math.round(y * d) / d;
    const x1 = Math.round((x + w) * d) / d, y1 = Math.round((y + h) * d) / d;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, Math.max(1 / d, x1 - x0), Math.max(1 / d, y1 - y0));
    ctx.globalAlpha = 1;
  }

  /** A stroke plus a one-device-pixel dark halo, so it reads on sky and dirt. */
  _stroke(ctx, x, y, w, h, color, alpha) {
    const o = 1 / this.dpr;
    this._rect(ctx, x - o, y - o, w + o * 2, h + o * 2, C.shadow, alpha * 0.85);
    this._rect(ctx, x, y, w, h, color, alpha);
  }

  _drawCrosshair(ctx, cx, cy, s) {
    const ads = s.ads || 0;
    // Fully sighted: the optic is the sight picture, the reticle would double it.
    const vis = 1 - ease.outCubic(clamp((ads - 0.45) / 0.4, 0, 1));
    if (vis <= 0.01) return;

    const bloom = s.spread || 0;
    const gap = lerp(4.0, 2.0, ads) + bloom * 0.5;
    const len = lerp(8.5, 4.5, ads);
    const th = lerp(2.0, 1.5, ads);
    const boost = this._flash;
    const col = boost > 0 ? C.ink : C.ink;
    const a = vis * (0.82 + boost * 0.18);

    const hx = th / 2;
    // top / bottom
    this._stroke(ctx, cx - hx, cy - gap - len, th, len, col, a);
    this._stroke(ctx, cx - hx, cy + gap, th, len, col, a);
    // left / right
    this._stroke(ctx, cx - gap - len, cy - hx, len, th, col, a);
    this._stroke(ctx, cx + gap, cy - hx, len, th, col, a);

    // Settle pip: only visible when the weapon is actually accurate. It gives
    // the player a read on when the bloom has recovered without a bar.
    const settled = 1 - clamp(bloom / 9, 0, 1);
    if (settled > 0.02) {
      this._rect(ctx, cx - 0.5, cy - 0.5, 1, 1, C.ink, settled * 0.5 * vis);
    }
  }

  _drawHitmarkers(ctx, cx, cy) {
    for (const m of this.hitmarkers) {
      const t = m.t / m.life;
      const k = m.kind;
      // Fast attack (~35 ms to full), quick decay — snappy, never mushy.
      const att = clamp(m.t / 0.028, 0, 1);
      const dec = 1 - ease.inQuad(clamp((t - 0.16) / 0.84, 0, 1));
      const a = att * dec;
      if (a <= 0.01) continue;
      const punch = 1 + 0.42 * (1 - ease.outQuint(clamp(m.t / 0.11, 0, 1)));

      const cfg = k === 'head'
        ? { r0: 4.6, r1: 15.5, lw: 3.1, col: C.ink }
        : k === 'kill'
          ? { r0: 5.0, r1: 14.5, lw: 2.9, col: C.danger }
          : { r0: 5.0, r1: 12.5, lw: 2.2, col: C.ink };

      const r0 = cfg.r0 * punch, r1 = cfg.r1 * punch;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = a;

      // dark halo pass, then the bright pass
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? C.shadow : cfg.col;
        ctx.lineWidth = pass === 0 ? cfg.lw + 2.0 : cfg.lw;
        ctx.globalAlpha = pass === 0 ? a * 0.8 : a;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const ang = Math.PI / 4 + (i * Math.PI) / 2;
          const dx = Math.cos(ang), dy = Math.sin(ang);
          ctx.moveTo(dx * r0, dy * r0);
          ctx.lineTo(dx * r1, dy * r1);
        }
        ctx.stroke();
      }

      // Headshot: outer ticks make it read as heavier and *sharper* instantly.
      if (k === 'head') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const ang = Math.PI / 4 + (i * Math.PI) / 2;
          const dx = Math.cos(ang), dy = Math.sin(ang);
          ctx.moveTo(dx * (r1 + 3.2), dy * (r1 + 3.2));
          ctx.lineTo(dx * (r1 + 7.0), dy * (r1 + 7.0));
        }
        ctx.stroke();
      }

      // Kill: a single expanding ring, gone in a quarter second.
      if (k === 'kill') {
        const rt = ease.outQuint(clamp(m.t / 0.3, 0, 1));
        ctx.globalAlpha = a * (1 - rt) * 0.9;
        ctx.strokeStyle = C.danger;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.arc(0, 0, 9 + rt * 20, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  _drawDirs(ctx, cx, cy) {
    for (const d of this.dirs) {
      const t = d.t / d.life;
      const a = clamp(d.t / 0.05, 0, 1) * (1 - ease.inQuad(clamp((t - 0.35) / 0.65, 0, 1)));
      if (a <= 0.01) continue;
      const R = 116;
      const span = lerp(0.30, 0.46, clamp(d.amount / 45, 0, 1));
      const push = (1 - ease.outCubic(clamp(d.t / 0.18, 0, 1))) * 10;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(d.angle);
      ctx.translate(0, -(R + push));

      // Soft red bleed behind the chevron, then the hard edge on top.
      const g = ctx.createLinearGradient(0, -26, 0, 16);
      g.addColorStop(0, 'rgba(255,60,40,0)');
      g.addColorStop(1, `rgba(255,60,40,${0.30 * a})`);
      ctx.fillStyle = g;
      const halfw = Math.tan(span) * R;
      ctx.beginPath();
      ctx.moveTo(-halfw, 16); ctx.lineTo(0, -26); ctx.lineTo(halfw, 16);
      ctx.closePath(); ctx.fill();

      ctx.globalAlpha = a;
      ctx.strokeStyle = C.shadow; ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.moveTo(-halfw, 8); ctx.lineTo(0, -12); ctx.lineTo(halfw, 8);
      ctx.stroke();
      ctx.strokeStyle = C.danger; ctx.lineWidth = 3.0;
      ctx.beginPath();
      ctx.moveTo(-halfw, 8); ctx.lineTo(0, -12); ctx.lineTo(halfw, 8);
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  _drawNumbers(ctx) {
    for (const n of this.numbers) {
      const t = n.t / n.life;
      const a = clamp(n.t / 0.04, 0, 1) * (1 - ease.inQuad(clamp((t - 0.5) / 0.5, 0, 1)));
      const pop = 1 + 0.35 * (1 - ease.outQuint(clamp(n.t / 0.14, 0, 1)));
      const head = n.kind === 'head' || n.kind === 'kill';
      outlinedText(ctx, String(Math.round(n.amount)), n.x, n.y, {
        size: (head ? 19 : 15) * pop,
        weight: head ? 700 : 600,
        fill: n.kind === 'kill' ? C.danger : head ? C.warn : C.ink,
        align: 'center', baseline: 'middle', alpha: a, outlineWidth: 3,
      });
    }
  }

  _drawGrenades(ctx, cx, cy) {
    for (const [, g] of this.grenades) {
      const urgency = clamp(1 - g.fuse / 2.4, 0, 1);
      // Pulse rate climbs as the fuse burns down — the read is in the rhythm.
      const rate = lerp(3.2, 13.0, urgency);
      const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.001 * rate * Math.PI);
      const a = 0.55 + 0.45 * pulse;

      let x, y, edge = false;
      if (g.screen.onScreen) {
        x = g.screen.x; y = g.screen.y;
      } else {
        const R = Math.min(this.w, this.h) * 0.33;
        x = cx + Math.sin(g.screen.angle) * R;
        y = cy - Math.cos(g.screen.angle) * R;
        edge = true;
      }

      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = C.shadow; ctx.lineWidth = 4.5;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = C.danger; ctx.lineWidth = 2.0;
      ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();

      // Fuse ring drains clockwise from 12 o'clock.
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.danger; ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(x, y, 15.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(g.fuse / 3.5, 0, 1));
      ctx.stroke();

      // Pin glyph
      ctx.globalAlpha = a;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y - 4.5); ctx.lineTo(x, y + 4.5);
      ctx.moveTo(x - 4.5, y); ctx.lineTo(x + 4.5, y);
      ctx.stroke();

      if (edge) {
        ctx.translate(x, y);
        ctx.rotate(g.screen.angle);
        ctx.fillStyle = C.danger;
        ctx.beginPath();
        ctx.moveTo(0, -21); ctx.lineTo(5.5, -14); ctx.lineTo(-5.5, -14);
        ctx.closePath(); ctx.fill();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      if (g.distance != null && g.distance < 14) {
        outlinedText(ctx, 'GRENADE', x, y + 30, {
          size: 11, weight: 700, fill: C.danger, align: 'center',
          baseline: 'middle', tracking: 1.6, alpha: a,
        });
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
