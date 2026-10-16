/* LEVEL1-GAMEPLAY-SPEC.md acceptance checks 2–9, played through whole races (check 10, pause, is in rules.test.cjs). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.cjs');
const { load, stepUntil, running, types, swipe } = H;
const { runBot } = require('./bot.cjs');

const WW = load();

/* First-time player: no reaction to Snagling, steers into the dropped thread right after the drop. */
function firstTimePolicy(r, evs) {
  const drop = types(evs, 'drop')[0];
  if (drop && drop.lane !== r.state.purl.lane) return swipe(r, drop.lane > r.state.purl.lane ? 'right' : 'left');
  return [];
}

test('check 2: ribbon and shortcut connect before Purl crosses; he never walks a gap or slides back', function () {
  const race = running(WW, 21);
  const st = race.state;
  let prev = { seg: st.purl.seg, f: st.purl.f };
  const ready = {};
  stepUntil(race, function (s) {
    const p = s.purl;
    for (const id of Object.keys(s.stitches)) {
      const k = s.stitches[id];
      if (p.seg === k.segIndex && p.f > k.f + 1e-9) {
        assert.equal(k.state, 'open', id + ' must be open before Purl passes its stop');
        assert.ok(s.time >= k.openedAt + WW.TUNING.routeSettle - 1e-9);
      }
    }
    if (!s.transition || s.transition.kind === 'connector') {
      if (p.seg === prev.seg) assert.ok(p.f >= prev.f - 1e-12, 'never backwards');
      else assert.equal(p.seg, prev.seg + 1);
    }
    prev = { seg: p.seg, f: p.f };
    return s.mode === 'finished';
  }, 400, { tap: false, each: function (r) {
    // a slow player: taps each stitch 4 s after its cue
    const s = r.state, out = [];
    for (const id of Object.keys(s.stitches)) {
      if (s.stitches[id].state !== 'ready') continue;
      if (ready[id] === undefined) ready[id] = s.time;
      if (s.time >= ready[id] + 4) out.push.apply(out, r.input({ type: 'tap', target: id }));
    }
    return out;
  }, dodge: true });
  assert.equal(st.held.purl, 3);
});

test('check 3 + 7: score progression 0 → 1 → 1 → 2 → (1 → 2) → 3; the hit drops one ID and recovery restores only it', function () {
  const race = running(WW, 22);
  const st = race.state;
  const seq = [st.held.purl];
  const statusBefore = {};
  stepUntil(race, function (s, evs) {
    evs.forEach(function (e) {
      if ((e.type === 'pickup' && e.who === 'purl') || e.type === 'drop' || e.type === 'recover' ||
          (e.type === 'stitch-open' && e.id === 'shortcut')) seq.push(e.type + ':' + s.held.purl);
      if (e.type === 'drop') {
        Object.keys(s.items).forEach(function (k) { statusBefore[k] = s.items[k].status; });
        assert.equal(e.item, 'purl.teal', 'the most recently collected thread');
      }
      if (e.type === 'recover') {
        assert.equal(e.item, 'purl.teal');
        Object.keys(s.items).forEach(function (k) {
          if (k !== 'purl.teal') assert.equal(s.items[k].status, statusBefore[k], 'only the dropped ID changes');
        });
      }
    });
    assert.ok(s.held.purl <= 3);
    return s.mode === 'finished';
  }, 400, { dodge: false, each: firstTimePolicy });
  assert.deepEqual(seq, [0, 'pickup:1', 'stitch-open:1', 'pickup:2', 'drop:1', 'recover:2', 'pickup:3']);
  assert.deepEqual([st.stats.hits, st.stats.recoveries], [1, 1]);
  assert.equal(Object.keys(st.items).length, 6);
});

test('check 4: the tassels clear before Purl moves beneath them; Snagling never attacks during a stitch lock', function () {
  const race = running(WW, 23);
  stepUntil(race, function (s) {
    const k = s.stitches.tassels;
    if (s.purl.seg === k.segIndex && s.purl.f > k.f + 1e-9) assert.deepEqual(k.lifts, [1, 1, 1]);
    if (s.snagling.state === 'hop' && s.snagling.t === 0) assert.equal(WW.sim.stitches.locked(race.debug.ctx), false);
    return s.mode === 'finished';
  }, 400, { dodge: false, each: firstTimePolicy });
});

test('check 5: the butterfly delivers the gold onto reachable carpet ahead; 3/3 on pickup, not on tap', function () {
  const race = running(WW, 24);
  const st = race.state, b = st.stitches.butterfly, gold = st.items['purl.gold'];
  const seg = race.info.route[b.segIndex];
  assert.ok(gold.f > b.f && gold.f < seg.exit, 'on Purl\'s path between his stop and the exit');
  let tapHeld = null, pickT = null;
  stepUntil(race, function (s, evs) {
    if (b.state === 'animating' && tapHeld === null) tapHeld = s.held.purl;   // the step after the tap
    if (types(evs, 'pickup').some(function (e) { return e.item === 'purl.gold'; })) pickT = s.time;
    return pickT !== null;
  }, 300);
  assert.equal(tapHeld, 2);
  assert.ok(pickT > b.openedAt);
  assert.equal(st.held.purl, 3);
});

test('check 6: a successful dodge keeps 2/3 with no drop, no SNAGGED!/RECOVERED message', function () {
  const race = running(WW, 25);
  const kinds = new Set();
  const evs = stepUntil(race, function (s) {
    if (s.message) kinds.add(s.message.kind);
    return s.mode === 'finished';
  }, 400);
  assert.equal(types(evs, 'dodge').length, 1);
  assert.equal(types(evs, 'hit').length + types(evs, 'drop').length + types(evs, 'recover').length, 0);
  assert.ok(!kinds.has('hit') && !kinds.has('recover'));
});

test('check 8: missing threads always leave a reachable path — 2 → 1 (miss) → loop → 1 → 0 → loop → hit at 0 → fail', function () {
  const race = running(WW, 26);
  const st = race.state;
  const trail = [];
  stepUntil(race, function (s, evs) {
    evs.forEach(function (e) {
      if (['hit', 'drop', 'fail'].indexOf(e.type) >= 0) trail.push(e.type + ':' + s.held.purl);
    });
    if (s.transition && s.transition.kind === 'loop' && trail[trail.length - 1] !== 'loop') trail.push('loop');
    return s.mode === 'failed';
  }, 400, { dodge: false });
  assert.deepEqual(trail, ['hit:1', 'drop:1', 'loop', 'hit:0', 'drop:0', 'loop', 'hit:0', 'fail:0']);
  assert.equal(st.purl.action, 'failed');
  const dropped = Object.values(st.items).filter(function (it) { return it.status === 'dropped'; });
  dropped.forEach(function (it) { assert.equal(it.seg, 'landing'); });
  assert.equal(dropped.length, 2);
});

test('check 8: after a missed spool the recovery loop lets Purl recover it and finish; no extra item is created', function () {
  const race = running(WW, 27);
  const st = race.state;
  let looped = false;
  stepUntil(race, function (s) {
    if (s.transition && s.transition.kind === 'loop') looped = true;
    assert.ok(s.held.purl <= 3);
    return s.mode === 'finished';
  }, 400, { dodge: false, each: function (r, evs) {
    // misses the spool on the first pass, then dodges and steers in on the second
    const s = r.state;
    if (looped && s.snagling.state === 'hop' && s.snagling.t >= 0.3 && !s.purl.airborne && !s.snagling.contactConsumed) {
      return swipe(r, 'up');
    }
    if (looped && s.snagling.result === 'dodge' && s.purl.lane !== 1 && s.purl.segId === 'landing') return swipe(r, 'right');
    return [];
  } });
  assert.ok(looped);
  assert.deepEqual([st.held.purl, st.stats.hits, st.stats.recoveries], [3, 1, 1]);
  assert.equal(Object.keys(st.items).length, 6);
});

test('check 9: Loop genuinely finishes first or second; Purl completes the level in 2nd place with 3/3', function () {
  const P = WW.LEVEL.pacing;
  const a = runBot({ WW: WW, seed: P.competent.purlWins[0], profile: 'competent' });
  const b = runBot({ WW: WW, seed: P.competent.loopWins[0], profile: 'competent' });
  assert.deepEqual([a.result.purlRank, a.result.loopRank, a.result.winner], [1, 2, 'purl']);
  assert.deepEqual([b.result.purlRank, b.result.loopRank, b.result.winner], [2, 1, 'loop']);
  assert.equal(b.mode, 'finished');
  assert.deepEqual(b.held, { purl: 3, loop: 3 });
});
