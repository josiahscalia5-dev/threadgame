/* Real-sim renderer captures: node tests/harness/render-real.cjs <outDir> [moment,moment...|all] [--seed N] [--perf]
   Opens the REAL game (game/index.html?test=1) served by `python3 -m http.server 8101 --bind 127.0.0.1` from the repo
   root, starts the race, drives the real sim to each moment with WishweaveGame.debug (teleport / items / taps /
   manual advance) and saves <outDir>/<moment>.png at 412 × 915 CSS px, DPR 2 (the plate contain-fits at 0.489, so a
   capture lines up with the approved 841 × 1870 PNGs; see render-pairs.py). Prints Purl/Loop plate positions per shot.
   --perf  also times renderer.render(state, 1/60) (JS ms/frame) at several moments. */
'use strict';
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.WW_BASE || 'http://127.0.0.1:8101/game/index.html';

/* In-page helpers (stringified into the page). */
function pageHelpers() {
  const G = window.WishweaveGame, D = G.debug;
  const H = window.__H = {};
  H.race = function () { return D.race; };
  H.st = function () { return D.race.state; };
  H.adv = function (s) { return D.advance(s); };
  H.go = function (segId, f) { D.race.debug.teleport('purl', segId, f || 0); D.advance(1 / 60); };
  H.plateOf = function (segId) { const r = WW.LEVEL.route.find(function (s) { return s.id === segId; }); return WW.PLATES[r.plate]; };
  H.loopAt = function (segId, x, y) {
    const P = H.plateOf(segId), f = WW.path.project(P.loop.path, x, y);
    D.race.debug.teleport('loop', segId, f);
    return f;
  };
  H.hold = function (ids) { ids.forEach(function (id) { D.race.debug.setItem(id, { status: 'held', available: true }); }); };
  H.until = function (pred, max) {
    let t = 0;
    while (t < (max || 10)) { if (pred(H.st())) return t; D.advance(1 / 60); t += 1 / 60; }
    return -1;
  };
  H.info = function () {
    const s = H.st(), r = D.renderer, R = r._R, out = { t: +s.time.toFixed(2), purl: null, loop: null };
    const seg = WW.LEVEL.route[s.purl.seg];
    if (seg && seg.kind === 'plate') {
      const P = WW.PLATES[seg.plate];
      const p = WW.path.racerPoint(P.purl.path, s.purl.f, s.purl.laneX || 0, 0);
      out.plate = seg.plate;
      out.purl = { f: +s.purl.f.toFixed(4), x: Math.round(p.x), y: Math.round(p.groundY), w: Math.round(p.w), action: s.purl.action,
        screen: r.getLayout().purl, z: R.cam ? +R.cam.z.toFixed(3) : null };
      if (s.loop.seg === s.purl.seg) {
        const q = WW.path.racerPoint(P.loop.path, s.loop.f, 0, 0);
        out.loop = { f: +s.loop.f.toFixed(4), x: Math.round(q.x), y: Math.round(q.groundY), w: Math.round(q.w), action: s.loop.action,
          screen: r.worldToScreen(seg.plate, q.x, q.groundY) };
      }
    }
    return out;
  };
  return true;
}

/* Moments: each runs in a freshly started race. Approved Loop positions come from the plate comments. */
const MOMENTS = {
  'p02-ready': function () {
    __H.hold(['purl.coral', 'loop.coral']); __H.go('shortcut', 0); __H.adv(0.9);
    __H.loopAt('shortcut', 717, 687); __H.adv(0.15);
  },
  'p02-unroll': function () {
    __H.hold(['purl.coral', 'loop.coral']); __H.go('shortcut', 0); __H.adv(0.9);
    WishweaveGame.debug.tap('shortcut'); __H.loopAt('shortcut', 655, 657); __H.adv(0.75);
  },
  'p02-cross': function () {
    __H.hold(['purl.coral', 'loop.coral']); __H.go('shortcut', 0); __H.adv(0.9);
    WishweaveGame.debug.tap('shortcut'); __H.adv(2.6);
  },
  'p03-ready': function () {
    __H.hold(['purl.coral', 'loop.coral']); __H.go('tassels', 0); __H.adv(0.9);
    __H.loopAt('tassels', 740, 1000); __H.adv(0.15);
  },
  'p03-lift': function () {
    __H.hold(['purl.coral', 'loop.coral']); __H.go('tassels', 0); __H.adv(0.9);
    WishweaveGame.debug.tap('tassels'); __H.adv(0.55);
  },
  'p03-open': function () {
    __H.hold(['purl.coral', 'loop.coral']); __H.go('tassels', 0); __H.adv(0.9);
    WishweaveGame.debug.tap('tassels'); __H.adv(1.6);
  },
  'p04-hop': function () {
    __H.hold(['purl.coral', 'purl.teal', 'loop.coral', 'loop.teal']); __H.go('landing', 0.05);
    __H.until(function (s) { return s.snagling.state === 'hop'; }, 8); __H.adv(0.3);
  },
  'p04-snagged': function () {
    __H.hold(['purl.coral', 'purl.teal', 'loop.coral', 'loop.teal']); __H.go('landing', 0.05);
    __H.until(function (s) { return s.snagling.state === 'tangle'; }, 8);
    __H.loopAt('landing', 640, 556); __H.adv(0.28);
  },
  'p04-retreat': function () {
    __H.hold(['purl.coral', 'purl.teal', 'loop.coral', 'loop.teal']); __H.go('landing', 0.05);
    __H.until(function (s) { return s.snagling.state === 'retreat'; }, 8); __H.adv(0.35);
  },
  'p05-recovery': function () {
    __H.hold(['purl.coral', 'purl.teal', 'loop.coral', 'loop.teal']); __H.go('landing', 0.05);
    __H.until(function (s) { return s.snagling.state === 'tangle'; }, 8);
    const it = __H.st().items['purl.teal'];
    __H.until(function (s) { return s.purl.action === 'run'; }, 3);
    if (it.lane > __H.st().purl.lane) WishweaveGame.debug.swipe('right'); else if (it.lane < __H.st().purl.lane) WishweaveGame.debug.swipe('left');
    __H.until(function (s) { return s.items['purl.teal'].status === 'held'; }, 6);
    __H.loopAt('landing', 600, 530); __H.adv(0.3);
  },
  'p06-ready': function () {
    __H.hold(['purl.coral', 'purl.teal', 'loop.coral', 'loop.teal']); __H.go('tapestry', 0); __H.adv(0.9);
    __H.loopAt('tapestry', 730, 1000); __H.adv(0.15);
  },
  'p06-emerge': function () {
    __H.hold(['purl.coral', 'purl.teal', 'loop.coral', 'loop.teal']); __H.go('tapestry', 0); __H.adv(0.9);
    WishweaveGame.debug.tap('butterfly'); __H.adv(0.45);
  },
  'p06-fly': function () {
    __H.hold(['purl.coral', 'purl.teal', 'loop.coral', 'loop.teal']); __H.go('tapestry', 0); __H.adv(0.9);
    WishweaveGame.debug.tap('butterfly');
    __H.until(function (s) { return s.stitches.butterfly.phase === 'fly' && s.stitches.butterfly.phaseT >= 0.62; }, 4);
    __H.loopAt('tapestry', 713, 984);
    __H.until(function (s) { return s.stitches.butterfly.phase === 'fly' && s.stitches.butterfly.phaseT >= 0.75; }, 4);
  },
  'p06-place': function () {
    __H.hold(['purl.coral', 'purl.teal', 'loop.coral', 'loop.teal']); __H.go('tapestry', 0); __H.adv(0.9);
    WishweaveGame.debug.tap('butterfly');
    __H.until(function (s) { return s.stitches.butterfly.phase === 'place' && s.stitches.butterfly.phaseT >= 0.5; }, 5);
  },
  'p06-exit': function () {
    __H.hold(['purl.coral', 'purl.teal', 'loop.coral', 'loop.teal']); __H.go('tapestry', 0); __H.adv(0.9);
    WishweaveGame.debug.tap('butterfly');
    __H.until(function (s) { return s.stitches.butterfly.state === 'open'; }, 5); __H.adv(0.5);
  },
  'p07-approach': function () {
    WishweaveGame.debug.race.debug.giveAll(); __H.hold(['loop.coral', 'loop.teal', 'loop.gold']);
    __H.go('finish', 0.15); __H.loopAt('finish', 721, 1478); __H.adv(0.4);
  },
  'p07-finish': function () {
    WishweaveGame.debug.race.debug.giveAll(); __H.hold(['loop.coral', 'loop.teal', 'loop.gold']);
    __H.go('finish', 0.3); __H.loopAt('finish', 721, 1478);
    __H.until(function (s) { return s.mode === 'finished'; }, 8);
    __H.loopAt('finish', 647, 1328); __H.adv(1.2);
  },
  'p07-blocked': function () {
    __H.hold(['purl.coral', 'purl.teal']); __H.go('finish', 0.3);
    __H.until(function (s) { return s.transition && s.transition.kind === 'return' && s.transition.t > 0.3; }, 8);
  },
  'c-landing': function () {
    __H.hold(['purl.coral', 'purl.teal']); __H.go('c-landing', 0.45); __H.adv(0.05);
  }
};

(async () => {
  const argv = process.argv.slice(2);
  const out = argv[0] || '.';
  let list = (argv[1] && !argv[1].startsWith('--') ? argv[1] : 'all');
  const seed = argv.includes('--seed') ? +argv[argv.indexOf('--seed') + 1] : 7;
  const perf = argv.includes('--perf');
  const names = list === 'all' ? Object.keys(MOMENTS) : list.split(',');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const open = async () => {
    await page.goto(BASE + '?test=1&seed=' + seed);
    await page.waitForFunction(() => window.WishweaveGame && window.WishweaveGame.debug, null, { timeout: 30000 });
    await page.evaluate(() => window.WishweaveGame.debug.screenshotReady());
    await page.evaluate(() => window.WishweaveGame.debug.setClock('manual'));
    await page.evaluate(pageHelpers);
    await page.evaluate(() => { window.WishweaveGame.start(); window.WishweaveGame.debug.advance(3.2); });
  };
  for (const name of names) {
    const fn = MOMENTS[name];
    if (!fn) { console.log('unknown moment', name); continue; }
    await open();
    await page.evaluate('(' + fn.toString() + ')()');
    await page.evaluate(() => window.WishweaveGame.debug.screenshotReady());
    await page.screenshot({ path: path.join(out, name + '.png') });
    const info = await page.evaluate(() => window.__H.info());
    console.log(name, JSON.stringify(info));
  }
  if (perf) {
    await open();
    const res = await page.evaluate(() => {
      const D = window.WishweaveGame.debug, r = D.renderer, out = {};
      const time = function (label) {
        const st = D.race.state;
        for (let i = 0; i < 10; i++) r.render(st, 1 / 60);
        const t0 = performance.now();
        for (let i = 0; i < 120; i++) r.render(st, 1 / 60);
        out[label] = +((performance.now() - t0) / 120).toFixed(2);
      };
      __H.hold(['purl.coral', 'loop.coral']); __H.go('shortcut', 0); __H.adv(0.9); __H.loopAt('shortcut', 717, 687); time('p02-ready');
      __H.go('tassels', 0); __H.adv(0.9); D.tap('tassels'); __H.adv(0.4); time('p03-lift');
      __H.hold(['purl.teal']); __H.go('landing', 0.05);
      __H.until(function (s) { return s.snagling.state === 'tangle'; }, 8); time('p04-tangle');
      __H.go('c-landing', 0.5); time('connector');
      __H.go('tapestry', 0); __H.adv(0.9); D.tap('butterfly'); __H.adv(1.4); time('p06-fly');
      D.race.debug.giveAll(); __H.go('finish', 0.5); __H.adv(1.0); time('p07-finish');
      return out;
    });
    console.log('perf JS ms/frame (renderer.render, 412x915@2):', JSON.stringify(res));
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
