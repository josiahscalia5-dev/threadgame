// Quick screenshot helper: node tools/shot.cjs <url-query> <out.png> [advanceSeconds] [width] [height]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [query, out, adv, w, h] = process.argv.slice(2);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: +(w || 393), height: +(h || 852) }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8123/index.html?test=1&' + (query || ''));
  await page.waitForFunction(() => window.WishweaveGame && WishweaveGame.debug && WishweaveGame.debug.screenshotReady(), null, { timeout: 20000 });
  if (adv !== undefined && adv !== '') {
    await page.evaluate((s) => { const d = WishweaveGame.debug; d.setClock('manual'); WishweaveGame.start(); d.advance(3.2, 4); d.advance(+s, 4); }, adv);
  }
  await page.waitForTimeout(150);
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ errors, state: await page.evaluate(() => { const s = WishweaveGame.getState(); return { mode: s.mode, time: s.time, seg: s.purl.segId, f: s.purl.f, held: s.held }; }) }));
  await browser.close();
})();
