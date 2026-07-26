#!/usr/bin/env node
/**
 * Render one vantage under several sun placements from a single boot.
 *
 *   node tools/sunsweep.mjs street 118,10.5 118,26 145,22 152,17
 *
 * Writes shots/<shot>_sun_<az>_<el>.png per pair, plus a per-frame reading of
 * how much of the lower half of the frame — the ground the player walks on —
 * is actually lit.
 *
 * This exists because the compound's street runs between two tall buildings.
 * At the authored 10.5-degree sun one of them shadows the entire vantage, so
 * every object's shadow lands inside a larger shadow and nothing reads. That
 * is a fact about the level's geometry, and no amount of shadow-map tuning
 * addresses it; the fix is a sun angle that lights the street, and the honest
 * way to find one is to look at the candidates side by side.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [shotArg, ...pairArgs] = process.argv.slice(2);
const SHOT = shotArg || 'street';
const PAIRS = (pairArgs.length ? pairArgs : ['118,10.5', '118,26', '145,22', '152,16'])
  .map(s => s.split(',').map(Number));

const PORT = Number(process.env.PROBE_PORT || 5631);
const W = Number(process.env.PROBE_WIDTH || 800);

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
const cleanup = () => { try { server.kill('SIGKILL'); } catch {} };
process.on('exit', cleanup);

for (let i = 0; i < 200; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 250));
}

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: Math.round(W * 9 / 16) } });
const stage = (s) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
page.on('pageerror', e => console.error('[pageerror]', String(e).slice(0, 300)));

await page.goto(`http://127.0.0.1:${PORT}/?shot=${SHOT}`, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction('window.__BOOTED__ === true || window.__BOOT_ERROR__ !== undefined',
  null, { timeout: 900000 });
stage('booted');

const settle = (n) => page.evaluate((target) => new Promise(resolve => {
  const e = window.__ENGINE__;
  const goal = e.frame + target;
  const tick = () => (e.frame >= goal ? resolve(e.frame) : requestAnimationFrame(tick));
  tick();
}), n);

for (const [az, el] of PAIRS) {
  await page.evaluate(([a, e]) => {
    window.__ENGINE__.modules.get('lighting').setSunAngles(a, e);
  }, [az, el]);
  // Long settle: the sun move invalidates TAA history, the AO history and the
  // volumetric accumulation all at once.
  await settle(56);
  const url = await page.evaluate(() =>
    window.__ENGINE__.renderer.domElement.toDataURL('image/png'));

  const lit = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    // Lower half only: the sky is always bright and would drown the reading.
    const d = c.getContext('2d').getImageData(0, img.height / 2, img.width, img.height / 2).data;
    let sum = 0, n = 0, bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l; n++; if (l > 110) bright++;
    }
    return { meanLuma: +(sum / n).toFixed(1), litPct: +(100 * bright / n).toFixed(1) };
  }, url);

  const name = `shots/${SHOT}_sun_${az}_${el}.png`;
  writeFileSync(name, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`${name}  az ${az} el ${el}  groundMeanLuma ${lit.meanLuma}  litPct ${lit.litPct}%`);
}

await browser.close();
process.exit(0);
