/* Wishweave Wonders — simulation: Loop, the computer rival, on the connected course.

   Loop runs the same physical road as Purl under the same rules (sim/race.js moveRacer: speed integration, lateral
   clamp, fork/rejoin handoff, speed ribbon, finish). This module only decides his inputs. Every random choice is
   rolled once at createRace from the race seed on its own stream, so his race is identical for a seed whatever the
   player does: he never mirrors Purl's speed, is never teleported and is never slowed to hand Purl a win.

   plan (rolled in this fixed order): form (whole-race pace), line (preferred lateral), takeBranch (side loop or
   not), branchReact (s before he moves over for it), stumble (whether, where in main s, and for how long), per-
   section speed jitter, per-spool reaction time.

   Behaviour each step:
     line       he holds his preferred line …
     spools     … but heads for the next thread spool once it is within 30 m and his reaction time has passed;
     side loop  if planned, he moves to the left lane in the decision window and so takes the side loop;
     passing    he steers around Purl instead of running through him (only when close behind or alongside);
     stumble    one visible mistake: he trips (loopStumbleSpeed for loopStumble s) at a rolled point. */
(function (WW) {
  'use strict';
  const sim = WW.sim = WW.sim || {};
  const U = WW.util;

  function rollPlan(ctx) {
    const r = ctx.rngLoop, T = ctx.T;
    const plan = {};
    plan.form = U.lerp(T.loopForm[0], T.loopForm[1], r.next());
    plan.line = U.lerp(T.loopLine[0], T.loopLine[1], r.next());
    plan.takeBranch = r.next() < T.loopBranchChance;
    plan.branchReact = U.lerp(T.loopReact[0], T.loopReact[1], r.next());
    const stumbles = r.next() < T.loopStumbleChance;
    const at = U.lerp(36, 175, r.next());
    plan.stumbleAt = stumbles ? at : null;
    plan.stumbleDur = T.loopStumble;
    plan.sections = {};
    (ctx.course.data.sections || []).forEach(function (sec) {
      plan.sections[sec.id] = 1 + (r.next() * 2 - 1) * T.loopSpeedJitter;
    });
    plan.spoolReact = sim.inventory.COLORS.map(function () { return U.lerp(T.loopReact[0], T.loopReact[1], r.next()); });
    return plan;
  }

  function create(ctx, racer) {
    const plan = ctx.loopPlan = rollPlan(ctx);
    racer.form = plan.form;
    racer.stumbleUntil = 0;
    racer.stumbled = false;
    racer.seen = {};          // spool id → time first seen within range
    return plan;
  }

  function desiredLateral(ctx, L) {
    const st = ctx.state, T = ctx.T, plan = ctx.loopPlan, C = ctx.course;
    let want = plan.line;
    // the next own thread spool
    const next = sim.inventory.nextMissing(st, 'loop');
    if (next && next.mainS - L.mainS <= 30 && next.mainS > L.mainS) {
      const key = next.id + ':' + next.offers;
      if (L.seen[key] == null) L.seen[key] = st.time;
      if (st.time - L.seen[key] >= plan.spoolReact[next.order]) want = next.lateral;
    }
    // the side loop
    const b = C.branchList[0];
    if (b && L.road === 'main' && plan.takeBranch && L.forkDone !== b.id) {
      const from = b.startS - T.branchWindow;
      if (L.mainS >= from) {
        const key = 'fork:' + b.id;
        if (L.seen[key] == null) L.seen[key] = st.time;
        if (st.time - L.seen[key] >= plan.branchReact) want = -T.laneStep;
      }
    }
    if (L.road !== 'main') want = 0;
    // pass Purl instead of running through him
    const P = st.purl;
    if (P.road === L.road) {
      const ahead = P.mainS - L.mainS;
      if (ahead > -0.6 && ahead < 2.4 && Math.abs(P.lateral - want) < 1.1 && P.finishTime === null) {
        const side = P.lateral > want ? -1 : 1;
        let alt = P.lateral + side * 1.25;
        const lim = L.limit != null ? L.limit : 2.5;
        if (Math.abs(alt) > lim) alt = P.lateral - side * 1.25;
        want = alt;
      }
    }
    return want;
  }

  /* Loop's run speed for this step. */
  function runSpeed(ctx, L) {
    const T = ctx.T, plan = ctx.loopPlan, st = ctx.state;
    const sec = ctx.course.sectionAt(L.mainS);
    let v = T.loopSpeed * plan.form * (sec && plan.sections[sec.id] ? plan.sections[sec.id] : 1);
    if (L.road !== 'main') v *= T.sideLoopBoost;
    if (st.time < L.stumbleUntil) v *= T.loopStumbleSpeed;
    return v;
  }

  function update(ctx, dt) {
    const st = ctx.state, L = st.loop, plan = ctx.loopPlan;
    if (L.finishTime !== null) { ctx.moveRacer(L, dt, ctx.T.loopSpeed * plan.form); return; }
    // the planned stumble
    if (plan.stumbleAt !== null && !L.stumbled && L.mainS >= plan.stumbleAt && !L.airborne) {
      L.stumbled = true;
      L.stumbleUntil = st.time + plan.stumbleDur;
      ctx.emit({ type: 'stumble', who: 'loop' });
    }
    L.latTarget = desiredLateral(ctx, L);
    // Branch choice is physical: the lock in race.js commits him if he is in the left lane at the lock point.
    ctx.moveRacer(L, dt, runSpeed(ctx, L));
    L.action = L.finishTime !== null ? 'finished' : st.time < L.stumbleUntil ? 'stumble' :
      L.airborne ? 'jump' : 'run';
  }

  sim.loopAI = { create: create, update: update, rollPlan: rollPlan };
})(globalThis.WW = globalThis.WW || {});
