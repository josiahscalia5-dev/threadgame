/* Wishweave Wonders — simulation: Loop, the computer rival (docs/ARCHITECTURE.md §7.7).

   Loop runs his own `loopRoute` (index-aligned with Purl's route) with his own lengths. Everything random about
   him is rolled once at createRace from the race seed on a stream separate from anything Purl does, so his race
   is identical for a seed whatever the player does, and is simulated identically whether or not he is visible.
     cruise      loopSpeed × form (per race, WW.LEVEL.loop.form) × (1 ± loopSpeedJitter) (per segment)
     stitch      brakes to a stop at the task f, reacts (loopReact, + loopHesitate with loopHesitateChance),
                 performs for `dur` (default: Purl's animation time for that plate's stitch) + routeSettle;
                 completing it delivers his gold on that segment (like the butterfly does for Purl)
     bypass      the longer route: `extra` × (1 ± bypassJitter) s of extra travel out of sight at the task f
     hop         a jump; with loopHopMissChance he mistimes it and stumbles (loopStumble s); with
                 loopDropOnStumbleChance his most recent thread drops just ahead (dropAheadF) and he recovers the
                 same ID physically: he runs to it and picks it up no earlier than loopRecover s after the drop
   He finishes only with all three loop.* IDs held. f is always continuous (he never teleports). */
(function (WW) {
  'use strict';
  const sim = WW.sim = WW.sim || {};
  const U = WW.util;

  /* Pre-roll every random choice: 1 draw for form, then per segment 1 speed draw + 4 draws per task. */
  function rollPlan(ctx) {
    const r = ctx.rngLoop, T = ctx.T;
    const plan = { form: U.lerp(T.loopForm[0], T.loopForm[1], r.next()), segs: [], tasks: {} };
    ctx.loopRoute.forEach(function (seg) {
      plan.segs.push(1 + (r.next() * 2 - 1) * T.loopSpeedJitter);
      seg.tasks.forEach(function (task) {
        const a = r.next(), b = r.next(), c = r.next(), d = r.next();
        const p = { kind: task.kind };
        if (task.kind === 'stitch') {
          p.react = U.lerp(T.loopReact[0], T.loopReact[1], a);
          p.hesitate = b < T.loopHesitateChance ? U.lerp(T.loopHesitate[0], T.loopHesitate[1], c) : 0;
          p.dur = task.dur;
        } else if (task.kind === 'hop') {
          p.miss = a < T.loopHopMissChance;
          p.drop = p.miss && b < T.loopDropOnStumbleChance;
        } else if (task.kind === 'bypass') {
          p.extra = Math.max(0, (task.extra || 0) * (1 + (a * 2 - 1) * T.loopBypassJitter));
        }
        void d;   // reserved so adding a per-task choice later does not shift other seeds' plans
        plan.tasks[task.key] = p;
      });
    });
    return plan;
  }

  function create(ctx) {
    const plan = ctx.loopPlan = rollPlan(ctx);
    const seg0 = ctx.loopRoute[0];
    const tasks = {};
    ctx.loopRoute.forEach(function (seg) {
      seg.tasks.forEach(function (task) {
        tasks[task.key] = { key: task.key, kind: task.kind, seg: seg.id, segIndex: seg.index, f: task.f,
                            x: task.x, y: task.y, state: 'pending', t: 0 };
      });
    });
    return {
      loop: { seg: 0, segId: seg0.id, f: seg0.startF, laneX: 0, lane: 0, jumpH: 0, jumpT: 0, airborne: false,
              speed: 0, action: 'idle', task: null, distance: 0, finishTime: null, rank: null, progress: 0,
              form: plan.form, stumbleUntil: 0, hop: null },
      loopTasks: tasks
    };
  }

  function cruise(ctx) {
    const L = ctx.state.loop;
    return ctx.T.loopSpeed * L.form * ctx.loopPlan.segs[L.seg];
  }

  function pendingStitchAt(ctx, segIndex, f) {
    const seg = ctx.loopRoute[segIndex];
    for (let i = 0; i < seg.tasks.length; i++) {
      const task = seg.tasks[i];
      if (task.kind === 'stitch' && ctx.state.loopTasks[task.key].state === 'pending' && task.f >= f - 1e-9) return task;
    }
    return null;
  }

  function droppedAhead(ctx, segIndex, f) {
    const items = ctx.state.items;
    let best = null;
    Object.keys(items).forEach(function (id) {
      const it = items[id];
      if (it.owner === 'loop' && it.status === 'dropped' && it.segIndex === segIndex && it.f >= f - 1e-9 &&
          (!best || it.f < best.f)) best = it;
    });
    return best;
  }

  /* Where Loop must stop on segment `segIndex` at or after f (null if nowhere). */
  function blockIn(ctx, segIndex, f) {
    const L = ctx.state.loop, seg = ctx.loopRoute[segIndex];
    let b = null;
    const task = pendingStitchAt(ctx, segIndex, f);
    if (task) b = task.f;
    const it = droppedAhead(ctx, segIndex, f);
    if (it && (b === null || it.f < b)) b = it.f;
    if (seg.finish !== null && L.finishTime === null && !ctx.inventory.allHeld(ctx.state, 'loop') &&
        seg.finish >= f - 1e-9 && (b === null || seg.finish < b)) b = seg.finish;
    return b;
  }

  function startJump(ctx, L) {
    L.airborne = true; L.jumpT = 0; L.jumpH = 0;
    ctx.emit({ type: 'jump', who: 'loop' });
  }

  function land(ctx, L) {
    const st = ctx.state, T = ctx.T;
    L.airborne = false; L.jumpT = 0; L.jumpH = 0;
    const hop = L.hop;
    L.hop = null;
    if (!hop) return;
    st.loopTasks[hop.key].state = 'done';
    st.loopTasks[hop.key].t = 1;
    if (!hop.miss) return;
    L.action = 'stumble';
    L.stumbleUntil = st.time + T.loopStumble;
    ctx.emit({ type: 'loop-stumble' });
    if (hop.drop) {
      const it = ctx.inventory.mostRecentHeld(st, 'loop');
      if (it) {
        const seg = ctx.loopRoute[L.seg];
        const f = Math.min(L.f + T.loopDropAheadF, seg.exit - 0.04);
        ctx.inventory.drop(ctx, it, L.seg, Math.max(f, L.f), 0);
      }
    }
  }

  function enter(ctx, L, segIndex) {
    L.seg = segIndex;
    L.segId = ctx.loopRoute[segIndex].id;
    ctx.emit({ type: 'segment', who: 'loop', segId: L.segId });
  }

  function crossed(span, f) {
    return (span.entered ? f >= span.f0 - 1e-9 : f > span.f0 + 1e-12) && f <= span.f1 + 1e-12;
  }

  function finish(ctx, L, seg, span) {
    const st = ctx.state;
    const over = (span.f1 - seg.finish) * seg.length;
    L.finishTime = Math.max(0, st.time - (L.speed > 0.01 ? over / L.speed : 0));
    L.action = 'finished';
    L.task = null;
    ctx.emit({ type: 'finish', who: 'loop', time: L.finishTime });
  }

  function update(ctx, dt) {
    const st = ctx.state, T = ctx.T, L = st.loop, R = ctx.loopRoute;
    const now = st.time;
    const accel = T.loopAccel || T.purlAccel;

    if (L.airborne) {
      L.jumpT += dt;
      if (L.jumpT >= T.jumpTime) land(ctx, L);
      else {
        L.jumpH = Math.sin(Math.PI * L.jumpT / T.jumpTime);
        if (L.hop) st.loopTasks[L.hop.key].t = L.jumpT / T.jumpTime;
      }
    }

    let target = L.finishTime !== null ? 0 : cruise(ctx);
    let frozen = false;

    if (L.action === 'stumble') {
      target = 0;
      L.speed = U.approach(L.speed, 0, accel * 3 * dt);
      if (now >= L.stumbleUntil) L.action = 'run';
    }

    const tk = L.task;
    if (tk) {
      const ts = st.loopTasks[tk.key];
      frozen = true;
      if (tk.kind === 'stitch') {
        L.speed = 0;
        while (L.task && now >= tk.until) {
          if (tk.phase === 'react' && tk.hesitate > 0) {
            tk.phase = 'hesitate'; tk.until += tk.hesitate; ts.state = 'hesitate'; L.action = 'hesitate';
          } else if (tk.phase === 'react' || tk.phase === 'hesitate') {
            tk.phase = 'perform'; tk.start = tk.until; tk.until += tk.dur; ts.state = 'active'; L.action = 'task';
            ctx.emit({ type: 'loop-task', kind: 'stitch', key: tk.key });
          } else {
            ts.state = 'done'; ts.t = 1; L.task = null; L.action = 'run';
            ctx.inventory.deliver(ctx, 'loop', tk.segIndex);
          }
        }
        if (L.task && tk.phase === 'perform') ts.t = U.clamp((now - tk.start) / tk.dur, 0, 1);
      } else if (tk.kind === 'bypass') {
        L.speed = U.approach(L.speed, target, accel * dt);
        L.distance += L.speed * dt;
        ts.t = tk.dur > 0 ? U.clamp(1 - (tk.until - now) / tk.dur, 0, 1) : 1;
        if (now >= tk.until) { ts.state = 'done'; ts.t = 1; L.task = null; L.action = 'run'; }
      } else if (tk.kind === 'recover') {
        L.speed = 0;
        if (now >= tk.until) {
          const it = st.items[tk.item];
          ctx.inventory.recover(ctx, it);
          L.task = null; L.action = 'run';
        }
      }
      if (L.task) return;
      frozen = false;
    }
    if (frozen) return;

    const bf = function (i, f) { return blockIn(ctx, i, f); };
    const dBlock = sim.route.blockDistance(R, L.seg, L.f, bf, 40);
    const vCap = Math.sqrt(2 * accel * Math.max(0, dBlock));
    if (L.action !== 'stumble') {
      L.speed = U.approach(L.speed, Math.min(target, vCap), accel * dt);
    }
    if (L.speed > vCap) L.speed = vCap;
    const res = sim.route.walk(R, L, L.speed * dt, bf, null);
    L.distance += L.speed * dt;
    res.entered.forEach(function (i) { enter(ctx, L, i); });

    for (let si = 0; si < res.spans.length; si++) {
      const span = res.spans[si], seg = R[span.seg];
      seg.tasks.forEach(function (task) {
        const ts = st.loopTasks[task.key];
        if (ts.state !== 'pending' || !crossed(span, task.f)) return;
        if (task.kind === 'hop') {
          ts.state = 'active'; ts.t = 0;
          const p = ctx.loopPlan.tasks[task.key];
          L.hop = { key: task.key, miss: p.miss, drop: p.drop };
          ctx.emit({ type: 'loop-task', kind: 'hop', key: task.key });
          startJump(ctx, L);
        } else if (task.kind === 'bypass') {
          const p = ctx.loopPlan.tasks[task.key];
          ts.state = 'active'; ts.t = 0;
          // the extra travel happens here, at the bypass point, out of sight (f holds, he keeps running)
          L.task = { kind: 'bypass', key: task.key, segIndex: span.seg, dur: p.extra, until: now + p.extra };
          L.action = 'task';
          ctx.emit({ type: 'loop-task', kind: 'bypass', key: task.key });
        }
      });
      ctx.inventory.loopPickups(ctx, [span]);
      if (seg.finish !== null && L.finishTime === null && crossed(span, seg.finish) &&
          ctx.inventory.allHeld(st, 'loop')) {
        finish(ctx, L, seg, span);
      }
      if (L.task) break;
    }

    if (L.finishTime !== null) { L.action = 'finished'; return; }
    if (L.task) return;

    // arrived at a block: a stitch task or his own dropped thread
    if (res.blocked && L.speed < 0.05) {
      const task = pendingStitchAt(ctx, L.seg, L.f);
      if (task && Math.abs(task.f - L.f) < 1e-6) {
        const p = ctx.loopPlan.tasks[task.key];
        L.speed = 0;
        L.task = { kind: 'stitch', key: task.key, segIndex: L.seg, phase: 'react', until: now + p.react,
                   hesitate: p.hesitate, dur: p.dur, start: null };
        st.loopTasks[task.key].state = 'react';
        L.action = 'task';
        return;
      }
      const it = droppedAhead(ctx, L.seg, L.f);
      if (it && Math.abs(it.f - L.f) < 1e-6 && L.action !== 'stumble') {
        L.speed = 0;
        L.task = { kind: 'recover', key: 'recover:' + it.id, item: it.id,
                   until: Math.max(it.dropTime + T.loopRecover, now + T.loopRecoverMin) };
        L.action = 'recover';
        return;
      }
    }
    if (L.action !== 'stumble') L.action = R[L.seg].kind === 'connector' ? 'transition' : 'run';
  }

  sim.loopAI = { create: create, update: update, rollPlan: rollPlan };
})(globalThis.WW = globalThis.WW || {});
