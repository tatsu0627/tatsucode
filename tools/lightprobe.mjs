#!/usr/bin/env node
/**
 * Isolate the sun so its shadows cannot hide in the rest of the image.
 *
 *   node tools/lightprobe.mjs street
 *
 * Writes four frames from a single boot:
 *
 *   <shot>_beauty.png    the scene as shipped
 *   <shot>_sun.png       sun only — IBL, hemisphere, local lights and
 *                        volumetrics all zeroed
 *   <shot>_sunflat.png   sun only, with the shadow term switched off
 *   <shot>_sundelta.png  |sun - sunflat|, which is the shadow term alone
 *
 * With ambient removed, anything the sun does not reach is black, so a cast
 * shadow is unmissable and self-shadow acne is equally unmissable — the whole
 * ground turns an even mid-grey instead of splitting into lit and unlit.
 * Judged in the beauty pass these two look nearly identical, which is how a
 * scene with no readable shadows survived several reviews.
 *
 * Shadows are disabled via `light.shadow.intensity = 0` rather than
 * `renderer.shadowMap.enabled`, because that is a uniform and needs no shader
 * recompile — the recompile costs minutes under SwiftShader and, since it
 * rebuilds every program in the scene, changes more than the thing under test.
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOT = process.argv[2] || 'street';
const PORT = Number(process.env.PROBE_PORT || 5621);
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
page.on('console', m => {
  if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.error('[error]', m.text().slice(0, 300));
});

stage('goto');
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

const grab = () => page.evaluate(() =>
  window.__ENGINE__.renderer.domElement.toDataURL('image/png'));

const save = (name, dataUrl) => {
  const f = `shots/${SHOT}_${name}.png`;
  writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`wrote ${f}`);
};

await settle(40);
const beauty = await grab();
save('beauty', beauty);
stage('beauty');

// Strip every light source except the sun. environmentIntensity and light
// intensities are all plain uniforms, so none of this triggers a recompile.
await page.evaluate(() => {
  const e = window.__ENGINE__;
  const L = e.modules.get('lighting');
  e.scene.environmentIntensity = 0;
  if (L._hemi) L._hemi.intensity = 0;
  for (const l of L.locals) l.intensity = 0;
  if (L.volumetric) L.volumetric.enabled = false;
  const r = e.modules.get('render');
  if (r?._volumetricPass) r._volumetricPass.enabled = false;
  if (r?.passes) { r.passes.bloom = false; r.passes.volumetric = false; }
});
await settle(40);
const sun = await grab();
save('sun', sun);
stage('sun only');

await page.evaluate(() => {
  const L = window.__ENGINE__.modules.get('lighting');
  for (const l of L.shadows.lights) l.shadow.intensity = 0;
});
await settle(40);
const sunflat = await grab();
save('sunflat', sunflat);
stage('sun only, no shadow term');

const result = await page.evaluate(async ({ a, b, gain }) => {
  const load = async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  };
  const [ca, cb] = await Promise.all([load(a), load(b)]);
  const A = ca.getContext('2d').getImageData(0, 0, ca.width, ca.height);
  const B = cb.getContext('2d').getImageData(0, 0, cb.width, cb.height);
  // Histogrammed rather than collected into an array: a 1600x900 frame is 1.4M
  // samples, and Math.max(...arr) on that overflows the call stack.
  const hist = new Int32Array(256);
  let total = 0, max = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A.data[i + k] - B.data[i + k]));
    hist[d]++; total++; if (d > max) max = d;
    for (let k = 0; k < 3; k++) A.data[i + k] = Math.min(255, d * gain);
  }
  ca.getContext('2d').putImageData(A, 0, 0);

  // Bimodality is the thing to measure. Real shadows split the frame into
  // "fully occluded" and "fully lit" with few pixels in between; acne parks
  // most of the frame in the middle.
  const count = (lo, hi) => {
    let n = 0;
    for (let d = Math.ceil(lo); d <= Math.min(255, Math.floor(hi)); d++) n += hist[d];
    return n;
  };
  const nonZero = count(7, 255);
  const mid = count(max * 0.2, max * 0.6);
  return {
    png: ca.toDataURL('image/png').split(',')[1],
    stats: {
      maxDelta: max,
      shadowedPct: +(100 * nonZero / total).toFixed(2),
      // High => the shadow term is mostly partial everywhere, i.e. acne.
      // Low  => pixels are decisively in or out of shadow.
      partialPct: +(100 * mid / Math.max(1, nonZero)).toFixed(1),
    },
  };
}, { a: sun, b: sunflat, gain: 2 });

writeFileSync(`shots/${SHOT}_sundelta.png`, Buffer.from(result.png, 'base64'));
console.log(`wrote shots/${SHOT}_sundelta.png`);
console.log('shadow term:', JSON.stringify(result.stats));
console.log(result.stats.partialPct > 45
  ? '=> MOSTLY PARTIAL. The shadow term is a grey wash, not a mask — acne.'
  : '=> decisive. Pixels are in or out of shadow, which is what a cast shadow looks like.');

await browser.close();
// browser.close() has hung here before, leaving the harness alive after it had
// already written its results. Nothing runs after this point, so just leave.
process.exit(0);
