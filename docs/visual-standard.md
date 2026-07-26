# Visual Standard

The bar every screenshot is judged against, and the checklist the review agent
works through. It exists so that "does this look AAA?" is answered against fixed
criteria on every loop iteration instead of against whatever the reviewer
happened to notice that day.

## How to judge

Look at the image the way a hostile forum commenter would — someone who plays
current-generation shooters and enjoys pointing out when something looks cheap.
Do not grade generously. Do not praise effort. The only question is whether a
player shown this frame with no context would assume it came from a commercial
game or from a browser tech demo.

Score each axis 1-10 and name the specific pixels that cost the points. A
critique that says "lighting could be better" is worthless; "the shadow under
the left container is detached from its base by ~6px, which reads as
peter-panning" is actionable.

## The tells (in rough order of how badly they give away amateur real-time 3D)

1. **Flat, uniform roughness.** Every real surface has varying gloss — wear on
   edges, grime in recesses, polish where hands touch. A material with a single
   roughness value across a whole wall reads as plastic instantly.
2. **Unbevelled edges.** Real edges have a small chamfer that catches a
   highlight. A perfectly sharp 90° corner with no highlight along it is the
   fastest way to look like a student project.
3. **Aliasing.** Crawling, jagged high-contrast edges — railings, wires, roof
   lines against sky. Any stair-stepping on a diagonal is a fail.
4. **Shadow problems.** Acne (self-shadowing stripes), peter-panning (shadow
   detached from the object's base), blocky low-resolution shadow edges, or
   visible seams where cascades change.
5. **No contact darkening.** Where any two surfaces meet there must be a soft
   dark gradient. Objects that appear to hover, even when geometrically
   grounded, are missing ambient occlusion.
6. **Flat ambient.** A scene lit so evenly that nothing has a clear light side
   and shadow side. Real light has direction; the eye reads its absence
   immediately even when it can't name it.
7. **Hard particle intersections.** A smoke or dust card slicing into geometry
   with a visible straight edge. Requires soft-particle depth fade.
8. **Banding.** Visible steps in a sky gradient, in fog, or in a volumetric
   shaft. Requires dithering and/or noise jitter.
9. **Bloom as a filter.** Glow smeared over the entire frame rather than
   emerging only from genuinely bright sources.
10. **No depth cueing.** Distant geometry as saturated and contrasty as the
    foreground. Atmospheric perspective is most of what makes a vista read as
    large.
11. **Repetition.** An obviously tiling texture, identical props on a grid,
    identical particles at identical sizes.
12. **Empty space.** Large surfaces with nothing on them. Real environments are
    dense with incidental detail — cables, stains, debris, signage, wear paths.

## Axes to score

| Axis | What earns a high score |
|---|---|
| Materials | Multi-frequency surface detail, varied roughness, correct metalness, wear concentrated where wear actually happens |
| Lighting | Clear key/fill separation, crisp correctly-attached shadows, believable bounce, no flat ambient |
| Atmosphere | Depth separation front-to-back, haze that responds to the sun, no banding |
| Geometry | Bevelled edges, believable construction and proportion, silhouette interest |
| Composition | The frame is arranged — leading lines, foreground occlusion, a subject |
| Post | AA clean, bloom disciplined, tonemapping filmic with deep blacks and retained detail |
| Dressing | Incidental detail density that suggests the space was used by people |
| Cohesion | Everything reads as one place under one light, not assets from three sources |

## Passing bar

- Any axis at 5 or below: **fail**, must be fixed before the loop advances.
- The frame passes when no axis is below 7 and the reviewer cannot name a
  specific tell from the list above.

## Honest framing about the reference

The stated goal for this project is to compare against Call of Duty directly.
Two constraints apply and should be stated plainly rather than papered over:

- This environment cannot fetch reference screenshots (outbound image requests
  are blocked), so a literal side-by-side against a real COD frame is not
  possible here. The reviewer judges against its own knowledge of how
  current-generation shooters look, which is substantial but is not a
  pixel-level A/B.
- A WebGL2 renderer running procedurally generated assets in a browser tab is
  not going to beat a native engine shipping scanned photogrammetry and
  offline-baked lighting on a console power budget. The realistic target is
  "a player would accept this as a real game", not "this beats Modern Warfare".
  A reviewer that reports the latter is not being useful.
