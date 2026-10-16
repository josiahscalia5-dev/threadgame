/* Wishweave Wonders — DOM helpers and responsive layout (docs/ARCHITECTURE.md §9).

   WW.ui.dom.collect()      element references used by the other UI modules
   WW.ui.dom.layout(els)    sizes #game inside the safe area (a centred portrait column on wide/landscape screens),
                            sets --k (CSS px per approved design px, from the game width) and the is-short / is-tiny
                            reflow classes; returns {w, h, k, column, short, tiny}
   WW.ui.dom.show/setText/restartClass   tiny cached setters so per-frame HUD updates touch the DOM only on change */
(function (WW) {
  'use strict';

  const ui = WW.ui = WW.ui || {};
  const DESIGN_W = (WW.DESIGN && WW.DESIGN.w) || 841;

  function $(id) { return document.getElementById(id); }

  function collect() {
    const ids = {
      app: 'app', game: 'game', canvas: 'view', hud: 'hud',
      phase: 'hud-phase', purl: 'hud-purl', loop: 'hud-loop', objective: 'hud-objective',
      thread: 'race-thread', results: 'hud-results', ranks: 'result-ranks', times: 'result-times',
      wait: 'result-wait', hint: 'hud-hint', pauseBtn: 'btn-pause', countdown: 'countdown',
      playAgain: 'btn-play-again', rewards: 'rewards', cashout: 'btn-cashout', cashNote: 'cashout-note',
      ovLoading: 'ov-loading', loadFill: 'load-fill', loadText: 'load-text', loadRetry: 'btn-load-retry',
      ovStart: 'ov-start', startBtn: 'btn-start', startPurl: 'start-purl', startLoop: 'start-loop',
      ovPause: 'ov-pause', pauseMenu: 'pause-menu', pauseHelp: 'pause-help', pauseSub: 'pause-sub',
      resumeBtn: 'btn-resume', restartBtn: 'btn-restart', helpBtn: 'btn-help', helpBack: 'btn-help-back',
      ovFail: 'ov-fail', failPurl: 'fail-purl', retryBtn: 'btn-retry',
      ovError: 'ov-error', errorText: 'error-text'
    };
    const els = {};
    Object.keys(ids).forEach(function (k) { els[k] = $(ids[k]); });
    els.objectiveText = els.objective && els.objective.querySelector('.txt');
    els.purlNum = els.purl && els.purl.querySelector('.num b');
    els.loopNum = els.loop && els.loop.querySelector('.num b');
    els.beadPurl = els.thread && els.thread.querySelector('.bead.purl');
    els.beadLoop = els.thread && els.thread.querySelector('.bead.loop');
    els.countdownText = els.countdown && els.countdown.querySelector('span');
    return els;
  }

  function show(el, on) {
    if (!el) return;
    on = !!on;
    if (el.__shown === on) return;
    el.__shown = on;
    el.hidden = !on;
  }

  function setText(el, text) {
    if (!el) return;
    text = text == null ? '' : String(text);
    if (el.__text === text) return;
    el.__text = text;
    el.textContent = text;
  }

  function setHTML(el, html) {
    if (!el || el.__html === html) return;
    el.__html = html;
    el.innerHTML = html;
  }

  function toggleClass(el, cls, on) {
    if (el) el.classList.toggle(cls, !!on);
  }

  /* Re-triggers a CSS animation class (pop/shake/countdown tick). */
  function restartClass(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the animation restarts
    el.classList.add(cls);
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Portrait column rules. Phones (narrower than ~0.62 w/h) use the full safe width. Wider viewports get a centred
     column 9:16 of the height but never narrower than 360 px (so the HUD stays legible in landscape). */
  const COLUMN_ABOVE = 0.62;
  const COLUMN_ASPECT = 0.5625;
  const COLUMN_MIN_W = 360;

  function computeLayout(availW, availH) {
    let w = Math.max(1, Math.floor(availW)), h = Math.max(1, Math.floor(availH));
    let column = false;
    if (w > h * COLUMN_ABOVE) {
      const colW = Math.floor(Math.min(w, Math.max(h * COLUMN_ASPECT, Math.min(w, COLUMN_MIN_W))));
      if (colW < w - 1) { w = colW; column = true; }
    }
    const k = w / DESIGN_W;
    const ratio = h / w;
    const tiny = ratio < 1.45 || h < 480;
    const short = tiny || ratio < 1.95 || h < 700;
    return { w: w, h: h, k: k, column: column, short: short, tiny: tiny };
  }

  function safeRect(app) {
    const cs = getComputedStyle(app);
    const w = app.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const h = app.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    return { w: w, h: h };
  }

  function layout(els) {
    const safe = safeRect(els.app);
    const L = computeLayout(safe.w, safe.h);
    const g = els.game;
    g.style.width = L.w + 'px';
    g.style.height = L.h + 'px';
    g.style.setProperty('--k', L.k.toFixed(4));
    g.classList.toggle('is-column', L.column);
    g.classList.toggle('is-short', L.short);
    g.classList.toggle('is-tiny', L.tiny);
    g.classList.toggle('no-logo', L.short);
    return L;
  }

  ui.dom = {
    $: $, collect: collect, show: show, setText: setText, setHTML: setHTML, toggleClass: toggleClass,
    restartClass: restartClass, escapeHTML: escapeHTML, layout: layout, computeLayout: computeLayout
  };
})(globalThis.WW = globalThis.WW || {});
