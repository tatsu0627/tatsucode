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
engine.add('ui', new UiModule());
engine.add('render', new RenderModule());

await engine.init();
installCaptureMode(engine);
engine.start();

window.__ENGINE__ = engine;
