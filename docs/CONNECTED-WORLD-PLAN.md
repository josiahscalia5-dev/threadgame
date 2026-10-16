# Connected World: root cause, reuse plan and renderer scope

Written 2026-10-16 after inspecting the engine and the Connected World kit (`kit/connected/Wishweave-Connected-World-Kit/`).
Full inspection reports: `history/transcripts/131a49c9-…/subagents/workflows/wf_ab6d9c83-f3e/journal.jsonl`
(engine and kit-code reports). The plate version stays recoverable at commit `635b772`.

## 1. Root cause of the "blurred pillar" wipe

Evidence image: `docs/checkpoints/connected/00-before-wipe.jpg` (the real game, 360×801 CSS px, seed 1, frames
at 15%, 50% and 85% through the first connector).

| What you see | Where it comes from |
|---|---|
| Purl crosses a gap with no floor | `game/src/data/level.js` alternates six `plate` segments with five `connector` segments. A connector has only `length/from/to/style`; `parseRoute` leaves its `path: null` (`sim/race.js:50`). No floor exists in the sim or the renderer. |
| The blurred pillar sweeps across | `render/renderer.js` `drawTransitionScene` (`:406-441`) slides two flat plate views apart and draws the outgoing plate's `wipe` strip, blurred (`columnCanvas`, blur at `:463`) at full screen height (`drawColumn`, `:474-494`). |
| Purl floats on top of it | Purl is drawn in screen space after everything else, interpolated between the exit pose and the entry pose (`:434-440`). |
| Purl shrinks, then snaps back large | The 2D camera zooms by `clamp(w0/w, 1, zMax)` inside one painting (`render/camera.js:47-62`) and snaps on the plate change (`renderer.js:392`). Measured Purl width: 84 → 115 → 146 px. |
| Loop vanishes | Loop is only drawn on plate segments (`renderer.js:316-319`). |
| HUD says 1/3 but still "Collect the coral thread" | `inventory.collect` never calls `refreshObjective` (`sim/inventory.js:61-69`), and `refreshObjective` returns early on connectors (`race.js:404`). |

**Why the plate renderer can't be extended:** its camera is a uniform scale plus translate inside one fixed
painting (`camera.js:81-84`). It has no yaw, pitch or perspective, so it can't follow a bend. Depth, occlusion and
racer size are hand-authored for each painting's single viewpoint, and lanes are screen-horizontal (`core/path.js:96`).
A connected course with a turning chase camera needs a real 3D renderer.

## 2. What is kept, changed or replaced

| Area | Decision |
|---|---|
| `core/ww.js` (rng, util, tuning) | Keep; distances become metres. |
| `core/path.js`, `data/plates/*`, `render/camera.js`, `render/world.js`, `render/setpieces.js` | Replace (plate-pixel geometry). Recoverable at `635b772`. |
| Kit `scenery/route.json` | Becomes `game/src/data/route.js` (`WW.ROUTE`), the course contract: 201.3 m main road, 6 m wide, tassel side loop at main s 81.4–97.4. |
| Kit `code/route-motion.mjs`, `code/touch-input.mjs` | Ported to classic scripts `core/route.js` and `core/gesture.js` (house style, Node-testable), with their 34 tests. |
| `sim/race.js` | Keep countdown, fixed step, pause, finish/ranks, input, debug API. Delete connectors and wipe transitions. Racers move on the route graph: `s`, `mainS`, lateral metres, heading, speed, brake, jump. |
| `sim/inventory.js` | Keep rules (three distinct threads, drop/recover). Positions become `mainS` + lateral; objective refreshes on pickup. |
| `sim/loop-ai.js` | Keep the seeded, player-independent plan. Loop runs the same road, makes his own branch choice with a reaction delay, can stumble, never mirrors Purl or teleports. |
| `sim/stitches.js`, `sim/snagling.js` | Kept; not placed on the course in Milestone 1 (they return after review). |
| `render/renderer.js` | Replaced by a three.js renderer with the same API used by `main.js`. |
| HUD, overlays, layout, main loop, lifecycle, test API, Android host | Keep. Add Left/Right/Jump/Run-Stop buttons and the double-tap brake. |

## 3. Renderer scope (three.js r147, `game/vendor/three.min.js`, classic script, works offline in the APK)

* **World built from route data:** road deck with a crochet carpet texture, deck sides, gold rope rails, posts,
  tassels and lanterns, the Bellspindle and Tassel towers, the tassel arch, the side loop, and the flower gate.
  Distant city art is used only as a far backdrop, never as pages to cross.
* **Characters:** 3D crochet Purl (coral, one curled tuft) and Loop (teal, two loop ears) built from shapes with knit
  textures and a simple rig. Their gait follows distance travelled: contact, push-off, swing, landing, opposite arms,
  gentle bob and lean. They have a real idle, a jump arc, a brake and a contact shadow.
* **Camera:** a chase camera behind and above Purl with time-based smoothing and look-ahead around bends, keeping him
  at about 15–20% of screen height. It never fades, wipes or resets between areas.
* **Debug view (`?debug=geom`):** walkable edges, steering limits, centre line, branch outline, foot-contact markers.

The kit's GLB is a blockout of the same course; it is not loaded at runtime (no loader needed, works from `file://`).
`tools/check-route-vs-glb.py` checks that our road matches its walkable top.

## 4. Milestone 1 (stop for review)

The connected opening through the next area: the opened rug → around the Bellspindle tower → the Tassel Switch
branch and rejoin → into Snagling Landing, dressed. The rest of the road exists and can be run to the finish line
with simple dressing. Red, teal and gold pickups and the finish rule work. Snagling, the butterfly and the pull lesson
are re-integrated after review.

Side-loop design choice: the kit's side loop is 3.6 m longer than the main road. To make it the "valid shorter route"
the prompt asks for (as the approved old 02 "shortcut" was), it carries a teal speed ribbon that makes it about 0.5 s
faster.

Proof: uncut recordings (normal and debug view) from one commit at 720×1602 and a narrower portrait size, showing
left/right, jump, brake with Loop passing, resume, a jump while stopped, pause, the opening bend, the branch/rejoin
and entry into the next area with no wipe; plus a debug APK. Tested in headless Chromium (SwiftShader software
WebGL) only, not on a physical phone.
