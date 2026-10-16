/* Milestone-1 smoke tests: the race API, the full headless route for both racers, determinism. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, newRace, GAME } = require('./load.cjs');
const { runBot } = require('./bot.cjs');

const DT = 1 / 60;
function stepFor(race, seconds) {
  const out = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) out.push.apply(out, race.step(DT));
  return out;
}

test('createRace exposes the §7.1 + §12 state shape', function () {
  const WW = load();
  const race = newRace(WW, 3);
  const st = race.state;
  for (const k of ['mode', 'paused', 'pauseReason', 'time', 'countdown', 'seed', 'purl', 'loop', 'items', 'held',
    'stitches', 'loopTasks', 'snagling', 'gate', 'objective', 'phase', 'message', 'hint', 'transition', 'result', 'stats']) {
    assert.ok(k in st, 'state.' + k);
  }
  for (const k of ['seg', 'segId', 'f', 'lane', 'laneX', 'jumpT', 'jumpH', 'speed', 'action', 'airborne',
    'immuneUntil', 'tangledUntil', 'distance', 'finishTime', 'rank']) assert.ok(k in st.purl, 'purl.' + k);
  for (const k of ['seg', 'segId', 'f', 'laneX', 'jumpH', 'speed', 'action', 'task', 'distance', 'finishTime', 'rank']) {
    assert.ok(k in st.loop, 'loop.' + k);
  }
  for (const k of ['state', 't', 'targetLane', 'contactF', 'result', 'pass', 'armed', 'contactConsumed']) {
    assert.ok(k in st.snagling, 'snagling.' + k);
  }
  assert.deepEqual(Object.keys(st.items).sort(),
    ['loop.coral', 'loop.gold', 'loop.teal', 'purl.coral', 'purl.gold', 'purl.teal']);
  for (const it of Object.values(st.items)) {
    assert.equal(it.status, 'uncollected');
    assert.equal(typeof it.seg, 'string');
    assert.ok(it.f > 0 && it.f < 1);
    assert.equal(typeof it.lane, 'number');
    assert.equal(it.available, it.color !== 'gold');
  }
  assert.equal(st.items['purl.teal'].seg, 'tassels');      // never the p02 preview
  assert.equal(st.stitches.tassels.lifts.length, 3);
  assert.equal(st.stitches.butterfly.phase, 'dormant');
  assert.equal(st.mode, 'intro');
});

test('countdown → running; nothing moves before GO; time starts at GO', function () {
  const WW = load();
  const race = newRace(WW, 3);
  const st = race.state;
  stepFor(race, 1);
  assert.equal(st.mode, 'intro');
  race.start();
  assert.equal(st.mode, 'countdown');
  assert.equal(st.countdown, WW.TUNING.countdown);
  const evs = stepFor(race, WW.TUNING.countdown - 0.05);
  assert.equal(st.mode, 'countdown');
  assert.equal(st.time, 0);
  assert.equal(st.purl.distance + st.loop.distance, 0);
  assert.equal(evs.length, 0);
  assert.deepEqual(stepFor(race, 0.1).filter(function (e) { return e.type === 'go'; }), [{ type: 'go' }]);
  assert.equal(st.mode, 'running');
});

test('a full headless race: both racers run the whole route, collect 3/3 and finish with true ranks', function () {
  const run = runBot({ seed: 1, react: 1.0 });
  const st = run.race.state;
  assert.equal(run.mode, 'finished');
  assert.deepEqual(run.held, { purl: 3, loop: 3 });
  assert.ok(run.purlTime > 60 && run.purlTime < 160, 'purl time ' + run.purlTime);
  assert.ok(run.loopTime > 60 && run.loopTime < 160, 'loop time ' + run.loopTime);
  const r = run.result;
  assert.equal(r.loopStillRacing, false);
  assert.deepEqual([r.purlRank, r.loopRank].sort(), [1, 2]);
  assert.equal(r.winner, r.purlRank === 1 ? 'purl' : 'loop');
  assert.equal(r.purlRank === 1, r.purlTime <= r.loopTime);
  const segs = function (who) {
    return run.timeline.filter(function (x) { return x.who === who && /^enter /.test(x.what); })
      .map(function (x) { return x.what.slice(6); });
  };
  const ids = st.purl && run.race.info.route.map(function (s) { return s.id; });
  assert.deepEqual(segs('purl'), ids.slice(1));
  assert.deepEqual(segs('loop'), ids.slice(1));
  const picks = run.timeline.filter(function (x) { return x.who === 'purl' && /^pickup/.test(x.what); })
    .map(function (x) { return x.what; });
  assert.deepEqual(picks, ['pickup purl.coral → 1/3', 'pickup purl.teal → 2/3', 'pickup purl.gold → 3/3']);
  const opens = run.timeline.filter(function (x) { return /^open /.test(x.what); }).map(function (x) { return x.what; });
  assert.deepEqual(opens, ['open ribbon (held 0/3)', 'open shortcut (held 1/3)', 'open tassels (held 1/3)',
    'open butterfly (held 2/3)']);
  for (const id of Object.keys(st.stitches)) assert.equal(st.stitches[id].state, 'open');
  assert.equal(st.gate.state, 'open');
  for (const k of Object.keys(st.loopTasks)) assert.equal(st.loopTasks[k].state, 'done', k);
});

test('the same seed and inputs give the same race; Loop does not depend on the player', function () {
  const WW = load();
  const a = runBot({ seed: 11, react: 1.0, WW: WW });
  const b = runBot({ seed: 11, react: 1.0, WW: WW });
  assert.deepEqual(a.timeline, b.timeline);
  const c = runBot({ seed: 11, react: 2.5, WW: WW });
  const loopOnly = function (run) {
    return run.timeline.filter(function (x) { return x.who === 'loop'; });
  };
  assert.deepEqual(loopOnly(a), loopOnly(c));
  assert.notEqual(a.purlTime, c.purlTime);
  const d = runBot({ seed: 12, react: 1.0, WW: WW });
  assert.notEqual(a.loopTime, d.loopTime);
});

test('taps never move Purl; swipes never trigger stitches; early taps are ignored', function () {
  const WW = load();
  const race = newRace(WW, 5);
  const st = race.state;
  race.start();
  stepFor(race, WW.TUNING.countdown + 1.5);
  assert.equal(st.purl.action, 'wait');
  assert.equal(st.stitches.ribbon.state, 'ready');
  const f = st.purl.f;
  for (const dir of ['left', 'right', 'up', 'down']) race.input({ type: 'swipe', dir: dir });
  stepFor(race, 1);
  assert.equal(st.stitches.ribbon.state, 'ready');
  assert.equal(st.purl.f, f);
  assert.deepEqual(race.input({ type: 'tap', target: 'shortcut' }), []);   // not ready yet: ignored
  assert.equal(st.stitches.shortcut.state, 'idle');
  assert.deepEqual(race.input({ type: 'tap', target: 'ribbon' }), [{ type: 'stitch-tap', id: 'ribbon' }]);
  assert.deepEqual(race.input({ type: 'tap', target: 'ribbon' }), []);     // no double activation
  assert.equal(st.purl.f, f);
  stepFor(race, WW.TUNING.ribbonUnfurl + WW.TUNING.routeSettle + 0.5);
  assert.ok(st.purl.f > f);
});

test('the simulation never reads the wall clock or Math.random', function () {
  for (const f of ['inventory.js', 'stitches.js', 'snagling.js', 'loop-ai.js', 'race.js']) {
    const src = fs.readFileSync(path.join(GAME, 'src/sim', f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|Date\.|Date\(|performance\.now|setTimeout|setInterval|document\.|window\./.test(src), f);
  }
});
