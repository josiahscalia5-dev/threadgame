/* Renderer harness: loads the runtime art, drives WW.render with the scripted stand-in sim (render-sim.js) and
   exposes window.H for Playwright captures.
   URL params:
     moment=<name>   jump to a named beat (see H.moments after load), or T=<seconds of wall clock incl. countdown>
     play=1          run in real time from the chosen moment (speed=<x> time scale)
     debug=1         renderer debug drawing;  info=1 shows the clock
     react, snag=hit|dodge, lanes=t:lane,t:lane, jumps=t,t   scripted inputs (times are race seconds)            */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const canvas = document.getElementById('view');
  const info = document.getElementById('info');
  const images = {};
  const COUNT = 3;

  function simOpts() {
    const o = {};
    if (q.has('react')) o.react = +q.get('react');
    if (q.has('snag')) o.snag = q.get('snag');
    if (q.has('lanes')) o.lanes = q.get('lanes').split(',').map(function (s) { const a = s.split(':'); return [+a[0], +a[1]]; });
    if (q.has('jumps')) o.jumps = q.get('jumps').split(',').map(Number);
    if (q.has('recover')) o.recover = q.get('recover') !== '0';
    return o;
  }

  function load() {
    const keys = Object.keys(WW.ASSETS.images);
    return Promise.all(keys.map(function (k) {
      return new Promise(function (res) {
        const im = new Image();
        im.onload = function () { res(); }; im.onerror = function () { console.warn('missing', k); res(); };
        im.src = '../../game/' + WW.ASSETS.images[k].file;
        images[k] = im;
      });
    })).then(function () { return Promise.all(Object.keys(images).map(function (k) { return images[k].decode ? images[k].decode().catch(function () {}) : 0; })); });
  }

  let renderer = null, sim = null, wall = 0;
  function makeRenderer() {
    renderer = WW.render.createRenderer({ canvas: canvas, images: images, assets: WW.ASSETS, plates: WW.PLATES, level: WW.LEVEL, debug: q.get('debug') === '1' });
    renderer.resize(innerWidth, innerHeight, devicePixelRatio);
    H.renderer = renderer;
  }

  /* Dry run to find event times (race seconds) for the named moments. */
  function computeMoments() {
    const s = WW.harnessSim(simOpts());
    for (let i = 0; i < 60 * 260 && s.state.purl.finishTime === null; i++) s.step(1 / 60);
    for (let i = 0; i < 60 * 3; i++) s.step(1 / 60);
    const t = s.times, w = function (x) { return x === undefined ? undefined : x + COUNT; };
    const seg = t.segStart;
    const m = {
      countdown: 1.5,
      stop: COUNT + 1.4,
      unfurl: w(t.stitch.ribbon) + 0.62,
      unfurl2: w(t.stitch.ribbon) + 1.05,
      run: w(t.stitch.ribbon) + TUN().ribbonUnfurl + 2.6,
      run2: w(t.stitch.ribbon) + TUN().ribbonUnfurl + 7,
      pickup: w(t.item['purl.coral']) + 0.12,
      exit: w(seg[1]) - 0.4,
      connector: w(seg[1]) + 1.0,
      connector2: w(seg[1]) + 2.0,
      p02: w(seg[2]) + 1.2,
      unroll: w(t.stitch.shortcut) + 0.7,
      p02run: w(t.stitch.shortcut) + TUN().shortcutUnroll + 2.5,
      p03: w(seg[4]) + 1.2,
      lift: w(t.stitch.tassels) + 0.45,
      p03run: w(t.stitch.tassels) + 2.6,
      tealpick: w(t.item['purl.teal']) + 0.12,
      p04: w(seg[6]) + 0.6,
      reveal: w(t.reveal) + 0.3,
      snagged: w(t.hit) + 0.25,
      recovery: w(t['item'] && t.item['purl.teal:recover']) + 0.1,
      p06: w(seg[8]) + 1.2,
      emerge: w(t.stitch.butterfly) + 0.35,
      fly: w(t.stitch.butterfly) + 1.4,
      place: w(t.stitch.butterfly) + 2.6,
      goldpick: w(t.item['purl.gold']) + 0.12,
      p07: w(seg[10]) + 1.0,
      finish: w(t.finish) + 0.5,
      finish2: w(t.finish) + 1.6
    };
    H.times = t;
    return m;
  }
  function TUN() { return WW.TUNING; }

  /* Re-simulate from 0 to wall time T, rendering the last `warm` seconds so cosmetic state (camera, fx) is right. */
  function goto(T, warm) {
    warm = warm === undefined ? 2.5 : warm;
    makeRenderer();
    sim = WW.harnessSim(simOpts());
    const dt = 1 / 60;
    let t = 0, n = 0;
    while (t < T - 1e-9) {
      sim.step(dt); t += dt; n++;
      const evs = sim.events.splice(0);
      if (t >= T - warm) {
        renderer.handleEvents(evs);
        if (n % 2 === 0 || t >= T - 1e-9) renderer.render(sim.state, 2 * dt);
      }
    }
    if (n === 0) renderer.render(sim.state, 0);
    wall = t;
    showInfo();
    return sim.state;
  }

  function showInfo() {
    if (q.get('info') !== '1') return;
    info.hidden = false;
    info.textContent = 'wall ' + wall.toFixed(2) + ' race ' + sim.state.time.toFixed(2) + ' seg ' + sim.state.purl.seg + ' f ' + sim.state.purl.f.toFixed(3);
  }

  function play() {
    let last = performance.now();
    const speed = +(q.get('speed') || 1);
    function frame(now) {
      const dtr = Math.min(0.1, (now - last) / 1000); last = now;
      const steps = Math.round(dtr * speed * 60);
      for (let i = 0; i < steps; i++) { sim.step(1 / 60); renderer.handleEvents(sim.events.splice(0)); }
      wall += steps / 60;
      renderer.render(sim.state, dtr * speed);
      showInfo();
      H.frames++;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  const H = window.H = { goto: goto, moments: null, renderer: null, frames: 0, get state() { return sim && sim.state; } };
  addEventListener('resize', function () { if (renderer) renderer.resize(innerWidth, innerHeight, devicePixelRatio); });

  H.ready = load().then(function () {
    H.moments = computeMoments();
    const m = q.get('moment');
    const T = m && H.moments[m] !== undefined ? H.moments[m] : +(q.get('T') || 0);
    goto(T);
    if (q.get('play') === '1') play();
    return true;
  });
})();
