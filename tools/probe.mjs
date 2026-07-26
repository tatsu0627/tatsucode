#!/usr/bin/env node
/**
 * Boot the scene and dump live renderer/lighting state.
 *
 * Waits only for __BOOTED__, not for temporal convergence, so it answers
 * "is the shadow rig actually configured?" in a minute rather than the six
 * a full capture takes.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = Number(process.env.PROBE_PORT || 5601);
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
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|404/.test(t)) console.log('[error]', t.slice(0, 300));
  else if (/^world:|^lighting:|^render:|^fx:/.test(t)) console.log('[info]', t);
});

await page.goto(`http://127.0.0.1:${PORT}/?shot=hero`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(
  'window.__BOOTED__ === true || window.__BOOT_ERROR__ !== undefined',
  null, { timeout: 600000 });

// Let a few frames run so shadow maps get allocated and drawn at least once.
await page.waitForTimeout(8000);

const state = await page.evaluate(() => {
  const e = window.__ENGINE__;
  const out = { boot: window.__BOOT_ERROR__ || 'ok', frame: e.frame };
  const r = e.renderer;
  out.renderer = {
    shadowMapEnabled: r.shadowMap.enabled,
    shadowMapType: r.shadowMap.type,
    toneMapping: r.toneMapping,
    calls: r.info.render.calls,
    triangles: r.info.render.triangles,
    programs: r.info.programs?.length ?? -1,
  };
  const L = e.modules.get('lighting');
  const lights = L?.shadows?.lights ?? [];
  out.lighting = {
    hasShadows: !!L?.shadows,
    lightCount: lights.length,
    sunDir: L?.sunDir?.toArray?.().map(n => +n.toFixed(3)),
    envMap: !!L?.envMap,
    lights: lights.map(l => ({
      castShadow: l.castShadow,
      intensity: +l.intensity.toFixed(2),
      hasMap: !!l.shadow?.map,
      mapSize: l.shadow?.mapSize?.toArray?.(),
      camFar: l.shadow?.camera?.far,
      pos: l.position.toArray().map(n => +n.toFixed(1)),
      targetPos: l.target?.position?.toArray?.().map(n => +n.toFixed(1)),
      inScene: !!l.parent,
    })),
  };
  const W = e.modules.get('world');
  const first = W?.raycastTargets?.[0];
  out.world = {
    targets: W?.raycastTargets?.length,
    colliders: W?.colliders?.length,
    sampleCastShadow: first?.castShadow,
    sampleReceiveShadow: first?.receiveShadow,
    materialsPatched: [...(W?.materials?.values?.() ?? [])]
      .slice(0, 3).map(m => ({ name: m.name, hasCSM: !!m.defines?.CSM_CASCADES || !!m.userData?.csm })),
  };
  return out;
});

console.log(JSON.stringify(state, null, 2));
await browser.close();
cleanup();
