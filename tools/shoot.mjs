#!/usr/bin/env node
/**
 * Screenshot harness for the visual review loop.
 *
 *   node tools/shoot.mjs                 # all vantage points -> shots/
 *   node tools/shoot.mjs hero street     # a subset
 *   node tools/shoot.mjs --out shots/v3  # into a versioned folder
 *
 * Boots a vite dev server, drives headless Chromium with a real GPU-ish
 * software backend, waits for window.__READY__ (temporal passes converged),
 * and writes 1600x900 PNGs. Fails loudly on any page error so a broken build
 * can never be silently reviewed as "looks fine".
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';

const ALL = ['hero', 'street', 'interior', 'weapon', 'vista', 'shadows'];
const args = process.argv.slice(2);
let out = 'shots';
const outIdx = args.indexOf('--out');
if (outIdx !== -1) { out = args[outIdx + 1]; args.splice(outIdx, 2); }
const shots = args.length ? args : ALL;

const PORT = 5199;
const WIDTH = 1600, HEIGHT = 900;

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { const r = await fetch(url); if (r.ok) return resolve(); } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error('vite did not start'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const cleanup = () => { try { server.kill('SIGKILL'); } catch {} };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

try {
  await waitForServer(`http://localhost:${PORT}/`);
} catch (e) {
  console.error('Vite failed to start:\n' + serverLog);
  cleanup();
  process.exit(1);
}

mkdirSync(out, { recursive: true });

// The image ships a pinned Chromium that may not match the playwright package's
// expected build number, so point at it explicitly rather than downloading.
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-frame-rate-limit',
  ],
});

const results = [];
let hardFail = false;

for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  const url = `http://localhost:${PORT}/?shot=${shot}`;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction('window.__READY__ === true', null, { timeout: 60000 });
    // A couple of extra frames for anything that converges on __READY__'s heels.
    await page.waitForTimeout(400);
    const file = `${out}/${shot}.png`;
    await page.screenshot({ path: file });
    const fps = await page.evaluate(() => {
      const e = window.__ENGINE__;
      return e ? Math.round(e.frame / Math.max(e.elapsed, 0.001)) : 0;
    }).catch(() => 0);
    results.push({ shot, file, errors, fps });
    console.log(`${errors.length ? 'ERR ' : 'ok  '} ${shot} -> ${file}${fps ? ` (~${fps}fps sw-render)` : ''}`);
  } catch (e) {
    hardFail = true;
    results.push({ shot, file: null, errors: [...errors, String(e)] });
    console.log(`FAIL ${shot}: ${e.message}`);
  }
  if (errors.length) {
    hardFail = true;
    for (const err of errors.slice(0, 5)) console.log(`      ${err.slice(0, 300)}`);
  }
  await page.close();
}

await browser.close();
cleanup();

writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 2));
if (hardFail) { console.log('\nSCREENSHOT RUN HAD ERRORS — fix before reviewing.'); process.exit(2); }
console.log(`\nAll shots clean -> ${out}/`);
