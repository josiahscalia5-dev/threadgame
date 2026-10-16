/* The opening TOUCH → PULL → OPEN lesson, played with real touch input (CDP touch events → pointer events) in the
   real game, with assertions, beat screenshots and an optional MP4.
     node tests/e2e/pull.cjs OUT_DIR [--record] [--seed N] [--w 412 --h 915]
   Covers: arrival, idle reading time (race clock and both racers frozen), touch, partial pull + release (progress
   kept), a second finger (ignored), pause + resume mid-grip (safe), touch again and finish, carpet unfurling, repeated
   touches after completion (no duplicate effect), run-up, Loop resuming from his held position, coral pickup 0/3 → 1/3. */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

(async () => {
  const out = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'pull-out';
  const record = process.argv.includes('--record');
  const seed = Number(arg('seed', 1));
  const W = Number(arg('w', 412)), H = Number(arg('h', 915));
  fs.mkdirSync(out, { recursive: true });
  const g = await L.openGame({ seed, width: W, height: H });
  const fps = 30, dt = 1 / fps;
  const rec = record ? L.recorder(path.join(out, 'frames'), fps) : null;
  const checks = [];
  const check = (ok, msg) => { checks.push((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) console.log('FAIL', msg); };
  const shot = (n) => g.page.screenshot({ path: path.join(out, n + '.png') });
  const log = (m) => console.log(m);
  const frames = async (sec) => { for (let i = 0; i < Math.round(sec * fps); i++) { await L.advance(g, dt); if (rec) await rec.frame(g); } };
  const ribbon = () => g.page.evaluate(() => {
    const s = window.WishweaveGame.debug.race.state, r = s.stitches.ribbon;
    return { state: r.state, pull: r.pull, gripping: r.gripping, tutorial: s.tutorial, time: s.time,
             loop: { f: s.loop.f, seg: s.loop.seg, distance: s.loop.distance, speed: s.loop.speed },
             purl: { f: s.purl.f, action: s.purl.action, waitingFor: s.purl.waitingFor, lane: s.purl.lane, jumpH: s.purl.jumpH },
             held: s.held.purl, items: Object.keys(s.items).length, objective: s.objective };
  });
  const touch = (type, pts) => g.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  /* Drag from (x, y) down by `dy` CSS px over `sec` seconds of game time, recording frames; release unless keep. */
  const drag = async (x, y, dy, sec, keep, sideways) => {
    await touch('touchStart', [{ x, y, id: 1 }]);
    const n = Math.max(2, Math.round(sec * fps));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      await touch('touchMove', [{ x: x + (sideways || 0) * k, y: y + dy * k, id: 1 }]);
      await L.advance(g, dt); if (rec) await rec.frame(g);
    }
    if (!keep) await touch('touchEnd', []);
  };

  if (rec) for (let i = 0; i < fps; i++) await rec.frame(g);
  await L.tapElement(g, '#btn-start');
  // countdown + arrival
  let s = await L.snap(g), guard = 0;
  while (!(s.targets.find((t) => t.id === 'ribbon' && t.kind === 'pull'))) {
    await frames(dt); s = await L.snap(g);
    if (++guard > 10 * fps) throw new Error('Purl never reached the ribbon loop');
  }
  let r = await ribbon();
  log('arrived: race time ' + r.time.toFixed(2) + ' s, stage ' + JSON.stringify(r.tutorial));
  check(r.tutorial && r.tutorial.stage === 'touch', 'tutorial starts in TOUCH stage on arrival');
  const tgt = s.targets.find((t) => t.id === 'ribbon');
  log('loop target at ' + tgt.x.toFixed(0) + ',' + tgt.y.toFixed(0) + ' r ' + tgt.r.toFixed(0));
  check(tgt.r * 2 >= 48, 'loop hit area ≥ 48 CSS px (diameter ' + (tgt.r * 2).toFixed(0) + ')');
  const dist = await g.page.evaluate(() => {
    const h = document.getElementById('view').getBoundingClientRect().height;
    return Math.min(110, Math.max(64, 0.1 * h));
  });
  log('drag target ' + dist.toFixed(1) + ' CSS px');

  // the player reads the lesson for 3 s: nothing races
  const hold0 = r;
  await frames(1.2);
  await shot('1-touch');
  await frames(1.8);
  r = await ribbon();
  check(r.time === hold0.time, 'race clock frozen while reading (' + hold0.time.toFixed(3) + ' → ' + r.time.toFixed(3) + ')');
  check(r.loop.f === hold0.loop.f && r.loop.distance === hold0.loop.distance, 'Loop holds his exact position while reading');

  // a tap elsewhere and an upward/sideways drag on the loop do nothing to the progress
  await L.touchTap(g, tgt.x - 150, tgt.y - 250); await frames(0.2);
  await drag(tgt.x, tgt.y, -60, 0.3, false, 40); await frames(0.3);
  r = await ribbon();
  check(r.pull === 0 && r.state === 'ready', 'upward/sideways drag gives no progress (pull ' + r.pull + ')');
  check(r.purl.jumpH === 0 && r.purl.lane === 0, 'a drag on the loop never jumps Purl or changes lane');

  // partial pull (40 %), hold, release: progress kept
  await drag(tgt.x, tgt.y, dist * 0.4, 0.5, true);
  r = await ribbon();
  check(r.gripping && Math.abs(r.pull - 0.4) < 0.05, 'partial pull tracks the finger (pull ' + r.pull.toFixed(2) + ')');
  check(r.tutorial.stage === 'pull', 'stage PULL while gripping');
  await shot('2a-partial-pull');
  // a second finger during the pull is ignored
  await touch('touchStart', [{ x: tgt.x, y: tgt.y + dist * 0.4, id: 1 }, { x: W * 0.5, y: H * 0.5, id: 2 }]);
  await touch('touchMove', [{ x: tgt.x, y: tgt.y + dist * 0.4, id: 1 }, { x: W * 0.5, y: H * 0.5 - 120, id: 2 }]);
  await touch('touchEnd', [{ x: tgt.x, y: tgt.y + dist * 0.4, id: 1 }]);
  await frames(0.3);
  r = await ribbon();
  check(r.purl.jumpH === 0 && r.state === 'ready', 'second finger swipe ignored (no jump, no completion)');
  await touch('touchEnd', []);
  await frames(0.6);
  r = await ribbon();
  check(!r.gripping && Math.abs(r.pull - 0.4) < 0.05 && r.state === 'ready', 'early release keeps partial progress (' + r.pull.toFixed(2) + ')');
  await shot('2b-released-partial');

  // touch again, pull a little, then the app is backgrounded (pause) mid-grip
  await drag(tgt.x, tgt.y, dist * 0.2, 0.3, true);
  r = await ribbon();
  const midPull = r.pull;
  check(Math.abs(midPull - 0.6) < 0.06, 'second touch continues from the kept progress (' + midPull.toFixed(2) + ')');
  await g.page.evaluate(() => window.WishweaveGame.pause('background'));
  await touch('touchMove', [{ x: tgt.x, y: tgt.y + dist * 1.5, id: 1 }]);
  await touch('touchEnd', []);
  await frames(0.5);
  r = await ribbon();
  check(!r.gripping && Math.abs(r.pull - midPull) < 1e-6 && r.state === 'ready', 'pause mid-grip: grip released, progress kept, no completion');
  await g.page.evaluate(() => window.WishweaveGame.resume());
  await frames(0.4);
  r = await ribbon();
  check(r.time === hold0.time && r.loop.f === hold0.loop.f, 'still frozen after resume (clock and Loop)');

  // touch again and finish the pull
  await touch('touchStart', [{ x: tgt.x, y: tgt.y, id: 1 }]);
  const n = 12;
  let shotPull = false;
  for (let i = 1; i <= n; i++) {
    await touch('touchMove', [{ x: tgt.x + 2 * Math.sin(i), y: tgt.y + dist * 0.6 * i / n, id: 1 }]);
    await L.advance(g, dt); if (rec) await rec.frame(g);
    r = await ribbon();
    if (!shotPull && r.pull >= 0.85) { await shot('2-pull'); shotPull = true; }
    if (r.state !== 'ready') break;
  }
  await touch('touchEnd', []);
  r = await ribbon();
  check(r.state === 'animating' && r.pull === 1, 'completed pull releases the knot (state ' + r.state + ')');
  check(r.tutorial && r.tutorial.stage === 'unfurl', 'stage UNFURL');
  const t0 = r.time;
  // repeated touches during and after the unfurl cannot do anything
  for (let i = 0; i < 3; i++) { await drag(tgt.x, tgt.y, dist * 1.2, 0.12); await L.touchTap(g, tgt.x, tgt.y); }
  await frames(0.25);
  await shot('3a-unfurling');
  let events = [];
  let lastHeld = r;
  for (let i = 0; i < 90; i++) { r = await ribbon(); if (!r.tutorial) break; lastHeld = r; await frames(dt); }
  // lastHeld = the final frame of the lesson (stage 'settle'): nothing raced during the whole lesson
  check(lastHeld.time === hold0.time, 'the whole lesson took no race time (' + hold0.time.toFixed(3) + ' → ' + lastHeld.time.toFixed(3) + ')');
  check(lastHeld.loop.f === hold0.loop.f && lastHeld.loop.distance === hold0.loop.distance,
    'Loop held his real position through the lesson (f ' + lastHeld.loop.f.toFixed(4) + ')');
  check(r.time - hold0.time < 0.1 && r.loop.f >= hold0.loop.f, 'both racers continue from where they were');
  check(r.held === 0 && r.items === 6, 'opening awards nothing: still 0/3, six item IDs');
  check(r.objective === 'Collect the coral thread', 'objective "' + r.objective + '"');
  await frames(0.25);
  await shot('3-open');
  for (let i = 0; i < 3; i++) { await L.touchTap(g, tgt.x, tgt.y); await drag(tgt.x, tgt.y, dist, 0.1); }
  events = await g.page.evaluate(() => (window.WishweaveGame.debug.events || []).map((e) => e.type + (e.id ? ':' + e.id : '')));
  const opens = events.filter((e) => e === 'stitch-open:ribbon').length;
  const completes = events.filter((e) => e === 'pull-complete:ribbon').length;
  check(opens === 1 && completes === 1, 'exactly one completion and one opening (' + completes + ', ' + opens + ')');

  // run-up: Loop moves again, Purl collects the coral spool physically
  const lf = r.loop.f;
  await frames(1.0);
  r = await ribbon();
  check(r.loop.f > lf && r.time > t0, 'race clock and Loop resume after the lesson');
  await shot('4-run-up');
  let pickedAt = null;
  for (let i = 0; i < 40 * fps; i++) {
    await L.advance(g, dt); if (rec) await rec.frame(g);
    if (i % 3) continue;
    r = await ribbon();
    if (r.held === 1 && pickedAt == null) { pickedAt = r.time; log('coral collected at race time ' + r.time.toFixed(2)); }
    if (pickedAt != null && r.time > pickedAt + 0.4) break;
  }
  check(pickedAt != null, 'Purl physically collects the coral spool: 0/3 → 1/3');
  await shot('5-coral-pickup');
  check(g.errors.length === 0, 'no page errors' + (g.errors.length ? ': ' + g.errors.join(' | ') : ''));
  fs.writeFileSync(path.join(out, 'checks.txt'), checks.join('\n') + '\n');
  console.log(checks.join('\n'));
  if (rec) console.log('video:', rec.encode(path.join(out, 'pull-stitch.mp4')), rec.count, 'frames');
  await g.browser.close();
  process.exit(checks.some((c) => c.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
