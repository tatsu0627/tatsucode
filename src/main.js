import { Engine } from './core/engine.js';
import { RenderModule } from './render/render.js';
import { WorldModule } from './world/world.js';
import { LightingModule } from './lighting/lighting.js';
import { PlayerModule } from './player/player.js';
import { WeaponsModule } from './weapons/weapons.js';
import { CombatModule } from './combat/combat.js';
import { FxModule } from './fx/fx.js';
import { AiModule } from './ai/ai.js';
import { UiModule } from './ui/ui.js';
import { AudioModule } from './audio/audio.js';
import { GameModule } from './core/game.js';
import { installCaptureMode } from './core/capture.js';

const engine = new Engine(document.getElementById('viewport'));

// Registration order defines update order. World before lighting (lighting probes
// the world), player before weapons (viewmodel follows the camera), combat after
// both (it resolves against the frame's final transforms).
engine.add('world', new WorldModule());
engine.add('lighting', new LightingModule());
engine.add('player', new PlayerModule());
engine.add('weapons', new WeaponsModule());
engine.add('ai', new AiModule());
engine.add('combat', new CombatModule());
engine.add('fx', new FxModule());
engine.add('audio', new AudioModule());
// After ai and combat so it observes a settled frame, and before ui so its
// callouts reach the HUD the same frame they are decided.
engine.add('game', new GameModule());
engine.add('ui', new UiModule());
engine.add('render', new RenderModule());

window.__ENGINE__ = engine;

// A top-level await that rejects leaves a blank page and an unhandled rejection
// with no usable stack, which is the worst possible failure mode for a scene
// that takes a while to boot. Catch it, surface it on screen, and record it
// where the screenshot harness can read it.
try {
  await engine.init();
  installCaptureMode(engine);
  engine.start();
  window.__BOOTED__ = true;
} catch (err) {
  window.__BOOT_ERROR__ = { message: String(err && err.message || err), stack: String(err && err.stack || '') };
  console.error('boot failed:', err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;background:#140a0a;' +
    'color:#ff9c8a;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;z-index:9999;overflow:auto';
  pre.textContent = `boot failed\n\n${window.__BOOT_ERROR__.stack || window.__BOOT_ERROR__.message}`;
  document.body.appendChild(pre);
  throw err;
}
