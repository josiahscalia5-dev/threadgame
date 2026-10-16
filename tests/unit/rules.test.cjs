/* Rule tests for docs/ARCHITECTURE.md §7 (+ §12 addenda). Each test names the rule it checks. */
'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.cjs');
const { load, newRace, DT, stepUntil, stepFor, running, toLanding, toReveal, types, swipe } = H;

const WW = load();
const T = WW.TUNING;
const close = function (a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b); };

describe('§7.2 movement and input', function () {
  test('stops clamp f until the stitch is open + routeSettle (never auto-run into the gap)', function () {
    const race = running(WW, 2);
    const st = race.state, stopF = st.stitches.ribbon.f;
    stepFor(race, 20);
    assert.equal(st.purl.action, 'wait');
    assert.equal(st.purl.waitingFor, 'ribbon');
    assert.ok(st.purl.f <= stopF + 1e-9);
    assert.ok(st.loop.distance > 50, 'Loop keeps racing while Purl waits');
    race.input({ type: 'tap', target: 'ribbon' });
    stepUntil(race, function (s) { return s.stitches.ribbon.state === 'open'; }, 5, { tap: false });
    stepFor(race, T.routeSettle - 0.05);
    assert.ok(st.purl.f <= stopF + 1e-9, 'still settling');
    stepFor(race, 0.3);
    assert.ok(st.purl.f > stopF, 'moving after routeSettle');
  });

  test('swipes change the lane by one where the path has lanes; laneX follows over laneChangeTime', function () {
    const race = running(WW, 2);
    const st = race.state;
    assert.deepEqual(swipe(race, 'right'), [{ type: 'lane', who: 'purl', lane: 1 }]);
    assert.deepEqual(swipe(race, 'right'), [], 'already at the edge lane');
    stepFor(race, T.laneChangeTime / 2);
    close(st.purl.laneX, 0.5, 0.05, 'half way');
    stepFor(race, T.laneChangeTime / 2 + DT);
    assert.equal(st.purl.laneX, 1);
    assert.deepEqual(swipe(race, 'left'), [{ type: 'lane', who: 'purl', lane: 0 }]);
    assert.deepEqual(swipe(race, 'left'), [{ type: 'lane', who: 'purl', lane: -1 }]);
    assert.deepEqual(swipe(race, 'down'), [], 'swipe down does nothing');
  });

  test('single-file stretches (lane spacing < 20 px) ease lane/laneX to 0 and refuse lane swipes', function () {
    const race = running(WW, 2);
    const st = race.state;
    race.debug.openStitch('ribbon');
    swipe(race, 'right');
    stepFor(race, 0.5);
    assert.equal(st.purl.laneX, 1);
    race.debug.teleport('purl', 'ribbon', 0.5);   // p01 upper band: lane spacing 0
    stepFor(race, 0.1);
    assert.equal(st.purl.lane, 0);
    stepFor(race, T.laneChangeTime);
    assert.equal(st.purl.laneX, 0);
    assert.deepEqual(swipe(race, 'left'), []);
  });

  test('swipe up jumps with height sin(πt/jumpTime); a swipe within inputBufferTime of landing is replayed', function () {
    const race = running(WW, 2);
    const st = race.state;
    assert.deepEqual(swipe(race, 'up'), [{ type: 'jump', who: 'purl' }]);
    stepFor(race, T.jumpTime / 2);
    close(st.purl.jumpH, 1, 0.01, 'apex');
    assert.equal(st.purl.airborne, true);
    assert.deepEqual(swipe(race, 'up'), [], 'too early to buffer');
    assert.equal(st.purl.jumpBuffered, false);
    stepFor(race, T.jumpTime / 2 - T.inputBufferTime + 0.05);
    swipe(race, 'up');
    assert.equal(st.purl.jumpBuffered, true);
    const evs = stepFor(race, T.inputBufferTime);
    assert.equal(types(evs, 'jump').length, 1, 'buffered jump starts on landing');
    assert.equal(st.purl.airborne, true);
    stepFor(race, T.jumpTime + DT);
    assert.equal(st.purl.airborne, false);
    assert.equal(st.purl.jumpH, 0);
  });
});

describe('§7.3 stitch interactions', function () {
  test('ready only on its segment (f ≥ readyF) after GO; taps during countdown or before ready are ignored', function () {
    const race = newRace(WW, 2);
    const st = race.state;
    race.start();
    stepFor(race, 1);
    assert.deepEqual(race.input({ type: 'tap', target: 'ribbon' }), []);
    assert.equal(st.stitches.ribbon.state, 'idle');
    stepFor(race, T.countdown);
    assert.equal(st.stitches.ribbon.state, 'ready');
    for (const id of ['shortcut', 'tassels', 'butterfly']) {
      assert.deepEqual(race.input({ type: 'tap', target: id }), []);
      assert.equal(st.stitches[id].state, 'idle');
    }
    assert.equal(st.stats.taps, 3, 'early taps are counted but harmless');
  });

  test('ribbon unfurls in ribbonUnfurl s; shortcut unrolls in shortcutUnroll s with no inventory change', function () {
    const race = running(WW, 2);
    const st = race.state;
    const opened = {};
    stepUntil(race, function (s, evs) {
      evs.forEach(function (e) { if (e.type === 'stitch-open') opened[e.id] = { t: s.time, held: s.held.purl }; });
      return !!opened.shortcut;
    }, 100);
    close(opened.ribbon.t - st.stitches.ribbon.tappedAt, T.ribbonUnfurl, DT + 1e-9, 'ribbon');
    close(opened.shortcut.t - st.stitches.shortcut.tappedAt, T.shortcutUnroll, DT + 1e-9, 'shortcut');
    assert.equal(opened.shortcut.held, 1);
    assert.equal(st.held.purl, 1);
  });

  test('tassels lift in a staggered sequence and open only when all three are clear; Purl waits until then', function () {
    const race = running(WW, 2);
    const st = race.state, s = st.stitches.tassels;
    stepUntil(race, function () { return s.state === 'animating'; }, 100);
    const t0 = s.tappedAt;
    const seen = [];
    stepUntil(race, function (x) {
      const e = x.time - t0;
      if (s.state === 'animating') {
        for (let i = 0; i < 3; i++) close(s.lifts[i], Math.min(1, Math.max(0, (e - i * T.tasselStagger) / T.tasselLift)), 1e-6);
        assert.ok(x.purl.f <= s.f + 1e-9, 'Purl under the tassels before they clear');
        seen.push(s.lifts.slice());
      }
      return s.state === 'open';
    }, 5, { tap: false });
    assert.ok(seen.some(function (l) { return l[0] > 0.5 && l[2] === 0; }), 'first lifts before the third starts');
    close(st.time - t0, 2 * T.tasselStagger + T.tasselLift, DT + 1e-9);
    assert.deepEqual(s.lifts, [1, 1, 1]);
    assert.ok(st.purl.f <= s.f + 1e-9);
  });

  test('butterfly: emerge → fly → place → done; gold becomes available only at the end of place; 3/3 only on pickup', function () {
    const race = running(WW, 2);
    const st = race.state, b = st.stitches.butterfly, gold = st.items['purl.gold'];
    stepUntil(race, function () { return b.state === 'animating'; }, 200);
    const phases = [];
    stepUntil(race, function (x) {
      if (phases[phases.length - 1] !== b.phase) phases.push(b.phase);
      if (b.state === 'animating') {
        assert.equal(gold.available, false);
        assert.equal(x.held.purl, 2);
        assert.ok(x.purl.f <= b.f + 1e-9, 'Purl waits through the delivery');
      }
      return b.state === 'open';
    }, 10, { tap: false });
    assert.deepEqual(phases, ['emerge', 'fly', 'place', 'done']);
    close(st.time - b.tappedAt, T.butterflyEmerge + T.butterflyFly + T.butterflyPlace, DT + 1e-9);
    assert.equal(gold.available, true);
    assert.equal(gold.status, 'uncollected');
    assert.equal(st.held.purl, 2);
    const evs = stepUntil(race, function (x) { return x.held.purl === 3; }, 20);
    assert.deepEqual(types(evs, 'pickup').map(function (e) { return e.item; }), ['purl.gold']);
    assert.ok(gold.f > b.f, 'delivered ahead of the stop on Purl\'s path');
  });

  test('taps while animating/open do nothing; opened routes never close and tassels never lower', function () {
    const race = running(WW, 2);
    const st = race.state;
    stepUntil(race, function (s) { return s.stitches.ribbon.state === 'animating'; }, 5);
    assert.deepEqual(race.input({ type: 'tap', target: 'ribbon' }), []);
    stepUntil(race, function (s) {
      for (const id of Object.keys(s.stitches)) {
        if (s.stitches[id].openedAt !== null) assert.equal(s.stitches[id].state, 'open', id);
      }
      if (s.stitches.tassels.state === 'open') assert.deepEqual(s.stitches.tassels.lifts, [1, 1, 1]);
      return s.mode === 'finished';
    }, 300, { each: function (r) { return r.input({ type: 'tap', target: 'ribbon' }); } });
    for (const id of Object.keys(st.stitches)) assert.equal(st.stitches[id].state, 'open');
  });
});

describe('§7.4 inventory', function () {
  test('normal pickups are lane-agnostic, happen once, and held counts are derived from statuses', function () {
    const race = running(WW, 2);
    const st = race.state;
    race.debug.setItem('purl.coral', { f: 0.06 });          // move the coral onto the laned carpet
    race.debug.openStitch('ribbon');
    swipe(race, 'left');
    const evs = stepUntil(race, function (s) { return s.purl.f > 0.12; }, 10, { tap: false });
    assert.ok(st.purl.laneX < -0.9);
    assert.deepEqual(types(evs, 'pickup').map(function (e) { return e.item; }), ['purl.coral']);
    assert.equal(st.held.purl, 1);
    race.debug.teleport('purl', 'ribbon', 0.02);             // run over the same spot again
    const again = stepUntil(race, function (s) { return s.purl.f > 0.12; }, 10, { tap: false });
    assert.equal(types(again, 'pickup').length, 0, 'a held item has no world visual');
    assert.equal(st.held.purl, 1);
    const count = Object.values(st.items).filter(function (it) { return it.owner === 'purl' && it.status === 'held'; }).length;
    assert.equal(st.held.purl, count);
  });

  test('Purl never touches loop.* items and Loop never touches purl.* items', function () {
    const race = running(WW, 2);
    const st = race.state;
    race.debug.openStitch('ribbon');
    race.debug.setItem('loop.coral', { seg: 'ribbon', f: 0.1 });   // right on Purl's path (and Loop's f)
    race.debug.setItem('purl.coral', { f: 0.3 });
    stepUntil(race, function (s) { return s.purl.f > 0.35 && s.loop.f > 0.35; }, 30);
    assert.equal(st.items['purl.coral'].status, 'held');
    assert.equal(st.items['loop.coral'].status, 'held', 'Loop collected his own at f 0.1 on his path');
    assert.equal(st.held.purl, 1);
    assert.equal(st.held.loop, 1);
    const race2 = running(WW, 2);
    race2.debug.setItem('purl.teal', { seg: 'ribbon', f: 0.05 });  // on Loop's ribbon f, never his to take
    stepUntil(race2, function (s) { return s.loop.f > 0.2; }, 30);
    assert.equal(race2.state.items['purl.teal'].status, 'uncollected');
    assert.equal(race2.state.held.loop, 0);
  });

  test('a dropped thread is recovered only from its lane and comes back as the same ID', function () {
    const race = toLanding(WW, 2);
    const st = race.state;
    const teal = st.items['purl.teal'];
    race.debug.setItem('purl.teal', { status: 'dropped', f: 0.2, lane: 1 });
    assert.equal(st.held.purl, 1);
    stepUntil(race, function (s) { return s.purl.f > 0.3; }, 10, { tap: false, each: function (r) {
      if (r.state.snagling.state === 'hop') return swipe(r, 'up');
    } });
    assert.equal(teal.status, 'dropped', 'passed in lane 0: not recovered');
    race.debug.teleport('purl', 'landing', 0.1);
    swipe(race, 'right');
    const evs = stepUntil(race, function (s) { return s.purl.f > 0.3; }, 10, { tap: false });
    assert.deepEqual(types(evs, 'recover'), [{ type: 'recover', item: 'purl.teal' }]);
    assert.equal(st.items['purl.teal'], teal);
    assert.equal(teal.status, 'held');
    assert.equal(st.held.purl, 2);
    assert.equal(st.stats.recoveries, 1);
    assert.equal(Object.keys(st.items).length, 6);
  });
});

describe('§7.5 Snagling', function () {
  test('reveals at the reveal f with targetLane = purl.lane, then hop → retreat → done (§12.2 timings)', function () {
    const race = toLanding(WW, 3);
    const st = race.state, s = st.snagling, seg = race.info.route[st.purl.seg];
    assert.equal(s.state, 'concealed');
    assert.equal(s.armed, true);
    swipe(race, 'left');
    const evs = toReveal(race);
    assert.equal(types(evs, 'reveal').length, 1);
    assert.ok(st.purl.f >= seg.reveal && st.purl.f < seg.reveal + 0.01);
    assert.equal(s.targetLane, -1);
    assert.equal(s.state, 'hop');
    assert.equal(s.armed, false);
    close(s.contactF, st.purl.f + st.purl.speed * T.snagRevealToContact / seg.length, 1e-9);
    swipe(race, 'right');                                     // leave lane -1 in time
    const rest = stepUntil(race, function (x) { return x.snagling.state === 'done'; }, 5, { tap: false });
    assert.deepEqual(types(rest, 'dodge'), [{ type: 'dodge' }]);
    assert.equal(s.result, 'dodge');
    close(st.time - (rest.length ? 0 : 0), st.time, 0);
  });

  test('no reveal while a stitch lock holds Purl; it reveals once the stop is passable', function () {
    const level = JSON.parse(JSON.stringify(WW.LEVEL));
    const plates = JSON.parse(JSON.stringify(WW.PLATES));
    const reveal = plates.p04.purl.events.filter(function (e) { return e.type === 'reveal'; })[0].f;
    level.stitches.lockTest = { seg: 'landing', kind: 'ribbon' };
    plates.p04.purl.events.push({ type: 'stop', stitch: 'lockTest', f: reveal + 0.02, readyF: 0 });
    const race = WW.sim.createRace({ seed: 3, level: level, plates: plates, tuning: WW.TUNING });
    race.start();
    stepUntil(race, function (s) { return s.purl.segId === 'landing'; }, 200, { each: function (r) {
      const st = r.state;
      ['ribbon', 'shortcut', 'tassels'].forEach(function (id) {
        if (st.stitches[id].state === 'ready') r.input({ type: 'tap', target: id });
      });
    } });
    const st = race.state;
    stepFor(race, 6);
    assert.equal(st.purl.waitingFor, 'lockTest');
    assert.ok(st.purl.f >= reveal);
    assert.equal(st.snagling.state, 'concealed', 'no attack during a stitch lock');
    race.input({ type: 'tap', target: 'lockTest' });
    const evs = stepUntil(race, function (s, e) { return e.some(function (x) { return x.type === 'reveal'; }); }, 5, { tap: false });
    assert.ok(st.time >= st.stitches.lockTest.openedAt + T.routeSettle - 1e-9);
    assert.equal(types(evs, 'reveal').length, 1);
  });

  test('contact rule: lane distance < 0.55 and jumpH < jumpAirborneAbove; jump or lane change 0.25–0.35 s after the reveal dodges', function () {
    const outcome = function (action, delay) {
      const race = toLanding(WW, 4);
      toReveal(race);
      if (action !== 'stay') stepFor(race, delay);
      if (action === 'jump') swipe(race, 'up');
      if (action === 'lane') swipe(race, 'right');
      stepUntil(race, function (s) { return s.snagling.state !== 'hop'; }, 2, { tap: false });
      return race.state.snagling.result;
    };
    assert.equal(outcome('stay'), 'hit');
    for (const d of [0.25, 0.3, 0.35]) {
      assert.equal(outcome('jump', d), 'dodge', 'jump at ' + d);
      assert.equal(outcome('lane', d), 'dodge', 'lane at ' + d);
    }
    assert.equal(outcome('jump', 0.6), 'hit', 'too late');
    assert.equal(outcome('lane', 0.5), 'hit', 'too late');
  });

  test('one damage per attack; contact during hitImmunity is ignored (no drop, no fail)', function () {
    const race = toLanding(WW, 4);
    const st = race.state;
    toReveal(race);
    const evs = stepUntil(race, function (s) { return s.snagling.state !== 'hop'; }, 2, { tap: false });
    assert.equal(types(evs, 'hit').length, 1);
    assert.equal(types(evs, 'drop').length, 1);
    assert.equal(st.held.purl, 1);
    close(st.purl.immuneUntil - st.time, T.hitImmunity - (st.time - st.purl.immuneUntil + T.hitImmunity), 1);
    race.debug.forceReveal();                                 // a second attack inside the immunity
    const again = stepUntil(race, function (s) { return s.snagling.state !== 'hop'; }, 2, { tap: false });
    assert.ok(st.time < st.purl.immuneUntil);
    assert.equal(types(again, 'immune-ignored').length, 1);
    assert.equal(types(again, 'hit').length + types(again, 'drop').length, 0);
    assert.equal(st.snagling.result, 'immune');
    assert.equal(st.held.purl, 1);
    assert.equal(st.stats.hits, 1);
  });

  test('a hit drops the most recent held ID ahead/right on laned carpet, tangles (speed 0) then slows, says SNAGGED!', function () {
    const race = toLanding(WW, 4);
    const st = race.state, seg = race.info.route[st.purl.seg];
    assert.ok(st.items['purl.teal'].heldSeq > st.items['purl.coral'].heldSeq);
    toReveal(race);
    stepUntil(race, function (s, e) { return e.some(function (x) { return x.type === 'hit'; }); }, 2, { tap: false });
    const teal = st.items['purl.teal'], f = st.purl.f;
    assert.equal(teal.status, 'dropped');
    assert.equal(st.items['purl.coral'].status, 'held');
    assert.equal(teal.lane, 1);
    close(teal.f, f + T.dropAheadF, 0.011);
    assert.ok(teal.f <= seg.exit - 0.08);
    assert.ok(WW.path.sample(seg.path, teal.f).lane >= 20, 'lane +1 exists there');
    assert.equal(teal.seg, 'landing');
    assert.deepEqual([st.message.text, st.message.kind], ['SNAGGED!', 'hit']);
    assert.equal(st.objective, 'GET YOUR THREAD BACK');
    stepFor(race, T.snagTangle - 0.05);
    assert.equal(st.purl.action, 'tangled');
    assert.equal(st.purl.f, f, 'Snagling never moves Purl');
    stepFor(race, 0.5);
    assert.ok(st.purl.f > f);
    assert.ok(st.purl.speed <= T.purlSpeed * T.slowAfterHit + 1e-9, 'slowAfterHit');
    stepFor(race, T.slowAfterHitTime + 0.6);
    assert.ok(st.purl.speed > T.purlSpeed * T.slowAfterHit + 0.1);
  });

  test('in lane +1 the drop goes to lane 0; drops keep dropSpacingF apart', function () {
    const race = toLanding(WW, 4);
    const st = race.state;
    race.debug.setItem('purl.coral', { status: 'dropped', f: 0.43, lane: 0 });
    swipe(race, 'right');
    toReveal(race);
    stepUntil(race, function (s, e) { return e.some(function (x) { return x.type === 'hit'; }); }, 2, { tap: false });
    const teal = st.items['purl.teal'], coral = st.items['purl.coral'];
    assert.equal(teal.lane, 0);
    assert.ok(Math.abs(teal.f - coral.f) >= T.dropSpacingF - 1e-9);
  });

  test('1 → 0 is not a fail; a valid hit at 0 fails after failDelay', function () {
    const race = toLanding(WW, 4);
    const st = race.state;
    race.debug.setItem('purl.coral', { status: 'dropped', f: 0.9, lane: 0 });
    assert.equal(st.held.purl, 1);
    toReveal(race);
    stepUntil(race, function (s) { return s.snagling.state !== 'hop'; }, 2, { tap: false });
    assert.equal(st.held.purl, 0);
    assert.equal(st.mode, 'running');
    stepFor(race, 3);
    assert.equal(st.mode, 'running', '0/3 keeps racing');
    race.debug.setImmunity(0);
    race.debug.forceReveal();
    let failT = null;
    const evs = stepUntil(race, function (s, e) {
      if (e.some(function (x) { return x.type === 'hit'; })) failT = s.time;
      return s.mode === 'failed';
    }, 5, { tap: false });
    assert.equal(types(evs, 'fail').length, 1);
    close(st.time - failT, T.failDelay, DT + 1e-9);
    assert.equal(st.purl.action, 'failed');
    const snap = JSON.stringify(st);
    assert.deepEqual(race.step(DT), []);
    assert.equal(JSON.stringify(st), snap, 'a failed race is frozen');
  });

  test('a dodge keeps the count and shows no message; stats count it', function () {
    const race = toLanding(WW, 5);
    const st = race.state;
    toReveal(race);
    stepFor(race, 0.3);
    swipe(race, 'up');
    const evs = stepUntil(race, function (s) { return s.snagling.state === 'done'; }, 4, { tap: false });
    assert.deepEqual(types(evs, 'dodge'), [{ type: 'dodge' }]);
    assert.equal(types(evs, 'drop').length + types(evs, 'hit').length, 0);
    assert.equal(st.held.purl, 2);
    assert.equal(st.message, null);
    assert.deepEqual([st.stats.dodges, st.stats.hits], [1, 0]);
  });

  test('recovery loop: leaving the landing with a dropped thread loops back to loopReturn and re-arms Snagling', function () {
    const race = toLanding(WW, 6);
    const st = race.state, seg = race.info.route[st.purl.seg];
    toReveal(race);
    stepUntil(race, function (s) { return s.purl.action === 'looping'; }, 20, { tap: false });
    assert.equal(st.transition.kind, 'loop');
    assert.deepEqual([st.transition.from, st.transition.to], ['landing', 'landing']);
    assert.equal(st.items['purl.teal'].status, 'dropped', 'missed in lane 0');
    stepUntil(race, function (s) { return !s.transition; }, T.recoveryLoopTime + 0.1, { tap: false });
    close(st.purl.f, seg.loopReturn, 0.01);
    assert.equal(st.purl.segId, 'landing');
    assert.deepEqual([st.snagling.state, st.snagling.armed, st.snagling.pass], ['concealed', true, 2]);
    toReveal(race);
    stepFor(race, 0.3);
    swipe(race, 'up');
    stepFor(race, 0.8);
    swipe(race, 'right');
    const evs = stepUntil(race, function (s) { return s.purl.segId === 'c-landing'; }, 20, { tap: false });
    assert.deepEqual(types(evs, 'recover'), [{ type: 'recover', item: 'purl.teal' }]);
    assert.equal(st.held.purl, 2);
    const fin = stepUntil(race, function (s) { return s.mode === 'finished'; }, 120);
    assert.equal(types(fin, 'finish')[0].who, 'purl');
    assert.equal(st.held.purl, 3);
  });
});

describe('§7.6 finish and gate fallback', function () {
  test('finish needs all three; rank 1 before Loop; gate opens; damage stops after finishing', function () {
    const race = running(WW, 7);
    const st = race.state;
    race.debug.setLoopForm(0.5);                              // test helper only: Loop far behind
    const evs = stepUntil(race, function (s) { return s.purl.finishTime !== null; }, 300);
    assert.equal(st.held.purl, 3);
    assert.equal(st.purl.rank, 1);
    assert.equal(st.mode, 'finished');
    assert.equal(types(evs, 'gate-open').length, 1);
    assert.equal(st.gate.state, 'opening');
    assert.equal(st.result.loopStillRacing, true);
    assert.equal(st.objective, 'LEVEL 1 COMPLETE');
    assert.equal(race.debug.forceReveal(), false, 'no attacks once finished');
    stepFor(race, T.gateOpenTime || 1.3);
    assert.equal(st.gate.state, 'open');
  });

  test('Loop finishing first ranks Purl 2nd; result fills in true ranks and times', function () {
    const race = running(WW, 7);
    const st = race.state;
    race.debug.setLoopForm(1.5);                              // test helper only: Loop far ahead
    stepUntil(race, function (s) { return s.mode === 'finished'; }, 300);
    assert.equal(st.loop.rank, 1);
    assert.equal(st.purl.rank, 2);
    assert.deepEqual([st.result.winner, st.result.purlRank, st.result.loopRank, st.result.loopStillRacing],
      ['loop', 2, 1, false]);
    assert.ok(st.result.loopTime < st.result.purlTime);
  });

  test('finishWaitForLoop: loopStillRacing stays true until Loop finishes or the wait runs out', function () {
    const race = running(WW, 7);
    const st = race.state;
    race.debug.setLoopForm(0.3);
    stepUntil(race, function (s) { return s.mode === 'finished'; }, 300);
    const pt = st.purl.finishTime;
    stepFor(race, T.finishWaitForLoop - 1);
    assert.equal(st.result.loopStillRacing, true);
    stepFor(race, 1.5);
    assert.equal(st.result.loopStillRacing, false);
    assert.deepEqual([st.result.loopTime, st.result.loopRank, st.result.winner], [null, null, 'purl']);
    const t = st.time;
    stepFor(race, 2);
    assert.equal(st.time, t, 'the race clock stops once the result is final');
    close(t - pt, T.finishWaitForLoop, 0.05);
  });

  test('reaching the finish incomplete: gate-blocked, "A THREAD IS MISSING", return to the earliest missing item', function () {
    const race = running(WW, 8);
    const st = race.state;
    stepUntil(race, function (s) { return s.purl.segId === 'c-tapestry'; }, 300);
    race.debug.setItem('purl.teal', { status: 'dropped', seg: 'landing', f: 0.5, lane: 0 });
    const evs = stepUntil(race, function (s) { return s.purl.action === 'returning'; }, 30);
    assert.equal(types(evs, 'gate-blocked').length, 1);
    assert.equal(st.message.text, 'A THREAD IS MISSING');
    assert.equal(st.purl.finishTime, null);
    assert.equal(st.gate.state, 'closed');
    assert.deepEqual([st.transition.kind, st.transition.from, st.transition.to], ['return', 'finish', 'landing']);
    stepUntil(race, function (s) { return !s.transition; }, 5);
    assert.equal(st.purl.segId, 'landing');
    close(st.purl.f, race.info.route[st.purl.seg].loopReturn, 0.01);
    assert.equal(st.snagling.armed || st.snagling.state !== 'done', true, 'a new pass re-arms Snagling');
    const fin = stepUntil(race, function (s) { return s.mode === 'finished'; }, 120);
    assert.deepEqual(types(fin, 'recover'), [{ type: 'recover', item: 'purl.teal' }]);
    assert.equal(st.held.purl, 3);
    assert.ok(st.purl.finishTime > 0);
  });

  test('the return goes to the segment entry when the missing item is not on the landing', function () {
    const race = running(WW, 8);
    const st = race.state;
    stepUntil(race, function (s) { return s.purl.segId === 'c-tapestry'; }, 300);
    race.debug.setItem('purl.coral', { status: 'uncollected' });
    stepUntil(race, function (s) { return s.purl.action === 'returning'; }, 30);
    assert.equal(st.transition.to, 'ribbon');
    stepUntil(race, function (s) { return !s.transition; }, 5);
    assert.deepEqual([st.purl.segId, st.purl.f], ['ribbon', 0]);
    stepUntil(race, function (s) { return s.mode === 'finished'; }, 300);
    assert.equal(st.held.purl, 3);
  });
});

describe('§7.7 Loop', function () {
  const plans = [];
  for (let seed = 1; seed <= 60; seed++) plans.push({ seed: seed, plan: newRace(WW, seed).info.plan });

  test('per-race form and bypass extra stay inside their symmetric ranges; per-segment jitter ≤ loopSpeedJitter', function () {
    const L = WW.LEVEL.loop;
    let lo = Infinity, hi = -Infinity;
    plans.forEach(function (p) {
      assert.ok(p.plan.form >= L.form[0] && p.plan.form <= L.form[1]);
      lo = Math.min(lo, p.plan.form); hi = Math.max(hi, p.plan.form);
      p.plan.segs.forEach(function (j) { assert.ok(Math.abs(j - 1) <= T.loopSpeedJitter + 1e-12); });
      const bp = p.plan.tasks['shortcut:bypass'];
      const extra = WW.PLATES.p02.loop.events.filter(function (e) { return e.kind === 'bypass'; })[0].extra;
      assert.ok(Math.abs(bp.extra / extra - 1) <= L.bypassJitter + 1e-12);
    });
    assert.ok(lo < 0.95 && hi > 1.05, 'both faster and slower forms occur');
  });

  test('stitch task: stops at the task f, reacts (+ hesitation), performs dur + routeSettle, then continues', function () {
    const pick = plans.filter(function (p) { return p.plan.tasks['tassels:stitch'].hesitate > 0; })[0];
    const plain = plans.filter(function (p) { return p.plan.tasks['tassels:stitch'].hesitate === 0; })[0];
    assert.ok(pick && plain, 'seeds with and without hesitation exist');
    [pick, plain].forEach(function (p) {
      const race = running(WW, p.seed);
      const st = race.state, ts = st.loopTasks['tassels:stitch'];
      stepUntil(race, function () { return ts.state === 'react'; }, 200);
      const arrive = st.time, task = race.info.loopRoute[st.loop.seg].tasks.filter(function (t) { return t.kind === 'stitch'; })[0];
      close(st.loop.f, task.f, 1e-6);
      assert.equal(st.loop.speed, 0);
      let hes = false;
      stepUntil(race, function (s) { if (s.loop.action === 'hesitate') hes = true; return ts.state === 'active'; }, 5);
      const plan = p.plan.tasks['tassels:stitch'];
      close(st.time - arrive, plan.react + plan.hesitate, DT + 1e-9);
      assert.equal(hes, plan.hesitate > 0);
      const start = st.time;
      stepUntil(race, function () { return ts.state === 'done'; }, 6);
      close(st.time - start, plan.dur, DT + 1e-9);
      close(plan.dur, 2 * T.tasselStagger + T.tasselLift + T.routeSettle, 1e-9);
      stepFor(race, 1);
      assert.ok(st.loop.f > task.f);
    });
  });

  test('a mistimed hop → stumble; a drop of his most recent thread is recovered physically as the same ID', function () {
    const p = plans.filter(function (x) { return x.plan.tasks['landing:hop'].drop; })[0];
    const q = plans.filter(function (x) { return !x.plan.tasks['landing:hop'].miss; })[0];
    assert.ok(p && q, 'seeds with a dropped thread and with a clean hop exist');
    const race = running(WW, p.seed);
    const st = race.state, L = st.loop;
    const evs = stepUntil(race, function (s, e) { return e.some(function (x) { return x.type === 'loop-recover'; }); }, 200);
    const kinds = evs.filter(function (e) { return /^loop-/.test(e.type) && e.kind !== 'stitch' && e.kind !== 'bypass'; })
      .map(function (e) { return e.type + (e.item ? ':' + e.item : ''); });
    assert.deepEqual(kinds, ['loop-task', 'loop-stumble', 'loop-drop:loop.teal', 'loop-recover:loop.teal']);
    const teal = st.items['loop.teal'];
    assert.equal(teal.status, 'held');
    assert.ok(L.f >= teal.f && L.f - teal.f < 0.003, 'he is at the spot (one step past it)');
    assert.equal(st.held.loop, 2);
    const race2 = running(WW, q.seed);
    const evs2 = stepUntil(race2, function (s) { return s.loop.segId === 'c-landing'; }, 200);
    assert.equal(types(evs2, 'loop-stumble').length, 0);
  });

  test('Loop never teleports and never changes his count because of Purl (hit vs dodge give the same Loop race)', function () {
    const trace = function (dodge) {
      const race = running(WW, 9);
      const out = [];
      let prev = { seg: race.state.loop.seg, f: race.state.loop.f };
      stepUntil(race, function (s) {
        const L = s.loop;
        if (L.seg === prev.seg) assert.ok(L.f >= prev.f - 1e-12, 'never backwards');
        else { assert.equal(L.seg, prev.seg + 1); assert.ok(L.f < 0.05); }
        prev = { seg: L.seg, f: L.f };
        out.push(L.seg + ':' + L.f.toFixed(9) + ':' + s.held.loop);
        return L.finishTime !== null;
      }, 300, { dodge: dodge, each: function (r, evs) {
        const drop = evs.filter(function (e) { return e.type === 'drop'; })[0];
        if (drop) return swipe(r, drop.lane > r.state.purl.lane ? 'right' : 'left');
      } });
      return { out: out, hits: race.state.stats.hits };
    };
    const a = trace(true), b = trace(false);
    assert.equal(a.hits, 0);
    assert.ok(b.hits >= 1);
    assert.deepEqual(a.out, b.out);
  });

  test('Loop finishes only with all three of his threads held', function () {
    const race = running(WW, 10);
    const st = race.state;
    stepUntil(race, function (s) { return s.loop.segId === 'c-tapestry'; }, 200);
    race.debug.setItem('loop.coral', { status: 'uncollected', available: false });
    stepFor(race, 40);
    assert.equal(st.loop.finishTime, null);
    const seg = race.info.loopRoute[st.loop.seg];
    assert.equal(st.loop.segId, 'finish');
    close(st.loop.f, seg.finish, 1e-6);
  });
});

describe('pause semantics and determinism', function () {
  test('while paused, step() is a no-op for everything; a paused-and-resumed race replays identically', function () {
    const policy = function (r) { if (r.state.snagling.state === 'hop' && !r.state.purl.airborne) return swipe(r, 'up'); };
    const play = function (pauses) {
      const race = newRace(WW, 12);
      const st = race.state;
      race.start();
      const log = [];
      let steps = 0;
      for (let i = 0; i < 60 * 260 && !(st.mode === 'finished' && !st.result.loopStillRacing); i++) {
        if (pauses.indexOf(i) >= 0) {
          race.pause('test');
          const snap = JSON.stringify(st);
          for (let k = 0; k < 90; k++) assert.deepEqual(race.step(DT), []);
          assert.deepEqual(race.input({ type: 'tap', target: 'ribbon' }), []);
          assert.deepEqual(race.input({ type: 'swipe', dir: 'up' }), []);
          const s2 = JSON.parse(JSON.stringify(st));
          assert.equal(s2.paused, true);
          s2.paused = false; s2.pauseReason = null;
          const s1 = JSON.parse(snap); s1.paused = false; s1.pauseReason = null;
          assert.deepEqual(s2, s1);
          race.resume();
        }
        const evs = race.step(DT);
        steps++;
        H.tapReady(race, evs);
        evs.push.apply(evs, policy(race) || []);
        evs.forEach(function (e) { log.push(st.time.toFixed(4) + ' ' + JSON.stringify(e)); });
      }
      return { log: log, result: st.result, steps: steps };
    };
    const base = play([]);
    // pauses in the countdown, the ribbon animation, the butterfly delivery and around the Snagling hop
    const paused = play([60, 300, 3900, 4500, 4520, 5000, 5300]);
    assert.deepEqual(paused.log, base.log);
    assert.deepEqual(paused.result, base.result);
  });

  test('debug.snapshot() is a JSON-safe copy', function () {
    const race = running(WW, 1);
    stepFor(race, 2);
    const snap = race.debug.snapshot();
    assert.deepEqual(snap, JSON.parse(JSON.stringify(race.state)));
    snap.purl.f = 99;
    assert.notEqual(race.state.purl.f, 99);
  });
});
