/* Features added to the original game from the Connected World package (the approved screens are unchanged):
   the objective updates in the same step as a pickup, and Purl's double-tap brake (Loop keeps racing, a jump while
   stopped stays in place, never mid-way through a scene change). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, newRace, DT, stepUntil, stepFor } = require('./helpers.cjs');

function running(race) {
  race.start();
  stepUntil(race, (s) => s.mode === 'running', 5);
}
/* Run until Purl is on a plate (not a connector), past the opening lesson, running at full speed. */
function cruising(race, segId) {
  stepUntil(race, (s) => s.purl.segId === segId && !s.tutorial && s.purl.speed > 4.9 && !s.purl.waitingFor, 120);
}

test('the objective changes in the same step as the thread counter (and stays right on the next connector)', () => {
  const WW = load(), race = newRace(WW, 1), st = race.state;
  running(race);
  let before = null;
  stepUntil(race, (s) => { if (s.held.purl === 0) before = s.objective; return s.held.purl === 1; }, 120);
  assert.equal(before, 'Collect the coral thread');
  assert.equal(st.objective, 'FOLLOW THE RIBBON', 'updated in the pickup step');
  stepUntil(race, (s) => s.purl.segId === 'c-ribbon', 30);
  assert.equal(st.objective, 'FOLLOW THE RIBBON', 'not stale on the connector');
});

test('double-tap brake: Purl stops in about brakeTime and stands in the idle pose; a second toggle resumes', () => {
  const WW = load(), race = newRace(WW, 2), st = race.state;
  running(race);
  cruising(race, 'ribbon');
  const ev = race.input({ type: 'brake' });
  assert.deepEqual(ev.map((e) => e.type), ['brake']);
  let t = 0;
  stepUntil(race, (s) => { t += DT; return s.purl.speed === 0; }, 2, { tap: false });
  assert.ok(t >= 0.18 && t <= 0.3, 'stopped in ' + t.toFixed(3) + ' s');
  stepFor(race, 0.1, { tap: false });
  assert.equal(st.purl.action, 'stopped');
  const d = st.purl.distance, f = st.purl.f;
  stepFor(race, 2, { tap: false });
  assert.equal(st.purl.distance, d, 'no jogging in place');
  assert.equal(st.purl.f, f);
  race.input({ type: 'brake' });
  stepFor(race, 1, { tap: false });
  assert.ok(st.purl.speed > 4.9 && st.purl.action === 'run', 'running again');
});

test('a jump while stopped stays in place and does not resume running', () => {
  const WW = load(), race = newRace(WW, 2), st = race.state;
  running(race);
  cruising(race, 'ribbon');
  race.input({ type: 'brake', on: true });
  stepFor(race, 0.5, { tap: false });
  const f = st.purl.f;
  race.input({ type: 'swipe', dir: 'up' });
  assert.equal(st.purl.airborne, true);
  stepFor(race, WW.TUNING.jumpTime + 0.3, { tap: false });
  assert.equal(st.purl.airborne, false);
  assert.equal(st.purl.f, f, 'landed where he took off');
  assert.equal(st.purl.speed, 0);
  assert.equal(st.purl.braked, true);
});

test('Loop keeps racing while Purl is braked, and his race is the same either way', () => {
  const WW = load();
  function loopAfter(brake) {
    const race = newRace(WW, 5), st = race.state;
    running(race);
    cruising(race, 'ribbon');
    if (brake) race.input({ type: 'brake', on: true });
    const p0 = st.purl.distance, l0 = st.loop.distance;
    stepFor(race, 4, { tap: false });
    return { purl: st.purl.distance - p0, loop: st.loop.distance - l0, loopF: st.loop.f, loopSeg: st.loop.seg };
  }
  const a = loopAfter(false), b = loopAfter(true);
  assert.ok(b.purl < 1.0, 'braked Purl hardly moved (' + b.purl.toFixed(2) + ' m)');
  assert.ok(b.loop > 5, 'Loop kept racing (' + b.loop.toFixed(1) + ' m; he may also be doing his own stitch stop)');
  assert.equal(b.loop, a.loop, 'Loop does not react to the brake');
  assert.equal(b.loopF, a.loopF);
});

test('no brake during the opening lesson; a brake on a connector waits until Purl is back on carpet', () => {
  const WW = load(), race = newRace(WW, 1), st = race.state;
  running(race);
  stepUntil(race, (s) => !!s.tutorial, 60, { tap: false });
  assert.deepEqual(race.input({ type: 'brake' }), []);
  assert.equal(st.purl.braked, false);
  stepUntil(race, (s) => s.purl.segId === 'c-ribbon' && s.transition && s.transition.t > 0.2, 120);
  race.input({ type: 'brake', on: true });
  const f0 = st.transition.t;
  stepFor(race, 0.3, { tap: false });
  assert.ok(st.transition && st.transition.t > f0, 'the scene change keeps going');
  stepUntil(race, (s) => s.purl.segId === 'shortcut', 10, { tap: false });
  stepFor(race, 0.6, { tap: false });
  assert.equal(st.purl.speed, 0, 'stopped once on the next plate');
});
