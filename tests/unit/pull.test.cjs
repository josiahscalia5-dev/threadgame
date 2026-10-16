/* The opening TOUCH → PULL → OPEN lesson (kit/pull-stitch/CLAUDIA-PULL-STITCH-PROMPT.txt, docs/PULL-STITCH.md):
   gesture rules, the one-time completion, and the tutorial hold that freezes the race clock and both racers. */
'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.cjs');
const { load, stepUntil, stepFor, running, types } = H;

const WW = load();
const T = WW.TUNING;
const pull = function (race, phase, amount) {
  return race.input({ type: 'pull', target: 'ribbon', phase: phase, amount: amount });
};
const atRibbon = function (seed) {
  const race = running(WW, seed == null ? 3 : seed);
  stepUntil(race, function (s) { return s.purl.waitingFor === 'ribbon'; }, 5, { tap: false });
  return race;
};
const loopPos = function (st) {
  const L = st.loop;
  return JSON.stringify([L.seg, L.f, L.distance, L.speed, L.action, L.task, st.loopTasks]);
};

describe('pull stitch: the first lesson', function () {
  test('the hold freezes the race clock and both racers until the route is ready; idle time costs nothing', function () {
    const race = atRibbon();
    const st = race.state;
    const t0 = st.time, purl0 = JSON.stringify([st.purl.seg, st.purl.f, st.purl.distance]), loop0 = loopPos(st);
    assert.deepEqual(st.tutorial, { id: 'ribbon', stage: 'touch' });
    assert.ok(t0 < 1, 'Purl arrives at the closed carpet right after GO: ' + t0);
    stepFor(race, 30);                                 // the player reads the lesson for 30 s
    assert.equal(st.time, t0, 'race clock stands still');
    assert.equal(JSON.stringify([st.purl.seg, st.purl.f, st.purl.distance]), purl0);
    assert.equal(loopPos(st), loop0, 'Loop holds his exact position, speed and task state');
    assert.equal(st.mode, 'running');
  });

  test('a grip starts only from the stop, only on the loop, and counts only downward progress', function () {
    const race = running(WW, 3);
    const st = race.state;
    stepFor(race, 0.05);
    assert.equal(st.purl.waitingFor, null, 'still arriving');
    assert.deepEqual(pull(race, 'start'), [], 'out of reach: ignored');
    stepUntil(race, function (s) { return s.purl.waitingFor === 'ribbon'; }, 5, { tap: false });
    assert.deepEqual(race.input({ type: 'pull', target: 'shortcut', phase: 'start' }), [], 'not a pull stitch');
    assert.deepEqual(race.input({ type: 'tap', target: 'ribbon' }), [], 'a tap does not open it');
    assert.equal(st.stitches.ribbon.state, 'ready');
    assert.deepEqual(pull(race, 'move', 0.5), [], 'a move without a grip does nothing');
    assert.equal(st.stitches.ribbon.pull, 0);
    assert.deepEqual(types(pull(race, 'start'), 'pull-start').length, 1);
    assert.deepEqual(pull(race, 'start'), [], 'a second grip (second finger) is ignored');
    assert.equal(st.tutorial.stage, 'pull');
    pull(race, 'move', 0.3);
    assert.equal(st.stitches.ribbon.pull, 0.3);
    pull(race, 'move', 0.1);                           // finger moved back up
    assert.equal(st.stitches.ribbon.pull, 0.3, 'pulling back never undoes progress');
    pull(race, 'move', -2);
    assert.equal(st.stitches.ribbon.pull, 0.3);
  });

  test('releasing early keeps partial progress; a new touch continues from it and completes once', function () {
    const race = atRibbon();
    const st = race.state, s = st.stitches.ribbon;
    pull(race, 'start'); pull(race, 'move', 0.45);
    const rel = types(pull(race, 'end', 0.45), 'pull-release');
    assert.equal(rel.length, 1);
    assert.equal(s.gripping, false);
    assert.equal(s.pull, 0.45);
    stepFor(race, 5);
    assert.equal(s.pull, 0.45, 'partial progress is retained while released');
    assert.equal(s.state, 'ready');
    assert.equal(st.tutorial.stage, 'pull');
    pull(race, 'start');
    pull(race, 'move', 0.3);
    assert.ok(Math.abs(s.pull - 0.75) < 1e-9, 'second gesture adds to the retained progress: ' + s.pull);
    const done = pull(race, 'move', 0.6);
    assert.deepEqual(done.map(function (e) { return e.type; }), ['stitch-tap', 'pull-complete']);
    assert.equal(s.state, 'animating');
    assert.equal(s.pull, 1);
    assert.equal(st.tutorial.stage, 'unfurl');
    // repeated touches, pulls and taps cannot start it again or create anything
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(pull(race, 'start'), []);
      assert.deepEqual(pull(race, 'move', 1), []);
      assert.deepEqual(pull(race, 'end', 1), []);
      assert.deepEqual(race.input({ type: 'tap', target: 'ribbon' }), []);
    }
    const evs = stepFor(race, T.ribbonUnfurl + T.routeSettle + 0.1);
    assert.equal(types(evs, 'stitch-open').length, 1, 'opens exactly once');
    assert.equal(st.stats.pulls, 2);
  });

  test('pause, cancel and a lost pointer release the grip safely; input while paused is ignored', function () {
    const race = atRibbon();
    const st = race.state, s = st.stitches.ribbon;
    pull(race, 'start'); pull(race, 'move', 0.2);
    race.pause('background');
    assert.equal(s.gripping, false, 'pause lets go');
    assert.deepEqual(pull(race, 'start'), []);
    assert.deepEqual(pull(race, 'move', 1), []);
    stepFor(race, 3);
    race.resume();
    assert.equal(s.pull, 0.2);
    assert.deepEqual(pull(race, 'move', 1), [], 'the old gesture is gone after a pause');
    pull(race, 'start'); pull(race, 'move', 0.1);
    assert.equal(types(pull(race, 'cancel'), 'pull-release')[0].cancelled, true);
    assert.ok(Math.abs(s.pull - 0.3) < 1e-9);
    assert.equal(s.state, 'ready');
  });

  test('opening awards nothing and grants no boost; both racers resume from their real positions', function () {
    const race = atRibbon(4);
    const st = race.state;
    const t0 = st.time, loopF = st.loop.f, loopSpeed = st.loop.speed, items0 = JSON.stringify(st.items);
    stepFor(race, 8);                                  // the player takes their time
    H.activate(race, 'ribbon');
    const evs = stepUntil(race, function (s) { return s.tutorial === null; }, 5, { tap: false });
    assert.equal(types(evs, 'pickup').length, 0);
    assert.equal(st.held.purl, 0, 'still 0/3 until Purl reaches the coral spool');
    assert.equal(JSON.stringify(st.items), items0, 'no item changed, none created');
    assert.equal(Object.keys(st.items).length, 6);
    assert.equal(st.time, t0, 'the whole lesson took no race time');
    assert.equal(st.loop.f, loopF);
    assert.equal(st.objective, 'Collect the coral thread');
    let maxSpeed = 0;
    stepFor(race, 4, { each: function (r) { maxSpeed = Math.max(maxSpeed, r.state.purl.speed); } });
    assert.ok(maxSpeed <= T.purlSpeed + 1e-9, 'no speed boost from the opening: ' + maxSpeed);
    assert.ok(st.loop.f > loopF, 'Loop races on');
    assert.ok(Math.abs(st.loop.speed - loopSpeed) < 3, 'Loop resumes at his own pace');
    assert.ok(st.time > t0 + 3.9, 'race clock runs again');
    stepUntil(race, function (s) { return s.held.purl === 1; }, 40);
    assert.equal(st.items['purl.coral'].status, 'held', 'the coral spool is collected physically, 0/3 → 1/3');
  });

  test('a retry starts a fresh lesson', function () {
    const race = atRibbon();
    pull(race, 'start'); pull(race, 'move', 0.6);
    const again = atRibbon();
    assert.equal(again.state.stitches.ribbon.pull, 0);
    assert.equal(again.state.stitches.ribbon.state, 'ready');
    assert.deepEqual(again.state.tutorial, { id: 'ribbon', stage: 'touch' });
  });
});
