/* Renderer harness captures: node tests/harness/render-capture.cjs <outDir> moment[,moment...] [extra query]
   Serves nothing itself — expects `python3 -m http.server 8101 --bind 127.0.0.1` from the repo root.
   Captures at 412 × 915 CSS px, DPR 2 (the plate contain-fits at 0.489, lining up with the approved PNGs).
   Also prints console errors and a frame-time sample for `perf` (real-time play for 3 s). */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');

(async () => {
  const out = process.argv[2] || '.';
  const moments = (process.argv[3] || 'stop').split(',');
  const extra = process.argv[4] ? '&' + process.argv[4] : '';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +(process.env.VW || 412), height: +(process.env.VH || 915) }, deviceScaleFactor: +(process.env.DPR || 2) });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const m of moments) {
    const isT = /^T=/.test(m);
    const url = 'http://127.0.0.1:8101/tests/harness/render-harness.html?' + (isT ? m : 'moment=' + m) + extra;
    await page.goto(url);
    await page.evaluate(() => window.H.ready);
    if (m === 'perf') {
      await page.goto('http://127.0.0.1:8101/tests/harness/render-harness.html?moment=run&play=1' + extra);
      await page.evaluate(() => window.H.ready);
      const r = await page.evaluate(() => new Promise((res) => {
        const t0 = performance.now(), f0 = window.H.frames;
        setTimeout(() => res({ fps: (window.H.frames - f0) / ((performance.now() - t0) / 1000) }), 3000);
      }));
      const ms = await page.evaluate(() => {
        const r = window.H.renderer, st = window.H.state, out = {};
        for (const m of ['stop', 'run', 'pickup']) {
          window.H.goto(window.H.moments[m], 0.2);
          const t0 = performance.now();
          for (let i = 0; i < 120; i++) window.H.renderer.render(window.H.state, 1 / 60);
          out[m] = +((performance.now() - t0) / 120).toFixed(2);
        }
        return out;
      });
      console.log('perf', JSON.stringify(r), 'render ms/frame', JSON.stringify(ms));
      continue;
    }
    const file = path.join(out, (isT ? m.replace(/[=.]/g, '_') : m) + '.png');
    await page.screenshot({ path: file });
    const info = await page.evaluate(() => ({ purl: window.H.renderer.getLayout().purl, taps: window.H.renderer.getTapTargets(),
      seg: window.H.state.purl.seg, f: +window.H.state.purl.f.toFixed(4), loop: [window.H.state.loop.seg, +window.H.state.loop.f.toFixed(3), window.H.state.loop.action] }));
    console.log(m, JSON.stringify(info));
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
