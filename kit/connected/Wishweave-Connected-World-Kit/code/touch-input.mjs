/** Engine-independent Pointer Events input. Coordinates and thresholds use CSS pixels. */
export const DEFAULTS = Object.freeze({
  swipeWidthRatio: 0.08, swipeMin: 24, swipeMax: 72,
  axisDominance: 1.2, tapSlop: 10, tapDuration: 200,
  doubleTapInterval: 320, doubleTapDistance: 24,
});

export const INTENTS = Object.freeze({
  left: Object.freeze({ type: 'steer', direction: -1 }),
  right: Object.freeze({ type: 'steer', direction: 1 }),
  jump: Object.freeze({ type: 'jump' }),
  togglePlayerBrake: Object.freeze({ type: 'toggle-player-brake' }),
  toggleGlobalPause: Object.freeze({ type: 'toggle-global-pause' }),
});

export function swipeThreshold(viewportWidth, options = {}) {
  const c = { ...DEFAULTS, ...options };
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 320;
  return Math.min(c.swipeMax, Math.max(c.swipeMin, width * c.swipeWidthRatio));
}

/** Pure classification: returns tap/left/right/jump/reserved/none. */
export function classifyGesture({ dx, dy, duration, maxDistance, viewportWidth }, options = {}) {
  const c = { ...DEFAULTS, ...options };
  const travel = Math.max(maxDistance, Math.hypot(dx, dy));
  if (duration >= 0 && duration <= c.tapDuration && travel <= c.tapSlop) return 'tap';
  const threshold = swipeThreshold(viewportWidth, c);
  const x = Math.abs(dx), y = Math.abs(dy);
  if (x >= threshold && x >= y * c.axisDominance) return dx < 0 ? 'left' : 'right';
  if (y >= threshold && y >= x * c.axisDominance) return dy < 0 ? 'jump' : 'reserved';
  return 'none';
}

/** Stateful but DOM-free. Every event supplies {pointerId,x,y,time,viewportWidth};
 * down additionally accepts ignored. Methods return arrays of immutable intents.
 * time is milliseconds from one monotonic clock. One completed gesture => <=1 intent.
 */
export function createGestureMachine(options = {}) {
  const c = { ...DEFAULTS, ...options };
  const pointers = new Set();
  let stroke = null, firstTap = null, blocked = false, lastTime = -Infinity;
  const clock = value => {
    if (!Number.isFinite(value)) throw new TypeError('A finite monotonic time is required');
    lastTime = Math.max(lastTime, value);
    return lastTime;
  };
  const update = event => {
    if (!stroke || stroke.id !== event.pointerId) return;
    stroke.x = event.x; stroke.y = event.y;
    stroke.maxDistance = Math.max(stroke.maxDistance,
      Math.hypot(event.x - stroke.startX, event.y - stroke.startY));
  };
  return {
    down(event) {
      const time = clock(event.time);
      if (pointers.has(event.pointerId)) return [];
      pointers.add(event.pointerId);
      if (event.ignored || pointers.size > 1) {
        stroke = firstTap = null; blocked = true;
        return [];
      }
      if (blocked) return [];
      stroke = { id: event.pointerId, startX: event.x, startY: event.y,
        x: event.x, y: event.y, startTime: time, maxDistance: 0,
        viewportWidth: event.viewportWidth };
      return [];
    },
    move(event) {
      clock(event.time); update(event); return [];
    },
    up(event) {
      const time = clock(event.time);
      if (!pointers.has(event.pointerId)) return [];
      update(event);
      const completed = stroke?.id === event.pointerId ? stroke : null;
      pointers.delete(event.pointerId);
      if (completed) stroke = null;
      if (pointers.size === 0) blocked = false;
      if (!completed) return [];
      const kind = classifyGesture({ dx: completed.x - completed.startX,
        dy: completed.y - completed.startY, duration: time - completed.startTime,
        maxDistance: completed.maxDistance, viewportWidth: completed.viewportWidth }, c);
      if (kind === 'tap') {
        if (firstTap && time - firstTap.time <= c.doubleTapInterval &&
            Math.hypot(completed.startX - firstTap.x, completed.startY - firstTap.y) <= c.doubleTapDistance) {
          firstTap = null;
          return [INTENTS.togglePlayerBrake];
        }
        firstTap = { time, x: completed.startX, y: completed.startY };
        return [];
      }
      firstTap = null;
      return INTENTS[kind] ? [INTENTS[kind]] : [];
    },
    cancel(pointerId, { retainPointer = false } = {}) {
      if (!pointers.has(pointerId)) return [];
      if (!retainPointer) pointers.delete(pointerId);
      stroke = firstTap = null;
      blocked = pointers.size > 0;
      return [];
    },
    reset() {
      pointers.clear(); stroke = firstTap = null; blocked = false;
      return [];
    },
  };
}

/** Bind one surface. UI/outside interactions invalidate pending taps; multi-touch
 * cancels the gesture until every tracked contact lifts. Returns {reset,dispose}.
 */
export function attachTouchInput(surface, onIntent, options = {}) {
  const doc = surface.ownerDocument, win = doc.defaultView;
  const machine = createGestureMachine(options);
  const now = options.now ?? (() => win.performance.now());
  const uiSelector = options.uiSelector ??
    '[data-ui],button,a,input,select,textarea,[contenteditable="true"],[role="button"]';
  const listeners = [];
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn, { capture: true, passive: false });
    listeners.push(() => target.removeEventListener(name, fn, true));
  };
  const sample = e => ({ pointerId: e.pointerId, x: e.clientX, y: e.clientY,
    time: now(), viewportWidth: doc.documentElement.clientWidth || win.innerWidth });
  listen(doc, 'pointerdown', e => {
    const path = e.composedPath?.() ?? [e.target];
    const inside = path.includes(surface) || surface.contains(e.target);
    const isUI = path.some(node => node.matches?.(uiSelector)) || !!e.target.closest?.(uiSelector);
    // After a mode reset, a second finger may arrive while the first is still down.
    // isPrimary protects that case even though reset discarded old pointer IDs.
    const ignored = !inside || isUI || e.button !== 0 ||
      (e.pointerType === 'touch' && e.isPrimary === false);
    machine.down({ ...sample(e), ignored });
    if (!ignored) {
      if (e.cancelable) e.preventDefault();
      try { surface.setPointerCapture(e.pointerId); } catch { /* Contact already ended. */ }
    }
  });
  listen(doc, 'pointermove', e => {
    // Preserve short excursions from coalesced samples so a drag-return is not a tap.
    const events = e.getCoalescedEvents?.() ?? [];
    for (const event of events) machine.move(sample(event));
    machine.move(sample(e));
  });
  listen(doc, 'pointerup', e => {
    for (const intent of machine.up(sample(e))) onIntent(intent);
  });
  listen(doc, 'pointercancel', e => machine.cancel(e.pointerId));
  // Capture loss can occur while a contact is still down. Keep it tracked until
  // pointerup/pointercancel so a fresh contact cannot re-arm a cancelled gesture.
  listen(doc, 'lostpointercapture', e => machine.cancel(e.pointerId, { retainPointer: true }));
  listen(win, 'blur', () => machine.reset());
  listen(doc, 'visibilitychange', () => { if (doc.hidden) machine.reset(); });
  return {
    reset: () => machine.reset(),
    dispose: () => { for (const remove of listeners) remove(); machine.reset(); },
  };
}
