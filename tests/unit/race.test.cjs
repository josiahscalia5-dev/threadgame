/* Rule tests for the race simulation: node --test tests/unit */
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, play } = require('./bot.cjs');
const WW = load();

function heldSequence(events) {
  // Purl's held count after each of his inventory events.
  const seq = [];
  let n = 0;
  for (const [, e] of events) {
    if (e.type === 'pickup' || e.type === 'recover') seq.push(++n);
    else if (e.type === 'drop') seq.push(--n);
  }
  return seq;
}

test('clean run: threads 0→1→2→3 in route order, then the finish with all three', () => {
  const out = play(WW, 7, 'dodge');
  const picks = out.events.filter(([, e]) => e.type === 'pickup').map(([, e]) => e.item);
  assert.deepEqual(picks, ['purl.coral', 'purl.teal', 'purl.gold']);
  assert.deepEqual(heldSequence(out.events), [1, 2, 3]);
  assert.equal(out.state.held.purl, 3);
  assert.ok(out.result && out.result.purlTime > 30 && out.result.purlTime < 60, 'race takes 30-60 s: ' + (out.result && out.result.purlTime));
  assert.ok(out.events.some(([, e]) => e.type === 'dodge'));
});

test('hit branch: 2→1 on the landing, the SAME teal thread is recovered (1→2), then gold makes 3', () => {
  const out = play(WW, 7, 'hit');
  assert.deepEqual(heldSequence(out.events), [1, 2, 1, 2, 3]);
  const drop = out.events.find(([, e]) => e.type === 'drop')[1];
  const rec = out.events.find(([, e]) => e.type === 'recover')[1];
  assert.equal(drop.item, 'purl.teal');         // the most recently collected thread
  assert.equal(rec.item, 'purl.teal');          // same identity comes back, no fourth item
  assert.equal(Object.keys(out.state.items).filter(k => k.startsWith('purl.')).length, 3);
  assert.ok(out.result, 'the level still completes');
});

test('missing the dropped thread sends Purl round the recovery loop; he can still get it back and finish', () => {
  const out = play(WW, 11, 'miss');
  const types = out.events.map(([, e]) => e.type);
  assert.ok(types.includes('loop-start') && types.includes('loop-return'));
  assert.ok(types.indexOf('recover') > types.indexOf('loop-return'));
  assert.equal(out.state.held.purl, 3);
  assert.ok(out.result);
});

test('zero-thread rule: losing the last thread does not fail; a hit while already at 0 does', () => {
  const out = play(WW, 3, 'passive');
  assert.equal(out.state.mode, 'failed');
  const seq = heldSequence(out.events);
  assert.deepEqual(seq, [1, 2, 1, 0]);
  const hits = out.events.filter(([, e]) => e.type === 'hit').length;
  assert.equal(hits, 3);                        // 2→1, 1→0, then the hit at 0 starts the fail
});

test('immunity: a second contact inside the immunity window is ignored', () => {
  const race = WW.sim.createRace({ seed: 5 });
  race.start();
  for (let i = 0; i < 400 && race.state.mode !== 'running'; i++) race.step(1 / 60);
  race.debug.teleport('purl', 'landing', 0.3);
  race.debug.setItem('purl.coral', { status: 'held', heldSeq: 1 });
  race.debug.setItem('purl.teal', { status: 'held', heldSeq: 2 });
  const evs = [];
  race.debug.forceReveal();
  for (let i = 0; i < 60; i++) race.step(1 / 60).forEach(e => evs.push(e));
  assert.equal(evs.filter(e => e.type === 'hit').length, 1);
  assert.equal(race.state.held.purl, 1);
  // Snagling strikes again straight away: Purl is still immune.
  race.debug.forceReveal();
  for (let i = 0; i < 60; i++) race.step(1 / 60).forEach(e => evs.push(e));
  assert.ok(evs.some(e => e.type === 'immune-ignored'));
  assert.equal(race.state.held.purl, 1);
});

test('duplicate protection: a held thread is never collected again', () => {
  const out = play(WW, 9, 'dodge');
  const ids = out.events.filter(([, e]) => e.type === 'pickup').map(([, e]) => e.item);
  assert.equal(new Set(ids).size, ids.length);
  const loopIds = out.events.filter(([, e]) => e.type === 'loop-pickup').map(([, e]) => e.item);
  assert.equal(new Set(loopIds).size, loopIds.length);
});

test('the finish needs all three threads', () => {
  const race = WW.sim.createRace({ seed: 2 });
  race.start();
  for (let i = 0; i < 400 && race.state.mode !== 'running'; i++) race.step(1 / 60);
  race.debug.teleport('purl', 'finish', 0.5);
  const evs = [];
  for (let i = 0; i < 120; i++) race.step(1 / 60).forEach(e => evs.push(e));
  assert.ok(evs.some(e => e.type === 'gate-blocked'));
  assert.equal(race.state.purl.finishTime, null);
  assert.ok(race.state.purl.trans && race.state.purl.trans.kind === 'return', 'sent back for the missing thread, not a dead end');
});

test('Loop is a fair, independent rival: never teleports, collects his own three, finishes holding them', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const out = play(WW, seed, 'dodge');
    for (let i = 1; i < out.timeline.length; i++) {
      assert.ok(out.timeline[i].l - out.timeline[i - 1].l < 0.01, 'no jump in Loop progress');
      assert.ok(out.timeline[i].l >= out.timeline[i - 1].l - 1e-9, 'Loop never moves backwards');
    }
    assert.equal(out.state.held.loop, 3);
    assert.ok(out.state.loop.finishTime !== null);
  }
  // His race does not depend on what the player does.
  const a = play(WW, 21, 'dodge'), b = play(WW, 21, 'hit');
  assert.equal(a.state.loop.finishTime.toFixed(3), b.state.loop.finishTime.toFixed(3));
});

test('both race outcomes happen with a competent player', () => {
  let wins = 0, losses = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const out = play(WW, seed, 'dodge');
    if (out.result.winner === 'purl') wins++; else losses++;
  }
  assert.ok(wins > 30 && losses > 5, `wins ${wins}, losses ${losses}`);
});

test('deterministic for a seed and input sequence', () => {
  const a = play(WW, 42, 'hit'), b = play(WW, 42, 'hit');
  assert.equal(a.result.purlTime, b.result.purlTime);
  assert.equal(a.result.loopTime, b.result.loopTime);
  assert.equal(a.events.length, b.events.length);
});

test('pause freezes the whole race (both racers and Snagling)', () => {
  const race = WW.sim.createRace({ seed: 8 });
  race.start();
  for (let i = 0; i < 600; i++) race.step(1 / 60);
  const snap = JSON.stringify([race.state.time, race.state.purl.f, race.state.loop.f, race.state.snagling]);
  race.pause('background');
  for (let i = 0; i < 600; i++) race.step(1 / 60);
  race.input({ type: 'swipe', dir: 'left' });
  assert.equal(JSON.stringify([race.state.time, race.state.purl.f, race.state.loop.f, race.state.snagling]), snap);
  race.resume();
  race.step(1 / 60);
  assert.ok(race.state.time > JSON.parse(snap)[0]);
});

test('lanes: swipes move between three lanes on wide carpet and are ignored where the route is single file', () => {
  const race = WW.sim.createRace({ seed: 4 });
  race.start();
  for (let i = 0; i < 400 && race.state.mode !== 'running'; i++) race.step(1 / 60);
  race.input({ type: 'swipe', dir: 'right' });
  race.input({ type: 'swipe', dir: 'right' });
  assert.equal(race.state.purl.lane, 1);       // clamped at the right lane
  race.input({ type: 'swipe', dir: 'left' });
  assert.equal(race.state.purl.lane, 0);
  race.debug.teleport('purl', 'ribbon', 0.6);   // up on the narrow ribbon
  const ev = race.input({ type: 'swipe', dir: 'left' });
  assert.equal(ev[0].type, 'lane-blocked');
  // a tap jumps
  race.input({ type: 'tap' });
  race.step(1 / 60);
  assert.ok(race.state.purl.jumpH > 0);
});
