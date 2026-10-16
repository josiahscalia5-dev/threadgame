/* Traces Purl's on-screen motion every frame of a whole race (real renderer, manual clock) and reports
   movement problems: sideways sliding (screen motion mostly horizontal while the rear-view run cycle plays),
   moving back toward the camera while facing away (moonwalk), drifting off the camera anchor, size pops, and
   frames where the view is a slide between two different scenes.

     node tools/trace-motion.cjs [seed] [--json out.json]        (needs http-server game -p 8123) */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const seed = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '3';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.goto((process.env.WW_URL || 'http://127.0.0.1:8123/index.html') + '?test=1&seed=' + seed);
  await page.waitForFunction(() => window.WishweaveGame && WishweaveGame.debug && WishweaveGame.debug.screenshotReady());
  const rows = await page.evaluate(() => {
    const d = WishweaveGame.debug, race = d.race(), ren = d.renderer();
    d.setClock('manual'); WishweaveGame.start(); d.advance(3.05, 0);
    const out = [];
    for (let i = 0; i < 60 * 70; i++) {
      const s = race.state;
      // dodge Snagling so the run is uninterrupted
      if (s.snagling.state === 'hop' && s.snagling.t > 0.3 && !window.__d) { window.__d = 1; d.swipe('left'); }
      race.step(1 / 60);
      ren.render(race.state, 1 / 60);
      const L = ren.getLayout(), q = L.purl, v = ren.debugView && ren.debugView();
      // Direction Purl is actually travelling along his route in the painting (not on screen).
      const seg = race.course.purl[s.purl.seg];
      let heading = null;
      if (seg.kind === 'plate' && !s.purl.trans && s.purl.speed > 1) {
        const sp = WW.path.sample(seg.path, s.purl.f);
        heading = sp.ty > 0.05 ? 'toward-camera' : (Math.abs(sp.tx) > Math.abs(sp.ty) * 1.2 ? 'sideways' : 'into-scene');
      }
      out.push({ t: +s.time.toFixed(3), seg: s.purl.segId, f: +s.purl.f.toFixed(4), x: q.x, y: q.y, w: q.w,
                 view: v ? v.kind : null, offset: v && v.offset ? v.offset : 0, scenes: v ? v.scenes : null, speed: s.purl.speed,
                 lane: s.purl.lane, laneX: s.purl.laneX, heading: heading });
      if (s.result && s.time - s.result.purlTime > 1) break;
    }
    return out;
  });
  await browser.close();
  const H = 852;
  const issues = { sideways: {}, backward: {}, offAnchor: {}, slideFrames: 0, sizePops: [], maxJump: 0, maxJumpAt: null, maxSize: 0 };
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.view === 'slide' || b.offset > 1) issues.slideFrames++;
    // largest frame-to-frame jump of Purl on screen (excluding his own lane changes), in px and in % of size
    if (Math.abs(b.laneX - a.laneX) < 1e-6) {
      const j = Math.hypot(b.x - a.x, b.y - a.y);
      if (j > issues.maxJump) { issues.maxJump = +j.toFixed(1); issues.maxJumpAt = [b.t, b.seg]; }
      issues.maxSize = Math.max(issues.maxSize, +(100 * Math.abs(b.w - a.w) / a.w).toFixed(1));
    }
    if (b.seg !== a.seg) continue;
    const dx = b.x - a.x, dy = b.y - a.y, wAvg = (a.w + b.w) / 2;
    const step = Math.hypot(dx, dy) / wAvg;              // body widths per frame on screen
    if (b.speed > 2 && b.view !== 'slide') {
      if (Math.abs(dx) > 2.5 * Math.abs(dy) && Math.abs(dx) / wAvg > 0.004) issues.sideways[b.seg] = (issues.sideways[b.seg] || 0) + 1;
      if (dy > 0.6 && Math.abs(dy) > Math.abs(dx) * 0.5) issues.backward[b.seg] = (issues.backward[b.seg] || 0) + 1;
      if (b.y < H * 0.68) issues.offAnchor[b.seg] = Math.min(issues.offAnchor[b.seg] || 1, +(b.y / H).toFixed(2));
    }
    if (Math.abs(b.w - a.w) / wAvg > 0.04) issues.sizePops.push([b.t, b.seg, +(a.w).toFixed(0), +(b.w).toFixed(0)]);
  }
  const perSeg = {};
  rows.forEach(r => { perSeg[r.seg] = perSeg[r.seg] || { frames: 0, minY: 1, maxY: 0, minW: 1e9, maxW: 0 }; const p = perSeg[r.seg]; p.frames++; p.minY = Math.min(p.minY, r.y / H); p.maxY = Math.max(p.maxY, r.y / H); p.minW = Math.min(p.minW, r.w); p.maxW = Math.max(p.maxW, r.w); });
  for (const k in perSeg) { const p = perSeg[k]; p.minY = +p.minY.toFixed(2); p.maxY = +p.maxY.toFixed(2); p.minW = Math.round(p.minW); p.maxW = Math.round(p.maxW); }
  console.log('frames', rows.length);
  console.table(perSeg);
  console.log('frames sliding sideways while running (per scene):', issues.sideways);
  console.log('frames moving back toward the camera while facing away:', issues.backward);
  console.log('lowest anchor (feet height / screen) when Purl drifts above 0.68:', issues.offAnchor);
  console.log('frames drawn as a two-scene slide (screen flip):', issues.slideFrames);
  console.log('size pops > 4%/frame:', issues.sizePops.slice(0, 12), issues.sizePops.length);
  console.log('largest jump of Purl on screen in one frame:', issues.maxJump, 'px at', issues.maxJumpAt, '| largest size change in one frame:', issues.maxSize + '%');
  const run = rows.filter(r => r.heading);
  const along = { sideways: {}, 'toward-camera': {} };
  run.forEach(r => { if (r.heading !== 'into-scene') along[r.heading][r.seg] = +(((along[r.heading][r.seg] || 0) + 1 / 60).toFixed(2)); });
  console.log('seconds Purl runs SIDEWAYS along a rail (route direction in the painting):', along.sideways);
  console.log('seconds Purl runs BACK TOWARD THE CAMERA while facing away:', along['toward-camera']);
  const summary = { railSidewaysSec: +run.filter(r => r.heading === 'sideways').length / 60, railBackwardSec: run.filter(r => r.heading === 'toward-camera').length / 60, flipFrames: issues.slideFrames, sidewaysFrames: Object.values(issues.sideways).reduce((x, y) => x + y, 0),
    backwardFrames: Object.values(issues.backward).reduce((x, y) => x + y, 0), lowestAnchor: Math.min(1, ...Object.values(issues.offAnchor)),
    maxJumpPx: issues.maxJump, maxSizeChangePct: issues.maxSize };
  console.log('SUMMARY', JSON.stringify(summary));
  const j = process.argv.indexOf('--json');
  if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(rows));
})();
