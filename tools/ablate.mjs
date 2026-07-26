#!/usr/bin/env node
/**
 * Turn post-processing passes off one at a time and see what changes.
 *
 *   node tools/ablate.mjs shadows volumetric bloom dof sharpen
 *
 * Captures the vantage as shipped, then once per named pass with only that
 * pass disabled, and reports what share of the frame is clipped to white in
 * each. One boot, one settle per variant.
 *
 * Written after a fix aimed at the volumetric term produced numerically
 * identical output — same luminance, same standard deviation, to one decimal.
 * That is the signature of having attributed a symptom to the wrong pass, and
 * the cheapest correction is to stop reasoning about which pass is responsible
 * and just switch each one off.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [shotArg, ...passArgs] = process.argv.slice(2);
const SHOT = shotArg || 'shadows';
const PASSES = passArgs.length ? passArgs : ['volumetric', 'bloom', 'tonemap'];

const PORT = Number(process.env.PROBE_PORT || 5641);
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

const capture = async (label) => {
  await settle(44);
  const url = await page.evaluate(() =>
    window.__ENGINE__.renderer.domElement.toDataURL('image/png'));
  const stats = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    let clipped = 0, hot = 0, sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l; n++;
      if (l >= 250) clipped++;
      if (l >= 235) hot++;
    }
    return {
      meanLuma: +(sum / n).toFixed(1),
      clippedPct: +(100 * clipped / n).toFixed(2),
      hotPct: +(100 * hot / n).toFixed(2),
    };
  }, url);
  const f = `shots/${SHOT}_ab_${label}.png`;
  writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`${label.padEnd(14)} clipped ${String(stats.clippedPct).padStart(6)}%  ` +
    `hot ${String(stats.hotPct).padStart(6)}%  meanLuma ${stats.meanLuma}  -> ${f}`);
  return stats;
};

const base = await capture('all');

for (const name of PASSES) {
  // Re-enable everything, then drop just this one, so the variants are
  // independent rather than cumulative.
  await page.evaluate((only) => {
    const r = window.__ENGINE__.modules.get('render');
    for (const k of Object.keys(r.passes)) r.passes[k] = true;
    r.passes[only] = false;
  }, name);
  const s = await capture(`no_${name}`);
  const drop = +(base.clippedPct - s.clippedPct).toFixed(2);
  console.log(`               ^ removing ${name} changes clipped area by ${drop > 0 ? '-' : '+'}${Math.abs(drop)} points`);
}

await browser.close();
process.exit(0);
