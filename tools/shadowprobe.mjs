#!/usr/bin/env node
/**
 * Answer one question with a number instead of an opinion: is the sun shadow
 * map contributing anything to the image?
 *
 * Reviewing frames by eye has repeatedly produced "shadows look fine" for a
 * scene that turned out to have none. So this renders the configured vantage
 * twice — once as built, once with `renderer.shadowMap.enabled = false` and
 * every program recompiled — and reports how many pixels changed and by how
 * much. If shadows are working, turning them off is a large, obvious delta.
 * If the two frames are near-identical, the shadow rig is decorative.
 *
 * It also dumps the per-cascade shadow camera bounds, the resolved bias values
 * and the caster/receiver counts, since those are what you need next once the
 * delta comes back at zero.
 *
 *   node tools/shadowprobe.mjs street
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SHOT = process.argv[2] || 'street';
const PORT = Number(process.env.PROBE_PORT || 5611);
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
// Modest viewport: this is a difference measurement, not a beauty shot, and
// SwiftShader cost scales with pixels. Big enough that a shadow's silhouette is
// still readable in the delta image.
const W = Number(process.env.PROBE_WIDTH || 800);
const page = await browser.newPage({ viewport: { width: W, height: Math.round(W * 9 / 16) } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('console', m => {
  if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log('[error]', m.text().slice(0, 300));
});

// Stage logging: a silent hang in this harness has cost more time than the
// bugs it was built to find, and the only way to locate one is to say where it
// got to.
const stage = (s) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

stage('goto');
await page.goto(`http://127.0.0.1:${PORT}/?shot=${SHOT}`,
  { waitUntil: 'load', timeout: 90000 });
stage('waiting for boot');
// Deliberately NOT waiting for __READY__. Convergence matters for a beauty
// shot; this is a difference measurement between two frames rendered the same
// way, so a few settled frames is enough and costs minutes less.
await page.waitForFunction('window.__BOOTED__ === true || window.__BOOT_ERROR__ !== undefined',
  null, { timeout: 900000 });
stage('booted');

const settle = (n) => page.evaluate((target) => new Promise(resolve => {
  const e = window.__ENGINE__;
  const goal = e.frame + target;
  const tick = () => (e.frame >= goal ? resolve(e.frame) : requestAnimationFrame(tick));
  tick();
}), n);

await settle(40);
stage('settled');

const state = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const L = e.modules.get('lighting');
  const lights = L?.shadows?.lights ?? [];
  let casters = 0, receivers = 0, meshes = 0;
  e.scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    meshes++;
    if (o.castShadow) casters++;
    if (o.receiveShadow) receivers++;
  });
  return {
    frame: e.frame,
    shadowMapEnabled: e.renderer.shadowMap.enabled,
    shadowMapType: e.renderer.shadowMap.type,
    sunDir: L?.sunDir?.toArray?.().map(n => +n.toFixed(3)),
    meshes, casters, receivers,
    cascades: lights.map(l => {
      const c = l.shadow.camera;
      return {
        castShadow: l.castShadow,
        intensity: +l.intensity.toFixed(2),
        hasMap: !!l.shadow.map,
        mapSize: l.shadow.mapSize.toArray(),
        bias: +l.shadow.bias.toExponential(2),
        normalBias: +l.shadow.normalBias.toFixed(4),
        radius: l.shadow.radius,
        // Width of the cascade in world metres, and metres per shadow texel.
        widthM: +(c.right - c.left).toFixed(1),
        texelM: +((c.right - c.left) / l.shadow.mapSize.x).toFixed(3),
        near: +c.near.toFixed(1), far: +c.far.toFixed(1),
        lightPos: l.position.toArray().map(n => +n.toFixed(1)),
        targetPos: l.target.position.toArray().map(n => +n.toFixed(1)),
      };
    }),
  };
});

// `?shot=` turns on preserveDrawingBuffer, so the backbuffer is still readable
// outside of a rAF callback. Playwright's own screenshot goes through the
// compositor and hangs on an animating WebGL canvas under SwiftShader.
const grab = () => page.evaluate(() =>
  window.__ENGINE__.renderer.domElement.toDataURL('image/png'));

const before = await grab();
stage('captured with shadows');

// Recompiling is required: the shadow path is compiled into each program, so
// flipping the flag alone changes nothing until the materials are rebuilt.
await page.evaluate(() => {
  const e = window.__ENGINE__;
  e.renderer.shadowMap.enabled = false;
  e.scene.traverse(o => {
    const m = o.material;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
  });
});
// Let the composited/temporal passes settle again before comparing.
await settle(40);
const after = await grab();
stage('captured without shadows');

// The delta image is the actual deliverable here. Summary statistics can say
// "something got darker" without saying *what shape* got darker, and shape is
// the entire question: a cast shadow has the silhouette of its caster, filtered
// self-shadow acne has the silhouette of the whole ground plane.
const deltaPng = await page.evaluate(async ({ a, b, gain }) => {
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
  for (let i = 0; i < A.data.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      A.data[i + k] = Math.min(255, Math.abs(A.data[i + k] - B.data[i + k]) * gain);
    }
  }
  ca.getContext('2d').putImageData(A, 0, 0);
  return ca.toDataURL('image/png').split(',')[1];
}, { a: before, b: after, gain: 4 });

const diff = await page.evaluate(async ({ a, b }) => {
  const load = async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.getContext('2d').getImageData(0, 0, img.width, img.height).data;
  };
  const [A, B] = await Promise.all([load(a), load(b)]);
  const deltas = [];
  let changed = 0, deep = 0, sum = 0, max = 0;
  for (let i = 0; i < A.length; i += 4) {
    const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
    deltas.push(d);
    sum += d; if (d > 3) changed++; if (d > 40) deep++; if (d > max) max = d;
  }
  const total = deltas.length;
  const mean = sum / total;
  const sd = Math.sqrt(deltas.reduce((a, v) => a + (v - mean) ** 2, 0) / total);
  return {
    changedPct: +(100 * changed / total).toFixed(2),
    meanDelta: +mean.toFixed(2),
    maxDelta: max,
    // The two numbers that separate real shadows from filtered acne. A uniform
    // veil dims everything by about the same amount: high changedPct, low sd,
    // almost no pixels deeply darkened. Actual cast shadows are the opposite —
    // a minority of pixels changing a lot.
    sd: +sd.toFixed(2),
    deepPct: +(100 * deep / total).toFixed(2),
  };
}, { a: before, b: after });

console.log(JSON.stringify(state, null, 2));
console.log('\nshadows on vs off:', JSON.stringify(diff));
console.log(
  diff.changedPct < 1
    ? '=> SHADOWS CONTRIBUTE NOTHING. The rig is configured but not reaching the image.'
  : diff.deepPct < 2 || diff.sd < diff.meanDelta * 0.8
    ? '=> A VEIL, NOT SHADOWS. Most of the frame dims by a similar small amount, ' +
      'which is what filtered self-shadow acne looks like — not cast shadows.'
    : '=> shadows are casting: a minority of the frame is deeply darkened.');

writeFileSync(`shots/${SHOT}_shadowon.png`, Buffer.from(before.split(',')[1], 'base64'));
writeFileSync(`shots/${SHOT}_shadowoff.png`, Buffer.from(after.split(',')[1], 'base64'));
writeFileSync(`shots/${SHOT}_shadowdelta.png`, Buffer.from(deltaPng, 'base64'));
console.log(`wrote shots/${SHOT}_shadow{on,off,delta}.png`);

await browser.close();
cleanup();
