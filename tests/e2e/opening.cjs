/* Plays the opening (start → ribbon stitch → coral pickup → into the shortcut) with real touch input and saves
   screenshots of each beat, plus an MP4 if --record is given.
   node tests/e2e/opening.cjs OUT_DIR [--record] [--seed N] */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');

(async () => {
  const out = process.argv[2] || 'opening-out';
  const record = process.argv.includes('--record');
  const si = process.argv.indexOf('--seed');
  const seed = si > 0 ? Number(process.argv[si + 1]) : 1;
  fs.mkdirSync(out, { recursive: true });
  const g = await L.openGame({ seed });
  const fps = 30, dt = 1 / fps;
  const rec = record ? L.recorder(path.join(out, 'frames'), fps) : null;
  const shot = (n) => g.page.screenshot({ path: path.join(out, n + '.png') });
  const log = (t, m) => console.log(String(t.toFixed(2)).padStart(6), m);

  await shot('a-start-screen');
  if (rec) for (let i = 0; i < fps; i++) await rec.frame(g);
  await L.tapElement(g, '#btn-start');
  let wall = 0, s = await L.snap(g), tapped = false, readyAt = null, prevHeld = 0, shots = {};
  const want = async (key, cond) => { if (!shots[key] && cond) { shots[key] = true; await shot(key); log(s.time, 'shot ' + key); } };
  while (wall < 40) {
    await L.advance(g, dt); wall += dt;
    if (rec) await rec.frame(g);
    s = await L.snap(g);
    await want('b-countdown', s.mode === 'countdown' && wall > 1.2);
    const tg = s.targets.find((t) => t.id === 'ribbon');
    if (tg && readyAt == null) { readyAt = wall; log(s.time, 'ribbon stitch ready'); }
    await want('c-stop-tap-the-stitch', tg && wall - readyAt > 0.8);
    if (tg && !tapped && wall - readyAt > 1.0) { await L.touchTap(g, tg.x, tg.y); tapped = true; log(s.time, 'TOUCH tap stitch at ' + tg.x.toFixed(0) + ',' + tg.y.toFixed(0)); }
    await want('d-ribbon-unfurling', s.stitches.ribbon.state === 'animating' && s.stitches.ribbon && wall - readyAt > 1.6);
    await want('e-running-up-ribbon', s.stitches.ribbon.state === 'open' && s.purl.segId === 'ribbon' && s.purl.f > 0.35);
    if (s.held.purl !== prevHeld) { log(s.time, 'PURL ' + prevHeld + '/3 -> ' + s.held.purl + '/3'); prevHeld = s.held.purl; shots.pickupAt = wall; }
    await want('f-coral-collected', shots.pickupAt && wall - shots.pickupAt > 0.35);
    await want('g-around-the-tower', s.transition && s.transition.kind === 'connector' && s.transition.t > 0.45);
    if (s.purl.segId === 'shortcut' && s.purl.action === 'wait') { await want('h-shortcut-arrival', true); break; }
  }
  console.log('errors:', g.errors.length ? g.errors.join('\n') : 'none');
  if (rec) console.log('video:', rec.encode(path.join(out, 'opening.mp4')), rec.count, 'frames');
  await g.browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
