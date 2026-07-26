# Operation Blacksite

A first-person shooter built on Three.js (WebGL2), targeting the highest
visual and mechanical fidelity achievable in a browser tab. Every asset —
textures, models, animations, audio — is generated procedurally at runtime.
There are no downloaded assets.

## Running it

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm run build
```

Click the viewport to capture the pointer. `Esc` releases it.

| Input | Action |
|---|---|
| `WASD` | Move |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch (hold to slide while sprinting) |
| `Space` | Jump / vault |
| Mouse | Look |
| LMB | Fire |
| RMB | Aim down sights |
| `R` | Reload |
| `Esc` | Pause / settings |

## Architecture

`Engine` (`src/core/engine.js`) owns the WebGL context and the frame loop, and
nothing else. Everything else is a **module** registered against it, and modules
only reach each other through `engine.get(name)` against a contract documented
at the top of each module file. That boundary is what allowed the ten subsystems
below to be built independently and in parallel.

| Module | Owns |
|---|---|
| `world` | Level geometry, procedural PBR materials, colliders, set dressing |
| `lighting` | Physical sky, cascaded shadows, IBL, volumetrics, fog |
| `render` | The draw call and the entire post-processing chain |
| `player` | Input, movement, collision, camera |
| `weapons` | Viewmodel, weapon state, firing, procedural weapon animation |
| `combat` | Shot resolution, ballistics, hitboxes, penetration, damage |
| `fx` | Particles, decals, tracers, explosions — all pooled and instanced |
| `ai` | Enemy rigs, procedural animation, perception, navigation, behaviour |
| `ui` | HUD, hitmarkers, killfeed, menus |
| `audio` | Procedural WebAudio synthesis, convolution reverb, positional mix |

Registration order in `src/main.js` defines update order, and the ordering is
load-bearing: the world must exist before lighting probes it, the player must
move before the viewmodel follows the camera, and combat resolves last against
the frame's final transforms.

### The art direction bible

`src/core/artdirection.js` is the single source of truth for scale, exposure,
sun angle, palette, fog and post tuning. Modules read from it rather than
hardcoding values. Without it, independently developed world/lighting/render
work does not compose into a coherent image — it produces three different
looks in one frame.

## Visual review

The look is verified by screenshot, not by assumption.

```sh
node tools/shoot.mjs                    # all vantage points -> shots/
node tools/shoot.mjs hero interior      # a subset
SHOOT_PORT=5301 node tools/shoot.mjs    # alternate port
```

`src/core/capture.js` defines fixed camera vantage points. Loading
`?shot=<name>` freezes the camera there, pins the world clock, and sets
`window.__READY__` once the temporal passes (TAA, AO history, volumetrics) have
converged — so captures are deterministic and noise-free rather than catching a
half-accumulated frame. The harness renders under SwiftShader, which is slow but
produces a correct image, and it fails loudly on any console error so a broken
build cannot be reviewed as "looks fine".

Frames are then judged against `docs/visual-standard.md`, which lists the
specific artifacts that give away amateur real-time rendering and the score
each axis must reach.

## The match

Deploy from the main menu. The objective is to clear the compound: six hostiles
hold it, you have three lives, and the mission ends when the garrison is down or
your lives run out — then it resets for another run.

The garrison fights back. Agents acquire, hesitate, fire a short burst, pause
and repeat, and only ever shoot with a live line of sight, so breaking contact
works. An attack-token cap means at most two open fire at once: a squad that all
shoots at once is not a firefight, it is a death. You regenerate health after a
lull and get a few seconds of protection on spawn.

Standing in the open under fire costs roughly half your health in seven seconds
— enough time to react, not enough to ignore.

## Playtesting

Visual review says nothing about whether the game plays, so behaviour is
verified by driving real input:

```sh
node tools/playtest.mjs
```

It presses keys, moves the mouse and clicks, then asserts on engine state:
that deploying enables the player, that mouse look turns the camera, that
movement accelerates and decelerates, that collision holds and the player never
falls out of the world, that firing consumes ammo and resolves shots, that
reload draws from reserve, that the AI perceives and shoots back without being
instantly lethal, and that death leads to a redeploy and a cleared garrison
completes the mission.

Two things about it are load-bearing. Waits are expressed in **engine frames,
not wall clock** — the software rasteriser can take seconds per frame while the
engine clamps dt to 1/15 s, so a wall-clock wait can span less than one
simulated frame and read as a broken game. And it runs with `?nolock=1`, since
headless Chromium never grants pointer lock and every input path is gated behind
it.

## Current state

Every module listed above is implemented, wired and exercised by the playtest.

Known outstanding issues, stated plainly:

- **Ambient occlusion is subtle, and that appears to be correct.** It reads as
  very little contact shading in the beauty pass, which prompted a hunt through
  three hypotheses — packed depth-stencil depth format, too small a world
  radius, and the shared G-buffer handoff. All three were disproved by
  capturing the occlusion buffer directly (`post=ao`), including running GTAO
  on its own normals and depth via `?aogbuffer=own`, which produced a
  near-identical result.
  Inspecting that buffer closely, the occlusion is present and spatially
  correct — under the barriers, in the window reveals, around the building base
  and the crates — just faint. An open desert compound has very few concave
  corners for ambient light to be occluded in, so physically-based AO genuinely
  has little to find here; the original expectation was calibrated for
  interiors. The grounding cue in this scene comes from the sun shadows.
  If stronger grounding is wanted it should come from deliberately art-directed
  contact darkening, not from inflating the AO radius.
- **The backdrop ridge may or may not have been floating.** The ground plane
  ended at z=-110 while the ridge sits at z=-150 to -320, so geometrically it
  had no terrain beneath it; the plane was widened to 800 m. But the re-render
  came back all but identical, because at that range the haze washes ground and
  ridge to the same value and the difference cannot be seen. The wider plane is
  kept because terrain ending before the backdrop is wrong regardless, not
  because a visible fix was demonstrated.
- **The concrete texture's dome stamps read as regular dark ellipses** across
  large flat surfaces — most visible on the interior ceiling and floor, where
  they look like leopard spots rather than staining. The stamp radius wants
  reducing and randomising against the tile size.
- **Interior practicals blow out**, reading as a white disc rather than a
  fitting with a hot centre.
- The HUD is reviewed and is the strongest element in the project — compass
  strip with bearing and objective range, killfeed, dynamic crosshair, damage
  numbers, directional damage indicator, low-ammo state, grenade indicator and
  equipment readout, all in tight condensed type with restrained colour.
  Note that reviewing it at all required `SHOOT_DOM=1`: the default capture
  path reads the WebGL drawing buffer, which cannot see a DOM overlay, so the
  HUD was invisible in every earlier capture regardless of what the UI module
  did.

### Debugging tools

Two of these exist because the browser was the slowest possible place to find a
bug, and neither texture synthesis nor geometry construction needs a GPU:

```sh
node tools/texbench.mjs 0.5     # per-texture-set synthesis timings
node tools/levelbench.mjs 0.5   # material + geometry build, triangle/draw counts
node tools/probe.mjs            # boot the scene, dump live renderer/lighting state
```

The rest exist because looking at frames is unreliable. Over this project,
eyeballing renders produced several confident, wrong conclusions — shadows
called working when they were detached by metres, and later called entirely
absent in a frame where two thirds of the pixels were shadow-affected. These
turn "does it look right" into a number:

```sh
node tools/pixels.mjs shots/street.png 300,760,324,784   # luma, spread, warmth
node tools/crop.mjs   shots/street.png 1050,540,1560,830 2   # crop and magnify
node tools/shadowprobe.mjs street   # does the shadow map reach the image at all
node tools/lightprobe.mjs  street   # sun only, so shadows cannot hide in ambient
node tools/sunsweep.mjs street 118,10.5 145,22   # one vantage, several suns
```

`lightprobe` is the one that settles arguments. It zeroes the IBL, hemisphere,
local lights and volumetrics, so anything the sun does not reach goes black and
both cast shadows and self-shadow acne become impossible to miss — the two are
nearly indistinguishable in the beauty pass, which is how a scene with no
readable shadows got through several reviews.

Renderer buffers can be captured directly, which is how the AO problem was
localised:

```sh
SHOOT_PARAMS='post=ao' SHOOT_SUFFIX='_ao' node tools/shoot.mjs hero
# post=ao | normal | depth | velocity | scene

# The HUD is a DOM overlay and is invisible to the default canvas capture.
SHOOT_DOM=1 SHOOT_PARAMS='hud=1' SHOOT_SUFFIX='_hud' node tools/shoot.mjs weapon
```

## Honest limitations

This is a browser game. It renders procedurally generated assets through WebGL2
in a JavaScript VM, against titles that ship scanned photogrammetry, offline-
baked global illumination, and a native engine with a console power budget. It
is built to be the best-looking thing achievable under those constraints and to
be judged honestly against that bar — not to claim a win over a shipping AAA
title. `docs/visual-standard.md` states where it actually lands.
