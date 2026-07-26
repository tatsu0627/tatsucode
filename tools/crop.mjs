#!/usr/bin/env node
/**
 * Crop and magnify a region of a rendered frame so it can actually be looked at.
 *
 *   node tools/crop.mjs shots/street.png 1150,560,1550,820 4
 *
 * A 1600x900 frame is downsampled to roughly a third of its size before it
 * reaches a reviewer's eye, which is exactly the scale at which "is that a
 * contact shadow or asphalt noise?" becomes unanswerable. Writes
 * shots/crop.png.
 *
 * Uses the installed headless Chromium as the codec rather than adding an
 * image dependency, same as tools/pixels.mjs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [file, region, zoomArg, outArg] = process.argv.slice(2);
if (!file || !existsSync(file) || !region) {
  console.error('usage: crop.mjs <file.png> x0,y0,x1,y1 [zoom] [out.png]');
  process.exit(1);
}
const [x0, y0, x1, y1] = region.split(',').map(Number);
const zoom = Number(zoomArg || 2);
const out = outArg || 'shots/crop.png';

const dataUrl = 'data:image/png;base64,' + readFileSync(file).toString('base64');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
});
const page = await browser.newPage();

const b64 = await page.evaluate(async ({ dataUrl, x0, y0, x1, y1, zoom }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const w = x1 - x0, h = y1 - y0;
  const c = document.createElement('canvas');
  c.width = Math.round(w * zoom); c.height = Math.round(h * zoom);
  const ctx = c.getContext('2d');
  // Nearest-neighbour: interpolation invents gradients, and a soft edge that
  // the upscaler produced is indistinguishable from a soft penumbra.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x0, y0, w, h, 0, 0, c.width, c.height);
  return c.toDataURL('image/png').split(',')[1];
}, { dataUrl, x0, y0, x1, y1, zoom });

writeFileSync(out, Buffer.from(b64, 'base64'));
console.log(`${out}  ${Math.round((x1 - x0) * zoom)}x${Math.round((y1 - y0) * zoom)}  from ${file} [${x0},${y0} ${x1},${y1}] @${zoom}x`);
await browser.close();
