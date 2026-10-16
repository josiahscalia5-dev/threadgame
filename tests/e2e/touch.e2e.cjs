/* Browser check with real touch input (Chrome DevTools touch events, as a phone sends them).

     http-server game -p 8123 &   node tests/e2e/touch.e2e.cjs

   Checks: full-screen canvas with no uncovered pixels, START RACE by tap, countdown on the real clock, swipe
   right/left changes lane, swipe up and tap jump, page hidden pauses (and stays paused), Back pauses, resume. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const assert = require('node:assert/strict');
const BASE = process.env.WW_URL || 'http://127.0.0.1:8123/index.html';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + '?test=1&seed=12');
  await page.waitForFunction(() => window.WishweaveGame && WishweaveGame.debug && WishweaveGame.debug.screenshotReady(), null, { timeout: 20000 });
  const cdp = await page.context().newCDPSession(page);
  async function touchSwipe(dx, dy) {
    const x = 206, y = 600, steps = 6;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / steps, y: y + dy * i / steps }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const state = () => page.evaluate(() => { const s = WishweaveGame.getState(); return { mode: s.mode, paused: s.paused, lane: s.purl.lane, jumpH: s.purl.jumpH, time: s.time, reason: s.pauseReason }; });

  // 1. The canvas covers the whole viewport and every corner pixel is painted scenery (no black/empty bars).
  const cover = await page.evaluate(() => {
    const c = document.getElementById('view'), r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  });
  assert.equal(Math.round(cover.w), cover.vw); assert.equal(Math.round(cover.h), cover.vh);

  // 2. Start by a real tap; the countdown runs on the real clock.
  await page.tap('#btn-start');
  assert.equal((await state()).mode, 'countdown');
  await page.waitForFunction(() => WishweaveGame.getState().mode === 'running', null, { timeout: 6000 });
  const shot = await page.screenshot();
  const px = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    let dark = 0, n = 0;
    for (const [x, y] of [[2, 2], [img.width - 3, 2], [2, img.height - 3], [img.width - 3, img.height - 3], [img.width / 2, img.height / 2]]) {
      const d = g.getImageData(x | 0, y | 0, 1, 1).data; n++;
      if (d[0] + d[1] + d[2] < 30) dark++;
    }
    return { dark, n };
  }, shot.toString('base64'));
  assert.equal(px.dark, 0, 'no black pixels at the screen corners/centre');

  // 3. Swipes.
  await touchSwipe(90, 0);
  assert.equal((await state()).lane, 1, 'swipe right → right lane');
  await touchSwipe(-90, 0);
  await touchSwipe(-90, 0);
  assert.equal((await state()).lane, -1, 'two swipes left → left lane');
  await touchSwipe(0, -90);
  await page.waitForTimeout(120);
  assert.ok((await state()).jumpH > 0, 'swipe up jumps');
  await page.waitForTimeout(700);
  await page.touchscreen.tap(206, 600);
  await page.waitForTimeout(120);
  assert.ok((await state()).jumpH > 0, 'tap jumps');

  // 4. Backgrounding pauses, and the race stays paused when the page comes back.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  let s = await state();
  assert.ok(s.paused && s.reason === 'background');
  const t0 = s.time;
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  s = await state();
  assert.ok(s.paused && s.time === t0, 'still paused, race clock frozen');
  assert.ok(await page.isVisible('#ov-pause'));
  await page.tap('#btn-resume');
  await page.waitForTimeout(300);
  assert.ok(!(await state()).paused && (await state()).time > t0);

  // 5. Android Back: pauses a running race; on the pause screen it means exit.
  assert.equal(await page.evaluate(() => WishweaveGame.onBack()), 'paused');
  assert.equal(await page.evaluate(() => WishweaveGame.onBack()), 'exit');

  assert.deepEqual(errors, []);
  console.log('touch e2e: all checks passed');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
