/* Wishweave Wonders — touch, mouse and keyboard input (WW.ui.attachInput).

   Swipes are recognised while the finger is still moving (≥ 30 px along the dominant axis), so a lane change or
   jump responds immediately, like other runner games. A short touch (< 14 px, < 300 ms) is a tap, which jumps.
   One gesture produces at most one swipe; lift the finger to swipe again. Keyboard for desktop: ← → / A D change
   lane, ↑ / W / Space jump, ↓ / S drop, P / Esc pause. */
(function (WW) {
  'use strict';
  const SWIPE = 30, TAP_MOVE = 14, TAP_TIME = 300;

  function attachInput(surface, send, onPauseKey) {
    const touches = new Map();

    function down(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), fired: false });
      try { surface.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: fine */ }
      e.preventDefault();
    }
    function move(e) {
      const g = touches.get(e.pointerId);
      if (!g || g.fired) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (Math.max(ax, ay) < SWIPE) return;
      g.fired = true;
      if (ax > ay) send({ type: 'swipe', dir: dx < 0 ? 'left' : 'right' });
      else send({ type: 'swipe', dir: dy < 0 ? 'up' : 'down' });
    }
    function up(e) {
      const g = touches.get(e.pointerId);
      touches.delete(e.pointerId);
      if (!g || g.fired) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.hypot(dx, dy) < TAP_MOVE && performance.now() - g.t < TAP_TIME) send({ type: 'tap' });
    }
    function cancel(e) { touches.delete(e.pointerId); }

    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up);
    surface.addEventListener('pointercancel', cancel);
    surface.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('keydown', function (e) {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      let cmd = null;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') cmd = { type: 'swipe', dir: 'left' };
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') cmd = { type: 'swipe', dir: 'right' };
      else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') cmd = { type: 'swipe', dir: 'up' };
      else if (k === 'ArrowDown' || k === 's' || k === 'S') cmd = { type: 'swipe', dir: 'down' };
      else if (k === 'p' || k === 'P' || k === 'Escape') { onPauseKey(); e.preventDefault(); return; }
      if (cmd) {
        // Space/Enter on a focused button keeps its normal meaning.
        if (k === ' ' && document.activeElement && document.activeElement.tagName === 'BUTTON') return;
        send(cmd);
        e.preventDefault();
      }
    });
  }

  WW.ui = WW.ui || {};
  WW.ui.attachInput = attachInput;
})(globalThis.WW = globalThis.WW || {});
