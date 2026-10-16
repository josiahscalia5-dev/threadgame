# Touch input handoff

`touch-input.mjs` is a small, dependency-free browser ES module. It emits immutable intentions; the game engine owns movement, animation, collision, and race state. Serve these files with the rest of the game; no CDN or runtime network request is needed. Browser ES modules generally need an HTTP origin, so opening the HTML directly as `file://` is not a supported launch method.

## Exports

| Export | Contract |
| --- | --- |
| `attachTouchInput(surface, onIntent, options?)` | Pointer Events adapter. Returns `{ reset, dispose }`; call `dispose()` when replacing the scene. |
| `createGestureMachine(options?)` | DOM-free state machine with `down`, `move`, `up`, `cancel(pointerId, options?)`, `reset`. Each returns an array of zero or one intents. |
| `classifyGesture(sample, options?)` | Pure classifier: `tap`, `left`, `right`, `jump`, `reserved`, or `none`. |
| `swipeThreshold(viewportWidth, options?)` | Horizontal/vertical threshold in CSS pixels. |
| `INTENTS` | `left`, `right`, `jump`, `togglePlayerBrake`, `toggleGlobalPause`. Buttons and other accessible controls use the same objects. |
| `DEFAULTS` | Frozen gesture defaults; pass overrides only after device testing. |

Pointer samples use `{ pointerId, x, y, time, viewportWidth }`. `down` also accepts `ignored: true`. Use CSS coordinates and a single monotonic millisecond clock (`performance.now()`). The adapter supplies these; it deliberately does not depend on browser event timestamp origins. The pure classifier takes `{ dx, dy, duration, maxDistance, viewportWidth }`, where `maxDistance` is the furthest excursion from the starting point. For capture loss while a pointer remains down, call `cancel(id, { retainPointer: true })`; ordinary `pointercancel` uses `cancel(id)`.

## Exact behavior

The swipe threshold is 8% of viewport width, clamped to 24–72 CSS pixels. A swipe must have a dominant axis (1.2× the other axis). Each stroke resolves once on release. Left/right emit one steering intention; up emits **jump only**. Down is reserved and emits nothing. Ambiguous diagonals and subthreshold movements emit nothing.

Double tap requires two taps of at most 200 ms, each staying within 10 CSS pixels of its start, with releases no more than 320 ms apart and starts within 24 CSS pixels. A single tap has no action. Swipes, long presses, drag-return gestures, UI input, cancellation, and multi-touch invalidate pending taps. After a double tap, a third tap starts a new pair. Two simultaneous contacts are never a double tap. Multi-touch cancels until every tracked contact lifts; the module does not interpret pinch gestures.

UI elements marked `data-ui`, native buttons/links/form inputs, editable text, and `role="button"` are excluded. Interaction outside the surface also clears pending taps. Pointer capture, `pointercancel`, capture loss, page visibility, and focus loss are handled. Call `reset()` when switching modes or opening/closing a pause screen.

## Wire the engine

Start Purl automatically at a **normal, brisk** running pace. Calibrate world speed to scenery, camera scale, obstacle spacing, and available reaction distance; this module intentionally specifies no numeric world speed.

| Intent | Required engine response |
| --- | --- |
| `{ type: 'steer', direction: -1 or 1 }` | During a junction selection window, queue the corresponding branch and commit at the junction. Between junctions, update the lane target or smooth steering target. Do not treat a swipe as teleportation. |
| `{ type: 'jump' }` | Request a jump subject to grounded/jump rules. Never also issue forward movement or a speed boost. |
| `{ type: 'toggle-player-brake' }` | Toggle Purl's requested running/stopped state. Decelerate to rest over **0.18–0.25 seconds**; a second double tap resumes normal running. **Loop keeps racing** while Purl brakes or stands still. |
| `{ type: 'toggle-global-pause' }` | Pause/resume simulation for **both Purl and Loop**, including race timers. Preserve Purl's pre-pause brake state. This intent is emitted by an explicit pause control, never by a gesture. |

Use elapsed seconds (`dt`) for movement, braking, smoothing, and jump physics; never multiply by an assumed frame rate. Integrate velocity across the braking interval, including its endpoint, so different refresh rates travel the same distance. Freeze simulation time during global pause and reset the animation-loop timestamp when resuming; a background-tab interval must not advance the race in one giant step. While globally paused, ignore steering/jump/brake requests and keep the pause button usable.

Drive stride phase from **actual distance traveled**, not a free-running animation clock. Blend into an idle pose once Purl is stopped; do not keep feet running while the root is stationary. The opponent's movement and animation continue during the player-only brake. A late landing while braking must respect grounded physics and the requested stop state.

## Accessible controls and CSS

Use real buttons so keyboard, assistive technology, mouse, and switch users have equivalents. Keep controls visible and sufficiently large, use clear focus styles, and update the brake/pause labels and `aria-pressed` values from actual engine state. If adding keyboard shortcuts, skip events from text inputs and editable content, and prevent repeated keydown toggles.

```html
<div id="playfield" aria-label="Wishweave race"></div>
<nav data-ui aria-label="Race controls">
  <button type="button" data-action="left">Steer left</button>
  <button type="button" data-action="right">Steer right</button>
  <button type="button" data-action="jump">Jump</button>
  <button type="button" data-action="togglePlayerBrake" aria-pressed="false">Stop Purl</button>
  <button type="button" data-action="toggleGlobalPause" aria-pressed="false">Pause race</button>
</nav>
<style>
  #playfield { touch-action: none; user-select: none; }
  [data-ui] button { touch-action: manipulation; min-width: 48px; min-height: 48px; }
  [data-ui] button:focus-visible { outline: 3px solid currentColor; outline-offset: 3px; }
</style>
<script type="module">
  import { attachTouchInput, INTENTS } from './code/touch-input.mjs';
  // Supply game.handleIntent(intent) in the host game using the contracts above.
  const emit = intent => game.handleIntent(intent);
  const input = attachTouchInput(document.querySelector('#playfield'), emit);
  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', () => {
      input.reset();
      emit(INTENTS[button.dataset.action]);
    });
  });
  // Also call input.reset() on programmatic pause/mode changes.
  // During scene teardown remove the host button listeners and call input.dispose().
</script>
```

Apply `touch-action: none` **before** contacts begin, only to the gameplay surface; leave page navigation and controls usable. Viewport-width measurement uses layout CSS pixels, not physical device pixels. Do not add competing click/double-click/touch listeners to the surface. Keep one adapter mounted per active playfield.

## Checks

Run `node --test code/touch-input.test.mjs` from the kit folder. The tests cover threshold boundaries, directional exclusivity, tap eligibility, UI interruption, multi-touch, cancellation/capture loss, disposal, and coalesced drag excursions. They validate logic and a simulated adapter, not device compatibility. Before release, check on real touch devices: scroll/zoom containment, fast swipes, two-finger contact, interrupted gestures, UI buttons, background/resume, braking while jumping, and frame-rate-independent movement.
