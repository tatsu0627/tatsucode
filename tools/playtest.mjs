#!/usr/bin/env node
/**
 * Drive the game with real input and assert that it actually plays.
 *
 * Every check so far has been a still frame, which says nothing about whether
 * the thing is playable. This presses keys, moves the mouse and clicks, then
 * asserts on engine state: does the player move, does collision hold, does
 * firing consume ammo and resolve a shot, does reload complete, do the AI
 * notice.
 *
 * Runs headless under SwiftShader, so it is slow — the point is correctness,
 * not framerate.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = Number(process.env.PLAYTEST_PORT || 5800);
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
const cleanup = () => { try { server.kill('SIGKILL'); } catch {} };
process.on('exit', cleanup);

for (let i = 0; i < 240; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 250));
}

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|404/.test(t)) errors.push(t);
});

// The renderer is software-rasterised and the engine clamps dt to 1/15 s, so
// wall-clock waits are meaningless here: 2 seconds of real time can be a single
// simulated frame. Every wait is therefore expressed in engine frames.
const waitFrames = async (n, timeoutMs = 600000) => {
  const start = await page.evaluate(() => window.__ENGINE__.frame);
  await page.waitForFunction(
    (target) => window.__ENGINE__.frame >= target, start + n, { timeout: timeoutMs });
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// nolock=1 because headless Chromium never grants pointer lock, and the game
// gates all input behind it.
// quality=low drops the expensive post passes: this checks simulation
// behaviour, not pixels, and software rasterisation makes every frame costly.
await page.goto(`http://127.0.0.1:${PORT}/?nolock=1&quality=low`,
  { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(
  'window.__BOOTED__ === true || window.__BOOT_ERROR__ !== undefined',
  null, { timeout: 900000 });

const boot = await page.evaluate(() => window.__BOOT_ERROR__ || null);
check('boots without error', !boot, boot ? (boot.message || '').slice(0, 120) : '');
if (boot) { await finish(); }

// Let a few frames run so the first-frame transients settle.
await waitFrames(5);

const snap = () => page.evaluate(() => {
  const e = window.__ENGINE__;
  const p = e.modules.get('player');
  const w = e.modules.get('weapons');
  const c = e.modules.get('combat');
  const ai = e.modules.get('ai');
  return {
    frame: e.frame,
    pos: p.position.toArray().map(n => +n.toFixed(3)),
    yaw: +p.yaw.toFixed(4),
    pitch: +p.pitch.toFixed(4),
    speed: +(p.state.speed ?? 0).toFixed(3),
    onGround: p.state.onGround,
    health: p.health,
    ammo: w.current.ammo,
    reserve: w.current.reserve,
    reloading: w.current.reloading,
    shots: c.shotsFired,
    hits: c.hits,
    agents: ai.agents.length,
    alive: ai.agents.filter(a => a.alive).length,
    engaged: ai.agents.filter(a => a.stance === 2).length,
    // Diagnostics: distinguish "input never arrived" from "input arrived but
    // movement was rejected".
    locked: !!p.input?.locked,
    keyForward: !!p.input?.down?.('forward'),
    rawKeys: p.input ? Object.keys(p.input.keys).filter(k => p.input.keys[k]) : [],
    keysSeen: p.state.keysSeen || null,
    frame: e.frame,
    wish: p.state.wishDir ? p.state.wishDir.toArray().map(n => +n.toFixed(2)) : null,
    moveIntent: !!p.state.moveIntent,
    axis: p.state.axis || null,
    dead: !!p.dead,
    sliding: !!p.state.sliding,
    mantling: !!p.state.mantling,
    vel: p.velocity.toArray().map(n => +n.toFixed(2)),
  };
});

const a = await snap();
check('player module reports a position', Array.isArray(a.pos), a.pos.join(', '));
check('enemies spawned', a.agents > 0, `${a.agents} agents, ${a.alive} alive`);

// --- start the game -------------------------------------------------------
// The game opens on a main menu which deliberately disables the player. Until
// DEPLOY is pressed there is nothing to drive, and the whole suite reads as
// "movement is broken" when in fact the match has not begun.
const deployed = await page.evaluate(() => {
  const b = document.querySelector('[data-act="play"]');
  if (!b) return false;
  b.click();
  return true;
});
check('main menu offers a deploy control', deployed);
await waitFrames(3);
const started = await page.evaluate(() => {
  const p = window.__ENGINE__.modules.get('player');
  return { enabled: p.enabled !== false };
});
check('deploying enables the player', started.enabled);

// --- look -----------------------------------------------------------------
await page.mouse.move(480, 270);
await waitFrames(2);
await page.mouse.move(480, 270);
for (let i = 0; i < 12; i++) {
  await page.mouse.move(480 + i * 18, 270, { steps: 1 });
}
await waitFrames(3);
const look = await snap();
check('mouse look turns the camera', Math.abs(look.yaw - a.yaw) > 1e-4,
  `yaw ${a.yaw} -> ${look.yaw}`);

// --- movement -------------------------------------------------------------
await page.keyboard.down('w');
await waitFrames(40);
const moving = await snap();
await page.keyboard.up('w');
await waitFrames(25);
const stopped = await snap();

const travelled = Math.hypot(moving.pos[0] - look.pos[0], moving.pos[2] - look.pos[2]);
check('W moves the player', travelled > 0.5,
  `${travelled.toFixed(2)} m — raw=${JSON.stringify(moving.rawKeys)} seenInUpdate=${JSON.stringify(moving.keysSeen)} axis=${JSON.stringify(moving.axis)} ` +
  `intent=${moving.moveIntent} wish=${JSON.stringify(moving.wish)} vel=${JSON.stringify(moving.vel)} ` +
  `dead=${moving.dead} slide=${moving.sliding} mantle=${moving.mantling}`);
check('player decelerates on release', stopped.speed < Math.max(0.5, moving.speed * 0.5),
  `speed ${moving.speed} -> ${stopped.speed}`);
check('player stays on the ground', stopped.onGround === true);

// --- collision: walk hard into the nearest wall for a while ---------------
const before = await snap();
await page.keyboard.down('w');
await waitFrames(45);
await page.keyboard.up('w');
const after = await snap();
const escaped = Math.abs(after.pos[1] - before.pos[1]) > 5;
check('player does not fall through the world', !escaped,
  `y ${before.pos[1]} -> ${after.pos[1]}`);

// --- firing ---------------------------------------------------------------
const preFire = await snap();
await page.mouse.down();
await waitFrames(20);
await page.mouse.up();
await waitFrames(6);
const postFire = await snap();
check('firing consumes ammo', postFire.ammo < preFire.ammo,
  `${preFire.ammo} -> ${postFire.ammo}`);
check('firing resolves shots in combat', postFire.shots > preFire.shots,
  `${preFire.shots} -> ${postFire.shots}`);

// --- reload ---------------------------------------------------------------
await page.keyboard.press('r');
// Reload takes 2.15 s of simulated time, and dt is clamped to 1/15 s, so it
// needs at least ~33 frames regardless of how long that takes in real time.
await waitFrames(55);
const postReload = await snap();
check('reload refills the magazine', postReload.ammo > postFire.ammo,
  `${postFire.ammo} -> ${postReload.ammo}`);
check('reload draws from reserve', postReload.reserve < preFire.reserve,
  `${preFire.reserve} -> ${postReload.reserve}`);

// --- AI -------------------------------------------------------------------
check('AI notices the player', postReload.engaged > 0,
  `${postReload.engaged}/${postReload.alive} engaged`);

check('no runtime errors during play', errors.length === 0,
  errors.slice(0, 3).join(' | ').slice(0, 200));

await finish();

async function finish() {
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  cleanup();
  process.exit(failed.length ? 1 : 0);
}
