/* Records a continuous run through the connected-road preview (game/world-preview.html) as an MP4.
     node tools/preview-video.cjs OUT.mp4 [--fps 20] [--speed 1.6] [--debug]     (needs http-server on :8123) */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
(async () => {
  const out = process.argv[2], fps = +arg('fps', '20'), speed = +arg('speed', '1.6');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pvvid-'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: +arg('dpr', '1.5') });
  await page.goto('http://127.0.0.1:8123/world-preview.html' + (process.argv.includes('--debug') ? '?debug=geom' : ''));
  await page.waitForFunction(() => window.previewReady, null, { timeout: 30000 });
  const total = await page.evaluate(() => window.preview.total);
  const n = Math.floor((total - 0.5) / speed * fps);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const d = i / fps * speed;
    // a steer left on the connecting road, a jump, then back to the centre
    const lane = d > 20.5 && d < 26.5 ? -1 : 0;
    await page.evaluate(([d, lane, i, fps]) => {
      const p = window.__p || (window.__p = { laneX: 0 });
      p.laneX += Math.max(-0.25, Math.min(0.25, lane - p.laneX));
      const jt = d - 23.2, jump = jt > 0 && jt < 1.0 ? Math.sin(Math.PI * jt / 1.0) : 0;
      window.preview.at(d, { laneX: p.laneX, lane: lane, jumpH: jump });
    }, [d, lane, i, fps]);
    await page.screenshot({ path: path.join(dir, 'f' + String(i).padStart(5, '0') + '.png') });
  }
  await browser.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'f%05d.png'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', out]);
  fs.rmSync(dir, { recursive: true });
  console.log('wrote', out, n, 'frames in', ((Date.now() - t0) / 1000).toFixed(0), 's');
})();
