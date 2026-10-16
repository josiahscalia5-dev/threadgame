/* Wishweave Wonders — simulation: the race on the connected course.

   const race = WW.sim.createRace({ seed, level: WW.LEVEL, tuning: WW.TUNING });
   race.state / race.step(dt) / race.input(ev) / race.start() / race.pause(reason) / race.resume() / race.debug
   race.info.course  the route graph (WW.route.createCourse) the renderer and tests sample

   Pure logic: no DOM, no wall clock, no Math.random. Deterministic for a seed + input sequence. Loop's random
   choices come from their own stream (sim/loop-ai.js), so his race does not depend on what the player does.

   Both racers live on ONE continuous course: road ('main' or the side loop id), s (metres along that road), lateral
   (metres, + = runner's right), and mainS (equivalent main-road progress, used for race order, spools and finish).
   There are no connectors, plates or wipes: a fork or rejoin hands the runner to the other road at the same world
   point (WW.route.createCourse toBranch/toMain), so his position, size and the camera stay continuous.

   Racer state (purl and loop; read-only for renderer/UI):
     road, s, mainS, lateral, latTarget, limit, speed, braked, gait (0..1, stride phase driven by distance),
     airborne, jumpT, jumpH (0..1), jumpY (m), landedAt, pos [x,y,z] (feet on the road top + jump), forward, right,
     normal, heading, action ('idle'|'run'|'brake'|'stopped'|'jump'|'stumble'|'finished'), finishTime, rank,
     progress (0..1 to the finish line), distance, forkDone, branchLock.
   Purl's controls (input): {type:'steer', direction:±1} | {type:'jump'} | {type:'toggle-player-brake'} and the older
   {type:'swipe', dir:'left'|'right'|'up'}. Steering moves the lateral target one laneStep, clamped inside the road
   (minus body clearance); it never moves him onto another road. Near the fork, being in the left lane at the lock
   point commits him to the side loop. A double tap toggles Purl's brake only: he decelerates to a stop in brakeTime
   and resumes on the next toggle; Loop keeps racing. A jump while stopped jumps in place and does not resume. */
(function (WW) {
  'use strict';
  const sim = WW.sim = WW.sim || {};
  const U = WW.util;

  const DEFAULTS = {
    messageTime: 1.8,
    hintTime: 4.5,
    gateOpenTime: 1.2
  };

  function createRace(opts) {
    opts = opts || {};
    const level = opts.level || WW.LEVEL;
    const seed = opts.seed == null ? 1 : opts.seed;
    const L0 = level.loop || {};
    const T = Object.assign({}, DEFAULTS, { loopForm: L0.form || [1, 1] }, WW.TUNING, opts.tuning || {});
    const course = WW.route.createCourse(level.course || WW.ROUTE, { runout: T.finishRunout });

    const ctx = {
      T: T, level: level, course: course,
      rngLoop: WW.rng(seed), heldCounter: 0, events: [], waitUntil: Infinity
    };
    ctx.emit = function (ev) { ctx.events.push(ev); return ev; };
    ctx.message = function (text, kind, dur) {
      ctx.state.message = { text: text, kind: kind || 'info', until: ctx.state.time + (dur || T.messageTime) };
    };
    ctx.moveRacer = function (r, dt, v) { moveRacer(ctx, r, dt, v); };

    const spawn = (level.course || WW.ROUTE).spawn.s;
    const st = ctx.state = {
      mode: 'intro', paused: false, pauseReason: null, time: 0, countdown: T.countdown, seed: seed,
      purl: racer('purl', spawn, -0.8),
      loop: racer('loop', spawn + 0.6, 0.8),
      items: null,
      held: { purl: 0, loop: 0 },
      stitches: {},
      objective: '', phase: '', section: null,
      message: null, hint: null, result: null, tutorial: null, transition: null,
      branchPrompt: null,
      gate: { state: 'closed', t: 0 },
      stats: { jumps: 0, brakes: 0, steers: 0, sideLoop: 0 }
    };
    sim.loopAI.create(ctx, st.loop);
    st.items = sim.inventory.create(ctx);
    sim.inventory.recount(st);
    pose(ctx, st.purl);
    pose(ctx, st.loop);
    refreshObjective(ctx);

    const race = {
      state: st,
      info: { course: course, plan: ctx.loopPlan, tuning: T },
      events: [],
      step: function (dt) { ctx.events = []; step(ctx, dt); race.events = ctx.events; return ctx.events; },
      input: function (ev) { ctx.events = []; input(ctx, ev); return ctx.events; },
      start: function () {
        if (st.mode === 'intro') { st.mode = 'countdown'; st.countdown = T.countdown; }
        return st.mode;
      },
      pause: function (reason) { st.paused = true; st.pauseReason = reason || 'user'; },
      resume: function () { st.paused = false; st.pauseReason = null; },
      debug: makeDebug(ctx)
    };
    return race;
  }

  function racer(who, s, lateral) {
    return {
      who: who, road: 'main', s: s, mainS: s, lateral: lateral, latTarget: lateral, limit: 2.5,
      speed: 0, braked: false, gait: 0, airborne: false, jumpT: 0, jumpH: 0, jumpY: 0, jumpBuffered: false,
      landedAt: -10, pos: [0, 0, 0], forward: [0, 0, 1], right: [1, 0, 0], normal: [0, 1, 0], heading: 0,
      action: 'idle', finishTime: null, rank: null, progress: 0, distance: 0, forkDone: null, branchLock: null
    };
  }

  /* ---------- step ---------- */

  function step(ctx, dt) {
    const st = ctx.state, T = ctx.T;
    if (!(dt > 0) || st.paused) return;
    if (st.mode === 'countdown') {
      st.countdown -= dt;
      if (st.countdown <= 0) {
        st.countdown = 0;
        st.mode = 'running';
        st.purl.action = 'run';
        st.loop.action = 'run';
        ctx.emit({ type: 'go' });
      }
      return;
    }
    if (st.mode === 'running' || st.mode === 'finished') {
      st.time += dt;
      expire(ctx);
      const racing = st.mode === 'running' || (st.result && st.result.loopStillRacing);
      updatePurl(ctx, dt);
      if (racing || st.loop.finishTime !== null) sim.loopAI.update(ctx, dt);
      settleFinish(ctx);
      refreshObjective(ctx);
    }
    if (st.gate.state === 'opening') {
      st.gate.t = Math.min(1, st.gate.t + dt / T.gateOpenTime);
      if (st.gate.t >= 1) st.gate.state = 'open';
    }
  }

  function expire(ctx) {
    const st = ctx.state;
    if (st.message && st.time >= st.message.until) st.message = null;
    if (st.hint && st.time >= st.hint.until) st.hint = null;
  }

  /* ---------- shared movement (both racers, same physical rules) ---------- */

  function stepJump(ctx, r, dt) {
    if (!r.airborne) return;
    const T = ctx.T;
    r.jumpT += dt;
    if (r.jumpT >= T.jumpTime) {
      r.airborne = false; r.jumpT = 0; r.jumpH = 0; r.jumpY = 0;
      r.landedAt = ctx.state.time;
      ctx.emit({ type: 'land', who: r.who });
      if (r.jumpBuffered) startJump(ctx, r);
      r.jumpBuffered = false;
    } else {
      r.jumpH = Math.sin(Math.PI * r.jumpT / T.jumpTime);
      r.jumpY = r.jumpH * T.jumpHeight;
    }
  }

  function startJump(ctx, r) {
    r.airborne = true; r.jumpT = 0; r.jumpH = 0; r.jumpY = 0; r.jumpBuffered = false;
    ctx.emit({ type: 'jump', who: r.who });
  }

  /* World pose of a racer from (road, s, lateral, jumpY); feet on the road top. */
  function pose(ctx, r) {
    const C = ctx.course, road = C.road(r.road);
    const q = WW.route.sample(road, r.s, r.lateral, null);
    const lim = WW.route.sample(road, r.s, 0, ctx.T.bodyRadius).limit;
    r.limit = lim;
    r.mainS = q.mainS;
    r.pos = [q.position[0] + q.normal[0] * r.jumpY, q.position[1] + q.normal[1] * r.jumpY,
             q.position[2] + q.normal[2] * r.jumpY];
    r.forward = q.forward; r.right = q.right; r.normal = q.normal; r.heading = q.heading;
    r.progress = U.clamp(r.mainS / C.finishS, 0, 1);
  }

  /* Lateral relative to the main road (for spools and race order), whichever road the racer is on. */
  function mainLateral(ctx, r) {
    if (r.road === 'main') return r.lateral;
    const C = ctx.course;
    return C.project(C.main, r.pos[0], r.pos[2], r.mainS, 4).lateral;
  }

  function moveRacer(ctx, r, dt, runSpeed) {
    const T = ctx.T, C = ctx.course, st = ctx.state;
    stepJump(ctx, r, dt);
    const road = C.road(r.road);
    const onBranch = r.road !== 'main';
    const done = r.finishTime !== null;
    const next = WW.route.advance({ s: r.s, speed: r.speed, phase: r.gait, braked: r.braked || done }, dt, {
      runSpeed: Math.max(0.01, runSpeed), accelerationTime: T.accelTime,
      // braking (player brake) is quick; easing off a speed ribbon or after the finish is gentle
      brakingTime: r.braked && !done ? T.brakeTime : T.accelTime * (done ? 2.5 : 1.6),
      strideLength: T.strideLength, routeLength: onBranch ? Infinity : C.main.length
    });
    const m0 = r.mainS;
    r.speed = next.speed;
    r.gait = next.phase;
    r.distance += next.distanceMoved;
    let s = next.s;

    const b = C.branchList[0];
    if (!onBranch && b) {
      // the decision point before the fork: the left lane commits the runner to the side loop
      if (r.forkDone !== b.id && r.branchLock === null && s >= b.startS - T.branchLock && m0 < b.startS) {
        r.branchLock = r.latTarget <= -0.8 * T.laneStep / 1.6 && r.lateral < 0 ? b.id : 'main';
        ctx.emit({ type: 'branch-lock', who: r.who, choice: r.branchLock });
      }
      if (r.branchLock === b.id && s >= b.startS) {
        const h = C.toBranch(b, s, r.lateral);
        if (h) {
          r.road = b.id; s = h.s; r.lateral = h.lateral;
          r.latTarget = 0;
          r.forkDone = b.id; r.branchLock = null;
          if (r.who === 'purl') st.stats.sideLoop += 1;
          ctx.emit({ type: 'branch', who: r.who, road: b.id });
        }
      } else if (r.branchLock === 'main' && s >= b.startS) {
        r.forkDone = b.id; r.branchLock = null;
      }
    } else if (onBranch && s >= road.length) {
      const h = C.toMain(road, road.length, r.lateral);
      const over = s - road.length;
      r.road = 'main'; s = h.s + over; r.lateral = h.lateral;
      r.latTarget = U.clamp(h.lateral, -T.laneStep, T.laneStep);
      ctx.emit({ type: 'rejoin', who: r.who });
    }
    r.s = s;

    // lateral follows its target smoothly inside the road actually under the runner
    const lim = WW.route.sample(C.road(r.road), r.s, 0, T.bodyRadius).limit;
    if (r.road === 'main' && r.branchLock === b.id) r.latTarget = Math.min(r.latTarget, -T.laneStep * 0.5);
    r.latTarget = U.clamp(r.latTarget, -lim, lim);
    r.lateral = U.damp(r.lateral, r.latTarget, T.steerHalfLife, dt);
    pose(ctx, r);

    // thread spools and the finish line
    if (r.finishTime === null) {
      sim.inventory.passSpools(ctx, r.who, m0, r.mainS, mainLateral(ctx, r), C.finishS);
      if (r.mainS >= C.finishS && m0 < C.finishS) crossFinish(ctx, r, m0, dt);
    }
  }

  function crossFinish(ctx, r, m0, dt) {
    const st = ctx.state, C = ctx.course;
    if (!sim.inventory.allHeld(st, r.who)) {
      // Never a dead end: a missed thread is always re-offered on the runner's line before the line (inventory.js);
      // if one is still missing here it is waiting at the gate.
      sim.inventory.ownItems(st, r.who).forEach(function (it) {
        if (it.status !== 'held') {
          it.mainS = r.mainS; it.lateral = mainLateral(ctx, r);
          sim.inventory.passSpools(ctx, r.who, r.mainS - 0.01, r.mainS, it.lateral, C.length);
        }
      });
      if (r.who === 'purl') ctx.message(ctx.level.missingMessage || 'A THREAD IS MISSING', 'info', 2.0);
    }
    const frac = r.mainS > m0 ? (C.finishS - m0) / (r.mainS - m0) : 1;
    r.finishTime = Math.max(0, st.time - dt * (1 - frac));
    r.action = 'finished';
    ctx.emit({ type: 'finish', who: r.who, time: r.finishTime });
    if (r.who === 'purl') {
      st.gate.state = 'opening'; st.gate.t = 0;
      ctx.emit({ type: 'gate-open' });
    }
  }

  /* ---------- Purl ---------- */

  function updatePurl(ctx, dt) {
    const st = ctx.state, T = ctx.T, p = st.purl, C = ctx.course;
    const v = T.purlSpeed * (p.road !== 'main' ? T.sideLoopBoost : 1);
    moveRacer(ctx, p, dt, v);
    if (p.finishTime !== null) p.action = 'finished';
    else if (p.airborne) p.action = 'jump';
    else if (p.braked) p.action = p.speed > 0.05 ? 'brake' : 'stopped';
    else p.action = p.speed > 0.05 ? 'run' : 'idle';

    // section → phase text
    const sec = C.sectionAt(p.mainS);
    if (sec && st.section !== sec.id) {
      st.section = sec.id;
      st.phase = 'LEVEL 1 · ' + ((ctx.level.sections || {})[sec.id] || sec.name.toUpperCase());
      ctx.emit({ type: 'section', id: sec.id });
    }
    // the side-loop announcement (decision window before the fork)
    const b = C.branchList[0];
    st.branchPrompt = null;
    if (b && p.road === 'main' && p.forkDone !== b.id && p.finishTime === null) {
      const d = b.startS - p.mainS;
      if (d <= T.branchWindow && d > 0) {
        st.branchPrompt = { road: b.id, side: 'left', distance: d,
                            locked: p.branchLock, chosen: p.branchLock ? p.branchLock === b.id : p.latTarget < 0 };
        st.hint = { text: (ctx.level.sideLoop && ctx.level.sideLoop.hint) || 'SIDE LOOP ON THE LEFT', until: st.time + 0.2 };
      }
    }
    if (p.braked && p.speed <= 0.05 && p.finishTime === null) {
      st.hint = { text: 'STOPPED · DOUBLE-TAP OR RUN TO GO', until: st.time + 0.2 };
    }
  }

  function refreshObjective(ctx) {
    const st = ctx.state, p = st.purl, O = ctx.level.objectives || {};
    if (p.finishTime !== null) { st.objective = ctx.level.completeObjective || 'LEVEL 1 COMPLETE'; return; }
    const next = sim.inventory.nextMissing(st, 'purl');
    let obj;
    if (!next) obj = O.gate;
    else if (next.offers > 0) obj = (O.missed || 'THE {color} THREAD IS AHEAD').replace('{color}', next.color.toUpperCase());
    else if (st.held.purl === 0) obj = O.first;
    else if (next.mainS - p.mainS <= (O.approach || 25)) obj = next.color === 'gold' ? O.gold : O.teal;
    else obj = O.city;
    st.objective = obj || '';
  }

  function settleFinish(ctx) {
    const st = ctx.state, p = st.purl, L = st.loop, pf = p.finishTime, lf = L.finishTime;
    if (pf !== null && p.rank === null) p.rank = (lf !== null && lf < pf) ? 2 : 1;
    if (lf !== null && L.rank === null) L.rank = (pf !== null && pf <= lf) ? 2 : 1;
    if (pf === null) return;
    if (!st.result) {
      st.mode = 'finished';
      ctx.waitUntil = pf + ctx.T.finishWaitForLoop;
      st.result = { purlTime: pf, loopTime: null, purlRank: p.rank, loopRank: null, winner: null, loopStillRacing: true };
    }
    const r = st.result;
    r.loopTime = lf;
    r.loopRank = L.rank;
    r.purlRank = p.rank;
    r.winner = p.rank === 1 ? 'purl' : 'loop';
    r.loopStillRacing = lf === null && st.time < ctx.waitUntil;
  }

  /* ---------- input ---------- */

  function input(ctx, ev) {
    const st = ctx.state, p = st.purl, T = ctx.T;
    if (!ev || st.paused || st.mode !== 'running' || p.finishTime !== null) return;
    let type = ev.type, dir = ev.direction;
    if (type === 'swipe') {
      if (ev.dir === 'left' || ev.dir === 'right') { type = 'steer'; dir = ev.dir === 'left' ? -1 : 1; }
      else if (ev.dir === 'up') type = 'jump';
      else return;
    }
    if (type === 'steer') {
      const b = ctx.course.branchList[0];
      if (dir > 0 && b && p.road === 'main' && p.branchLock === b.id) return;   // committed to the side loop
      const target = U.clamp(p.latTarget + (dir < 0 ? -1 : 1) * T.laneStep, -p.limit, p.limit);
      if (Math.abs(target - p.latTarget) > 1e-6) {
        p.latTarget = target;
        st.stats.steers += 1;
        ctx.emit({ type: 'lane', who: 'purl', lateral: target, dir: dir < 0 ? -1 : 1 });
      }
    } else if (type === 'jump') {
      if (!p.airborne) { startJump(ctx, p); st.stats.jumps += 1; }
      else if (T.jumpTime - p.jumpT <= T.inputBufferTime) p.jumpBuffered = true;
    } else if (type === 'toggle-player-brake' || type === 'brake') {
      p.braked = type === 'brake' ? !!ev.on : !p.braked;
      if (p.braked) st.stats.brakes += 1;
      ctx.emit({ type: 'brake', who: 'purl', on: p.braked });
    }
  }

  /* ---------- debug helpers (tests) ---------- */

  function makeDebug(ctx) {
    return {
      ctx: ctx,
      /* Put a racer on the main road at mainS/lateral (tests only; the game itself never teleports anyone). */
      teleport: function (who, mainS, lateral) {
        const r = ctx.state[who === 'loop' ? 'loop' : 'purl'];
        r.road = 'main'; r.s = mainS; r.lateral = r.latTarget = lateral || 0; r.speed = 0;
        r.forkDone = null; r.branchLock = null;
        const b = ctx.course.branchList[0];
        if (b && mainS >= b.startS) r.forkDone = b.id;
        pose(ctx, r);
        refreshObjective(ctx);
        return r;
      },
      giveAll: function (who) {
        who = who || 'purl';
        sim.inventory.COLORS.forEach(function (c) {
          const it = ctx.state.items[who + '.' + c];
          if (it.status !== 'held') { it.status = 'held'; it.heldSeq = ++ctx.heldCounter; }
        });
        sim.inventory.recount(ctx.state);
        refreshObjective(ctx);
        return ctx.state.held[who];
      },
      setLoopForm: function (form) { ctx.state.loop.form = ctx.loopPlan.form = form; return form; },
      setLoopPlan: function (patch) { Object.assign(ctx.loopPlan, patch || {}); return ctx.loopPlan; },
      snapshot: function () { return JSON.parse(JSON.stringify(ctx.state)); },
      loopPlan: function () { return ctx.loopPlan; },
      course: function () { return ctx.course; }
    };
  }

  sim.createRace = createRace;
  sim.DEFAULTS = DEFAULTS;
})(globalThis.WW = globalThis.WW || {});
