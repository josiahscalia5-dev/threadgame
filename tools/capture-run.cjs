/* Plays a whole race in headless Chromium with a simple bot and saves frames for review.

     node tools/capture-run.cjs --seed 3 --mode dodge|hit|jump --every 0.5 --out DIR [--video] [--w 393 --h 852]

   dodge: changes lane when Snagling appears; jump: jumps over him; hit: lets him hit, then steers into the
   dropped thread. Needs a server on :8123 serving game/ (http-server game -p 8123). Prints the event log. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes('--' + k);
(async () => {
  const seed = arg('seed', '3'), mode = arg('mode', 'dodge'), every = +arg('every', '0.5'), out = arg('out', 'capture');
  const W = +arg('w', '393'), H = +arg('h', '852'), fps = +arg('fps', '0');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +arg('dpr', '2'), isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8123/index.html?test=1&seed=' + seed + (has('debug') ? '&debug=1' : ''));
  await page.waitForFunction(() => window.WishweaveGame && WishweaveGame.debug && WishweaveGame.debug.screenshotReady(), null, { timeout: 20000 });
  await page.evaluate((mode) => {
    const d = WishweaveGame.debug;
    d.setClock('manual');
    window.__log = [];
    window.__bot = { mode: mode, acted: 0, recovered: false };
    window.__tick = function (frames) {
      const race = d.race(), b = window.__bot;
      for (let i = 0; i < frames; i++) {
        const s = race.state;
        if (s.mode === 'running') {
          const sn = s.snagling, p = s.purl;
          if (sn.state === 'hop' && b.acted !== sn.pass && sn.t > 0.25) {
            b.acted = sn.pass;
            if (b.mode === 'dodge') d.swipe(p.lane <= 0 ? 'left' : 'left');
            else if (b.mode === 'jump') { if (sn.t > 0.35) d.swipe('up'); else b.acted = 0; }
          }
          for (const id in s.items) {
            const it = s.items[id];
            if (it.owner === 'purl' && it.status === 'dropped' && s.time > it.dropTime + 0.6 && p.lane !== it.lane && s.time >= p.tangledUntil) {
              d.swipe(it.lane > p.lane ? 'right' : 'left');
            }
          }
        }
        const before = race.state.time;
        d.advance(1 / 60, 0);
      }
      return race.state;
    };
    const orig = d.race().step;
  }, mode);
  // patch event logging by wrapping step once
  await page.evaluate(() => {
    const race = WishweaveGame.debug.race(), step = race.step;
    race.step = function (dt) { const ev = step(dt); ev.forEach(e => { if (e.type !== 'segment' && e.type !== 'count') window.__log.push(race.state.time.toFixed(2) + ' ' + JSON.stringify(e)); }); return ev; };
  });
  await page.evaluate(() => { const d = WishweaveGame.debug; WishweaveGame.start(); d.render(); });
  let t = -3.0, k = 0;
  const framesPer = Math.max(1, Math.round(every * 60));
  for (;;) {
    const s = await page.evaluate((n) => { const s = window.__tick(n); return { mode: s.mode, time: s.time, seg: s.purl.segId, f: s.purl.f, result: s.result, held: s.held }; }, framesPer);
    t += every; k++;
    await page.screenshot({ path: path.join(out, 'f' + String(k).padStart(4, '0') + '.png') });
    if (s.mode === 'failed' || (s.result && !s.result.loopStillRacing && s.time - s.result.purlTime > 2.5) || t > 140) {
      console.log('end', JSON.stringify(s));
      break;
    }
  }
  console.log((await page.evaluate(() => window.__log)).join('\n'));
  if (errors.length) console.log('ERRORS', errors);
  await browser.close();
  if (has('video')) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps || Math.round(1 / every)), '-i', path.join(out, 'f%04d.png'),
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', path.join(out, 'run.mp4')]);
  }
})();
