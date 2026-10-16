/* Plays a complete Level 1 race in the real game using only touch input, like a person would:
   taps the START button, opens the first (ribbon) stitch with the TOUCH → PULL gesture (touch the gold loop, drag
   down past the drag target over ~0.45 s), taps each later glowing stitch after a reaction delay, swipes up to jump Snagling's hop
   (dodge branch) or lets it connect (hit branch) and then swipes into the dropped thread's lane to recover it.

   node tests/e2e/play.cjs [--seed N] [--branch dodge|hit] [--react 1.0] [--record out.mp4] [--fps 30]
                           [--shots dir] [--out timeline.json] [--width 412 --height 915]

   Prints a timeline of score changes and key events and exits non-zero if a rule check fails. Key moments
   matching the seven approved screens are saved to --shots as 01-ribbon.png … 07-finish.png. */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');

function args() {
  const a = { seed: 1, branch: 'dodge', react: 1.0, fps: 30, record: null, shots: null, out: null, width: 412, height: 915, max: 260 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    if (k in a) a[k] = typeof a[k] === 'number' ? Number(v[++i]) : v[++i];
  }
  return a;
}

(async () => {
  const A = args();
  const g = await L.openGame({ seed: A.seed, width: A.width, height: A.height });
  const rec = A.record ? L.recorder(A.record.replace(/\.mp4$/, '') + '-frames', A.fps) : null;
  if (A.shots) fs.mkdirSync(A.shots, { recursive: true });
  const dt = 1 / A.fps;
  const log = [];
  const say = (t, what) => { log.push({ t: +t.toFixed(2), what }); console.log(t.toFixed(2).padStart(7), what); };
  const shot = async (name) => { if (A.shots) await g.page.screenshot({ path: path.join(A.shots, name + '.png') }); };

  let s = await L.snap(g);
  if (rec) { for (let i = 0; i < A.fps; i++) { await rec.frame(g); } }   // one second on the start screen
  await shot('00-start');
  await L.tapElement(g, '#btn-start');
  say(0, 'tap START');

  const seen = {};           // stitch id -> sim time first seen ready
  const tapped = {};
  let hopSeenAt = null, jumped = false, lastSteer = -9, prevHeld = 0, prevLoopHeld = 0, prevSeg = null, prevLoopSeg = null;
  let prevSnag = null, recoveredShotDue = null, hitShotDue = null, butterflyShot = false, flightSeen = 0;
  const heldSeq = [0];
  let wall = 0, done = false, resultsAt = null;

  while (!done && wall < A.max) {
    await L.advance(g, dt);
    wall += dt;
    if (rec) await rec.frame(g);
    s = await L.snap(g);
    const t = s.time;

    if (s.purl.segId !== prevSeg) { say(t, 'Purl enters ' + s.purl.segId); prevSeg = s.purl.segId; }
    if (s.loop.segId !== prevLoopSeg) { say(t, '  Loop enters ' + s.loop.segId); prevLoopSeg = s.loop.segId; }
    if (s.held.purl !== prevHeld) { say(t, 'PURL ' + prevHeld + '/3 -> ' + s.held.purl + '/3'); heldSeq.push(s.held.purl); prevHeld = s.held.purl; }
    if (s.held.loop !== prevLoopHeld) { say(t, '  LOOP ' + prevLoopHeld + '/3 -> ' + s.held.loop + '/3'); prevLoopHeld = s.held.loop; }

    // Stitch taps: real touch on the renderer's tap target after a human-ish reaction time.
    for (const tg of s.targets) {
      if (tapped[tg.id]) continue;
      if (seen[tg.id] == null) { seen[tg.id] = wall; say(t, 'stitch ready: ' + tg.id); }
      const shotName = { ribbon: '01-ribbon', shortcut: '02-shortcut', tassels: '03-tassels', butterfly: '06-butterfly-cue' }[tg.id];
      if (wall - seen[tg.id] >= Math.min(0.6, A.react) && !tapped[tg.id + ':shot']) { tapped[tg.id + ':shot'] = true; await shot(shotName); }
      if (wall - seen[tg.id] >= A.react && tg.kind === 'pull') {
        // touch the loop and pull it down (target clamp(0.10 × height, 64, 110) CSS px; drag 1.25× that)
        const dist = 1.25 * Math.min(110, Math.max(64, 0.1 * A.height));
        const steps = Math.round(0.45 * A.fps);
        await g.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tg.x, y: tg.y, id: 1 }] });
        for (let i = 1; i <= steps; i++) {
          await g.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tg.x, y: tg.y + dist * i / steps, id: 1 }] });
          await L.advance(g, dt); wall += dt; if (rec) await rec.frame(g);
        }
        await g.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        tapped[tg.id] = true;
        say(t, 'PULL stitch ' + tg.id + ' from (' + tg.x.toFixed(0) + ',' + tg.y.toFixed(0) + ') down ' + dist.toFixed(0) + ' px');
      } else if (wall - seen[tg.id] >= A.react) {
        await L.touchTap(g, tg.x, tg.y);
        tapped[tg.id] = true;
        say(t, 'TAP stitch ' + tg.id + ' at (' + tg.x.toFixed(0) + ',' + tg.y.toFixed(0) + ')');
      }
    }
    // The butterfly carrying the gold spool (approved 06 moment).
    if (s.stitches.butterfly && s.stitches.butterfly.phase === 'fly') {
      flightSeen += dt;
      if (!butterflyShot && flightSeen >= 0.8) { butterflyShot = true; await shot('06-butterfly'); }
    }

    // Snagling: dodge by swiping up shortly after the reveal, or let it connect.
    if (s.snagling && s.snagling.state !== prevSnag) {
      say(t, 'Snagling ' + s.snagling.state + (s.snagling.result ? ' (' + s.snagling.result + ')' : ''));
      prevSnag = s.snagling.state;
      if (s.snagling.state === 'hop') { hopSeenAt = wall; jumped = false; }
      if (s.snagling.state === 'tangle') hitShotDue = wall + 0.3;
    }
    if (A.branch === 'dodge' && hopSeenAt != null && !jumped && s.snagling && s.snagling.state === 'hop' && wall - hopSeenAt >= 0.25) {
      await L.touchSwipe(g, 'up'); jumped = true; say(t, 'SWIPE up (dodge)');
    }
    if (hitShotDue != null && wall >= hitShotDue) { hitShotDue = null; await shot('04-snagged'); }

    // A dropped thread: steer into its lane (one swipe at a time).
    const dropped = Object.keys(s.items).filter((k) => k.startsWith('purl.') && s.items[k].status === 'dropped');
    if (dropped.length && s.purl.action === 'run' && wall - lastSteer > 0.4) {
      const it = s.items[dropped[0]];
      if (it.seg === s.purl.segId && it.f > s.purl.f && Math.round(it.lane) !== s.purl.lane) {
        const dir = it.lane > s.purl.lane ? 'right' : 'left';
        await L.touchSwipe(g, dir); lastSteer = wall; say(t, 'SWIPE ' + dir + ' toward dropped ' + dropped[0]);
      }
    }
    if (heldSeq.length >= 2 && s.message === 'THREAD RECOVERED' && recoveredShotDue == null) recoveredShotDue = wall + 0.25;
    if (recoveredShotDue != null && recoveredShotDue > 0 && wall >= recoveredShotDue) { recoveredShotDue = -1; await shot('05-recovery'); }

    if (s.mode === 'finished' && resultsAt == null) { resultsAt = wall; say(t, 'Purl finished: ' + JSON.stringify(s.result)); }
    if (s.mode === 'failed') { say(t, 'FAILED'); done = true; }
    if (resultsAt != null && ((s.result && !s.result.loopStillRacing) || wall - resultsAt > 30) && wall - resultsAt > 2.5) {
      await shot('07-finish');
      if (rec) { for (let i = 0; i < A.fps * 2; i++) { await L.advance(g, dt); await rec.frame(g); } }
      done = true;
    }
  }

  s = await L.snap(g);
  const report = { seed: A.seed, branch: A.branch, react: A.react, raceTime: s.time, wallSeconds: +wall.toFixed(2),
                   heldSequence: heldSeq, result: s.result, stats: s.stats, mode: s.mode, log, errors: g.errors };
  // Rule checks on the observed score sequence.
  const seq = heldSeq.join('>');
  const checks = [];
  checks.push(['finished', s.mode === 'finished']);
  if (A.branch === 'dodge') checks.push(['score 0>1>2>3 with no drop', seq === '0>1>2>3']);
  if (A.branch === 'hit') checks.push(['score 0>1>2>1>2>3 (hit then recovery)', seq === '0>1>2>1>2>3']);
  checks.push(['no page errors', g.errors.length === 0]);
  report.checks = checks;
  console.log('\nheld sequence:', seq);
  for (const [name, ok] of checks) console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (g.errors.length) console.log('errors:\n  ' + g.errors.slice(0, 10).join('\n  '));
  if (A.out) fs.writeFileSync(A.out, JSON.stringify(report, null, 2));
  if (rec) { console.log('frames:', rec.count); console.log('video:', rec.encode(A.record)); }
  await g.browser.close();
  process.exit(checks.every((c) => c[1]) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
