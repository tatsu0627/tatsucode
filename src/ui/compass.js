import { C, outlinedText, clamp } from './theme.js';

const SPAN = 110;           // degrees of world visible across the strip
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * COMPASS STRIP — top-centre bearing tape with objective markers.
 *
 * Redrawn only when the heading actually moves (or a marker changes), which for
 * a player standing still is never. The strip is a small canvas (470x42 CSS px)
 * so even continuous turning costs a rounding error of a frame.
 */
export class Compass {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 470; this.h = 42;
    this.dpr = 1;
    this.markers = [];      // {bearing, kind, label, dist}
    this._lastHeading = -999;
    this._dirty = true;
  }

  resize(dpr) {
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this._dirty = true;
  }

  setMarkers(list) { this.markers = list || []; this._dirty = true; }

  draw(heading) {
    if (!this._dirty && Math.abs(heading - this._lastHeading) < 0.08) return;
    this._lastHeading = heading;
    this._dirty = false;

    const ctx = this.ctx, W = this.w, H = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pxDeg = W / SPAN;
    const cx = W / 2;
    const fade = x => 1 - clamp((Math.abs(x - cx) / (W / 2) - 0.58) / 0.42, 0, 1);
    const delta = d => { let a = d - heading; while (a > 180) a -= 360; while (a < -180) a += 360; return a; };

    const RULE_Y = 33.5, TICK_B = 33, LETTER_Y = 22;

    // Baseline rule, faded at both ends so the tape has no hard termination.
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0.00, 'rgba(216,227,231,0)');
    g.addColorStop(0.18, 'rgba(216,227,231,0.22)');
    g.addColorStop(0.82, 'rgba(216,227,231,0.22)');
    g.addColorStop(1.00, 'rgba(216,227,231,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.round(RULE_Y * this.dpr) / this.dpr, W, 1 / this.dpr);

    // Ticks: minor every 5 degrees, major every 15, letters every 45.
    const start = Math.ceil((heading - SPAN / 2) / 5) * 5;
    for (let d = start; d <= heading + SPAN / 2; d += 5) {
      const x = cx + delta(d) * pxDeg;
      const a = fade(x);
      if (a <= 0.01) continue;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 15 === 0;
      const card = dd % 45 === 0;
      const len = card ? 9 : major ? 7 : 4;
      const wpx = card ? 1.6 : 1;
      const xs = Math.round((x - wpx / 2) * this.dpr) / this.dpr;
      ctx.globalAlpha = a * (card ? 0.95 : major ? 0.6 : 0.34);
      ctx.fillStyle = C.ink;
      ctx.fillRect(xs, TICK_B - len, wpx, len);

      if (card) {
        const letter = CARDINALS[(dd / 45) % 8];
        const cardinalPoint = dd % 90 === 0;
        outlinedText(ctx, letter, x, LETTER_Y, {
          size: cardinalPoint ? 15 : 12,
          weight: cardinalPoint ? 700 : 600,
          fill: cardinalPoint ? C.ink : C.steelDim,
          align: 'center', baseline: 'alphabetic',
          tracking: 0.6, alpha: a, outlineWidth: 3,
        });
      }
    }
    ctx.globalAlpha = 1;

    // Markers ride above the letters, clamped to the tape ends when off-span.
    for (const m of this.markers) {
      const dl = delta(m.bearing);
      const off = Math.abs(dl) > SPAN / 2;
      const x = clamp(cx + dl * pxDeg, 10, W - 10);
      const col = m.kind === 'enemy' ? C.danger : m.kind === 'ally' ? C.friendly : C.ink;
      ctx.save();
      ctx.globalAlpha = off ? 0.55 : 1;
      ctx.translate(x, 9);
      ctx.strokeStyle = C.shadow; ctx.lineWidth = 3.2;
      ctx.fillStyle = col;
      ctx.beginPath();
      if (m.kind === 'objective') {
        ctx.moveTo(0, -5.5); ctx.lineTo(5, 0); ctx.lineTo(0, 5.5); ctx.lineTo(-5, 0);
      } else {
        ctx.moveTo(0, -5); ctx.lineTo(4.6, 4); ctx.lineTo(-4.6, 4);
      }
      ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.restore();
    }

    // Centre caret — the "you are looking here" index.
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    ctx.moveTo(cx, 36.5); ctx.lineTo(cx + 5.5, 43); ctx.lineTo(cx - 5.5, 43);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.ink;
    ctx.beginPath();
    ctx.moveTo(cx, 38); ctx.lineTo(cx + 4, 43); ctx.lineTo(cx - 4, 43);
    ctx.closePath(); ctx.fill();
  }
}
