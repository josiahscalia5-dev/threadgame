# Wishweave Wonders Level 1 — architecture and module contracts

This is the implementation contract for the playable Level 1. The behavioral source of truth is the kit:
`kit/Wishweave-Level1-Complete-Visual-Kit/docs/LEVEL1-GAMEPLAY-SPEC.md`, `ART-DIRECTION.md`,
`CLAUDIA-INTEGRATION.md`, `scene-connections.json` and `kit/CLAUDIA-LEVEL1-COMPLETE-PROMPT.txt`.
Where this document gives numbers, they implement those documents; where it is silent, follow them.

## 1. Technology

* A 2.5D game in plain JavaScript + Canvas 2D, no build step, no dependencies, classic `<script>` files that
  attach to `globalThis.WW` (so `game/index.html` also opens from `file://`, and the simulation runs in Node tests).
* Android: a native WebView host (`android/`) packages `game/` and serves it from
  `https://appassets.androidplatform.net/assets/game/index.html` with `WebViewAssetLoader`, applying system-bar
  and cutout insets as padding (derived from the kit's viewer host).
* The six clean plates are the scenery. A camera dollies into each plate as Purl runs, keeping him lower-centre at a
  constant size; connectors between plates are "around the tower" wipe transitions while both racers keep running.
  Separate sprites provide racers, Snagling, spools, tassels, butterfly, rolls and cues. Foreground occluder polygons
  redraw plate pixels over characters that are behind posts/towers.

## 2. Files and ownership

| Path | Owner | Contents |
|---|---|---|
| `game/src/core/ww.js` | core (fixed) | `WW` namespace, `WW.TUNING`, `WW.rng(seed)`, `WW.util` |
| `game/src/core/path.js` | core (fixed) | `WW.path.prepare/sample/project/racerPoint/widths` |
| `game/src/data/asset-data.js` | generated | `WW.ASSETS` by `tools/build-runtime-assets.py` — never hand-edit |
| `game/src/data/plates/p01.js … p07.js` | route data | `WW.PLATES.pXX` per §5 |
| `game/src/data/level.js` | simulation | `WW.LEVEL` per §6 (route order, lengths, objectives, Loop route) |
| `game/src/sim/*.js` | simulation | `WW.sim.createRace(...)` per §7 |
| `game/src/render/*.js` | renderer | `WW.render.createRenderer(...)` per §8 |
| `game/src/ui/*.js`, `game/src/main.js`, `game/index.html`, `game/style.css` | UI | HUD, input, overlays, loop, lifecycle, public API per §9 |
| `android/**`, `tools/build-android.sh`, `docs/ANDROID.md` | Android | host project and build per §10 |
| `tests/unit/**` | simulation | Node `node:test` rule tests |
| `tests/e2e/**`, `tools/capture-*.cjs` | test | Playwright touch scenarios, recordings, comparisons |

Never edit files you do not own; never modify anything under `kit/` (the approved PNGs are immutable references).
Do not commit — the integrator commits.

Script order in `game/index.html`:
`core/ww.js, core/path.js, data/asset-data.js, data/plates/p01.js, p02.js, p03.js, p04.js, p06.js, p07.js,
data/level.js, sim/*.js (inventory.js, stitches.js, snagling.js, loop-ai.js, race.js), render/*.js (any order the
renderer declares; it must only define functions at load), ui/*.js, main.js`.
Each file is wrapped as `(function (WW) { 'use strict'; ... })(globalThis.WW = globalThis.WW || {});`.

## 3. Coordinate systems

1. **Plate (design) pixels** — every plate is 841 × 1870 (`WW.DESIGN`). All authored geometry uses these.
2. **Route state** — a racer is at `{seg, f, laneX, jumpH}`: `seg` indexes `WW.LEVEL.route` (or `loopRoute`), `f ∈ [0,1]`
   is the path fraction (racer-width metric, see `core/path.js`) on a plate segment or progress on a connector,
   `laneX ∈ [-1, 1]` is the continuous lane, `jumpH ∈ [0, 1]` the jump height fraction. The sim never uses pixels.
3. **Screen (CSS pixels)** — the renderer maps plate pixels to the canvas through its camera; the UI positions DOM by
   CSS pixels inside the safe area. `renderer.worldToScreen` converts.

`WW.path.racerPoint(path, f, laneX, jumpH)` gives the plate-pixel foot point; lane offset is horizontal
(`laneX * lane` plate px), jump lifts by `jumpH * 0.42 * w`.

## 4. Assets (`WW.ASSETS`)

`WW.ASSETS.images[key] = {file, w, h}` (files relative to `game/`) and
`WW.ASSETS.frames[name] = {img, x, y, w, h, px, py}` — a trimmed source rectangle in image `img` and its pivot
(`px, py` within the rectangle). Draw a frame at plate point P with target width W:
`scale = W / frame.w; dx = P.x - px*scale; dy = P.y - py*scale`.

Images: `p01 p02 p03 p04 p06 p07` (plates), `purl loop` (rear atlases), `purlFront loopFront`, `snag`, `props`,
`features`, `ui.logo ui.pill ui.pause ui.bubble-coral ui.bubble-teal`.

Frames:
* `purl.*`, `loop.*`: `idle run-left run-pass-a run-right run-pass-b jump duck stumble` (rear, foot pivots).
  Run cycle order: `run-left → run-pass-a → run-right → run-pass-b`.
* `purlFront.f1..f8`, `loopFront.f1..f8`: front poses — only for start/results moments, never running at the camera.
* `snag.*`: `idle reach cheer walk spin peek alert grab` (`peek` = low sneaky crouch, `alert` = surprised "!" pop,
  `reach`/`grab` = attacking with yarn arms, `spin` = tangling, `walk`/`cheer` = retreat).
* `prop.*`: `coral-thread teal-thread golden-thread` (bottom pivot), `swinging-tassel` (TOP pivot), `cover-post`, `flower-gate`.
* `feat.*`: `stitch-loop carpet-rolled carpet-flat butterfly-closed butterfly-open butterfly-carrying-spool`.

Reference widths from the approved art (plate px): Purl 289–312 near the camera; spools 62–108; Loop 95–145 on his route.

## 5. Plate data (`WW.PLATES.pXX`)

Plates: `p01` ribbon, `p02` shortcut, `p03` tassels, `p04` landing (shared by approved 04-snagged and 05-recovery),
`p06` butterfly, `p07` finish. Schema (all coordinates plate px):

```js
WW.PLATES.p01 = {
  id: 'p01', image: 'p01', approved: '01-ribbon.png',
  camera: { zMax: 1.8, anchorY: 0.80 },          // max dolly zoom; Purl's target foot height (fraction of view)
  purl: {
    path: [[x, y, w, lane], ...],                // entry (near camera) → exit (far); see core/path.js
    events: [                                    // f = fraction on this path (use WW.path.project to find)
      { type: 'start', f },                      // p01 only: spawn point for the countdown
      { type: 'stop', stitch: 'ribbon', f, readyF },  // Purl halts at f until the stitch is open; tap accepted from readyF
      { type: 'pickup', item: 'coral'|'teal'|'gold', f, lane: 0, size },  // size = spool width in plate px
      { type: 'reveal', f },                     // p04: Snagling reveal trigger
      { type: 'loopReturn', f },                 // p04: where the local recovery loop returns Purl
      { type: 'exit', f },                       // optional, default 1: where the segment hands over to the next
      { type: 'finish', f },                     // p07: finish trigger
      { type: 'hint', f, text }                  // optional coaching text shown by the UI
    ]
  },
  loop: {                                        // Loop's own visible route through this plate
    path: [[x, y, w], ...],
    events: [
      { type: 'task', kind: 'stitch'|'hop'|'bypass', f, x, y, dur, extra },  // x,y = sparkle location for his task
      { type: 'pickup', item, f, size },
      { type: 'finish', f }                      // p07
    ]
  },
  stitch: { id: 'ribbon', x, y, r },             // world tap target + cue anchor (r ≥ 60 px)
  ribbon:   { band: [[x, y, halfWidth], ...] },  // p01: ribbon centre line from its base to the plate's top curl
  shortcut: { band: [[x, y, halfWidth], ...] },  // p02: runner centre line from the near landing edge to the far roll
  tassels: [{ x, y, w, lift }, x3],              // p03: TOP anchor point, sprite width, lift distance (px up)
  previews: [{ item, x, y, size }],              // p02: sightline preview of purl.teal (never collectible here)
  cameo: { x, y, w },                            // p02: harmless Snagling peek (no collision)
  snagling: { hide: {x, y, w}, peek: {x, y, w} },// p04: concealed position behind the left post, reveal pose
  butterfly: { rest: {x, y, w, rot}, flight: [[x, y, w], ...], exit: [[x, y, w], ...] },  // p06
  gate: { x, y, arch: [[x, y], ...] },           // p07: gate centre and opening polygon
  occluders: [{ id, poly: [[x, y], ...], behindY }],  // plate pixels inside poly are redrawn over any character whose
                                                       // ground y < behindY (it is farther away than the occluder)
  wipe: { x0, x1 }                               // a full-height tower/pillar column used as the transition wipe
};
```

Route rules the data must satisfy (from the spec):
* p01: Purl starts on the lower coral carpet; the stitch is reachable ahead/right; the ribbon band starts at the
  carpet and ends at the plate's cream top curl; the coral pickup is high on the ribbon; the path continues around the tower.
* p02: Purl stops on the broad foreground landing beside the stitch; the band joins the landing to the far platform
  where the plate's roll rests; the path crosses only after opening and turns away **before** the teal preview, so
  Purl cannot reach the preview spool.
* p03: three tassels hang across the approach before the raised round landing; the teal pickup is on that landing.
* p04: broad landing with lanes (lane spacing large); reveal after controls are restored; drops land ahead/right on
  safe carpet; the exit and loopReturn exist for the recovery loop.
* p06: stitch on the tall left tapestry's lower fitting; butterfly rests on its outline; flight ends above the gold
  pickup point on Purl's path.
* p07: Purl enters on the terrace (no ground below ~y 1520), finish trigger near the approved Purl position;
  Loop arrives on his adjacent route.

## 6. Level route (`WW.LEVEL`, `game/src/data/level.js`)

```js
WW.LEVEL = {
  route: [            // Purl's connected route; plate segments alternate with connectors
    { id: 'ribbon',   kind: 'plate', plate: 'p01', length: 40, phase: 'LEVEL 1 · START', objective: 'UNFURL THE RIBBON' },
    { id: 'c-ribbon', kind: 'connector', from: 'p01', to: 'p02', length: 9, style: 'left' | 'right' },
    { id: 'shortcut', kind: 'plate', plate: 'p02', ... 'LEVEL 1 · MIDDLE', 'OPEN THE SHORTCUT' },
    { id: 'c-shortcut', ... }, { id: 'tassels', plate: 'p03', ... 'LIFT THE TASSELS' },
    { id: 'c-tassels', ... }, { id: 'landing', plate: 'p04', ... },
    { id: 'c-landing', ... }, { id: 'tapestry', plate: 'p06', ... 'WAKE THE EMBROIDERY' },
    { id: 'c-tapestry', ... }, { id: 'finish', plate: 'p07', ... }
  ],
  loopRoute: [ /* same ids, kinds and plates (index-aligned with route), Loop's own lengths */ ],
  stitches: { ribbon: { seg: 'ribbon', kind: 'ribbon' }, shortcut: {...}, tassels: {...}, butterfly: {...} }
};
```
`length` is metres; a racer at speed v advances `df = v * dt / length`. Lengths are tuned so a first successful run
takes ~90–150 s (see §7.8).

## 7. Simulation (`WW.sim`)

Pure logic, deterministic for a given seed and input sequence, no DOM, no wall clock, runs in Node.

```js
const race = WW.sim.createRace({ seed, level: WW.LEVEL, plates: WW.PLATES, tuning: WW.TUNING });
race.state                         // live state object (§7.1) — readers must not mutate it
race.step(dt)                      // advance by dt seconds (callers use fixed 1/60 steps); returns events[]
race.input({ type: 'tap', target: 'ribbon' })        // stitch tap (target = stitch id)
race.input({ type: 'swipe', dir: 'left'|'right'|'up'|'down' })
race.start()                       // intro → countdown
race.pause(reason) / race.resume() // while paused, step() is a no-op for every racer, hazard and animation
race.debug                         // test helpers: teleport(who, segId, f), setItem(id, patch), forceReveal(), ...
```

### 7.1 State shape
```js
{
  mode: 'intro'|'countdown'|'running'|'finished'|'failed',
  paused: false, pauseReason: null,
  time: 0,                       // race clock (s since GO); only advances while running and not paused
  countdown: 3,                  // seconds left in countdown
  seed,
  purl: { seg, segId, f, lane, laneX, jumpT, jumpH, speed,
          action: 'idle'|'run'|'wait'|'tangled'|'transition'|'looping'|'returning'|'finished'|'failed',
          airborne, immuneUntil, tangledUntil, distance /* metres run, drives run-cycle frames */,
          finishTime: null, rank: null },
  loop: { seg, segId, f, laneX, jumpH, speed, action: 'idle'|'run'|'task'|'hesitate'|'stumble'|'recover'|'transition'|'finished',
          task: null | { kind, until }, distance, finishTime: null, rank: null },
  items: {                       // exactly six unique IDs
    'purl.coral': { id, owner: 'purl', color: 'coral', status: 'uncollected'|'held'|'dropped',
                    available: true, seg, f, lane, heldSeq: 0, dropTime: null }, ...
    // purl.gold / loop.gold start available:false until delivered; status changes only by the rules below
  },
  held: { purl: 0, loop: 0 },    // derived counts = number of that racer's IDs with status 'held'
  stitches: {
    ribbon:   { state: 'idle'|'ready'|'animating'|'open', t: 0..1, tappedAt: null },
    shortcut: { ... }, tassels: { ..., lifts: [0, 0, 0] },
    butterfly: { ..., phase: 'dormant'|'emerge'|'fly'|'place'|'done' }
  },
  loopTasks: { [taskKey]: { state, t } },
  snagling: { state: 'concealed'|'hop'|'tangle'|'retreat'|'done', t, targetLane, pass, armed, contactConsumed },
  gate: { state: 'closed'|'opening'|'open', t },
  objective: 'UNFURL THE RIBBON', phase: 'LEVEL 1 · START',
  message: null | { text, kind: 'hit'|'recover'|'dodge'|'info', until },
  hint: null | { text, until },
  transition: null | { kind: 'connector'|'loop'|'return', from, to, style, t: 0..1 },
  result: null | { purlTime, loopTime, purlRank, loopRank, winner: 'purl'|'loop'|null, loopStillRacing },
  stats: { hits, dodges, recoveries, taps }
}
```
Events returned by `step()`/`input()` (also used for sound/FX): `{type:'go'}`, `{type:'stitch-tap', id}`,
`{type:'stitch-open', id}`, `{type:'pickup', item}`, `{type:'drop', item, f, lane}`, `{type:'recover', item}`,
`{type:'reveal'}`, `{type:'hit'}`, `{type:'immune-ignored'}`, `{type:'dodge'}`, `{type:'fail'}`,
`{type:'jump', who}`, `{type:'lane', who, lane}`, `{type:'loop-task', kind}`, `{type:'loop-stumble'}`,
`{type:'loop-drop', item}`, `{type:'loop-recover', item}`, `{type:'gate-open'}`, `{type:'gate-blocked'}`,
`{type:'finish', who, time}`, `{type:'segment', who, segId}`.

### 7.2 Movement and input
* Auto-run at `purlSpeed`; accelerate/decelerate at `purlAccel`. Stops clamp `f` to the stop until the stitch is open
  (+`routeSettle`). Purl is never auto-run into a gap: the clamp is the route boundary.
* Swipe left/right changes target `lane` by one within the lanes the current path allows (`lane` spacing > 0 at f);
  `laneX` moves toward it over `laneChangeTime`. Swipe up starts a jump (`jumpTime`, height `sin(πt)`), buffered if
  pressed within `inputBufferTime` before landing. Swipe down does nothing (no slide obstacle exists).
* Taps never trigger movement; swipes never trigger stitches. A tap targets a stitch id from the renderer's hit test.

### 7.3 Stitch interactions
* A stitch becomes `ready` when Purl is on its segment with `f ≥ readyF`; taps before that are ignored (no penalty).
  A missed or early tap is simply retryable. Taps while `animating`/`open` do nothing (no double activation).
* `ribbon`: animating `ribbonUnfurl` s → open. `shortcut`: `shortcutUnroll` s → open, **no inventory change**.
  `tassels`: three lifts staggered by `tasselStagger`, each `tasselLift` s; open when all three are fully clear.
  `butterfly`: `emerge → fly → place` (`butterflyEmerge/Fly/Place`); at the end of `place`, `purl.gold.available = true`
  at its pickup f; 3/3 happens only on pickup. Purl waits at the stop through the whole delivery.
* Opened routes never close; tassels never lower. No Snagling attack can happen during any stitch lock.

### 7.4 Inventory
* Pickup: Purl on the item's segment, item `available`, status `uncollected`, `|f - item.f| ≤ pickupRadiusF` → `held`,
  `heldSeq = ++counter`, event `pickup`. Normal pickups are lane-agnostic (cannot be missed).
* Dropped item recovery additionally needs `|laneX - item.lane| < dropPickupLane`; it restores the **same ID** to
  `held` (event `recover`, message "THREAD RECOVERED"). A held item's visual never exists in the world, so it cannot be
  collected twice. Purl can never touch `loop.*` items and vice versa.

### 7.5 Snagling (p04 only)
* Armed once per pass over the landing. When Purl reaches the `reveal` f (not in a lock, not transitioning) →
  `hop` with `targetLane = purl.lane` at that instant. Contact is tested from `snagRevealToContact` for
  `snagContactWindow` s: contact if `|laneX - targetLane| < 0.55` and `jumpH < jumpAirborneAbove`.
* One damage event per attack (`contactConsumed`). Contact during immunity (`time < immuneUntil`) → `immune-ignored`.
* Hit while holding ≥ 1: drop the most recently collected held ID (`max heldSeq`) at
  `f + dropAheadF` (kept ≥ 0.08 before exit; spaced from other drops by `dropSpacingF`), lane `+1` (or `0` if Purl is
  in lane +1) — away from Snagling's left side. Message "SNAGGED!", tangle `snagTangle` s (speed 0), immunity
  `hitImmunity` s, then `slowAfterHit` for `slowAfterHitTime` s. Losing the last thread (1 → 0) does not fail.
* Hit while already at 0 held (and not immune) → `failed` after `failDelay` (gentle fail; retry resets the attempt).
* No contact in the window → `dodge` event, Snagling retreats; held count unchanged, no hit/recovery messages.
* Snagling never moves Purl, never drags him; drops always land on the landing's carpet.
* Recovery loop: if Purl reaches the landing exit while any `purl.*` item is `dropped` on this segment, he runs a short
  loop (`transition.kind = 'loop'`, `recoveryLoopTime` s) back to `loopReturn` f; Snagling re-arms (new pass).
  So 2 → 1 (miss spool) → 1 → 0 → hit at 0 → fail is reachable; recovering at any point continues normally.

### 7.6 Finish and gate fallback
* At p07 `finish` f with all three `purl.*` held → `finishTime = time`, rank 1 if Loop has not finished, else 2. The gate
  opens (`gate.state`). Damage stops. The sim keeps simulating Loop until he finishes or `finishWaitForLoop` s pass
  (`result.loopStillRacing` true until then). Loop finishing first is a legitimate result; Purl second still completes
  the level.
* Reaching `finish` with fewer than three held → `gate-blocked`, message "A THREAD IS MISSING", a `return` transition
  back to the segment holding the earliest non-held item (its `loopReturn` f on p04, else that segment's entry). Never a
  dead end.

### 7.7 Loop (computer rival)
* Follows `loopRoute` (index-aligned with Purl's route; same plates/connectors) with his own lengths and speed
  `loopSpeed × (1 ± loopSpeedJitter)` per segment. Never teleports; `f` is continuous; simulated identically when not visible.
* Tasks: `stitch` — slows to a stop, reacts after `loopReact` (+ `loopHesitate` with `loopHesitateChance`), performs for
  `dur` (default the equivalent Purl animation time), continues. `bypass` — the longer upper route: `extra` seconds of
  additional travel. `hop` — jumps; with `loopHopMissChance` he mistimes and stumbles for `loopStumble` s, and with
  `loopDropOnStumbleChance` drops his most recent thread just ahead and recovers it after `loopRecover` s (same ID).
* Pickups use his own `loop.*` IDs. His count never changes because of Purl. He finishes only with all three held.

### 7.8 Pacing targets (verified in tests/unit)
* A competent touch run (stitch reaction ~1.0 s, dodges) and a first-time run (reaction ~2 s, one hit + recovery):
  race clock roughly 85–130 s; with the 3 s countdown and transitions, a first successful attempt lands in 90–150 s.
* Across seeds, Loop's finish times overlap both runs: a competent player wins most but not all races; a first-time
  player with a hit loses a meaningful share. Both outcomes must be reachable with documented seeds.

## 8. Renderer (`WW.render`)

```js
const r = WW.render.createRenderer({ canvas, images /* {key: HTMLImageElement} */, assets: WW.ASSETS,
                                      plates: WW.PLATES, level: WW.LEVEL, debug: false });
r.resize(cssWidth, cssHeight, devicePixelRatio)   // canvas fills the safe-area game surface
r.render(state, dtReal)          // draw one frame from sim state (read-only); dtReal drives cosmetic animation only
r.getTapTargets()                // [{id, x, y, r}] CSS px, only for stitches currently 'ready' (generous r ≥ 44 CSS px)
r.worldToScreen(plateId, x, y)   // CSS px for the plate currently on screen
r.getLayout()                    // {view: {x, y, w, h} CSS px of the plate rectangle at zoom 1, purl: {x, y, w}}
```
Responsibilities:
* **Fit:** contain-fit the 841 × 1870 plate into the canvas at zoom 1; fill the remaining area with a blurred, darkened
  copy of the current plate (decorative framing, never stretched). Cap the backing store at DPR 2.
* **Camera:** for Purl at sample `{x, y, w}`: zoom `z = clamp(w0 / w, 1, zMax)` (w0 = path start w); as z rises, blend
  Purl's screen anchor toward (centre + lane offset, `anchorY`); clamp the view inside the plate; damp ~0.2 s.
  At a segment start the view equals the approved composition.
* **Layers:** framing → plate → unopened-route ghosting → props behind → depth-sorted actors/items (by ground y) →
  occluders → effects → world cues → transition wipe.
* **Route openings:** before open, the not-yet-woven part of the ribbon/shortcut band (from the roll position to the
  far end) is drawn "ghosted" (desaturated, pale, translucent shimmer) and a carpet roll sprite sits at the band start
  (coral-tinted for the ribbon); animating moves the roll along the band to its end (where the plate's own roll/curl
  is) while revealing full-colour carpet behind it; open = the untouched plate.
* **Tassels** hang across the route until lifted on gold ropes (staggered easeOutBack); **butterfly** rests as
  embroidery on the tapestry, peels off (scale/shadow/flap between open/closed frames), flies the flight path with
  `butterfly-carrying-spool`, sets the gold spool on the carpet, exits; **gate** has a soft closed veil that bursts into
  petals and glow when Purl arrives complete.
* **Characters:** 4-frame run cycle from `distance` (one cycle ≈ 1.6 m), idle breathing, jump pose + shadow shrink,
  stumble when tangled (yarn loops around ankles), subtle golden immunity rim; Loop identically on his path with his
  scale, hidden whenever he is not on the plate's segment or occluded.
* **Snagling:** invisible while concealed (no warning), hop arc from behind the left post to the target lane (alert →
  reach → grab), tangle, retreat behind the post. p02 cameo: harmless peek.
* **Spools:** world items with soft glow; pickup flies to the HUD; drops arc onto the carpet and bob with a ring;
  approved callouts "−1 THREAD" / "+1 THREAD" pills near the spool.
* **Cues:** world-anchored "Tap the stitch" pill + arrow + pulsing gold ring on the stitch while `ready`; text on the
  first two stitches, ring only later unless idle for `cueRepeatAfter` s. Snagling never gets a warning cue.
* **Transitions:** connector = both plates visible during a horizontal turn with the `wipe` tower column sweeping across,
  Purl kept running at his screen anchor; loop/return use the same machinery.
* `debug: true` draws paths, lanes, events and occluders.

## 9. UI, input, lifecycle (`game/index.html`, `game/style.css`, `game/src/ui/*`, `game/src/main.js`)

* Layout: `#game` fills the viewport inside `env(safe-area-inset-*)` (the Android host also pads the WebView). Canvas
  fills `#game`; DOM HUD overlays it.
* HUD (top, compact, cream stitched pills from `ui.pill`/`ui.logo`/`ui.pause`): logo (hidden on short screens), phase
  pill, PURL n/3 (coral) and LOOP n/3 (teal, labelled as computer rival in the start screen/help), objective/message
  pill, pause button top-right (≥ 44 px). A slim race-progress thread with a coral and a teal bead is allowed. Counts
  come from `state.held` only.
* Rewards strip (bottom, slim): "SAVED REWARDS" decorative bar + locked "CASH OUT" (disabled; tapping explains it is
  locked — no real money, no exchange rate). Never changes with hits/fails/replays.
* Overlays: start (title, Purl vs Loop "computer rival", how to play: tap stitches, swipe ←/→ to move, swipe ↑ to jump),
  countdown, pause (Resume / Restart / How to play), fail (gentle, Try again), results (LEVEL 1 COMPLETE, true ranks and
  times, "Loop is still racing…" until he finishes, PLAY AGAIN).
* Input: pointer events on the game surface. Tap = < 12 px movement and < 300 ms → hit-test `renderer.getTapTargets()`
  (generous radius) → `race.input({type:'tap', target})`; swipe = ≥ 36 px dominant-axis movement → `swipe` dir.
  Keyboard for desktop testing: ←/→/↑, Space/Enter taps the ready stitch, P/Esc pauses.
* Loop: `requestAnimationFrame`; fixed 1/60 s sim steps with an accumulator (max 5 steps/frame); render every frame.
* Lifecycle: `visibilitychange` hidden / `pagehide` / `blur` → pause (stays paused on return until the player resumes).
* Public API `window.WishweaveGame = { version, start(), pause(reason), resume(), restart(seed?), getState(), onBack() }`
  — `onBack()` pauses a running race and returns `'paused'`, otherwise returns `'exit'` (Android Back).
* Test mode `?test=1` adds `WishweaveGame.debug = { race, renderer, advance(seconds), setClock('manual'|'real'),
  tap(target), swipe(dir), screenshotReady() }`; `?seed=N` fixes the seed; `?debug=1` enables renderer debug drawing.

## 10. Android host (`android/`)

Application id `com.wishweave.wonders.level1`, label "Wishweave Wonders", minSdk 26, target/compile 36, AGP 8.13.x,
Gradle wrapper 8.13, Java 17 bytecode. `bundleGame` Sync task copies `../game` into generated assets. MainActivity:
WebView with `WebViewAssetLoader`, blocked network fallbacks, system-bar/cutout insets applied as root padding,
`onPause` → `WishweaveGame.pause('background')` + `pauseTimers()`, `onResume` → resume timers only (game stays paused),
Back → `WishweaveGame.onBack()`; finish only on `'exit'`. Portrait. No INTERNET permission. Renderer-crash recovery view.

## 11. Honesty boundaries

No real money: the rewards strip is a placeholder, cash out is locked, nothing is credited. Loop is labelled a computer
rival. Do not claim device testing that did not happen; browser/Playwright checks are not Android device tests.
