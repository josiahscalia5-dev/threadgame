# Opening lesson: TOUCH → PULL → OPEN

The first stitch of Level 1 (the closed coral ribbon on p01) is opened by touching the gold loop beside Purl and
pulling it down, instead of tapping. Sources: `kit/pull-stitch/CLAUDIA-PULL-STITCH-PROMPT.txt` and the three
approved still frames in `kit/pull-stitch/approved-frames/` (TOUCH, PULL, OPEN; extracted from
`Preview-Wishweave-Pull-Stitch-Small.html`).

**Not received:** the prompt refers to an update ZIP containing `approved/pull-stitch-approved.png`,
`START-HERE.txt`, `docs/PULL-STITCH-SPEC.md`, `docs/ANIMATION-AND-ART.md`, `docs/ASSET-INTEGRATION.md`,
`docs/ACCEPTANCE-CHECKS.md` and raster cutouts/plates. Only the preview HTML and the prompt were uploaded, so this
implementation follows the prompt and the three compressed frames. The full-resolution triptych, the extra specs
and the cutouts would let the art be matched more closely; nothing in the code depends on them.

## Player flow

1. Purl runs ~0.8 m from the start and stops at the closed carpet. The race enters the **lesson hold**.
   A gold loop with glow and rings sits on the carpet beside him; the pill reads **Touch the loop**, with an arrow.
2. Touching the loop (hit radius max(1.15 × target r, 48) CSS px, target r ≥ 44) grips it. The pill becomes
   **Pull down**, with a long downward arrow that fills gold with the progress. Purl reaches toward the loop, then braces
   in a two-foot crouch and leans back. A twisted gold strand is fitted every frame from the roll's fastening to
   his grip, with its slack falling to the carpet. Stitch lights twinkle at the roll's edges. The roll climbs the
   ramp base with the progress, up to 8 % of the band. The route stays closed and Purl cannot enter it.
3. At full progress the knot releases (sparkle burst at the fastening, Purl recoils, then recovers). The prompt
   disappears. The roll finishes laying the carpet up the tower in `ribbonUnfurl` = 1.3 s, revealing the plate's own
   coral-and-gold surface. After `routeSettle` (0.25 s) the hold ends and both racers run on.
4. The objective changes to **Collect the coral thread**. Opening awards nothing: Purl stays 0/3 until he
   physically reaches the coral spool, which makes it 1/3.

## Rules (simulation: `game/src/sim/stitches.js`, `race.js`)

* `WW.LEVEL.stitches.ribbon = { …, interaction: 'pull', tutorial: true }`.
* Input `{type:'pull', target, phase:'start'|'move'|'end'|'cancel', amount}`. `amount` is this gesture's largest
  downward drag divided by the drag target.
  * `start` is accepted only while the stitch is `ready` **and** Purl stands at its stop (`purl.waitingFor`).
    A second simultaneous grip is ignored.
  * `pull = max(pull, pullBase + amount)`, where `pullBase` is the progress kept from earlier gestures. Pulling back never
    lowers it. Releasing early keeps it, and the next touch continues from it.
  * At `pull = 1` the stitch goes `animating`, exactly once. Later pulls and taps on it return no events. Taps never
    open a pull stitch.
  * `race.pause()` releases any grip (partial progress kept). Input is ignored while paused. A retry is a new race
    with a fresh lesson.
* **Lesson hold:** while Purl waits at a stop whose stitch has `tutorial: true` and it is not yet passable
  (landed, lane settled, no transition), `state.tutorial = {id, stage}` with stage `touch|pull|unfurl|settle`.
  During the hold:
  * The race clock does not advance.
  * Neither racer's route progress, speed, tasks or timers change. Loop holds his exact position.
  * Swipes are ignored.
  * Only the stitch advances. Its settle time is counted in sim steps (`stitch.settle`), not race time.
  When it ends, both racers continue from their real positions. Loop is never moved, teleported or levelled with
  Purl. Every later stitch and the rest of the race are unchanged: Loop stays autonomous.
* No speed boost, no item, no score. The three item identities stay coral/teal/gold (six IDs in total).
* Events: `pull-start {id, pull}`, `pull-release {id, pull, cancelled}`, `stitch-tap`, `pull-complete`, `stitch-open`.
* Pacing: the lesson is untimed. Loop's ribbon is 10 m shorter than before, so he no longer gains the ground he used
  to cover while Purl opened it, and the race balance is unchanged (competent 72 % wins, first-time 38 %).
  See `game/src/data/level.js`.

## Input (`game/src/ui/input.js`, `game/src/main.js`)

* A press that starts on a target of kind `'pull'` becomes a pull gesture with pointer capture.
  * Only downward movement counts. Sideways and upward movement is ignored.
  * The drag target is clamp(0.10 × canvas height, 64, 110) CSS px: 91.5 px at 412 × 915, 64 px at 360 × 640.
* A pull is never also a tap or a swipe. Extra fingers are ignored.
* `pointercancel`, lost capture, a pause/overlay/backgrounding (`input.cancelPull()` in `doPause`) end the gesture as
  `cancel`.
* `touch-action: none` is on the game canvas `#view` only (no longer on the whole `#game` container).
* Desktop: Space/Enter performs the whole pull.

## Rendering (`game/src/render/pull.js` + small hooks)

* `world.openProgress()` asks `pull.openProgress()` for the roll position: during the drag the roll moves up to 8 % of
  the band, smoothed. During the unfurl it goes from 8 % to 100 % with an ease. `world.rollGeom()` gives the roll
  geometry used for the fastening.
* There is only ever one roll (world.js). The clean p01 plate shows the open carpet, and the closed part of the band
  is drawn as cream, not-yet-woven crochet.
* Purl's lesson poses are synthesised from his existing rear `idle` and `duck` frames: lean about the feet, small
  squash, and a tug on each gain. No new character art was drawn and his feet do not run or slide. Loop is drawn idle
  (breathing) during the hold.
* Labels and arrows are 1.5× the later "Tap the stitch" cue, matching the approved triptych.

## Verification

* `node --test tests/unit/`: `tests/unit/pull.test.cjs` covers the hold, the gesture rules, retained progress,
  once-only completion, pause/cancel and no award/boost. The other suites were updated for the untimed lesson.
* `node tests/e2e/pull.cjs OUT [--record] [--w W --h H]` drives the lesson with real CDP touch events in Chromium and
  checks 24 points:
  * arrival and the frozen clock and Loop;
  * an upward/sideways drag, a partial pull and release, a second finger, and a pause mid-grip;
  * finishing the pull, then repeated touches;
  * one completion and one opening, no award;
  * the resume, and the physical coral pickup.
* Comparison sheet: `docs/checkpoints/2026-10-16-pull-stitch-compare.jpg` (approved vs running game at 412 × 915).

## Known differences from the approved frames

* **Purl's size.** The triptych draws Purl about 1.8× larger than approved screen 01 at the same camera (the tower,
  Loop and background match 01). The game keeps the approved-01 character scale and camera, as the prompt says.
* **Pull pose.** The approved PULL shows Purl's arms raised, gripping the strand overhead. The rear atlas has no
  raised-arm pull pose, so he braces in the crouched `duck` frame and the strand meets his right hand at his side.
  A dedicated reach/pull rear pose would close this gap.
* **Roll.** The approved PULL roll is larger and further up the ramp. Here it stays on the straight ramp base during the
  drag (larger travel turned it sideways at the band's bend) and climbs the rest during the unfurl.
* Browser (Chromium/Playwright) checks only. Not tested on an Android phone.
