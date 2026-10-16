/* Renders frames of the connected-road preview (game/world-preview.html) at given distances along the course.
     node tools/preview-shots.cjs OUTDIR d1,d2,... [--debug] [--w 393 --h 852]     (needs http-server on :8123) */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
(async () => {
  const out = process.argv[2], ds = process.argv[3];
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +arg('w', '393'), height: +arg('h', '852') }, deviceScaleFactor: +arg('dpr', '2') });
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => logs.push('pageerror: ' + e));
  await page.goto('http://127.0.0.1:8123/world-preview.html' + (process.argv.includes('--debug') ? '?debug=geom' : ''));
  await page.waitForFunction(() => window.previewReady, null, { timeout: 30000 }).catch(() => {});
  const info = await page.evaluate(() => window.preview ? { total: window.preview.total, segs: window.preview.segs } : null);
  console.log(JSON.stringify(info));
  // each entry: distance, optionally with options as  d:laneX:jumpH:overhead  e.g. 24:-1:0.8 or 20:0:0:1
  const list = ds.split(',').map(x => { const p = x.split(':').map(Number); return { d: p[0], o: { laneX: p[1] || 0, lane: p[1] || 0, jumpH: p[2] || 0, overhead: !!p[3] } }; });
  for (let i = 0; i < list.length; i++) {
    const r = await page.evaluate((e) => window.preview.at(e.d, e.o), list[i]);
    await page.screenshot({ path: path.join(out, 'f' + String(i + 1).padStart(4, '0') + '.png') });
    console.log(JSON.stringify(list[i]), JSON.stringify(r));
  }
  if (logs.length) console.log(logs.slice(0, 20).join('\n'));
  await browser.close();
})();
