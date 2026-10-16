/* The kit's route-motion tests (kit/connected/.../code/route-motion.test.mjs), run against the ported classic script
   game/src/core/route.js and the generated WW.ROUTE, plus tests of what the game adds: the sign convention, the route
   graph, projection and the fork/rejoin handoff. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GAME = path.resolve(__dirname, '../../game');
const KIT = path.resolve(__dirname, '../../kit/connected/Wishweave-Connected-World-Kit');
function loadCore() {
  delete globalThis.WW;
  ['src/core/ww.js', 'src/core/route.js', 'src/data/route.js'].forEach(function (rel) {
    const f = path.join(GAME, rel);
    vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
  });
  return globalThis.WW;
}
const WW = loadCore();
const R = WW.route;
const data = JSON.parse(fs.readFileSync(path.join(KIT, 'scenery/route.json'), 'utf8'));
const road = R.prepare(data.mainRoute);                 // kit-style objects
const gameMain = R.prepare(WW.ROUTE.main);              // packed game data
const near = (a, b, e) => assert.ok(Math.abs(a - b) < (e || 1e-5), a + ' != ' + b);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* ---- the kit's 8 tests ---- */

test('kit: route sampler reaches the actual spawn and finish and clamps road edges', () => {
  const p = R.sample(road, data.mainRoute.spawn.s); p.position.forEach((v, i) => near(v, data.mainRoute.spawn.position[i], 0.002));
  const f = R.sample(road, 1e6); f.position.forEach((v, i) => near(v, data.mainRoute.finish.position[i], 0.002));
  near(R.sample(road, 50, 500, 0.5).lateral, 2.5); near(R.sample(road, 50, -500, 0.5).lateral, -2.5);
});
test('kit: sampled surface frame remains orthonormal and upward on the whole route', () => {
  for (let s = 0; s < road.length; s += 0.3) {
    const a = R.sample(road, s);
    near(Math.hypot(...a.forward), 1); near(Math.hypot(...a.normal), 1);
    near(dot(a.forward, a.normal), 0); near(dot(a.right, a.normal), 0); assert.ok(a.normal[1] > 0.98);
  }
});
test('kit: braking travels the same distance at different frame rates and stops the gait', () => {
  const opt = { runSpeed: 4, brakingTime: 0.22 };
  function sim(hz) { let s = { s: 0, speed: 4, phase: 0, braked: true }; for (let i = 0; i < hz; i++) s = R.advance(s, 1 / hz, opt); return s; }
  const a = sim(30), b = sim(120); near(a.s, b.s); near(a.s, 0.44); near(a.speed, 0); near(R.advance(a, 1, opt).phase, a.phase);
});
test('kit: player brake does not affect an independently advanced rival', () => {
  const options = { runSpeed: 4 };
  const p = R.advance({ s: 10, speed: 4, phase: 0, braked: true }, 1, options);
  const l = R.advance({ s: 9, speed: 4, phase: 0, braked: false }, 1, options);
  assert.ok(l.s > p.s);
});
test('kit: global pause freezes progress and gait while preserving brake state', () => {
  const s = { s: 5, speed: 2, phase: 0.5, braked: true };
  assert.deepEqual(R.advance(s, 40, { runSpeed: 4, paused: true }), Object.assign({}, s, { distanceMoved: 0 }));
});
test('kit: distance and gait clamp to route endpoint without extra foot cycling', () => {
  const s = R.advance({ s: road.length - 0.1, speed: 4, phase: 0.1, braked: false }, 1, { runSpeed: 4, routeLength: road.length });
  near(s.s, road.length); near(s.speed, 0); near(s.distanceMoved, 0.1);
  near(R.advance(s, 1, { runSpeed: 4, routeLength: road.length }).phase, s.phase);
});
test('kit: branch endpoints coincide with main route and comparable progress', () => {
  for (const b of data.branches) {
    const br = R.prepare(b);
    for (const [s, m] of [[0, b.startS], [b.points[b.points.length - 1].s, b.endS]]) {
      const p = R.sample(br, s), q = R.sample(road, m);
      p.position.forEach((v, i) => near(v, q.position[i], 0.002)); near(p.mainS, m, 0.002);
    }
  }
});
test('kit: camera aims forward along the continuous route with finite positions', () => {
  for (let s = 0; s < road.length; s += 2) {
    const c = R.chase(road, s);
    assert.ok(c.position.every(Number.isFinite)); assert.ok(c.target.every(Number.isFinite)); assert.ok(c.target[2] > c.position[2]);
  }
});

/* ---- game additions ---- */

test('packed WW.ROUTE matches the kit route.json point for point', () => {
  assert.equal(gameMain.points.length, data.mainRoute.points.length);
  for (let s = 0; s < road.length; s += 0.7) {
    const a = R.sample(road, s), b = R.sample(gameMain, s);
    a.center.forEach((v, i) => near(v, b.center[i], 2e-5));
  }
  const src = fs.readFileSync(path.join(KIT, 'scenery/route.json'));
  assert.equal(WW.ROUTE.sourceSha256, require('node:crypto').createHash('sha256').update(src).digest('hex'));
});

test('positive lateral is the runner\'s right: right = forward × up', () => {
  for (let s = 0; s < road.length; s += 5) {
    const a = R.sample(gameMain, s);
    // forward × up (0,1,0) = (-f.z, 0, f.x)
    near(a.right[0], -a.forward[2] / Math.hypot(a.forward[0], a.forward[2]), 1e-6);
    near(a.right[2], a.forward[0] / Math.hypot(a.forward[0], a.forward[2]), 1e-6);
  }
});

test('collectible and landmark lateral offsets reproduce the kit world positions', () => {
  WW.ROUTE.collectibles.forEach((c) => {
    const q = R.sample(gameMain, c.mainS, c.lateral, 0);
    near(q.position[0], c.position[0], 0.002); near(q.position[2], c.position[2], 0.002);
    near(q.position[1] + c.hover, c.position[1], 0.002);
  });
  WW.ROUTE.landmarks.filter((l) => Math.abs(l.lateral) > 0).forEach((l) => {
    const q = R.sample(gameMain, l.mainS, l.lateral, null);   // no clamp
    near(q.position[0], l.position[0], 0.01); near(q.position[2], l.position[2], 0.01);
  });
});

test('the side loop lies on the runner\'s left and rejoins the main road', () => {
  const C = R.createCourse(WW.ROUTE);
  const b = C.branchList[0];
  assert.equal(b.side, 'left');
  const mid = R.sample(b, b.length / 2, 0, 0);
  const m = R.project(C.main, mid.center[0], mid.center[2], mid.mainS, 6);
  assert.ok(m.lateral < -4, 'branch centre is ' + m.lateral.toFixed(2) + ' m from the main centre');
});

test('fork and rejoin handoffs keep the world position (no jump)', () => {
  const C = R.createCourse(WW.ROUTE);
  const b = C.branchList[0];
  for (const lat of [-2.4, -1.6, -0.5, 0, 0.8]) {
    // walk forward in 1/60 s steps at 6 m/s until the handoff is possible, as the race does
    let s = b.startS, h = null;
    while (!(h = C.toBranch(b, s, lat))) s += 0.1;
    assert.ok(s - b.startS < 0.25, 'handoff for lateral ' + lat + ' waited ' + (s - b.startS).toFixed(2) + ' m');
    const before = R.sample(C.main, s, lat, null);
    const after = R.sample(b, h.s, h.lateral, null);
    near(Math.hypot(before.position[0] - after.position[0], before.position[2] - after.position[2]), 0, 0.002);
  }
  for (const lat of [-0.8, 0, 0.8]) {
    const before = R.sample(b, b.length - 0.01, lat, 0);
    const h = C.toMain(b, b.length - 0.01, lat);
    const after = R.sample(C.main, h.s, h.lateral, null);
    near(Math.hypot(before.position[0] - after.position[0], before.position[2] - after.position[2]), 0, 0.002);
    near(h.s, b.endS, 0.05);
  }
});

test('look-ahead crosses the rejoin and runs past the finish without folding back', () => {
  const C = R.createCourse(WW.ROUTE);
  const b = C.branchList[0];
  const a = C.sampleAhead({ road: b.id, s: b.length - 2, lateral: 0 }, 7, 0);
  near(a.s, b.endS + 5, 1e-6);
  const f = C.sampleAhead({ road: 'main', s: C.length - 1, lateral: 0 }, 7, 0);
  const end = R.sample(C.main, C.length, 0, 0);
  assert.ok(Math.hypot(f.position[0] - end.position[0], f.position[2] - end.position[2]) > 5.5);
});
