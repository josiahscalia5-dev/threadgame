/* Rules of the race on the connected course (sim/race.js, sim/loop-ai.js, sim/inventory.js on WW.ROUTE).
   Covers the kit's ACCEPTANCE.txt items that a headless simulation can prove (1, 3, 4, 5, 8, 11, 12) and the
   plate-era rules that still apply. Rendering, touch and Android are covered by tests/e2e and recordings. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, newRace, GAME } = require('./load.cjs');

const DT = 1 / 60;
function stepFor(race, sec, each) {
  const all = [];
  const n = Math.round(sec / DT);
  for (let i = 0; i < n; i++) {
    const ev = race.step(DT);
    all.push.apply(all, ev);
    if (each) each(race.state, ev, i);
  }
  return all;
}
function stepUntil(race, pred, max, each) {
  const all = [];
  for (let i = 0; i < Math.round((max || 120) / DT); i++) {
    const ev = race.step(DT);
    all.push.apply(all, ev);
    if (each) each(race.state, ev);
    if (pred(race.state, ev)) return all;
  }
  throw new Error('condition not reached in ' + (max || 120) + ' s');
}
function go(race) { race.start(); stepUntil(race, (s) => s.mode === 'running', 5); }
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/* A player who steers onto each spool's line when it is 20 m ahead (what a competent player does). */
function steerToSpools(race) {
  return function (st) {
    const it = ['coral', 'teal', 'gold'].map((c) => st.items['purl.' + c]).filter((i) => i.status !== 'held')[0];
    if (!it || st.purl.road !== 'main') return;
    const d = it.mainS - st.purl.mainS;
    if (d > 0 && d < 20 && Math.abs(st.purl.latTarget - it.lateral) > 0.9) {
      race.input({ type: 'steer', direction: it.lateral > st.purl.latTarget ? 1 : -1 });
    }
  };
}

test('state shape: both racers on the main road at the spawn, nothing moves before GO', () => {
  const WW = load(), race = newRace(WW, 1), st = race.state;
  for (const k of ['mode', 'paused', 'time', 'countdown', 'purl', 'loop', 'items', 'held', 'objective', 'phase',
                   'message', 'hint', 'result', 'gate', 'stats']) assert.ok(k in st, k);
  for (const who of ['purl', 'loop']) {
    const r = st[who];
    for (const k of ['road', 's', 'mainS', 'lateral', 'speed', 'braked', 'gait', 'airborne', 'jumpY', 'pos',
                     'forward', 'right', 'normal', 'heading', 'action', 'finishTime', 'rank', 'progress']) assert.ok(k in r, who + '.' + k);
    assert.equal(r.road, 'main');
  }
  assert.deepEqual(Object.keys(st.items).sort(), ['loop.coral', 'loop.gold', 'loop.teal', 'purl.coral', 'purl.gold', 'purl.teal']);
  assert.equal(st.objective, 'RACE TO THE FIRST THREAD');
  race.start();
  const p0 = st.purl.pos.slice(), l0 = st.loop.pos.slice();
  stepFor(race, 2.9);
  assert.equal(st.mode, 'countdown'); assert.equal(st.time, 0);
  assert.deepEqual(st.purl.pos, p0); assert.deepEqual(st.loop.pos, l0);
  const ev = stepFor(race, 0.2);
  assert.equal(st.mode, 'running');
  assert.ok(ev.some((e) => e.type === 'go'));
});

test('one continuous road: no position jump, no size reset, feet on the deck, from start to finish (both racers)', () => {
  const WW = load(), race = newRace(WW, 3);
  go(race);
  const prev = { purl: race.state.purl.pos.slice(), loop: race.state.loop.pos.slice() };
  let maxStep = 0, maxOff = 0;
  const C = race.info.course;
  stepUntil(race, (s) => s.mode === 'finished' && s.loop.finishTime !== null, 90, (st) => {
    for (const who of ['purl', 'loop']) {
      const r = st[who];
      maxStep = Math.max(maxStep, dist(r.pos, prev[who]) / DT);
      prev[who] = r.pos.slice();
      // the root stays on the deck: on main |lateral| ≤ 3 m, on the side loop the point is on one of the two decks
      if (r.road === 'main') maxOff = Math.max(maxOff, Math.abs(r.lateral) - 3);
      else {
        const onB = Math.abs(r.lateral) <= 1.3 + 1e-6;
        const m = C.project(C.main, r.pos[0], r.pos[2], r.mainS, 4);
        assert.ok(onB || Math.abs(m.lateral) <= 3, who + ' off both decks at mainS ' + r.mainS.toFixed(2));
      }
    }
  });
  const vmax = Math.hypot(WW.TUNING.purlSpeed * WW.TUNING.sideLoopBoost * 1.1, WW.TUNING.steerSpeed);
  assert.ok(maxStep < vmax * 1.05, 'fastest per-step move ' + maxStep.toFixed(2) + ' m/s (limit ' + vmax.toFixed(2) + ')');
  assert.ok(maxOff <= 1e-6, 'left the deck by ' + maxOff);
});

test('steering: one swipe = one laneStep of target, smooth lateral motion, clamped inside the road', () => {
  const WW = load(), race = newRace(WW, 1), T = WW.TUNING, st = race.state;
  go(race);
  const t0 = st.purl.latTarget;
  race.input({ type: 'steer', direction: 1 });
  assert.equal(st.purl.latTarget, t0 + T.laneStep);
  let prev = st.purl.lateral, maxD = 0;
  stepFor(race, 0.45, (s) => { maxD = Math.max(maxD, Math.abs(s.purl.lateral - prev)); prev = s.purl.lateral; });
  assert.ok(Math.abs(st.purl.lateral - t0) >= 0.9 * T.laneStep, '90 % of the side-step within 0.45 s');
  stepFor(race, 0.45, (s) => { maxD = Math.max(maxD, Math.abs(s.purl.lateral - prev)); prev = s.purl.lateral; });
  assert.ok(Math.abs(st.purl.lateral - st.purl.latTarget) < 0.01, 'settles on the target');
  assert.ok(maxD <= T.steerSpeed * DT + 1e-9, 'never faster than steerSpeed (max ' + (maxD / DT).toFixed(2) + ' m/s)');
  for (let i = 0; i < 6; i++) race.input({ type: 'steer', direction: 1 });
  stepFor(race, 0.8);
  assert.ok(Math.abs(st.purl.lateral - (3 - T.bodyRadius)) < 0.02, 'clamped at the road edge minus body clearance');
  for (let i = 0; i < 9; i++) race.input({ type: 'swipe', dir: 'left' });
  stepFor(race, 1.8);                       // 5 m across at steerSpeed
  assert.ok(Math.abs(st.purl.lateral + (3 - T.bodyRadius)) < 0.02);
});

test('jump: one swipe = one arc of jumpHeight, landing on the road; a swipe just before landing is replayed', () => {
  const WW = load(), race = newRace(WW, 1), T = WW.TUNING, st = race.state;
  go(race); stepFor(race, 1);
  const ev = race.input({ type: 'jump' });
  assert.ok(ev.some((e) => e.type === 'jump'));
  assert.deepEqual(race.input({ type: 'jump' }).filter((e) => e.type === 'jump'), [], 'no double jump in the air');
  let top = 0;
  const all = stepFor(race, T.jumpTime + 0.05, (s) => { top = Math.max(top, s.purl.jumpY); });
  assert.ok(Math.abs(top - T.jumpHeight) < 0.01);
  assert.equal(st.purl.airborne, false); assert.equal(st.purl.jumpY, 0);
  assert.ok(all.some((e) => e.type === 'land'));
  race.input({ type: 'jump' });
  stepFor(race, T.jumpTime - T.inputBufferTime / 2);
  race.input({ type: 'jump' });
  stepFor(race, T.inputBufferTime);
  assert.equal(st.purl.airborne, true, 'buffered jump started on landing');
});

test('brake: double tap stops Purl in ~brakeTime, Loop keeps racing and passes, a second toggle resumes', () => {
  const WW = load(), race = newRace(WW, 2), T = WW.TUNING, st = race.state;
  go(race); stepFor(race, 3);
  assert.ok(st.purl.mainS > st.loop.mainS - 3, 'set-up: Purl near or ahead of Loop');
  const s0 = st.purl.mainS, v0 = st.purl.speed;
  race.input({ type: 'toggle-player-brake' });
  let t = 0;
  stepUntil(race, (s) => { t += DT; return s.purl.speed === 0; }, 2);
  assert.ok(t >= 0.18 && t <= 0.27, 'stopped in ' + t.toFixed(3) + ' s');
  assert.ok(Math.abs((st.purl.mainS - s0) - v0 * T.brakeTime / 2) < 0.1, 'braking distance');
  assert.equal(st.purl.action, 'stopped');
  const gait = st.purl.gait, stopAt = st.purl.mainS, loopAt = st.loop.mainS;
  stepFor(race, 3);
  assert.equal(st.purl.mainS, stopAt, 'stays stopped'); assert.equal(st.purl.gait, gait, 'no jogging in place');
  assert.ok(st.loop.mainS > loopAt + 10 && st.loop.mainS > st.purl.mainS, 'Loop kept racing and passed');
  // a jump while stopped is in place and does not resume
  race.input({ type: 'jump' });
  stepFor(race, T.jumpTime + 0.3);
  assert.equal(st.purl.mainS, stopAt); assert.equal(st.purl.braked, true);
  race.input({ type: 'toggle-player-brake' });
  stepFor(race, T.accelTime + 0.05);
  assert.ok(Math.abs(st.purl.speed - T.purlSpeed) < 1e-6, 'back to run speed after accelTime');
});

test('Loop steers around a stopped Purl instead of running through him', () => {
  for (const seed of [1, 2, 5, 9]) {
    const WW = load(), race = newRace(WW, seed), st = race.state;
    go(race);
    race.debug.teleport('purl', 60, 0);
    race.debug.teleport('loop', 40, 0);
    race.input({ type: 'toggle-player-brake' });
    let minSep = Infinity;
    stepUntil(race, (s) => s.loop.mainS > 63, 10, (s) => {
      if (Math.abs(s.loop.mainS - s.purl.mainS) < 0.6) minSep = Math.min(minSep, Math.abs(s.loop.lateral - s.purl.lateral));
    });
    assert.ok(minSep >= 0.85, 'seed ' + seed + ': passed ' + minSep.toFixed(2) + ' m beside Purl');
  }
});

test('pause freezes everything; a paused-and-resumed race replays identically', () => {
  const WW = load();
  const a = newRace(WW, 7), b = newRace(WW, 7);
  go(a); go(b);
  stepFor(a, 4); stepFor(b, 4);
  a.pause('user');
  const snap = JSON.stringify(a.state);
  stepFor(a, 5);
  assert.equal(JSON.stringify(Object.assign({}, a.state)), snap);
  a.input({ type: 'jump' });
  assert.equal(a.state.purl.airborne, false, 'input ignored while paused');
  a.resume();
  stepFor(a, 6); stepFor(b, 6);
  assert.equal(JSON.stringify(a.state.purl.pos), JSON.stringify(b.state.purl.pos));
  assert.equal(JSON.stringify(a.state.loop.pos), JSON.stringify(b.state.loop.pos));
});

test('side loop: staying left at the fork takes it continuously, it rejoins, and it is the faster line', () => {
  const WW = load(), T = WW.TUNING;
  function run(left) {
    const race = newRace(WW, 4, { loopBranchChance: 0 }), st = race.state, C = race.info.course, b = C.branchList[0];
    go(race);
    race.debug.teleport('purl', b.startS - 20, 0);
    race.debug.teleport('loop', 5, 0);
    let roads = new Set(), prev = st.purl.pos.slice(), maxV = 0, prompt = false, prevMain = st.purl.mainS;
    const all = stepUntil(race, (s) => s.purl.mainS >= b.endS + 5, 20, (s) => {
      roads.add(s.purl.road);
      if (s.branchPrompt) prompt = true;
      if (left && s.branchPrompt && s.purl.latTarget > -1.2) race.input({ type: 'steer', direction: -1 });
      maxV = Math.max(maxV, dist(s.purl.pos, prev) / DT); prev = s.purl.pos.slice();
      assert.ok(s.purl.mainS >= prevMain - 1e-9, 'race progress never goes backwards'); prevMain = s.purl.mainS;
    });
    return { roads: [...roads], maxV, prompt, time: st.time, events: all };
  }
  const main = run(false), side = run(true);
  assert.deepEqual(main.roads, ['main']);
  assert.deepEqual(side.roads, ['main', 'tassel-bypass']);
  assert.ok(side.prompt && main.prompt, 'the side loop is announced before the fork');
  assert.ok(side.events.some((e) => e.type === 'branch') && side.events.some((e) => e.type === 'rejoin'));
  const vmax = Math.hypot(T.purlSpeed * T.sideLoopBoost, T.steerSpeed);   // running + side-stepping at once
  assert.ok(side.maxV < vmax * 1.05, 'continuous through fork and rejoin (' + side.maxV.toFixed(2) + ' m/s)');
  assert.ok(side.time < main.time - 0.25, 'side loop ' + side.time.toFixed(2) + ' s vs main ' + main.time.toFixed(2) + ' s');
});

test('a right swipe cannot cancel a locked side loop or push Purl off it', () => {
  const WW = load(), race = newRace(WW, 4), st = race.state, b = race.info.course.branchList[0];
  go(race);
  race.debug.teleport('purl', b.startS - 8, -1.6);
  stepUntil(race, (s) => s.purl.branchLock !== null || s.purl.road !== 'main', 5);
  for (let i = 0; i < 4; i++) race.input({ type: 'steer', direction: 1 });
  stepUntil(race, (s) => s.purl.road !== 'main', 3);
  stepFor(race, 1);
  for (let i = 0; i < 4; i++) race.input({ type: 'steer', direction: 1 });
  stepFor(race, 0.5);
  assert.ok(Math.abs(st.purl.lateral) <= 1.3 - WW.TUNING.bodyRadius + 0.02, 'stays inside the 2.6 m side loop');
});

test('pickups: counter and objective update in the same step; own IDs only; a repeat never stands in for a missing type', () => {
  const WW = load(), race = newRace(WW, 1), st = race.state;
  go(race);
  const steer = steerToSpools(race);
  const ev = stepUntil(race, (s) => s.held.purl === 1, 20, steer);
  const pick = ev.filter((e) => e.type === 'pickup' && e.who === 'purl');
  assert.equal(pick.length, 1); assert.equal(pick[0].item, 'purl.coral');
  assert.equal(st.objective, 'RACE THROUGH THE LOOM CITY', 'objective changed in the pickup step');
  // re-collecting coral is impossible; held counts are derived
  assert.equal(WW.sim.inventory.collect(race.debug.ctx, st.items['purl.coral']), false);
  assert.equal(st.held.purl, 1);
  assert.ok(!ev.some((e) => e.type === 'pickup' && e.who === 'purl' && e.item.indexOf('loop.') === 0));
  stepUntil(race, (s) => s.held.purl === 3, 60, steer);
  assert.equal(st.objective, 'RACE TO THE FLOWER GATE');
});

test('a missed spool is offered again ahead on the runner\'s line (never a dead end)', () => {
  const WW = load(), race = newRace(WW, 1), st = race.state;
  go(race);
  for (let i = 0; i < 2; i++) race.input({ type: 'steer', direction: -1 });   // far left; red is at +1.2
  const ev = stepUntil(race, (s) => s.items['purl.coral'].offers > 0, 20);
  const miss = ev.filter((e) => e.type === 'missed')[0];
  assert.equal(miss.item, 'purl.coral');
  assert.ok(miss.mainS > st.purl.mainS + 10, 'offered ahead');
  assert.match(st.objective, /CORAL THREAD IS AHEAD/);
  stepUntil(race, (s) => s.held.purl === 1, 10);
  assert.equal(st.items['purl.coral'].status, 'held');
});

test('finish: needs the actual crossing with three distinct threads; times and ranks are per racer', () => {
  const WW = load(), race = newRace(WW, 1), st = race.state, C = race.info.course;
  go(race);
  const steer = steerToSpools(race);
  stepUntil(race, (s) => s.purl.finishTime !== null, 90, steer);
  assert.equal(st.held.purl, 3);
  assert.ok(st.purl.mainS >= C.finishS, 'crossed the line');
  assert.equal(st.mode, 'finished');
  assert.equal(st.objective, 'LEVEL 1 COMPLETE');
  stepUntil(race, (s) => s.loop.finishTime !== null || !s.result.loopStillRacing, 40);
  if (st.loop.finishTime !== null) {
    assert.equal(st.held.loop, 3);
    assert.deepEqual([st.purl.rank, st.loop.rank].sort(), [1, 2]);
    assert.equal(st.result.winner, st.purl.finishTime <= st.loop.finishTime ? 'purl' : 'loop');
  }
  // the runners slow to a stop on the plaza beyond the line, still on the road
  stepFor(race, 6);
  assert.equal(st.purl.speed, 0);
  assert.ok(st.purl.mainS > C.finishS && st.purl.mainS <= C.length + 1e-6);
});

test('the race is a race: Loop wins some seeds against a competent player and loses others', () => {
  const WW = load();
  let purlWins = 0, loopWins = 0, sideLoops = 0, stumbles = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const race = newRace(WW, seed), st = race.state;
    go(race);
    const ev = stepUntil(race, (s) => s.mode === 'finished' && (s.loop.finishTime !== null || !s.result.loopStillRacing), 120, steerToSpools(race));
    if (st.result.winner === 'purl') purlWins++; else loopWins++;
    if (ev.some((e) => e.type === 'branch' && e.who === 'loop')) sideLoops++;
    if (ev.some((e) => e.type === 'stumble')) stumbles++;
  }
  assert.ok(purlWins >= 5 && loopWins >= 5, 'Purl ' + purlWins + ' / Loop ' + loopWins);
  assert.ok(sideLoops >= 5 && sideLoops <= 25, 'Loop took the side loop in ' + sideLoops + '/30');
  assert.ok(stumbles >= 5, 'Loop stumbled in ' + stumbles + '/30');
});

test('same seed and inputs → same race; Loop\'s race does not depend on what Purl does', () => {
  const WW = load();
  function loopTrace(braking) {
    const race = newRace(WW, 11), st = race.state, out = [];
    go(race);
    stepFor(race, 20, (s, ev, i) => {
      if (braking && i === 60) race.input({ type: 'toggle-player-brake' });
      if (i % 30 === 0) out.push(s.loop.mainS.toFixed(6));
    });
    return out;
  }
  // Loop only reacts to Purl when steering around him; keep Purl out of his way by braking far behind? No — compare
  // two identical runs, then a run where Purl stops at the start line and Loop never meets him.
  assert.deepEqual(loopTrace(false), loopTrace(false));
  const a = loopTrace(true), b = (function () {
    const race = newRace(WW, 11), st = race.state, out = [];
    go(race);
    race.input({ type: 'toggle-player-brake' });
    stepFor(race, 20, (s, ev, i) => { if (i % 30 === 0) out.push(s.loop.mainS.toFixed(6)); });
    return out;
  })();
  assert.deepEqual(a.slice(4), b.slice(4), 'Loop\'s progress is the same whenever Purl stops');
});

test('the simulation never reads the wall clock or Math.random', () => {
  for (const f of ['sim/inventory.js', 'sim/loop-ai.js', 'sim/race.js', 'core/route.js', 'data/level.js']) {
    const src = fs.readFileSync(path.join(GAME, 'src', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|Date\.|Date\(|performance\.now|setTimeout|setInterval|document\.|window\./.test(src), f);
  }
});

test('debug.snapshot() is a JSON-safe copy', () => {
  const WW = load(), race = newRace(WW, 1);
  go(race); stepFor(race, 2);
  const s = race.debug.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});
