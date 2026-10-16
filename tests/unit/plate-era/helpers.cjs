/* Shared helpers for the rule tests (not a test file itself). */
'use strict';
const { load, newRace } = require('./load.cjs');

const DT = 1 / 60;

/* Step `race` until pred(state, events) is true (checked after every step) or maxSeconds of steps have run.
   opts.tap: tap every ready stitch immediately (default true); opts.dodge: jump 0.3 s after a Snagling reveal
   (default: same as opts.tap); opts.each(race, events): per-step hook. */
function stepUntil(race, pred, maxSeconds, opts) {
  opts = opts || {};
  const all = [];
  const n = Math.round((maxSeconds == null ? 600 : maxSeconds) / DT);
  for (let i = 0; i < n; i++) {
    const evs = race.step(DT);
    all.push.apply(all, evs);
    if (opts.tap !== false) tapReady(race, all);
    if (opts.dodge !== undefined ? opts.dodge : opts.tap !== false) autoDodge(race, all);
    if (opts.each) all.push.apply(all, opts.each(race, evs) || []);
    if (pred && pred(race.state, evs, all)) return all;
  }
  if (pred && !opts.noThrow) throw new Error('stepUntil: condition not reached in ' + maxSeconds + ' s');
  return all;
}

function autoDodge(race, sink) {
  const st = race.state;
  if (st.snagling.state === 'hop' && st.snagling.t >= 0.3 && !st.purl.airborne && !st.snagling.contactConsumed) {
    sink.push.apply(sink, race.input({ type: 'swipe', dir: 'up' }));
  }
}

function stepFor(race, seconds, opts) {
  return stepUntil(race, null, seconds, Object.assign({ tap: false }, opts || {}));
}

function tapReady(race, sink) {
  const st = race.state;
  Object.keys(st.stitches).forEach(function (id) {
    if (st.stitches[id].state === 'ready') {
      const evs = activate(race, id);
      if (sink) sink.push.apply(sink, evs);
    }
  });
}

/* Open a ready stitch the way a player does: a tap, or for a pull stitch (the opening ribbon) a complete
   TOUCH → PULL gesture once Purl stands at its stop. Returns the events. */
function activate(race, id) {
  const s = race.state.stitches[id];
  if (!s || s.interaction !== 'pull') return race.input({ type: 'tap', target: id });
  if (race.state.purl.waitingFor !== id) return [];
  const evs = [];
  [{ phase: 'start' }, { phase: 'move', amount: 1 }, { phase: 'end', amount: 1 }].forEach(function (g) {
    evs.push.apply(evs, race.input(Object.assign({ type: 'pull', target: id }, g)));
  });
  return evs;
}

/* A running race (countdown done). */
function running(WW, seed, tuning) {
  const race = newRace(WW, seed == null ? 1 : seed, tuning);
  race.start();
  stepUntil(race, function (st) { return st.mode === 'running'; }, 10, { tap: false });
  return race;
}

/* Real race with instant taps until Purl stands on the landing (coral + teal held). */
function toLanding(WW, seed, tuning) {
  const race = running(WW, seed, tuning);
  stepUntil(race, function (st) { return st.purl.segId === 'landing'; }, 200);
  return race;
}

/* Continue until Snagling reveals; returns the events up to and including the reveal. */
function toReveal(race) {
  return stepUntil(race, function (st, evs) { return evs.some(function (e) { return e.type === 'reveal'; }); }, 30);
}

function types(evs, type) { return evs.filter(function (e) { return e.type === type; }); }

function swipe(race, dir) { return race.input({ type: 'swipe', dir: dir }); }

module.exports = { load, newRace, DT, stepUntil, stepFor, tapReady, activate, running, toLanding, toReveal, types, swipe };
