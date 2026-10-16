/* Wishweave Wonders — boot, game loop, lifecycle and public API.

   Loads every image in WW.ASSETS, then runs requestAnimationFrame with fixed 1/60 s simulation steps (an
   accumulator, at most 5 steps per frame) and renders every frame. Hiding the page, backgrounding the app or
   losing focus pauses the race; it stays paused until the player taps Resume.

   window.WishweaveGame = { version, start(), pause(reason), resume(), restart(seed?), getState(), onBack(),
                            setInsets(top, right, bottom, left) }
   URL flags: ?seed=N fixes the race seed, ?debug=1 draws route geometry, ?test=1 adds WishweaveGame.debug for
   automated checks (manual clock, advance(seconds), swipe(dir), tap()). */
(function (WW) {
  'use strict';
  const STEP = 1 / 60;
  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';
  const DEBUG = params.get('debug') === '1';
  const fixedSeed = params.has('seed') ? (Number(params.get('seed')) >>> 0) : null;

  const app = document.getElementById('app');
  const canvas = document.getElementById('view');
  const game = document.getElementById('game');

  let images = {}, renderer = null, hud = null, race = null;
  let clock = 'real', acc = 0, lastT = 0, running = false, failed = false;

  function randomSeed() { return ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0 || 1; }

  // ---------------------------------------------------------------- loading
  function loadImages(onProgress) {
    const entries = Object.keys(WW.ASSETS.images).map(function (k) { return [k, WW.ASSETS.images[k].file]; });
    let done = 0;
    return Promise.all(entries.map(function (pair) {
      return new Promise(function (resolve, reject) {
        const img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          const finish = function () { done++; onProgress(done / entries.length); resolve([pair[0], img]); };
          if (img.decode) img.decode().then(finish, finish); else finish();
        };
        img.onerror = function () { reject(new Error('Could not load ' + pair[1])); };
        img.src = pair[1];
      });
    })).then(function (list) {
      const out = {};
      list.forEach(function (pair) { out[pair[0]] = pair[1]; });
      return out;
    });
  }

  // ---------------------------------------------------------------- layout
  function layout() {
    if (!renderer) return;
    const w = app.clientWidth || window.innerWidth, h = app.clientHeight || window.innerHeight;
    renderer.resize(w, h, window.devicePixelRatio || 1);
    const L = renderer.getLayout();
    game.style.left = L.col.x + 'px';
    game.style.width = L.col.w + 'px';
    game.style.setProperty('--k', (L.col.w / WW.DESIGN.w).toFixed(4));
    game.classList.toggle('is-short', h < 680);
    game.classList.toggle('is-tiny', h < 560);
    game.classList.toggle('no-logo', h / L.col.w < 1.75 || h < 600);
  }

  // ---------------------------------------------------------------- race lifecycle
  function newRace(seed) {
    race = WW.sim.createRace({ seed: seed === undefined || seed === null ? (fixedSeed !== null ? fixedSeed : randomSeed()) : seed });
    acc = 0;
    if (hud) hud.reset();
    return race;
  }
  function handle(events) {
    if (!events.length) return;
    renderer.onEvents(events, race.state);
    for (let i = 0; i < events.length; i++) {
      const t = events[i].type;
      if ((t === 'hit' || t === 'drop') && navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
    }
  }
  function stepSim(seconds) {
    acc += Math.min(seconds, 0.25);
    let n = 0;
    while (acc >= STEP && n < 5) { handle(race.step(STEP)); acc -= STEP; n++; }
    if (n === 5) acc = 0;     // a long stall: drop the backlog instead of fast-forwarding
  }
  function send(cmd) {
    if (!race) return;
    const s = race.state;
    if (s.paused || s.mode !== 'running') return;
    handle(race.input(cmd));
  }
  function start() { if (race && race.state.mode === 'intro') { race.start(); acc = 0; } }
  function pause(reason) {
    if (!race) return;
    const m = race.state.mode;
    if ((m === 'countdown' || m === 'running') && !race.state.paused) race.pause(reason || 'user');
  }
  function resume() { if (race && race.state.paused) { race.resume(); acc = 0; lastT = performance.now(); } }
  function restart(seed) { newRace(seed); race.start(); }

  // ---------------------------------------------------------------- frame loop
  function frame(t) {
    if (!running) return;
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : STEP;
    lastT = t;
    try {
      if (clock === 'real') stepSim(dt);
      renderer.render(race.state, dt);
      hud.update(race.state, app);
    } catch (err) {
      running = false;
      if (!failed) { failed = true; hud.error('The game hit a snag: ' + (err && err.message ? err.message : err)); }
      throw err;
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    hud = WW.ui.createHud({
      callbacks: {
        start: start, pause: pause, resume: resume,
        restart: function () { restart(); },
        retryLoad: function () { location.reload(); }
      },
      renderer: { setHudAnchors: function (a) { if (renderer) renderer.setHudAnchors(a); } }
    });
    hud.loading(0);
    loadImages(function (f) { hud.loading(f); }).then(function (imgs) {
      images = imgs;
      renderer = WW.render.createRenderer({ canvas: canvas, images: images, assets: WW.ASSETS, plates: WW.PLATES, level: WW.LEVEL, debug: DEBUG });
      layout();
      hud.drawPortraits(renderer.drawFrame);
      newRace();
      WW.ui.attachInput(app, send, function () {
        if (!race) return;
        if (race.state.paused) resume(); else pause('user');
      });
      running = true;
      lastT = 0;
      requestAnimationFrame(frame);
    }).catch(function (err) {
      hud.loadFailed('Some pictures did not load. Check your connection and try again. (' + err.message + ')');
    });

    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', function () { setTimeout(layout, 120); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
    document.addEventListener('visibilitychange', function () { if (document.hidden) pause('background'); });
    window.addEventListener('pagehide', function () { pause('background'); });
    window.addEventListener('blur', function () { if (!TEST) pause('background'); });
    // iOS pinch/double-tap zoom must never move the game.
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  }

  const api = {
    version: WW.VERSION,
    start: start,
    pause: pause,
    resume: resume,
    restart: restart,
    getState: function () { return race ? race.state : null; },
    onBack: function () {
      if (race && (race.state.mode === 'running' || race.state.mode === 'countdown') && !race.state.paused) { pause('user'); return 'paused'; }
      return 'exit';
    },
    /* The Android host draws edge to edge and reports the system-bar/cutout insets in CSS px. */
    setInsets: function (top, right, bottom, left) {
      const r = document.documentElement.style;
      r.setProperty('--host-inset-top', (top || 0) + 'px');
      r.setProperty('--host-inset-right', (right || 0) + 'px');
      r.setProperty('--host-inset-bottom', (bottom || 0) + 'px');
      r.setProperty('--host-inset-left', (left || 0) + 'px');
    }
  };
  if (TEST) {
    api.debug = {
      race: function () { return race; },
      renderer: function () { return renderer; },
      setClock: function (mode) { clock = mode === 'manual' ? 'manual' : 'real'; acc = 0; },
      /* Advances the race by `seconds` of game time in fixed steps, rendering every `renderEvery` steps. */
      advance: function (seconds, renderEvery) {
        const n = Math.round(seconds / STEP);
        for (let i = 0; i < n; i++) {
          handle(race.step(STEP));
          if (renderEvery && i % renderEvery === 0) renderer.render(race.state, STEP * renderEvery);
        }
        renderer.render(race.state, STEP);
        hud.update(race.state, app);
        return race.state;
      },
      render: function (dt) { renderer.render(race.state, dt || STEP); hud.update(race.state, app); },
      swipe: function (dir) { send({ type: 'swipe', dir: dir }); },
      tap: function () { send({ type: 'tap' }); },
      screenshotReady: function () { return !!renderer && !!race; }
    };
  }
  window.WishweaveGame = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(globalThis.WW = globalThis.WW || {});
