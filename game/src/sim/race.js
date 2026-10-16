/* Wishweave Wonders — simulation: the race (docs/ARCHITECTURE.md §7, §12).

   const race = WW.sim.createRace({ seed, level: WW.LEVEL, plates: WW.PLATES, tuning: WW.TUNING });
   race.state / race.step(dt) / race.input(ev) / race.start() / race.pause(reason) / race.resume() / race.debug

   Pure logic: no DOM, no wall clock, no Math.random. Deterministic for a seed + input sequence. Every route
   fraction is read from the plate events here, at createRace time. Loop's random choices come from their own
   stream (sim/loop-ai.js), so his race does not depend on what the player does.

   Extra state fields beyond §7.1/§12 (all read-only for the renderer/UI):
     purl.progress / loop.progress   0..1 along the racer's route to the finish trigger (race-progress thread)
     purl.waitingFor                 stitch id while Purl stands at its stop, else null
     purl.slowUntil, purl.jumpBuffered, loop.lane (always 0), loop.jumpT, loop.airborne, loop.form
     transition.fromSeg/toSeg/fromPlate/toPlate/dur (for every kind; connector `from`/`to` are plate ids as in
                                     WW.LEVEL, loop/return `from`/`to` are segment ids per §12.3)
     items[id].segIndex/size/homeSeg/homeF, stitches[id].elapsed/openedAt/phaseT/seg/f/readyF,
     loopTasks[key] = { key, kind, seg, segIndex, f, x, y, state: 'pending'|'react'|'hesitate'|'active'|'done', t }
   `purl.airborne` is true for the whole jump; contact rules use jumpH.

   TUTORIAL HOLD (the first lesson, kit/pull-stitch): while Purl waits at a stop whose stitch has `tutorial: true`
   (the opening ribbon pull) and it is not yet passable, `state.tutorial = {id, stage}` with stage
   'touch' | 'pull' | 'unfurl' | 'settle'. During the hold the race clock does not advance and neither racer's
   route progress, tasks or timers move (Loop keeps his exact position and speed; the renderer shows both idle).
   Only the stitch itself (gesture, unfurl, settle) advances. When the route is ready the hold ends and both
   racers continue from where they were. Outside the hold nothing changes: Loop stays fully autonomous. */
(function (WW) {
  'use strict';
  const sim = WW.sim = WW.sim || {};
  const U = WW.util;

  /* Sim-only tuning defaults for values that are not in WW.TUNING (WW.TUNING / createRace({tuning}) override). */
  const DEFAULTS = {
    laneMinSpacing: 20,          // §12.4: lane spacing (plate px) below which the path is single file
    connectorLaneSpacing: 100,   // connectors are broad carpet turns: lanes stay available there
    messageTime: 1.8,            // s a HUD message ("SNAGGED!", "THREAD RECOVERED", ...) stays up
    hintTime: 4.5,               // s a plate `hint` stays up
    gateOpenTime: 1.2,           // s for the flower gate to open once Purl arrives complete
    returnTime: 3.0,             // s of the gate-fallback `return` transition
    loopRecoverMin: 0.3,         // s Loop at least spends picking his dropped thread back up
    loopAccel: null              // m/s²; null = purlAccel
  };

  /* ---------- route tables ---------- */

  function parseRoute(level, plates, which) {
    const defs = which === 'purl' ? level.route : level.loopRoute;
    if (!Array.isArray(defs) || !defs.length) throw new Error('WW.sim: level ' + which + ' route is empty');
    let cum = 0;
    return defs.map(function (d, i) {
      const s = { index: i, id: d.id, kind: d.kind, length: d.length, plate: d.plate || null, from: d.from || null,
                  to: d.to || null, style: d.style || null, def: d, path: null, startF: 0, exit: 1, finish: null,
                  reveal: null, loopReturn: null, stops: [], pickups: [], tasks: [], hints: [], cum: 0 };
      if (!(d.length > 0)) throw new Error('WW.sim: segment ' + d.id + ' needs a positive length');
      if (d.kind === 'plate') {
        const plate = plates[d.plate];
        if (!plate || !plate[which]) throw new Error('WW.sim: plate ' + d.plate + ' has no ' + which + ' route');
        s.path = plate[which].path;
        const counts = {};
        (plate[which].events || []).slice().sort(function (a, b) { return a.f - b.f; }).forEach(function (ev) {
          switch (ev.type) {
            case 'start': s.startF = ev.f; break;
            case 'stop': s.stops.push({ stitch: ev.stitch, f: ev.f, readyF: ev.readyF == null ? 0 : ev.readyF }); break;
            case 'pickup': s.pickups.push({ item: ev.item, f: ev.f, lane: ev.lane || 0, size: ev.size }); break;
            case 'reveal': s.reveal = ev.f; break;
            case 'loopReturn': s.loopReturn = ev.f; break;
            case 'exit': s.exit = ev.f; break;
            case 'finish': s.finish = ev.f; break;
            case 'hint': s.hints.push({ f: ev.f, text: ev.text }); break;
            case 'task': {
              const n = counts[ev.kind] = (counts[ev.kind] || 0) + 1;
              s.tasks.push({ key: d.id + ':' + ev.kind + (n > 1 ? n : ''), kind: ev.kind, f: ev.f, x: ev.x, y: ev.y,
                             dur: ev.dur == null ? null : ev.dur, extra: ev.extra || 0 });
              break;
            }
            default: break;
          }
        });
      } else if (d.kind !== 'connector') {
        throw new Error('WW.sim: segment ' + d.id + ' has unknown kind ' + d.kind);
      }
      s.cum = cum;
      cum += (s.exit - (i === 0 ? s.startF : 0)) * s.length;
      return s;
    });
  }

  /* Metres from (seg, f) to the first block (blockIn(seg, f) → f or null), the end of the route, or Infinity
     beyond `look` metres. */
  function blockDistance(R, seg, f, blockIn, look) {
    let d = 0;
    for (;;) {
      const s = R[seg];
      const b = blockIn(seg, f);
      if (b !== null && b <= s.exit) return d + Math.max(0, b - f) * s.length;
      d += Math.max(0, s.exit - f) * s.length;
      if (seg >= R.length - 1) return d;
      if (d > look) return Infinity;
      seg += 1; f = 0;
    }
  }

  /* Move pos ({seg, f}) forward by dm metres, stopping at blocks, the route end, or an exit canLeave refuses.
     Returns { spans: [{seg, f0, f1, entered}], entered: [segIndex], blocked, leftover }. */
  function walk(R, pos, dm, blockIn, canLeave) {
    const spans = [], entered = [];
    let seg = pos.seg, f = pos.f, rem = dm, blocked = false;
    let span = { seg: seg, f0: f, f1: f, entered: false };
    spans.push(span);
    for (;;) {
      const s = R[seg];
      const b = blockIn(seg, f);
      const end = b !== null ? Math.min(b, s.exit) : s.exit;
      const need = Math.max(0, end - f) * s.length;
      if (rem < need) { f += rem / s.length; rem = 0; break; }
      f = Math.max(f, end); rem -= need;
      if (b !== null && b <= s.exit) { blocked = true; break; }
      if (seg >= R.length - 1 || (canLeave && !canLeave(seg))) { blocked = true; break; }
      if (rem <= 0) break;
      span.f1 = f;
      seg += 1; f = 0;
      entered.push(seg);
      span = { seg: seg, f0: 0, f1: 0, entered: true };
      spans.push(span);
    }
    span.f1 = f;
    pos.seg = seg; pos.f = f;
    return { spans: spans, entered: entered, blocked: blocked, leftover: rem };
  }

  function crossed(span, f) {
    return (span.entered ? f >= span.f0 - 1e-9 : f > span.f0 + 1e-12) && f <= span.f1 + 1e-12;
  }

  sim.route = { parse: parseRoute, blockDistance: blockDistance, walk: walk, crossed: crossed };

  /* ---------- the race ---------- */

  function createRace(opts) {
    opts = opts || {};
    const level = opts.level || WW.LEVEL, plates = opts.plates || WW.PLATES;
    const seed = opts.seed == null ? 1 : opts.seed;
    const L0 = level.loop || {};
    const T = Object.assign({}, DEFAULTS, {
      loopForm: L0.form || [1, 1], loopBypassJitter: L0.bypassJitter || 0, loopDropAheadF: L0.dropAheadF || 0.05
    }, WW.TUNING, opts.tuning || {});

    const route = parseRoute(level, plates, 'purl');
    const loopRoute = parseRoute(level, plates, 'loop');
    if (loopRoute.length !== route.length) throw new Error('WW.sim: loopRoute must be index-aligned with route');
    route.forEach(function (s, i) {
      const l = loopRoute[i];
      if (l.id !== s.id || l.kind !== s.kind || l.plate !== s.plate) {
        throw new Error('WW.sim: loopRoute[' + i + '] (' + l.id + ') does not match route[' + i + '] (' + s.id + ')');
      }
    });
    const segIndex = {};
    route.forEach(function (s, i) { segIndex[s.id] = i; });
    const finishSeg = route.filter(function (s) { return s.finish !== null; })[0];
    if (!finishSeg) throw new Error('WW.sim: no finish event on Purl\'s route');
    const loopFinishSeg = loopRoute.filter(function (s) { return s.finish !== null; })[0];
    if (!loopFinishSeg) throw new Error('WW.sim: no finish event on Loop\'s route');

    const ctx = {
      T: T, level: level, plates: plates, route: route, loopRoute: loopRoute, segIndex: segIndex,
      rngLoop: WW.rng(seed), rngSnag: WW.rng(((seed >>> 0) ^ 0x5bd1e995) >>> 0),
      heldCounter: 0, events: [], waitUntil: Infinity,
      inventory: sim.inventory, stitches: sim.stitches,
      purlTotal: finishSeg.cum + finishSeg.finish * finishSeg.length,
      loopTotal: loopFinishSeg.cum + loopFinishSeg.finish * loopFinishSeg.length
    };
    ctx.emit = function (ev) { ctx.events.push(ev); return ev; };
    ctx.message = function (text, kind, dur) {
      ctx.state.message = { text: text, kind: kind || 'info', until: ctx.state.time + (dur || T.messageTime) };
    };
    ctx.refreshObjective = function () { refreshObjective(ctx); };

    // Loop's default stitch performance = Purl's animation time for that plate's stitch.
    loopRoute.forEach(function (seg, i) {
      seg.tasks.forEach(function (task) {
        if (task.kind !== 'stitch' || task.dur != null) return;
        const id = Object.keys(level.stitches || {}).filter(function (k) { return level.stitches[k].seg === route[i].id; })[0];
        task.dur = sim.stitches.totalTime(T, id ? (level.stitches[id].kind || id) : 'ribbon');
      });
      seg.tasks.forEach(function (task) { if (task.kind === 'stitch') task.dur += T.routeSettle; });
    });

    const loopInit = sim.loopAI.create(ctx);
    const seg0 = route[0];
    const st = ctx.state = {
      mode: 'intro', paused: false, pauseReason: null, time: 0, countdown: T.countdown, seed: seed,
      purl: { seg: 0, segId: seg0.id, f: seg0.startF, lane: 0, laneX: 0, jumpT: 0, jumpH: 0, speed: 0,
              action: 'idle', airborne: false, jumpBuffered: false, immuneUntil: 0, tangledUntil: 0, slowUntil: 0,
              distance: 0, finishTime: null, rank: null, progress: 0, waitingFor: null, failAt: null },
      loop: loopInit.loop,
      items: null,
      held: { purl: 0, loop: 0 },
      stitches: null,
      loopTasks: loopInit.loopTasks,
      snagling: sim.snagling.create(ctx),
      gate: { state: 'closed', t: 0 },
      objective: seg0.def.objective || '', phase: seg0.def.phase || '',
      message: null, hint: null, transition: null, result: null, tutorial: null,
      stats: { hits: 0, dodges: 0, recoveries: 0, taps: 0, pulls: 0 }
    };
    st.items = sim.inventory.create(ctx);
    st.stitches = sim.stitches.create(ctx);
    sim.inventory.recount(st);
    updateProgress(ctx);

    const race = {
      state: st,
      info: { route: route, loopRoute: loopRoute, plan: ctx.loopPlan, tuning: T },
      events: [],
      step: function (dt) { ctx.events = []; step(ctx, dt); race.events = ctx.events; return ctx.events; },
      input: function (ev) { ctx.events = []; input(ctx, ev); return ctx.events; },
      start: function () {
        if (st.mode === 'intro') { st.mode = 'countdown'; st.countdown = T.countdown; }
        return st.mode;
      },
      pause: function (reason) { st.paused = true; st.pauseReason = reason || 'user'; sim.stitches.releaseAll(ctx); },
      resume: function () { st.paused = false; st.pauseReason = null; },
      debug: makeDebug(ctx)
    };
    return race;
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
    if (st.mode === 'running') {
      if (tutorialHold(ctx)) {
        // First lesson: the race clock and both racers' progress stand still; only the stitch moves.
        sim.stitches.update(ctx, dt);
        tutorialHold(ctx);
        updateProgress(ctx);
        return;
      }
      st.time += dt;
      expire(ctx);
      sim.stitches.update(ctx, dt);
      const spans = updatePurl(ctx, dt);
      sim.snagling.update(ctx, dt, spans);
      sim.loopAI.update(ctx, dt);
      settleFinish(ctx);
      tutorialHold(ctx);                 // report the lesson from the step Purl arrives in
      const p = st.purl;
      if (p.failAt !== null && st.mode === 'running' && st.time >= p.failAt - 1e-9) {
        st.mode = 'failed';
        p.action = 'failed';
        p.speed = 0;
        ctx.emit({ type: 'fail' });
      }
    } else if (st.mode === 'finished') {
      const racing = st.result && st.result.loopStillRacing;
      if (racing) st.time += dt;
      expire(ctx);
      coastPurl(ctx, dt);
      if (racing) sim.loopAI.update(ctx, dt);
      settleFinish(ctx);
    } else if (st.mode === 'failed') {
      return;
    }
    if (st.gate.state === 'opening') {
      st.gate.t = Math.min(1, st.gate.t + dt / T.gateOpenTime);
      if (st.gate.t >= 1) st.gate.state = 'open';
    }
    updateProgress(ctx);
  }

  /* Sets state.tutorial and returns true while the first-lesson hold applies (see the header). */
  function tutorialHold(ctx) {
    const st = ctx.state, p = st.purl;
    let t = null;
    // Purl must be standing at the stop (landed, lane settled) before the world freezes around him.
    if (p.waitingFor && p.finishTime === null && !st.transition && !p.airborne && Math.abs(p.laneX - p.lane) < 1e-3) {
      const s = st.stitches[p.waitingFor];
      if (s && s.tutorial && s.segIndex === p.seg && !sim.stitches.passable(ctx, s.id)) {
        const stage = s.state === 'open' ? 'settle' : s.state === 'animating' ? 'unfurl' :
          (s.gripping || s.pull > 0) ? 'pull' : 'touch';
        t = { id: s.id, stage: stage };
      }
    }
    st.tutorial = t;
    return !!t;
  }

  function expire(ctx) {
    const st = ctx.state;
    if (st.message && st.time >= st.message.until) st.message = null;
    if (st.hint && st.time >= st.hint.until) st.hint = null;
  }

  function updateProgress(ctx) {
    const st = ctx.state, p = st.purl, L = st.loop;
    const ps = ctx.route[p.seg], ls = ctx.loopRoute[L.seg];
    p.progress = U.clamp((ps.cum + (p.f - (p.seg === 0 ? ps.startF : 0)) * ps.length) / ctx.purlTotal, 0, 1);
    L.progress = U.clamp((ls.cum + (L.f - (L.seg === 0 ? ls.startF : 0)) * ls.length) / ctx.loopTotal, 0, 1);
  }

  /* ---------- Purl ---------- */

  function purlTarget(ctx) {
    const st = ctx.state, T = ctx.T, p = st.purl;
    if (st.time < p.tangledUntil) return 0;
    return T.purlSpeed * (st.time < p.slowUntil ? T.slowAfterHit : 1);
  }

  function purlBlockIn(ctx, segIndex, f) {
    const seg = ctx.route[segIndex];
    let b = null;
    for (let i = 0; i < seg.stops.length; i++) {
      const stop = seg.stops[i];
      if (stop.f >= f - 1e-9 && ctx.state.stitches[stop.stitch] && !sim.stitches.passable(ctx, stop.stitch)) {
        if (b === null || stop.f < b) b = stop.f;
      }
    }
    return b;
  }

  function purlDroppedOn(ctx, segIndex) {
    const items = ctx.state.items;
    return Object.keys(items).some(function (id) {
      const it = items[id];
      return it.owner === 'purl' && it.status === 'dropped' && it.segIndex === segIndex;
    });
  }

  /* The recovery loop (§7.5): leaving a segment that has a loopReturn while a purl.* thread lies dropped on it. */
  function purlCanLeave(ctx, segIndex) {
    return ctx.route[segIndex].loopReturn === null || !purlDroppedOn(ctx, segIndex);
  }

  function laneSpacing(ctx, seg, f) {
    if (seg.kind !== 'plate') return ctx.T.connectorLaneSpacing;
    return WW.path.sample(seg.path, f).lane;
  }

  function startJump(ctx, p) {
    p.airborne = true; p.jumpT = 0; p.jumpH = 0; p.jumpBuffered = false;
    ctx.emit({ type: 'jump', who: 'purl' });
  }

  function stepJump(ctx, p, dt) {
    if (!p.airborne) return;
    const T = ctx.T;
    p.jumpT += dt;
    if (p.jumpT >= T.jumpTime) {
      p.airborne = false; p.jumpT = 0; p.jumpH = 0;
      if (p.jumpBuffered && ctx.state.time >= p.tangledUntil) startJump(ctx, p);
      p.jumpBuffered = false;
    } else {
      p.jumpH = Math.sin(Math.PI * p.jumpT / T.jumpTime);
    }
  }

  function stepLane(ctx, p, dt) {
    const T = ctx.T;
    const seg = ctx.state.transition && ctx.state.transition.kind !== 'connector' ? null : ctx.route[p.seg];
    if (seg && laneSpacing(ctx, seg, p.f) < T.laneMinSpacing) p.lane = 0;
    p.laneX = U.approach(p.laneX, p.lane, dt / T.laneChangeTime);
  }

  function setTransitionFor(ctx, segIndex) {
    const st = ctx.state, R = ctx.route, s = R[segIndex];
    if (s.kind === 'connector') {
      const prev = R[segIndex - 1], next = R[segIndex + 1];
      st.transition = { kind: 'connector', from: s.from, to: s.to, style: s.style, t: st.purl.f,
                        fromSeg: prev ? prev.id : null, toSeg: next ? next.id : null,
                        fromPlate: s.from, toPlate: s.to, dur: s.length / ctx.T.purlSpeed };
    } else {
      st.transition = null;
    }
  }

  function enterPurl(ctx, segIndex) {
    const st = ctx.state;
    ctx.emit({ type: 'segment', who: 'purl', segId: ctx.route[segIndex].id });
    st.purl.segId = ctx.route[st.purl.seg].id;
    const s = ctx.route[st.purl.seg];
    if (s.kind === 'plate') {
      if (s.def.phase) st.phase = s.def.phase;
      refreshObjective(ctx);
    }
    setTransitionFor(ctx, st.purl.seg);
    if (s.reveal !== null && !st.snagling.armed) sim.snagling.rearm(ctx);   // a new pass over the landing
  }

  function refreshObjective(ctx) {
    const st = ctx.state, p = st.purl;
    let seg = ctx.route[p.seg];
    if (p.finishTime !== null) { st.objective = ctx.level.completeObjective || seg.def.objectiveDone || st.objective; return; }
    // On a connector the objective still belongs to the plate just left (e.g. a pickup right at its exit).
    if (seg.kind !== 'plate') {
      if (seg.index > 0 && ctx.route[seg.index - 1].kind === 'plate') seg = ctx.route[seg.index - 1];
      else return;
    }
    const def = seg.def;
    let obj = def.objective || st.objective;
    const sid = Object.keys(st.stitches || {}).filter(function (k) { return st.stitches[k].segIndex === seg.index; })[0];
    const stitchOpen = !sid || st.stitches[sid].state === 'open';
    if (sid && stitchOpen && def.objectiveOpen) obj = def.objectiveOpen;
    const own = Object.keys(st.items || {}).map(function (k) { return st.items[k]; })
      .filter(function (it) { return it.owner === 'purl' && it.homeSeg === seg.id; });
    if (stitchOpen && def.objectiveDone && (own.length ? own.every(function (it) { return it.status === 'held'; }) : !!sid)) {
      obj = def.objectiveDone;
    }
    if (purlDroppedOn(ctx, seg.index)) obj = def.objectiveDrop || 'GET YOUR THREAD BACK';
    st.objective = obj;
  }

  function startSpecialTransition(ctx, kind, toIndex, toF) {
    const st = ctx.state, p = st.purl, R = ctx.route;
    st.transition = { kind: kind, from: R[p.seg].id, to: R[toIndex].id, style: kind, t: 0,
                      fromSeg: R[p.seg].id, toSeg: R[toIndex].id, fromPlate: R[p.seg].plate, toPlate: R[toIndex].plate,
                      dur: kind === 'loop' ? ctx.T.recoveryLoopTime : ctx.T.returnTime, toIndex: toIndex, toF: toF };
    p.action = kind === 'loop' ? 'looping' : 'returning';
  }

  function endSpecialTransition(ctx) {
    const st = ctx.state, p = st.purl, tr = st.transition;
    p.seg = tr.toIndex;
    p.f = tr.toF;
    st.transition = null;
    enterPurl(ctx, p.seg);
  }

  function gateBlocked(ctx) {
    const st = ctx.state;
    ctx.emit({ type: 'gate-blocked' });
    ctx.message(ctx.level.missingMessage || 'A THREAD IS MISSING', 'info', 2.4);
    const miss = sim.inventory.earliestMissing(ctx, 'purl');
    const toIndex = miss ? miss.segIndex : st.purl.seg;
    const target = ctx.route[toIndex];
    if (miss && miss.status === 'uncollected') miss.available = true;   // never a dead end
    startSpecialTransition(ctx, 'return', toIndex, target.loopReturn !== null ? target.loopReturn : 0);
  }

  function finishPurl(ctx, seg, span) {
    const st = ctx.state, p = st.purl;
    const over = (span.f1 - seg.finish) * seg.length;
    p.finishTime = Math.max(0, st.time - (p.speed > 0.01 ? over / p.speed : 0));
    p.action = 'finished';
    p.waitingFor = null;
    st.gate.state = 'opening';
    st.gate.t = 0;
    ctx.emit({ type: 'finish', who: 'purl', time: p.finishTime });
    ctx.emit({ type: 'gate-open' });
    refreshObjective(ctx);
  }

  function updatePurl(ctx, dt) {
    const st = ctx.state, T = ctx.T, p = st.purl, R = ctx.route;
    stepJump(ctx, p, dt);
    stepLane(ctx, p, dt);

    const tr = st.transition;
    if (tr && (tr.kind === 'loop' || tr.kind === 'return')) {
      p.speed = U.approach(p.speed, purlTarget(ctx), T.purlAccel * dt);
      p.distance += p.speed * dt;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      if (tr.t < 1) { p.action = tr.kind === 'loop' ? 'looping' : 'returning'; return []; }
      endSpecialTransition(ctx);
    }

    const tangled = st.time < p.tangledUntil;
    const target = purlTarget(ctx);
    const bf = function (i, f) { return purlBlockIn(ctx, i, f); };
    const dB = blockDistance(R, p.seg, p.f, bf, 40);
    const vCap = Math.sqrt(2 * T.purlAccel * Math.max(0, dB));
    if (tangled) p.speed = 0;
    else p.speed = U.approach(p.speed, Math.min(target, vCap), T.purlAccel * dt);
    if (p.speed > vCap) p.speed = vCap;

    const res = walk(R, p, p.speed * dt, bf, function (i) { return purlCanLeave(ctx, i); });
    p.distance += p.speed * dt - res.leftover;
    res.entered.forEach(function (i) { enterPurl(ctx, i); });
    if (R[p.seg].kind === 'connector' && st.transition) st.transition.t = p.f;

    for (let si = 0; si < res.spans.length; si++) {
      const span = res.spans[si], seg = R[span.seg];
      seg.hints.forEach(function (h) {
        if (crossed(span, h.f)) st.hint = { text: h.text, until: st.time + T.hintTime };
      });
      sim.inventory.purlPickups(ctx, [span]);
      if (seg.finish !== null && p.finishTime === null && crossed(span, seg.finish)) {
        if (sim.inventory.allHeld(st, 'purl')) finishPurl(ctx, seg, span);
        else { gateBlocked(ctx); return res.spans.slice(0, si + 1); }
      }
    }
    if (p.finishTime !== null) return res.spans;

    // recovery loop: stopped at the landing exit with a dropped thread behind
    const cur = R[p.seg];
    if (res.blocked && cur.loopReturn !== null && p.f >= cur.exit - 1e-9 && !purlCanLeave(ctx, p.seg)) {
      startSpecialTransition(ctx, 'loop', p.seg, cur.loopReturn);
      return res.spans;
    }

    p.waitingFor = null;
    if (p.speed < 0.05) {
      cur.stops.forEach(function (stop) {
        if (Math.abs(stop.f - p.f) * cur.length < 0.05 && st.stitches[stop.stitch] &&
            !sim.stitches.passable(ctx, stop.stitch)) p.waitingFor = stop.stitch;
      });
    }
    if (tangled || p.failAt !== null) p.action = 'tangled';
    else if (cur.kind === 'connector') p.action = 'transition';
    else if (p.waitingFor) p.action = 'wait';
    else p.action = 'run';
    return res.spans;
  }

  function coastPurl(ctx, dt) {
    const p = ctx.state.purl, T = ctx.T;
    stepJump(ctx, p, dt);
    stepLane(ctx, p, dt);
    p.speed = U.approach(p.speed, 0, T.purlAccel * dt);
    if (p.speed <= 0) return;
    const res = walk(ctx.route, p, p.speed * dt, function () { return null; }, null);
    p.distance += p.speed * dt - res.leftover;
    if (res.blocked) p.speed = 0;
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
    if (!ev || st.paused || st.mode !== 'running') return;
    if (ev.type === 'tap') {
      st.stats.taps += 1;
      sim.stitches.tap(ctx, ev.target);
      return;
    }
    if (ev.type === 'pull') {
      // A grip can only start once Purl stands at that stitch's stop (he must be in reach of the loop).
      if (ev.phase === 'start' && p.waitingFor !== ev.target) return;
      if (sim.stitches.pull(ctx, ev.target, ev.phase, +ev.amount || 0)) {
        if (ev.phase === 'start') st.stats.pulls = (st.stats.pulls || 0) + 1;
        tutorialHold(ctx);
      }
      return;
    }
    if (ev.type !== 'swipe' || p.finishTime !== null || p.failAt !== null) return;
    if (st.tutorial) return;             // standing at the first lesson: no jumps or lane changes (they would freeze)
    if (ev.dir === 'left' || ev.dir === 'right') {
      const special = st.transition && st.transition.kind !== 'connector';
      const spacing = special ? T.connectorLaneSpacing : laneSpacing(ctx, ctx.route[p.seg], p.f);
      if (spacing < T.laneMinSpacing) return;
      const lane = U.clamp(p.lane + (ev.dir === 'left' ? -1 : 1), -1, 1);
      if (lane !== p.lane) { p.lane = lane; ctx.emit({ type: 'lane', who: 'purl', lane: lane }); }
    } else if (ev.dir === 'up') {
      if (st.time < p.tangledUntil) return;
      if (!p.airborne) startJump(ctx, p);
      else if (T.jumpTime - p.jumpT <= T.inputBufferTime) p.jumpBuffered = true;
    }
  }

  /* ---------- debug helpers (tests) ---------- */

  function makeDebug(ctx) {
    return {
      ctx: ctx,
      teleport: function (who, segId, f) {
        const st = ctx.state, i = ctx.segIndex[segId];
        if (i === undefined) throw new Error('unknown segment ' + segId);
        if (who === 'loop') {
          const L = st.loop;
          L.seg = i; L.segId = segId; L.f = f || 0; L.speed = 0; L.task = null; L.hop = null;
          L.airborne = false; L.jumpH = 0; L.action = ctx.loopRoute[i].kind === 'connector' ? 'transition' : 'run';
        } else {
          const p = st.purl;
          p.seg = i; p.segId = segId; p.f = f || 0; p.speed = 0; st.transition = null;
          setTransitionFor(ctx, i);
          if (ctx.route[i].kind === 'plate' && ctx.route[i].def.phase) st.phase = ctx.route[i].def.phase;
          refreshObjective(ctx);
        }
        updateProgress(ctx);
        return st[who === 'loop' ? 'loop' : 'purl'];
      },
      setItem: function (id, patch) {
        const it = ctx.state.items[id];
        if (!it) throw new Error('unknown item ' + id);
        Object.assign(it, patch || {});
        if (patch && patch.seg !== undefined) {
          const R = it.owner === 'purl' ? ctx.route : ctx.loopRoute;
          it.segIndex = R.findIndex(function (s) { return s.id === patch.seg; });
        }
        if (patch && patch.status === 'held' && !it.heldSeq) it.heldSeq = ++ctx.heldCounter;
        if (patch && patch.status === 'dropped' && it.dropTime === null) it.dropTime = ctx.state.time;
        sim.inventory.recount(ctx.state);
        refreshObjective(ctx);
        return it;
      },
      openStitch: function (id) {
        const s = ctx.state.stitches[id];
        s.state = 'animating'; s.elapsed = sim.stitches.totalTime(ctx.T, s.kind) + 1;
        sim.stitches.update(ctx, 0);
        if (s.state !== 'open') { s.state = 'animating'; }
        s.openedAt = ctx.state.time - ctx.T.routeSettle;
        s.settle = ctx.T.routeSettle;
        if (s.interaction === 'pull') { s.pull = 1; s.gripping = false; }
        return s;
      },
      setLoopForm: function (form) { ctx.state.loop.form = form; return form; },
      /* JSON-safe deep copy of the state (for the e2e harness). */
      snapshot: function () { return JSON.parse(JSON.stringify(ctx.state)); },
      /* Purl holds all three threads (helper for finish / gate tests). */
      giveAll: function () {
        ['coral', 'teal', 'gold'].forEach(function (c) {
          const it = ctx.state.items['purl.' + c];
          if (it.status !== 'held') { it.status = 'held'; it.available = true; it.heldSeq = ++ctx.heldCounter; }
        });
        sim.inventory.recount(ctx.state);
        return ctx.state.held.purl;
      },
      /* Make Purl immune / not immune right now (seconds from now; 0 clears). */
      setImmunity: function (seconds) { ctx.state.purl.immuneUntil = ctx.state.time + (seconds || 0); },
      forceReveal: function () { return sim.snagling.forceReveal ? sim.snagling.forceReveal(ctx) : false; },
      loopPlan: function () { return ctx.loopPlan; }
    };
  }

  sim.createRace = createRace;
  sim.DEFAULTS = DEFAULTS;
})(globalThis.WW = globalThis.WW || {});
