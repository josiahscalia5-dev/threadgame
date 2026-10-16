/* Wishweave Wonders — the connected course: road sampling, run integration and the route graph.

   Port of the Connected World kit's code/route-motion.mjs (sampleRoad, advanceRun, chaseTargets; same maths, house
   style) plus what the kit leaves to the host: a route graph (main road + side loop), race progress in main-road
   metres (mainS), projection of a world point onto a road, and a fork/rejoin handoff that keeps the runner's world
   position continuous.

   Conventions (see tools/build-route-data.py): metres, Y up; positive lateral = the runner's screen-right, so
   right = [-t.z, 0, t.x] (the kit's [t.z, 0, -t.x] negated) and normal = right × forward (points up).

     const R = WW.route.prepare(WW.ROUTE.main)           a road: {id, points[{s,x,y,z,width,tangent,mainS}], length…}
     WW.route.sample(R, s, lateral, bodyRadius|null)     → {s, center, position, forward, right, normal, width,
                                                             lateral, limit, heading, mainS}
     WW.route.advance(state, dt, opts)                   kit advanceRun: {s, speed, phase, braked} → new state
     WW.route.chase(R, s, lateral, opts)                 kit chaseTargets (unsmoothed camera position/target)
     const C = WW.route.createCourse(WW.ROUTE)           {main, branches, road(id), sample(pos, bodyRadius),
                                                          project(road, x, z, sHint, window), toBranch, toMain,
                                                          sampleAhead(pos, d, lateral)} */
(function (WW) {
  'use strict';

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function unit(v) {
    const n = Math.hypot(v[0], v[1], v[2]);
    if (!n) throw new Error('Zero tangent');
    return [v[0] / n, v[1] / n, v[2] / n];
  }

  /* A road from packed WW.ROUTE data ([s,x,y,z,width,tx,ty,tz(,mainS)] rows) or kit-style point objects. */
  function prepare(def) {
    const pts = (def.points || []).map(function (p) {
      if (Array.isArray(p)) {
        return { s: p[0], x: p[1], y: p[2], z: p[3], width: p[4], tangent: [p[5], p[6], p[7]],
                 mainS: p.length > 8 ? p[8] : undefined };
      }
      return p;
    });
    return {
      id: def.id || 'main', width: def.width, length: def.length != null ? def.length : pts[pts.length - 1].s,
      points: pts, startS: def.startS, endS: def.endS, isBranch: pts.length > 0 && pts[0].mainS !== undefined
    };
  }

  /* kit sampleRoad, with the screen-right sign and the clamp limit returned. */
  function sample(route, distance, lateral, bodyRadius) {
    if (lateral === undefined) lateral = 0;
    if (bodyRadius === undefined) bodyRadius = 0.35;
    const free = bodyRadius === null;          // game addition: null = no lateral clamp (world points off the deck)
    if (free) bodyRadius = 0;
    const p = route.points;
    if (!p || p.length < 2 || !isFinite(distance) || !isFinite(lateral) || !isFinite(bodyRadius) || bodyRadius < 0) {
      throw new TypeError('Valid route, distance and body radius required');
    }
    const s = clamp(distance, p[0].s, p[p.length - 1].s);
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].s <= s) lo = m; else hi = m; }
    const a = p[lo], b = p[hi], span = b.s - a.s;
    if (span <= 0) throw new Error('Route distances must strictly increase');
    const t = (s - a.s) / span;
    const center = [lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t)];
    const forward = unit(a.tangent && b.tangent
      ? [lerp(a.tangent[0], b.tangent[0], t), lerp(a.tangent[1], b.tangent[1], t), lerp(a.tangent[2], b.tangent[2], t)]
      : [b.x - a.x, b.y - a.y, b.z - a.z]);
    const right = unit([-forward[2], 0, forward[0]]);
    // normal = right × forward
    const normal = unit([right[1] * forward[2] - right[2] * forward[1],
                         right[2] * forward[0] - right[0] * forward[2],
                         right[0] * forward[1] - right[1] * forward[0]]);
    const aw = a.width != null ? a.width : route.width, bw = b.width != null ? b.width : route.width;
    const width = lerp(aw, bw, t);
    const limit = Math.max(0, width / 2 - bodyRadius);
    const offset = free ? lateral : clamp(lateral, -limit, limit);
    return {
      s: s, center: center,
      position: [center[0] + right[0] * offset, center[1] + right[1] * offset, center[2] + right[2] * offset],
      forward: forward, right: right, normal: normal, width: width, lateral: offset, limit: limit,
      heading: Math.atan2(forward[0], forward[2]),
      mainS: a.mainS !== undefined && b.mainS !== undefined ? lerp(a.mainS, b.mainS, t) : s
    };
  }

  /* kit advanceRun: exact constant-acceleration integration; gait phase driven by distance. */
  function advance(state, dt, options) {
    const runSpeed = options.runSpeed;
    const accelerationTime = options.accelerationTime === undefined ? 0.3 : options.accelerationTime;
    const brakingTime = options.brakingTime === undefined ? 0.22 : options.brakingTime;
    const strideLength = options.strideLength === undefined ? 1.4 : options.strideLength;
    const paused = !!options.paused;
    const routeLength = options.routeLength === undefined ? Infinity : options.routeLength;
    const fin = [dt, runSpeed, accelerationTime, brakingTime, strideLength, state.speed, state.s, state.phase];
    for (let i = 0; i < fin.length; i++) if (!isFinite(fin[i])) throw new TypeError('Invalid motion state/options');
    if (dt < 0 || runSpeed <= 0 || accelerationTime <= 0 || brakingTime <= 0 || strideLength <= 0 || state.speed < 0 ||
        state.s < 0 || isNaN(routeLength) || routeLength < state.s) throw new TypeError('Invalid motion state/options');
    if (paused || dt === 0) return Object.assign({}, state, { distanceMoved: 0 });
    const target = state.braked ? 0 : runSpeed;
    const direction = Math.sign(target - state.speed);
    const acceleration = direction * runSpeed / (direction < 0 ? brakingTime : accelerationTime);
    const changingTime = direction ? Math.min(dt, Math.abs((target - state.speed) / acceleration)) : 0;
    const speed = state.speed + acceleration * changingTime;
    const proposed = state.speed * changingTime + 0.5 * acceleration * changingTime * changingTime +
      speed * (dt - changingTime);
    const distanceMoved = Math.max(0, Math.min(proposed, routeLength - state.s));
    return Object.assign({}, state, {
      s: state.s + distanceMoved,
      speed: state.s + distanceMoved >= routeLength ? 0 : Math.max(0, speed),
      phase: ((state.phase + distanceMoved / strideLength) % 1 + 1) % 1,
      distanceMoved: distanceMoved
    });
  }

  /* kit chaseTargets: unsmoothed; the renderer adds damping, graph look-ahead and obstruction handling. */
  function chase(route, distance, lateral, options) {
    options = options || {};
    const behind = options.behind === undefined ? 5.5 : options.behind;
    const height = options.height === undefined ? 3.2 : options.height;
    const lookAhead = options.lookAhead === undefined ? 7 : options.lookAhead;
    const targetHeight = options.targetHeight === undefined ? 0.8 : options.targetHeight;
    const player = sample(route, distance, lateral || 0);
    const ahead = sample(route, distance + lookAhead, lateral || 0);
    return {
      position: player.position.map(function (v, i) { return v - player.forward[i] * behind + (i === 1 ? height : 0); }),
      target: ahead.position.map(function (v, i) { return v + (i === 1 ? targetHeight : 0); })
    };
  }

  /* Nearest point of `road` to world (x, z), searched within ±window metres of sHint (horizontal distance).
     Returns {s, lateral (signed, screen-right positive), dist}. */
  function project(road, x, z, sHint, window) {
    const p = road.points;
    const lo = sHint == null ? p[0].s : Math.max(p[0].s, sHint - (window || 6));
    const hi = sHint == null ? p[p.length - 1].s : Math.min(p[p.length - 1].s, sHint + (window || 6));
    let best = null;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      if (b.s < lo || a.s > hi) continue;
      const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez;
      const t = L2 > 0 ? clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1) : 0;
      const cx = a.x + ex * t, cz = a.z + ez * t;
      const d = Math.hypot(x - cx, z - cz);
      if (!best || d < best.dist) best = { s: lerp(a.s, b.s, t), dist: d };
    }
    if (!best) best = { s: clamp(sHint || 0, p[0].s, p[p.length - 1].s), dist: 0 };
    // Refine against sample()'s interpolated frame so sample(road, s, lateral) returns (x, z) exactly.
    let q = sample(road, best.s, 0, 0);
    for (let k = 0; k < 4; k++) {
      const fh = Math.hypot(q.forward[0], q.forward[2]) || 1;
      const along = ((x - q.center[0]) * q.forward[0] + (z - q.center[2]) * q.forward[2]) / fh;
      if (Math.abs(along) < 1e-6) break;
      best.s = clamp(best.s + along, p[0].s, p[p.length - 1].s);
      q = sample(road, best.s, 0, 0);
    }
    best.lateral = (x - q.center[0]) * q.right[0] + (z - q.center[2]) * q.right[2];
    return best;
  }

  /* The race course: main road + branches, positions {road: id, s, lateral}. */
  function createCourse(data) {
    const main = prepare(data.main);
    const branches = {};
    const list = (data.branches || []).map(function (b) {
      const r = prepare(b);
      r.startS = b.startS; r.endS = b.endS; r.side = b.side || 'left'; r.name = b.name;
      branches[r.id] = r;
      return r;
    });
    function road(id) { return id === 'main' || !id ? main : branches[id]; }
    const course = {
      main: main, branches: branches, branchList: list, length: main.length, data: data,
      road: road,
      /* Sample a racer position; lateral is clamped to the road it is on. */
      sample: function (pos, bodyRadius) { return sample(road(pos.road), pos.s, pos.lateral, bodyRadius); },
      /* Equivalent main-road progress of a position. */
      mainS: function (pos) { return pos.road === 'main' || !pos.road ? pos.s : sample(road(pos.road), pos.s).mainS; },
      project: project,
      /* Handoff at a fork: main (s ≥ branch.startS) → the branch, keeping the world point. */
      toBranch: function (branch, s, lateral) {
        const q = sample(main, s, lateral, 0);
        const local = project(branch, q.position[0], q.position[2], s - branch.startS, 4);
        return { road: branch.id, s: local.s, lateral: local.lateral };
      },
      /* Handoff at a rejoin: branch end → main, keeping the world point. */
      toMain: function (branch, s, lateral) {
        const q = sample(branch, s, lateral, 0);
        const m = project(main, q.position[0], q.position[2], branch.endS, 4);
        return { road: 'main', s: m.s, lateral: m.lateral };
      },
      /* Point d metres ahead along the racer's actual route (crosses a rejoin; main road beyond its end is
         extrapolated along the finish tangent so the camera never looks straight down). */
      sampleAhead: function (pos, d, lateral) {
        let r = road(pos.road), s = pos.s + d;
        if (r !== main && s > r.length) { s = r.endS + (s - r.length); r = main; }
        if (s <= main.length || r !== main) return sample(r, s, lateral || 0, 0);
        const end = sample(main, main.length, lateral || 0, 0), over = s - main.length;
        end.position = end.position.map(function (v, i) { return v + end.forward[i] * over; });
        end.center = end.center.map(function (v, i) { return v + end.forward[i] * over; });
        end.s = s; end.mainS = s;
        return end;
      },
      sectionAt: function (mainS) {
        const secs = data.sections || [];
        for (let i = 0; i < secs.length; i++) if (mainS < secs[i].endS) return secs[i];
        return secs[secs.length - 1] || null;
      }
    };
    return course;
  }

  WW.route = { prepare: prepare, sample: sample, advance: advance, chase: chase, project: project,
               createCourse: createCourse, clamp: clamp };
})(globalThis.WW = globalThis.WW || {});
