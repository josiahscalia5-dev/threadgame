/* Wishweave Wonders — touch / mouse / keyboard input (docs/ARCHITECTURE.md §9, §7.2).

   const input = WW.ui.createInput({
     surface,                 // the game canvas: gestures must START here (buttons and overlays never start one)
     getTargets(),            // renderer.getTapTargets(): [{id, x, y, r}] in CSS px relative to the canvas
     enabled(),               // false while an overlay owns the screen or the race is not running
     onTap(id, point), onSwipe(dir), onPauseKey(), onKeyTap()
   });

   One gesture per pointer-down, decided once:
     swipe  dominant-axis movement ≥ SWIPE_PX fires as soon as it is reached (during the move), then the gesture is
            spent — it can never also become a tap;
     tap    released with total movement < TAP_PX within TAP_MS → hit-test the ready stitches with a generous radius;
            a tap never moves Purl and a miss does nothing.
   A second finger while one is down is ignored. Pointer capture keeps a swipe that ends over a button from clicking it.
   Keyboard (desktop testing): ← → ↑ ↓ / A D W S swipe, Space/Enter taps the ready stitch, P/Esc pause. */
(function (WW) {
  'use strict';

  const ui = WW.ui = WW.ui || {};
  const TAP_PX = 12;
  const TAP_MS = 300;
  const SWIPE_PX = 36;
  const HIT_SCALE = 1.45;   // accept taps within 1.45 × the renderer's radius …
  const HIT_PAD = 26;       // … or radius + 26 CSS px, whichever is larger
  const HIT_MIN = 56;       // and never less than 56 CSS px from the target centre

  function hitTest(targets, x, y) {
    if (!targets || !targets.length) return null;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t || t.id == null) continue;
      const r = Math.max(1, +t.r || 44);
      const reach = Math.max(r * HIT_SCALE, r + HIT_PAD, HIT_MIN);
      const d = Math.hypot(x - t.x, y - t.y);
      if (d <= reach) {
        const score = d / reach;
        if (score < bestScore) { bestScore = score; best = t; }
      }
    }
    return best;
  }

  function swipeDir(dx, dy) {
    if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
    return dy < 0 ? 'up' : 'down';
  }

  function createInput(opts) {
    const surface = opts.surface;
    let g = null; // active gesture
    const stats = { taps: 0, swipes: 0, misses: 0, ignored: 0 };

    function enabled() { return !opts.enabled || opts.enabled(); }

    function local(e) {
      const rect = surface.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function down(e) {
      if (g) { stats.ignored++; return; }               // second finger: ignored
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = local(e);
      g = { id: e.pointerId, x0: p.x, y0: p.y, t0: performance.now(), max: 0, spent: false, last: p };
      try { surface.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
      if (e.cancelable) e.preventDefault();
    }

    function move(e) {
      if (!g || e.pointerId !== g.id) return;
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      const evs = list && list.length ? list : [e];
      for (let i = 0; i < evs.length && !g.spent; i++) track(local(evs[i]));
    }

    function track(p) {
      g.last = p;
      const dx = p.x - g.x0, dy = p.y - g.y0;
      g.max = Math.max(g.max, Math.hypot(dx, dy));
      if (g.spent) return;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE_PX) {
        g.spent = true;
        fireSwipe(swipeDir(dx, dy));
      }
    }

    function up(e) {
      if (!g || e.pointerId !== g.id) return;
      track(local(e));
      const gesture = g;
      g = null;
      try { surface.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (gesture.spent) return;
      const dt = performance.now() - gesture.t0;
      if (gesture.max < TAP_PX && dt < TAP_MS) fireTap(gesture.x0, gesture.y0);
    }

    function cancel(e) {
      if (g && (!e || e.pointerId === g.id)) g = null;
    }

    function fireSwipe(dir) {
      if (!enabled()) { stats.ignored++; return; }
      stats.swipes++;
      opts.onSwipe && opts.onSwipe(dir);
    }

    function fireTap(x, y) {
      if (!enabled()) { stats.ignored++; return; }
      const targets = opts.getTargets ? opts.getTargets() : [];
      const hit = hitTest(targets, x, y);
      if (!hit) { stats.misses++; opts.onMiss && opts.onMiss({ x: x, y: y }); return; }
      stats.taps++;
      opts.onTap && opts.onTap(hit.id, { x: x, y: y });
    }

    function key(e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === 'p' || k === 'P' || k === 'Escape') {
        e.preventDefault();
        opts.onPauseKey && opts.onPauseKey(k);
        return;
      }
      if (!enabled()) return;   // overlays keep Space/Enter for their focused buttons
      let dir = null;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') dir = 'left';
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') dir = 'right';
      else if (k === 'ArrowUp' || k === 'w' || k === 'W') dir = 'up';
      else if (k === 'ArrowDown' || k === 's' || k === 'S') dir = 'down';
      if (dir) {
        e.preventDefault();
        if (!e.repeat) fireSwipe(dir);
        return;
      }
      if (k === ' ' || k === 'Enter' || k === 'Spacebar') {
        const a = document.activeElement;
        if (a && a.tagName === 'BUTTON' && !a.hidden && a.offsetParent) return;
        e.preventDefault();
        if (e.repeat) return;
        opts.onKeyTap && opts.onKeyTap();
      }
    }

    surface.addEventListener('pointerdown', down, { passive: false });
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', cancel);
    surface.addEventListener('lostpointercapture', function (e) {
      // Capture lost without an up (e.g. the browser took over): drop the gesture without firing.
      if (g && e.pointerId === g.id) setTimeout(function () { if (g && g.id === e.pointerId) g = null; }, 0);
    });
    surface.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', key);

    return {
      hitTest: hitTest, stats: stats, reset: function () { g = null; },
      thresholds: { TAP_PX: TAP_PX, TAP_MS: TAP_MS, SWIPE_PX: SWIPE_PX, HIT_SCALE: HIT_SCALE, HIT_PAD: HIT_PAD, HIT_MIN: HIT_MIN }
    };
  }

  ui.createInput = createInput;
  ui.hitTest = hitTest;
})(globalThis.WW = globalThis.WW || {});
