/* §7.8 pacing (lead targets), Loop's spread over seeds, the documented seeds in WW.LEVEL.pacing and the Snagling
   dodge window. Uses the headless bot (tests/unit/bot.cjs). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.cjs');
const { runBot, sweep } = require('./bot.cjs');

const WW = load();
const P = WW.LEVEL.pacing;
const N = 50;
const comp = sweep(N, { profile: 'competent' });
const first = sweep(N, { profile: 'first' });

test('competent run (1.0 s reactions, dodge) ≈ 92–100 s race clock; first-time run (2.0 s, one hit + recovery) ≈ 105–120 s', function () {
  comp.rows.forEach(function (r) {
    assert.equal(r.mode, 'finished');
    assert.deepEqual([r.stats.hits, r.stats.dodges], [0, 1]);
  });
  first.rows.forEach(function (r) {
    assert.equal(r.mode, 'finished');
    assert.deepEqual([r.stats.hits, r.stats.recoveries], [1, 1]);
  });
  assert.ok(comp.purlAvg >= 92 && comp.purlAvg <= 100.5, 'competent ' + comp.purlAvg);
  assert.ok(first.purlAvg >= 104.5 && first.purlAvg <= 120, 'first-time ' + first.purlAvg);
  // §7.8: with the 3 s countdown a first successful attempt lands in 90–150 s
  [comp.purlAvg, first.purlAvg].forEach(function (t) { assert.ok(t + WW.TUNING.countdown >= 90 && t + WW.TUNING.countdown <= 150); });
  assert.ok(Math.abs(comp.purlAvg - P.competent.purl) < 0.5, 'documented competent time is current');
  assert.ok(Math.abs(first.purlAvg - P.first.purl) < 0.5, 'documented first-time time is current');
});

test('Loop overlaps both runs: competent Purl wins ~60–75 %, first-time Purl ~30–50 % over seeds 1–50', function () {
  assert.ok(comp.loopMin < comp.purlAvg && comp.loopMax > first.purlAvg, 'Loop spans both runs');
  const c = comp.purlWins / N, f = first.purlWins / N;
  assert.ok(c >= 0.6 && c <= 0.75, 'competent share ' + c);
  assert.ok(f >= 0.3 && f <= 0.5, 'first-time share ' + f);
});

test('documented seeds give the documented winner for each profile', function () {
  ['competent', 'first'].forEach(function (profile) {
    const rows = profile === 'competent' ? comp.rows : first.rows;
    P[profile].purlWins.forEach(function (seed) { assert.equal(rows[seed - 1].result.winner, 'purl', profile + ' seed ' + seed); });
    P[profile].loopWins.forEach(function (seed) {
      const r = rows[seed - 1].result;
      assert.equal(r.winner, 'loop', profile + ' seed ' + seed);
      assert.equal(r.purlRank, 2);
    });
  });
});

test('dodge window: a jump or a lane change started 0.25–0.35 s after the reveal reliably clears contact', function () {
  const windowOf = function (dodge) {
    const ok = [];
    for (let k = 0; k <= 42; k++) {
      const r = runBot({ WW: WW, seed: 1, profile: 'competent', dodge: dodge, dodgeDelay: k / 60, maxTime: 85 });
      ok.push(r.stats.dodges === 1 && r.stats.hits === 0);
    }
    const lo = ok.indexOf(true), hi = ok.lastIndexOf(true);
    assert.ok(ok.slice(lo, hi + 1).every(Boolean), dodge + ' window is contiguous');
    return [lo / 60, hi / 60];
  };
  const jump = windowOf('jump'), lane = windowOf('lane');
  assert.ok(jump[0] <= 0.05 && jump[1] >= 0.45, 'jump window ' + jump);
  assert.ok(lane[0] <= 0.0 + 1e-9 && lane[1] >= 0.4, 'lane window ' + lane);
});
