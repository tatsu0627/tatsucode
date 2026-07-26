#!/usr/bin/env node
/**
 * Measure regions of a rendered frame.
 *
 *   node tools/pixels.mjs shots/street.png 250,505,320,530 0,210,620,500
 *
 * Prints mean R/G/B, mean luminance and standard deviation for each
 * x0,y0,x1,y1 region. Reports a warm/cool bias too, since "shadows should read
 * cool against a warm key" is an art-direction claim that is trivially
 * checkable and was repeatedly asserted without being verified.
 *
 * Judging frames by eye has produced several wrong conclusions in this project
 * — shadows called working when they were detached by metres, cirrus called
 * visible when there was none. A number is harder to argue with.
 *
 * Decoding goes through the headless Chromium that is already installed rather
 * than adding an image dependency.
 */
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [file, ...regionArgs] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.error('usage: pixels.mjs <file.png> [x0,y0,x1,y1 ...]');
  process.exit(1);
}

const regions = regionArgs.map(a => a.split(',').map(Number));
const dataUrl = 'data:image/png;base64,' + readFileSync(file).toString('base64');

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
});
const page = await browser.newPage();

const out = await page.evaluate(async ({ dataUrl, regions }) => {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const measure = (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.min(x0, img.width - 1));
    x1 = Math.max(x0 + 1, Math.min(x1, img.width));
    y0 = Math.max(0, Math.min(y0, img.height - 1));
    y1 = Math.max(y0 + 1, Math.min(y1, img.height));
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let r = 0, g = 0, b = 0, n = 0;
    const lums = [];
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      lums.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    }
    const mean = lums.reduce((a, v) => a + v, 0) / lums.length;
    const sd = Math.sqrt(lums.reduce((a, v) => a + (v - mean) ** 2, 0) / lums.length);
    return {
      region: [x0, y0, x1, y1],
      r: +(r / n).toFixed(1), g: +(g / n).toFixed(1), b: +(b / n).toFixed(1),
      luma: +mean.toFixed(1), sd: +sd.toFixed(2),
      // Positive = warmer than neutral, negative = cooler.
      warmth: +(((r / n) - (b / n))).toFixed(1),
    };
  };

  return {
    size: [img.width, img.height],
    results: regions.length
      ? regions.map(([x0, y0, x1, y1]) => measure(x0, y0, x1, y1))
      : [measure(0, 0, img.width, img.height)],
  };
}, { dataUrl, regions });

console.log(`${file}  ${out.size[0]}x${out.size[1]}`);
for (const r of out.results) {
  const [x0, y0, x1, y1] = r.region;
  console.log(
    `  [${x0},${y0} ${x1},${y1}]  luma ${String(r.luma).padStart(6)}  sd ${String(r.sd).padStart(6)}` +
    `  rgb ${r.r}/${r.g}/${r.b}  warmth ${r.warmth > 0 ? '+' : ''}${r.warmth}`);
}

await browser.close();
