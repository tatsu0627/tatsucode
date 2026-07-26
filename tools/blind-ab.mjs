#!/usr/bin/env node
/**
 * Blind A/B harness.
 *
 *   node tools/blind-ab.mjs <imageA> <imageB> [--out dir]
 *
 * Copies two images into a review folder under neutral names (left.png /
 * right.png) in a randomised order, and writes the mapping to a separate
 * `key.json` that the reviewer must not read. The point is to remove the bias
 * that comes from knowing which image is "ours" or which is "the new one" —
 * a reviewer told that an image is the latest iteration will find it improved.
 *
 * Workflow:
 *   1. run this
 *   2. hand the reviewer ONLY review/left.png and review/right.png
 *   3. reviewer picks a winner per axis, without ever seeing key.json
 *   4. `node tools/blind-ab.mjs --reveal <dir>` decodes the verdict
 *
 * Use it for iteration-over-iteration regression checks (v3 vs v4), and for
 * comparison against a licensed reference frame if one is ever placed in the
 * repo — this environment blocks outbound image fetches, so a reference has to
 * be supplied by hand.
 */
import { copyFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);

if (args[0] === '--reveal') {
  const dir = args[1] || 'review';
  const key = JSON.parse(readFileSync(`${dir}/key.json`, 'utf8'));
  console.log(`left.png  = ${key.left}`);
  console.log(`right.png = ${key.right}`);
  process.exit(0);
}

let out = 'review';
const i = args.indexOf('--out');
if (i !== -1) { out = args[i + 1]; args.splice(i, 2); }

const [a, b] = args;
if (!a || !b) {
  console.error('usage: blind-ab.mjs <imageA> <imageB> [--out dir]');
  process.exit(1);
}
for (const f of [a, b]) {
  if (!existsSync(f)) { console.error(`missing: ${f}`); process.exit(1); }
}

mkdirSync(out, { recursive: true });

// Coin flip decides which side each image lands on.
const flip = Math.random() < 0.5;
const left = flip ? a : b;
const right = flip ? b : a;

copyFileSync(left, `${out}/left.png`);
copyFileSync(right, `${out}/right.png`);
writeFileSync(`${out}/key.json`, JSON.stringify({ left, right }, null, 2));

console.log(`Wrote ${out}/left.png and ${out}/right.png`);
console.log('Key withheld in key.json — do not show it to the reviewer.');
