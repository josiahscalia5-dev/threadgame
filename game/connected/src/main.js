/* Wishweave Wonders — boot, game loop, lifecycle and public API (docs/ARCHITECTURE.md §9, §12.5, §12.7).

   Boot: layout → load + decode the art (progress, retry) → WW.render.createRenderer({canvas, images, assets, level,
   debug}) (3D course, three.js) → WW.sim.createRace({seed, level, tuning}) in 'intro' → start overlay.
   Loop: requestAnimationFrame; fixed 1/60 s race.step() with an accumulator (max 5 steps per frame, backlog dropped);
   every events array from step()/input() goes to the HUD and to renderer.handleEvents when it exists; render every
   frame. While paused nothing is stepped and the renderer gets dtReal = 0.
   Lifecycle: visibilitychange(hidden) / pagehide / blur pause an active race; it stays paused on return.

   window.WishweaveGame = { version, start(), pause(reason), resume(), restart(seed?), getState(), onBack() }
   ?test=1  adds .debug = { race, renderer, advance(s), setClock('manual'|'real'), tap(id), swipe(dir),
            screenshotReady(), newRace(seed), ... }        ?seed=N fixes the seed      ?debug=1 renderer debug drawing */
(function (WW) {
  'use strict';

  const ui = WW.ui;
  const dom = ui.dom;
  const STEP = 1 / 60;
  const MAX_STEPS = 5;
  const ACTIVE = { countdown: 1, running: 1, finished: 1 };

  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';
  const DEBUG = params.get('debug') === '1';
  const SEED = params.has('seed') && params.get('seed') !== '' && isFinite(+params.get('seed'))
    ? (Math.floor(+params.get('seed')) >>> 0) : null;

  const els = dom.collect();
  let L = dom.layout(els);

  let images = null;
  let renderer = null;
  let race = null;
  let seed = null;
  let clock = 'real';
  let acc = 0;
  let lastT = null;
  let finishedFor = 0;
  let framesDrawn = 0;
  let dirty = true;
  let pendingStart = false;
  let booted = false;
  let failedFrames = 0;
  let frameError = null;
  let readyWaiters = [];
  const eventLog = [];

  /* ---------- modules ---------- */

  const hud = ui.createHud(els, { level: WW.LEVEL });

  const overlays = ui.createOverlays(els, {
    onStart: function () { api.start(); },
    onPause: function () { doPause('user'); },
    onResume: function () { doResume(); },
    onRestart: function () { restart(); },
    onRetry: function () { restart(); },
    onPlayAgain: function () { restart(); },
    onLoadRetry: function () { load(); }
  });

  const input = ui.createInput({
    surface: els.canvas,
    getTargets: function () { return targets(); },
    enabled: function () { return canPlay(); },
    onTap: function (id) { sendTap(id); },
    onSwipe: function (dir) { sendSwipe(dir); },
    onDoubleTap: function () { if (race) dispatch(race.input({ type: 'toggle-player-brake' })); },
    onPullStart: function (id) { sendPull(id, 'start', 0); },
    onPullMove: function (id, amount) { sendPull(id, 'move', amount); },
    onPullEnd: function (id, amount, cancelled) { sendPull(id, cancelled ? 'cancel' : 'end', amount); },
    onPauseKey: function () {
      if (!race) return;
      if (race.state.paused) {
        if (overlays.helpOpen()) overlays.closeHelp(); else doResume();
      } else doPause('user');
    },
    onKeyTap: function () {
      const t = targets();
      if (t.length && t[0].kind === 'pull') {     // desktop testing: Space/Enter performs the whole pull
        sendPull(t[0].id, 'start', 0); sendPull(t[0].id, 'move', 1); sendPull(t[0].id, 'end', 1);
        return;
      }
      if (t.length) { sendTap(t[0].id); return; }
      const st = race && race.state && race.state.stitches;
      if (st) {
        for (const id in st) if (st[id] && st[id].state === 'ready') { sendTap(id); return; }
      }
    }
  });

  /* ---------- helpers ---------- */

  function state() { return race ? race.state : null; }

  function canPlay() {
    const s = state();
    return !!(s && renderer && !s.paused && s.mode === 'running' && !overlays.modalOpen());
  }

  function canPause(s) {
    if (!s || s.paused) return false;
    if (s.mode === 'countdown' || s.mode === 'running') return true;
    // After Purl finishes the sim keeps racing Loop: backgrounding must not leave him running alone.
    return s.mode === 'finished' && !!(s.result ? s.result.loopStillRacing : s.loop && s.loop.finishTime == null);
  }

  function targets() {
    if (!renderer || !renderer.getTapTargets) return [];
    try { return renderer.getTapTargets() || []; } catch (e) { report(e); return []; }
  }

  function randomSeed() { return (Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0; }

  function report(err) {
    if (!frameError) {
      frameError = err;
      console.error('[wishweave]', err);
    }
  }

  function dispatch(events) {
    if (!events || !events.length) return events;
    if (TEST) {
      for (let i = 0; i < events.length; i++) eventLog.push(Object.assign({ t: state() ? state().time : 0 }, events[i]));
      if (eventLog.length > 2000) eventLog.splice(0, eventLog.length - 2000);
    }
    hud.handleEvents(events);
    if (renderer && renderer.handleEvents) {
      try { renderer.handleEvents(events); } catch (e) { report(e); }
    }
    dirty = true;
    return events;
  }

  function stepOnce() {
    const s = race.state;
    if (s.paused) return;
    dispatch(race.step(STEP));
    if (race.state.mode === 'finished') finishedFor += STEP;
  }

  function draw(dtReal) {
    if (!renderer || !race) return;
    renderer.render(race.state, dtReal);
    framesDrawn++;
    dirty = false;
  }

  function syncUI() {
    const s = state();
    if (!s) return;
    hud.update(s);
    overlays.update(s, { finishedFor: finishedFor });
  }

  function flushReady() {
    if (!readyWaiters.length || !booted || framesDrawn < 1) return;
    const list = readyWaiters;
    readyWaiters = [];
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fonts.then(function () {
      requestAnimationFrame(function () { requestAnimationFrame(function () { list.forEach(function (r) { r(true); }); }); });
    });
  }

  /* In manual-clock mode CSS animations follow the game clock: gameplay HUD animations are paused and advanced by
     advance(); purely presentational ones (overlay fades, PLAY AGAIN rise) jump to their end so captures never catch a
     half-faded overlay. */
  const CLOCKED_ANIMS = { pop: 1, shake: 1, msgIn: 1, count: 1, blink: 1, hitflash: 1, noteIn: 1 };
  function cssAnimations(advanceMs) {
    if (!els.game.getAnimations) return;
    const list = els.game.getAnimations({ subtree: true });
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      try {
        if (clock === 'real') { if (a.playState === 'paused') a.play(); continue; }
        if (!CLOCKED_ANIMS[a.animationName]) { a.finish(); continue; }
        if (a.playState !== 'paused') a.pause();
        if (advanceMs) a.currentTime = (a.currentTime || 0) + advanceMs;
      } catch (e) { try { a.pause(); } catch (e2) { /* ignore */ } }
    }
  }

  /* ---------- race control ---------- */

  function newRace(s, autostart) {
    if (!WW.sim || !WW.sim.createRace) throw new Error('The race simulation (WW.sim) is missing.');
    seed = s != null && isFinite(+s) ? (Math.floor(+s) >>> 0) : (SEED != null ? SEED : randomSeed());
    race = WW.sim.createRace({ seed: seed, level: WW.LEVEL, tuning: WW.TUNING });
    hud.reset();
    input.reset();
    finishedFor = 0;
    acc = 0;
    lastT = null;
    eventLog.length = 0;
    if (renderer && renderer.reset) { try { renderer.reset(race.state); } catch (e) { report(e); } }
    if (autostart) dispatch(race.start());
    dirty = true;
    if (renderer) draw(0);
    syncUI();
    return race;
  }

  function restart(s) {
    if (!booted) return false;
    newRace(s, true);
    return true;
  }

  function doPause(reason) {
    const s = state();
    if (!booted || !canPause(s)) return false;
    input.cancelPull();
    dispatch(race.pause(reason || 'user'));
    acc = 0;
    dirty = true;
    syncUI();
    return true;
  }

  function doResume() {
    const s = state();
    if (!s || !s.paused) return false;
    dispatch(race.resume());
    acc = 0;
    lastT = null;
    dirty = true;
    syncUI();
    return true;
  }

  function sendTap(id) {
    if (!race || id == null) return [];
    return dispatch(race.input({ type: 'tap', target: id })) || [];
  }

  function sendPull(id, phase, amount) {
    if (!race || id == null) return [];
    return dispatch(race.input({ type: 'pull', target: id, phase: phase, amount: amount })) || [];
  }

  function sendSwipe(dir) {
    if (!race || !dir) return [];
    return dispatch(race.input({ type: 'swipe', dir: dir })) || [];
  }

  /* ---------- loop ---------- */

  function frame(now) {
    requestAnimationFrame(frame);
    const dtReal = lastT == null ? 0 : Math.min(0.25, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    if (!booted || !race || !renderer) return;
    try {
      const s = race.state;
      if (clock === 'real') {
        if (!s.paused && s.mode !== 'intro') {
          acc += dtReal;
          let n = 0;
          while (acc >= STEP && n < MAX_STEPS) { stepOnce(); acc -= STEP; n++; }
          if (acc >= STEP) acc = 0;   // drop the backlog after a long frame instead of fast-forwarding
        } else {
          acc = 0;
        }
        draw(race.state.paused ? 0 : dtReal);
      } else {
        if (dirty) draw(0);
        cssAnimations(0);
      }
      syncUI();
      failedFrames = 0;
    } catch (e) {
      report(e);
      if (++failedFrames === 10) overlays.showError('Something snagged while drawing the race: ' + (e && e.message ? e.message : e));
    }
    flushReady();
  }

  /* ---------- layout ---------- */

  /* The canvas covers the whole screen (style.css #view), so the renderer gets the canvas's own size. */
  function viewSize() {
    const c = els.canvas;
    return { w: Math.max(1, c.clientWidth || L.w), h: Math.max(1, c.clientHeight || L.h) };
  }

  function relayout() {
    L = dom.layout(els);
    if (renderer && renderer.resize) {
      try { const v = viewSize(); renderer.resize(v.w, v.h, window.devicePixelRatio || 1); } catch (e) { report(e); }
    }
    dirty = true;
    if (renderer && race) { try { draw(0); } catch (e) { report(e); } }
  }

  let resizeQueued = false;
  function queueLayout() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(function () { resizeQueued = false; relayout(); });
  }
  window.addEventListener('resize', queueLayout);
  window.addEventListener('orientationchange', queueLayout);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', queueLayout);

  /* ---------- lifecycle ---------- */

  function autoPause(reason) {
    if (doPause(reason)) return;
    // Even when nothing is running, restart the frame clock so the next visible frame does not see a huge dt.
    lastT = null;
    acc = 0;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') autoPause('background');
    else { lastT = null; acc = 0; }
  });
  window.addEventListener('pagehide', function () { autoPause('background'); });
  window.addEventListener('blur', function () { autoPause('blur'); });

  /* ---------- boot ---------- */

  /* What the 3D course draws, all from the approved art: Purl's and Loop's rear sprite frames (purl/loop atlases),
     the props (spools, tassels, posts, flower gate), the menu portraits and UI, plus the course textures cut from the
     approved paintings (WW.WORLD_ART, tools/build-world-art.py). The plate paintings themselves are not loaded. */
  const USED_IMAGES = /^(purl|loop|props|purlFront|loopFront|ui\..*)$/;
  const loadList = {};
  Object.keys((WW.ASSETS && WW.ASSETS.images) || {}).forEach(function (k) {
    if (USED_IMAGES.test(k)) loadList[k] = WW.ASSETS.images[k];
  });
  Object.keys((WW.WORLD_ART && WW.WORLD_ART.images) || {}).forEach(function (k) { loadList[k] = WW.WORLD_ART.images[k]; });
  const loader = ui.createLoader({ images: loadList });

  function load() {
    overlays.loading(loader.progress().fraction);
    return loader.run(function (f) { overlays.loading(f); }).then(function (imgs) {
      images = imgs;
      boot();
    }, function (err) {
      console.error('[wishweave] loading failed', err);
      const n = err && err.failed ? err.failed.length : 0;
      overlays.loadFailed((n ? n + ' picture' + (n === 1 ? '' : 's') : 'Some pictures') + ' did not load. Check storage and try again.');
    });
  }

  function boot() {
    try {
      if (!WW.render || !WW.render.createRenderer) throw new Error('The renderer (WW.render) is missing.');
      renderer = WW.render.createRenderer({
        canvas: els.canvas, images: images, assets: WW.ASSETS, level: WW.LEVEL, debug: DEBUG
      });
      if (renderer.resize) { const v = viewSize(); renderer.resize(v.w, v.h, window.devicePixelRatio || 1); }
      overlays.drawPortraits(images, WW.ASSETS);
      booted = true;
      newRace(SEED, false);
      overlays.loaded();
      syncUI();
      if (pendingStart) { pendingStart = false; api.start(); }
    } catch (e) {
      console.error('[wishweave] boot failed', e);
      overlays.loaded();
      overlays.showError(e && e.message ? e.message : String(e));
    }
  }

  /* ---------- public API ---------- */

  const api = {
    version: WW.VERSION || '1.0.0',
    start: function () {
      if (!booted) { pendingStart = true; return false; }
      const s = state();
      if (!s || s.mode !== 'intro') return false;
      dispatch(race.start());
      lastT = null;
      acc = 0;
      syncUI();
      return true;
    },
    pause: function (reason) { return doPause(reason || 'api'); },
    resume: function () { return doResume(); },
    restart: function (s) { return restart(s); },
    getState: function () {
      const s = state();
      return s ? JSON.parse(JSON.stringify(s)) : null;
    },
    /* Android Back: pause a running race ('paused'), close the help panel ('paused'), otherwise 'exit'. */
    onBack: function () {
      if (overlays.helpOpen()) { overlays.closeHelp(); return 'paused'; }
      const s = state();
      if (canPause(s)) { doPause('back'); return 'paused'; }
      return 'exit';
    }
  };

  if (TEST) {
    api.debug = {
      get race() { return race; },
      get renderer() { return renderer; },
      get images() { return images; },
      get seed() { return seed; },
      get clock() { return clock; },
      get layout() { return L; },
      get finishedFor() { return finishedFor; },
      events: eventLog,
      input: input,
      hud: hud,
      overlays: overlays,
      /* Steps the simulation at 1/60 s for `seconds` (skipped while paused), then renders once with dtReal = seconds
         and refreshes the HUD; in manual mode HUD CSS animations advance by the same time. */
      advance: function (seconds) {
        if (!race || !renderer) return null;
        const n = Math.max(0, Math.round((+seconds || 0) / STEP));
        const all = [];
        for (let i = 0; i < n; i++) {
          if (race.state.paused) break;
          const ev = race.step(STEP);
          dispatch(ev);
          if (ev && ev.length) for (let j = 0; j < ev.length; j++) all.push(ev[j]);
          if (race.state.mode === 'finished') finishedFor += STEP;
        }
        draw(race.state.paused ? 0 : n * STEP);
        syncUI();
        if (clock === 'manual') cssAnimations(n * STEP * 1000);
        return all;
      },
      setClock: function (mode) {
        clock = mode === 'manual' ? 'manual' : 'real';
        acc = 0;
        lastT = null;
        cssAnimations(0);
        return clock;
      },
      tap: function (id) { const ev = sendTap(id); syncUI(); return ev; },
      swipe: function (dir) { const ev = sendSwipe(dir); syncUI(); return ev; },
      targets: function () { return targets(); },
      screenshotReady: function () {
        return new Promise(function (resolve) { readyWaiters.push(resolve); flushReady(); });
      },
      newRace: function (s) { if (!booted) return null; return newRace(s, false); },
      relayout: relayout,
      error: function () { return frameError; }
    };
  }

  window.WishweaveGame = api;

  requestAnimationFrame(frame);
  load();
})(globalThis.WW = globalThis.WW || {});
