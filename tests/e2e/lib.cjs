/* End-to-end helpers: open the real game in Chromium with a phone-sized touch viewport, drive it only through
   real touch input (CDP touch events -> pointer events in the page) and step the clock deterministically through
   WishweaveGame.debug (manual clock), optionally saving every frame for a video.

   Requires the game served over HTTP (tools/serve-game.sh or `python3 -m http.server 8100 --bind 127.0.0.1`). */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const BASE = process.env.WW_BASE || 'http://127.0.0.1:8100/game/index.html';

async function openGame(opts) {
  opts = Object.assign({ width: 412, height: 915, dpr: 2, seed: 1, query: '' }, opts || {});
  const browser = await chromium.launch({ args: ['--disable-gpu-vsync'] });
  const context = await browser.newContext({
    viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: opts.dpr,
    hasTouch: true, isMobile: true
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
  const url = BASE + '?test=1&seed=' + opts.seed + (opts.query ? '&' + opts.query : '');
  await page.goto(url);
  await page.waitForFunction(() => window.WishweaveGame && window.WishweaveGame.debug, null, { timeout: 30000 });
  await page.evaluate(() => window.WishweaveGame.debug.screenshotReady());
  await page.evaluate(() => window.WishweaveGame.debug.setClock('manual'));
  const cdp = await context.newCDPSession(page);
  return { browser, context, page, cdp, errors, opts };
}

/* A compact JSON snapshot of the live sim state (only what tests and the player policy need). */
async function snap(g) {
  return g.page.evaluate(() => {
    const d = window.WishweaveGame.debug, s = d.race.state;
    const items = {};
    for (const k in s.items) {
      const it = s.items[k];
      items[k] = { status: it.status, available: it.available, seg: it.seg, f: it.f, lane: it.lane };
    }
    const stitches = {};
    for (const k in s.stitches) stitches[k] = { state: s.stitches[k].state, phase: s.stitches[k].phase };
    const rect = document.getElementById('game').getBoundingClientRect();
    const targets = (d.renderer && d.renderer.getTapTargets ? d.renderer.getTapTargets() : [])
      .map((t) => ({ id: t.id, x: t.x + rect.left, y: t.y + rect.top, r: t.r }));
    return {
      mode: s.mode, paused: s.paused, time: s.time, countdown: s.countdown,
      purl: { segId: s.purl.segId, f: s.purl.f, lane: s.purl.lane, laneX: s.purl.laneX, action: s.purl.action,
              jumpH: s.purl.jumpH, finishTime: s.purl.finishTime, rank: s.purl.rank },
      loop: { segId: s.loop.segId, f: s.loop.f, action: s.loop.action, finishTime: s.loop.finishTime, rank: s.loop.rank },
      held: Object.assign({}, s.held), items, stitches,
      snagling: s.snagling ? { state: s.snagling.state, t: s.snagling.t, targetLane: s.snagling.targetLane, result: s.snagling.result } : null,
      message: s.message && s.message.text, objective: s.objective, phase: s.phase,
      result: s.result ? Object.assign({}, s.result) : null, stats: Object.assign({}, s.stats),
      transition: s.transition ? { kind: s.transition.kind, t: s.transition.t } : null,
      targets
    };
  });
}

async function advance(g, seconds) {
  await g.page.evaluate((sec) => window.WishweaveGame.debug.advance(sec), seconds);
}

/* Real touch tap: touchStart + touchEnd at one point (Chromium turns these into pointer events). */
async function touchTap(g, x, y) {
  const p = [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }];
  await g.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: p });
  await g.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/* Real touch swipe across the middle of the game surface. */
async function touchSwipe(g, dir, opts) {
  opts = opts || {};
  const vp = g.opts;
  const cx = opts.x || vp.width * 0.5, cy = opts.y || vp.height * 0.62;
  const dist = opts.dist || 110;
  const dx = dir === 'left' ? -dist : dir === 'right' ? dist : 0;
  const dy = dir === 'up' ? -dist : dir === 'down' ? dist : 0;
  await g.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await g.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: cx + dx * i / steps, y: cy + dy * i / steps, id: 1 }]
    });
  }
  await g.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function tapElement(g, selector) {
  const box = await g.page.locator(selector).boundingBox();
  if (!box) throw new Error('not visible: ' + selector);
  await touchTap(g, box.x + box.width / 2, box.y + box.height / 2);
}

async function visible(g, selector) {
  return g.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.hidden) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }, selector);
}

/* Frame recorder: JPEG frames into dir; encode() makes an H.264 MP4 with ffmpeg. */
function recorder(dir, fps) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.jpg')) fs.unlinkSync(path.join(dir, f));
  let n = 0;
  return {
    fps,
    async frame(g) {
      await g.page.screenshot({ path: path.join(dir, String(n++).padStart(6, '0') + '.jpg'), type: 'jpeg', quality: 82 });
    },
    get count() { return n; },
    encode(out) {
      const { execFileSync } = require('child_process');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%06d.jpg'),
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23',
        '-preset', 'medium', '-movflags', '+faststart', out]);
      return out;
    }
  };
}

module.exports = { BASE, openGame, snap, advance, touchTap, touchSwipe, tapElement, visible, recorder };
