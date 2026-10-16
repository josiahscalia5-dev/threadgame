/* Wishweave Wonders — touch gestures for the connected race.

   Syntax-only port of the Connected World kit's code/touch-input.mjs (same thresholds, states and results; its 26
   tests run against this file in tests/unit/gesture.test.cjs). Coordinates and thresholds are CSS pixels; time is
   milliseconds from one monotonic clock.

     WW.gesture.DEFAULTS, WW.gesture.INTENTS
     WW.gesture.swipeThreshold(viewportWidth, options)
     WW.gesture.classify({dx, dy, duration, maxDistance, viewportWidth}, options) → tap|left|right|jump|reserved|none
     WW.gesture.createMachine(options)  DOM-free; down/move/up/cancel/reset return arrays of frozen intents
     WW.gesture.attach(surface, onIntent, options)  binds one surface; returns {reset, dispose}

   Intents: steer {direction: -1|1}, jump, toggle-player-brake (double tap; NOT pause), toggle-global-pause (buttons
   only). One completed gesture gives at most one intent; swipes resolve on release. UI elements, a second finger,
   pointer cancellation and capture loss never produce gameplay intents. */
(function (WW) {
  'use strict';

  const DEFAULTS = Object.freeze({
    swipeWidthRatio: 0.08, swipeMin: 24, swipeMax: 72,
    axisDominance: 1.2, tapSlop: 10, tapDuration: 200,
    doubleTapInterval: 320, doubleTapDistance: 24
  });

  const INTENTS = Object.freeze({
    left: Object.freeze({ type: 'steer', direction: -1 }),
    right: Object.freeze({ type: 'steer', direction: 1 }),
    jump: Object.freeze({ type: 'jump' }),
    togglePlayerBrake: Object.freeze({ type: 'toggle-player-brake' }),
    toggleGlobalPause: Object.freeze({ type: 'toggle-global-pause' })
  });

  function opts(options) { return Object.assign({}, DEFAULTS, options || {}); }

  function swipeThreshold(viewportWidth, options) {
    const c = opts(options);
    const width = isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 320;
    return Math.min(c.swipeMax, Math.max(c.swipeMin, width * c.swipeWidthRatio));
  }

  function classify(g, options) {
    const c = opts(options);
    const travel = Math.max(g.maxDistance, Math.hypot(g.dx, g.dy));
    if (g.duration >= 0 && g.duration <= c.tapDuration && travel <= c.tapSlop) return 'tap';
    const threshold = swipeThreshold(g.viewportWidth, c);
    const x = Math.abs(g.dx), y = Math.abs(g.dy);
    if (x >= threshold && x >= y * c.axisDominance) return g.dx < 0 ? 'left' : 'right';
    if (y >= threshold && y >= x * c.axisDominance) return g.dy < 0 ? 'jump' : 'reserved';
    return 'none';
  }

  function createMachine(options) {
    const c = opts(options);
    const pointers = new Set();
    let stroke = null, firstTap = null, blocked = false, lastTime = -Infinity;
    function clock(value) {
      if (typeof value !== 'number' || !isFinite(value)) throw new TypeError('A finite monotonic time is required');
      lastTime = Math.max(lastTime, value);
      return lastTime;
    }
    function update(event) {
      if (!stroke || stroke.id !== event.pointerId) return;
      stroke.x = event.x; stroke.y = event.y;
      stroke.maxDistance = Math.max(stroke.maxDistance, Math.hypot(event.x - stroke.startX, event.y - stroke.startY));
    }
    return {
      down: function (event) {
        const time = clock(event.time);
        if (pointers.has(event.pointerId)) return [];
        pointers.add(event.pointerId);
        if (event.ignored || pointers.size > 1) {
          stroke = firstTap = null; blocked = true;
          return [];
        }
        if (blocked) return [];
        stroke = { id: event.pointerId, startX: event.x, startY: event.y, x: event.x, y: event.y,
                   startTime: time, maxDistance: 0, viewportWidth: event.viewportWidth };
        return [];
      },
      move: function (event) { clock(event.time); update(event); return []; },
      up: function (event) {
        const time = clock(event.time);
        if (!pointers.has(event.pointerId)) return [];
        update(event);
        const completed = stroke && stroke.id === event.pointerId ? stroke : null;
        pointers.delete(event.pointerId);
        if (completed) stroke = null;
        if (pointers.size === 0) blocked = false;
        if (!completed) return [];
        const kind = classify({ dx: completed.x - completed.startX, dy: completed.y - completed.startY,
                                duration: time - completed.startTime, maxDistance: completed.maxDistance,
                                viewportWidth: completed.viewportWidth }, c);
        if (kind === 'tap') {
          if (firstTap && time - firstTap.time <= c.doubleTapInterval &&
              Math.hypot(completed.startX - firstTap.x, completed.startY - firstTap.y) <= c.doubleTapDistance) {
            firstTap = null;
            return [INTENTS.togglePlayerBrake];
          }
          firstTap = { time: time, x: completed.startX, y: completed.startY };
          return [];
        }
        firstTap = null;
        return INTENTS[kind] ? [INTENTS[kind]] : [];
      },
      cancel: function (pointerId, o) {
        const retainPointer = !!(o && o.retainPointer);
        if (!pointers.has(pointerId)) return [];
        if (!retainPointer) pointers.delete(pointerId);
        stroke = firstTap = null;
        blocked = pointers.size > 0;
        return [];
      },
      reset: function () {
        pointers.clear(); stroke = firstTap = null; blocked = false;
        return [];
      }
    };
  }

  /* Bind one surface (kit attachTouchInput). UI/outside presses invalidate pending taps; multi-touch cancels the
     gesture until every tracked contact lifts. */
  function attach(surface, onIntent, options) {
    options = options || {};
    const doc = surface.ownerDocument, win = doc.defaultView;
    const machine = createMachine(options);
    const now = options.now || function () { return win.performance.now(); };
    const uiSelector = options.uiSelector ||
      '[data-ui],button,a,input,select,textarea,[contenteditable="true"],[role="button"]';
    const listeners = [];
    function listen(target, name, fn) {
      target.addEventListener(name, fn, { capture: true, passive: false });
      listeners.push(function () { target.removeEventListener(name, fn, true); });
    }
    function sample(e) {
      return { pointerId: e.pointerId, x: e.clientX, y: e.clientY, time: now(),
               viewportWidth: (doc.documentElement && doc.documentElement.clientWidth) || win.innerWidth };
    }
    function emit(list) { for (let i = 0; i < list.length; i++) onIntent(list[i]); }
    listen(doc, 'pointerdown', function (e) {
      const path = e.composedPath ? e.composedPath() : [e.target];
      const inside = path.indexOf(surface) >= 0 || surface.contains(e.target);
      const isUI = path.some(function (node) { return !!(node && node.matches && node.matches(uiSelector)); }) ||
        !!(e.target && e.target.closest && e.target.closest(uiSelector));
      // After a mode reset a second finger may arrive while the first is still down; isPrimary protects that case.
      const ignored = !inside || isUI || e.button !== 0 || (e.pointerType === 'touch' && e.isPrimary === false);
      machine.down(Object.assign(sample(e), { ignored: ignored }));
      if (!ignored) {
        if (e.cancelable) e.preventDefault();
        try { surface.setPointerCapture(e.pointerId); } catch (err) { /* contact already ended */ }
      }
    });
    listen(doc, 'pointermove', function (e) {
      // Short excursions from coalesced samples keep a drag-return from counting as a tap.
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (let i = 0; i < events.length; i++) machine.move(sample(events[i]));
      machine.move(sample(e));
    });
    listen(doc, 'pointerup', function (e) { emit(machine.up(sample(e))); });
    listen(doc, 'pointercancel', function (e) { machine.cancel(e.pointerId); });
    // Capture loss can happen while a contact is still down: keep it tracked until it really lifts.
    listen(doc, 'lostpointercapture', function (e) { machine.cancel(e.pointerId, { retainPointer: true }); });
    listen(win, 'blur', function () { machine.reset(); });
    listen(doc, 'visibilitychange', function () { if (doc.hidden) machine.reset(); });
    return {
      reset: function () { machine.reset(); },
      dispose: function () { listeners.forEach(function (remove) { remove(); }); machine.reset(); }
    };
  }

  WW.gesture = { DEFAULTS: DEFAULTS, INTENTS: INTENTS, swipeThreshold: swipeThreshold, classify: classify,
                 createMachine: createMachine, attach: attach };
})(globalThis.WW = globalThis.WW || {});
