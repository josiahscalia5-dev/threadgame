/* Wishweave Wonders — touch / mouse / keyboard input (docs/ARCHITECTURE.md §9, §7.2).

   const input = WW.ui.createInput({
     surface,                 // the game canvas: gestures must START here (buttons and overlays never start one)
     getTargets(),            // renderer.getTapTargets(): [{id, x, y, r}] in CSS px relative to the canvas
     enabled(),               // false while an overlay owns the screen or the race is not running
     onTap(id, point), onSwipe(dir), onPauseKey(), onKeyTap(),
     onPullStart(id), onPullMove(id, amount), onPullEnd(id, amount, cancelled)
   });

   One gesture per pointer-down, decided once:
     swipe  dominant-axis movement ≥ SWIPE_PX fires as soon as it is reached (during the move), then the gesture is
            spent — it can never also become a tap;
     tap    released with total movement < TAP_PX within TAP_MS → hit-test the ready stitches with a generous radius;
            a tap never moves Purl and a miss does nothing.
     pull   (the opening TOUCH → PULL lesson) a press that starts ON a target of kind 'pull' (the gold loop, hit
            radius ≥ 48 CSS px) becomes a pull: only downward movement counts, amount = the largest downward drag
            so far / PULL target distance clamp(0.10 × canvas height, 64, 110) CSS px (never decreases within the
            gesture; sideways/upward movement is ignored). Release → onPullEnd; pointercancel, lost capture or
            the game becoming disabled (pause, overlay, background) → onPullEnd(…, cancelled). A pull is never
            also a tap or a swipe, so it cannot jump Purl or change his lane.
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
  const PULL_HIT_MIN = 48;  // a pull starts within max(1.15 × radius, 48) CSS px of the gold loop
  const PULL_MIN = 64, PULL_MAX = 110, PULL_FRAC = 0.10;   // drag target: clamp(0.10 × height, 64, 110) CSS px

  function pullHit(targets, x, y) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < (targets || []).length; i++) {
      const t = targets[i];
      if (!t || t.kind !== 'pull') continue;
      const d = Math.hypot(x - t.x, y - t.y);
      if (d <= Math.max((+t.r || 44) * 1.15, PULL_HIT_MIN) && d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

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
    const stats = { taps: 0, swipes: 0, misses: 0, ignored: 0, pulls: 0 };

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
      if (enabled()) {
        const hit = pullHit(opts.getTargets ? opts.getTargets() : [], p.x, p.y);
        if (hit) {
          const h = surface.getBoundingClientRect().height || surface.clientHeight || 640;
          g.pull = hit.id;
          g.amount = 0;
          g.dist = Math.min(PULL_MAX, Math.max(PULL_MIN, PULL_FRAC * h));
          stats.pulls++;
          opts.onPullStart && opts.onPullStart(hit.id);
        }
      }
    }

    function trackPull(p) {
      g.last = p;
      if (!enabled()) { endPull(true); return; }
      const a = Math.min(1, Math.max(0, (p.y - g.y0) / g.dist));   // downward only
      if (a > g.amount + 1e-4) {
        g.amount = a;
        opts.onPullMove && opts.onPullMove(g.pull, a);
      }
    }

    function endPull(cancelled) {
      if (!g || !g.pull || g.pullDone) return;
      g.pullDone = true;
      opts.onPullEnd && opts.onPullEnd(g.pull, g.amount, !!cancelled);
    }

    function move(e) {
      if (!g || e.pointerId !== g.id) return;
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      const evs = list && list.length ? list : [e];
      if (g.pull) { for (let i = 0; i < evs.length && g && !g.pullDone; i++) trackPull(local(evs[i])); return; }
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
      if (g.pull) {
        if (!g.pullDone) trackPull(local(e));
        endPull(false);
        g = null;
        try { surface.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        return;
      }
      track(local(e));
      const gesture = g;
      g = null;
      try { surface.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (gesture.spent) return;
      const dt = performance.now() - gesture.t0;
      if (gesture.max < TAP_PX && dt < TAP_MS) fireTap(gesture.x0, gesture.y0);
    }

    function cancel(e) {
      if (g && (!e || e.pointerId === g.id)) { endPull(true); g = null; }
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
      if (g && e.pointerId === g.id) setTimeout(function () { if (g && g.id === e.pointerId) { endPull(true); g = null; } }, 0);
    });
    surface.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('keydown', key);

    return {
      hitTest: hitTest, stats: stats, reset: function () { g = null; },
      /* Pause/overlay/background: end an active pull as cancelled (partial progress stays in the sim). */
      cancelPull: function () { if (g && g.pull) { endPull(true); g = null; } },
      active: function () { return g ? { pull: g.pull || null, amount: g.amount || 0, dist: g.dist || 0 } : null; },
      thresholds: { TAP_PX: TAP_PX, TAP_MS: TAP_MS, SWIPE_PX: SWIPE_PX, HIT_SCALE: HIT_SCALE, HIT_PAD: HIT_PAD, HIT_MIN: HIT_MIN,
                    PULL_HIT_MIN: PULL_HIT_MIN, PULL_MIN: PULL_MIN, PULL_MAX: PULL_MAX, PULL_FRAC: PULL_FRAC }
    };
  }

  ui.createInput = createInput;
  ui.hitTest = hitTest;
})(globalThis.WW = globalThis.WW || {});
