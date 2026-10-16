/* Captures a short clip of the race at a given time: node tools/clip.cjs seed fromSeconds count every outDir [mode] */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const [seed, from, count, every, out, mode] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('ERR', String(e)));
  await page.goto('http://127.0.0.1:8123/index.html?test=1&seed=' + seed);
  await page.waitForFunction(() => window.WishweaveGame && WishweaveGame.debug && WishweaveGame.debug.screenshotReady());
  await page.evaluate(([from, mode]) => {
    const d = WishweaveGame.debug; d.setClock('manual'); WishweaveGame.start();
    window.__step = function (sec) {
      const n = Math.round(sec * 60), race = d.race();
      for (let i = 0; i < n; i++) {
        const s = race.state;
        if (mode === 'dodge' && s.snagling.state === 'hop' && s.snagling.t > 0.3 && !window.__dodged) { window.__dodged = 1; d.swipe('left'); }
        if (mode === 'jump' && s.snagling.state === 'hop' && s.snagling.t > 0.4 && !window.__dodged) { window.__dodged = 1; d.swipe('up'); }
        d.advance(1 / 60, 0);
        d.render(1 / 60);
      }
    };
    window.__step(3 + +from);
  }, [from, mode || '']);
  for (let i = 0; i < +count; i++) {
    await page.evaluate((e) => window.__step(e), +every);
    await page.screenshot({ path: path.join(out, 'f' + String(i + 1).padStart(4, '0') + '.png') });
  }
  await browser.close();
})();
