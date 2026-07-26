/**
 * HUD THEME — the colour and type language of the overlay.
 *
 * The scene (see core/artdirection.js) is a warm, sun-bleached desert compound:
 * sand #bfa984, haze #c9b79a, warm key light. A warm HUD would vibrate against
 * that and disappear into the dirt, so the overlay is deliberately *cool and
 * low-chroma*: near-white structure, steel-blue secondary, and colour spent only
 * where it carries meaning (amber = low, red = harm).
 *
 * Every stroke gets a dark outline rather than a blur-shadow — an outline stays
 * crisp at any DPI, a blur turns to mush at 1x and haloes at 3x.
 */

export const C = {
  ink:       'rgba(234,239,241,0.95)',   // primary strokes / numerals
  inkSoft:   'rgba(234,239,241,0.72)',
  inkDim:    'rgba(216,227,231,0.42)',   // labels, rules
  inkFaint:  'rgba(216,227,231,0.20)',
  steel:     'rgba(150,183,196,0.90)',   // secondary data (reserve ammo, bearing)
  steelDim:  'rgba(150,183,196,0.50)',
  shadow:    'rgba(3,6,9,0.70)',         // outline behind every light stroke
  warn:      'rgba(255,176,58,0.95)',    // low ammo
  danger:    'rgba(255,74,53,0.95)',     // damage, kill
  dangerDim: 'rgba(255,74,53,0.55)',
  blood:     'rgba(126,14,10,1)',
  friendly:  'rgba(150,196,255,0.95)',
};

// Condensed grotesque stack. Every entry is a real system face on some platform;
// the last resorts still get squeezed by font-stretch where the engine honours it.
export const FONT =
  '"Bahnschrift","DIN Alternate","DIN Condensed","Roboto Condensed",' +
  '"Archivo Narrow","Liberation Sans Narrow","Helvetica Neue Condensed",' +
  '"Arial Narrow",ui-sans-serif,system-ui,sans-serif';

/** Canvas font shorthand with the condensed stack. */
export function font(px, weight = 600, tracking = 0) {
  return `${weight} ${px}px ${FONT}`;
}

/**
 * Draw text with a hard dark outline. Cheaper and sharper than shadowBlur, and
 * it survives being composited over both blown-out sky and dark dirt.
 */
export function outlinedText(ctx, text, x, y, {
  size = 12, weight = 600, fill = C.ink, align = 'left', baseline = 'alphabetic',
  tracking = 0, outline = C.shadow, outlineWidth = 2.6, alpha = 1,
} = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = font(size, weight);
  ctx.textAlign = tracking ? 'left' : align;
  ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = outlineWidth;
  ctx.strokeStyle = outline;
  ctx.fillStyle = fill;

  if (!tracking) {
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
    return;
  }
  // Manual letter-spacing: ctx.letterSpacing is not universally supported.
  const chars = [...text];
  let total = 0;
  for (const ch of chars) total += ctx.measureText(ch).width + tracking;
  total -= tracking;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  for (const ch of chars) {
    ctx.strokeText(ch, cx, y);
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  ctx.restore();
}

/** Ease helpers — snappy attack, quick decay is the whole feel of a hitmarker. */
export const ease = {
  outCubic: t => 1 - Math.pow(1 - t, 3),
  outQuint: t => 1 - Math.pow(1 - t, 5),
  inQuad:   t => t * t,
  // Fast rise, slow-ish fall, peaked at ~12% of the life.
  punch: t => (t < 0.12 ? t / 0.12 : Math.pow(1 - (t - 0.12) / 0.88, 2.2)),
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
