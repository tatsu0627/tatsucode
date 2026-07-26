#!/usr/bin/env node
/**
 * Boot the game headlessly and print the first uncaught error with its stack.
 *
 * The screenshot harness reports that a page failed, but a bare message like
 * "Cannot read properties of undefined" is not actionable without the frame it
 * came from. This exists to get that frame.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = Number(process.env.TRACE_PORT || 5501);
const shot = process.argv[2] || 'hero';

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
const cleanup = () => { try { server.kill('SIGKILL'); } catch {} };
process.on('exit', cleanup);

const ready = async () => {
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
};
if (!await ready()) { console.error('vite failed to start'); cleanup(); process.exit(1); }

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });

page.on('pageerror', e => {
  console.log('\n=== PAGE ERROR ===');
  console.log(e.stack || String(e));
});
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|404/.test(t)) console.log('[console.error]', t);
  else if (/^world:|^render:|^lighting:|^fx:/.test(t)) console.log('[info]', t);
});

await page.goto(`http://127.0.0.1:${PORT}/?shot=${shot}`, { waitUntil: 'load', timeout: 60000 });
// Boot can take a while under SwiftShader (CSM injects into every material and
// shader compilation dominates), so wait for a definite outcome rather than a
// fixed sleep.
await page.waitForFunction(
  'window.__BOOTED__ === true || window.__BOOT_ERROR__ !== undefined',
  null, { timeout: 600000 }).catch(() => console.log('(neither boot nor error within 10min)'));

const boot = await page.evaluate(() => window.__BOOT_ERROR__ || null).catch(() => null);
if (boot) { console.log('\n=== BOOT ERROR ==='); console.log(boot.stack || boot.message); }

const state = await page.evaluate(() => {
  const e = window.__ENGINE__;
  if (!e) return { engine: false };
  return {
    engine: true,
    ready: window.__READY__,
    frame: e.frame,
    modules: [...e.modules.keys()],
    sceneChildren: e.scene.children.length,
  };
}).catch(err => ({ evalError: String(err) }));
console.log('\n=== STATE ===');
console.log(JSON.stringify(state, null, 2));

await browser.close();
cleanup();
