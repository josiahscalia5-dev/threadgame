/* Wishweave Wonders — race simulation (WW.sim).

   Pure logic: no DOM, no wall clock. Deterministic for a given seed and input sequence, so it runs the same in the
   browser, the Android WebView and Node tests.

     const race = WW.sim.createRace({ seed });
     race.start();                       // intro → 3 s countdown → running
     race.step(1 / 60);                  // returns this step's events (pickup, drop, hit, finish, ...)
     race.input({ type: 'swipe', dir: 'left' | 'right' | 'up' | 'down' });
     race.input({ type: 'tap' });        // a tap jumps, like swipe up
     race.pause(reason); race.resume();
     race.state                          // read-only for callers

   Purl (the player, red/coral) auto-runs along WW.LEVEL.route; Loop (the computer rival, teal) runs his own
   index-aligned route. Each racer has three unique threads (coral, teal, gold) and finishes only holding all three.
   Snagling ambushes Purl on the landing (p04): a hit drops his newest thread onto the carpet ahead, where he can
   steer into it to get it back; missing it sends him round a short loop for another try. Hit with no threads left
   = a gentle fail. Loop has his own stumbles and drops and is never slowed or sped up because of the player. */
(function (WW) {
  'use strict';
  const U = WW.util;

  function eventsOf(list, type) { return (list || []).filter(function (e) { return e.type === type; }); }
  function firstF(list, type, fallback) { const e = eventsOf(list, type)[0]; return e ? e.f : fallback; }

  /* Static description of both routes: lengths, windows and every event converted to segment fractions. */
  function buildCourse(level, plates) {
    const purl = level.route.map(function (def, i) {
      const s = { index: i, id: def.id, kind: def.kind, plate: def.plate || null, length: def.length, run: def.run || def.length, def: def };
      if (def.kind === 'plate') {
        const P = plates[def.plate];
        s.path = P.purl.path;
        s.events = (P.purl.events || []).slice().sort(function (a, b) { return a.f - b.f; });
        s.exitF = firstF(s.events, 'exit', 1);
        s.finishF = firstF(s.events, 'finish', null);
        s.loopReturnF = firstF(s.events, 'loopReturn', 0);
        s.startF = firstF(s.events, 'start', 0);
      } else {
        s.from = def.from; s.to = def.to; s.style = def.style; s.events = [];
      }
      return s;
    });
    const loop = level.loopRoute.map(function (def, i) {
      const s = { index: i, id: def.id, kind: def.kind, plate: def.plate || null, length: def.length, run: def.length, window: def.window };
      if (def.kind === 'plate') {
        const P = plates[def.plate];
        const a = def.window[0], b = def.window[1];
        s.path = P.loop.path;
        s.toSeg = function (pathF) { return a + pathF * (b - a); };
        s.toPath = function (segF) { return (segF - a) / (b - a); };
        s.events = (P.loop.events || []).map(function (e) {
          const out = Object.assign({}, e);
          out.pathF = e.f; out.f = s.toSeg(e.f);
          return out;
        }).sort(function (x, y) { return x.f - y.f; });
        s.finishF = firstF(s.events, 'finish', null);
      } else {
        s.from = def.from; s.to = def.to; s.style = def.style; s.events = [];
      }
      return s;
    });
    /* Start distance of every segment; `total` is the distance to the finish line (HUD progress reaches 1 there). */
    function cumulative(segs) {
      let total = 0;
      const start = segs.map(function (s) { const v = total; total += s.run; return v; });
      const last = segs[segs.length - 1];
      return { start: start, total: start[segs.length - 1] + (last.finishF !== null && last.finishF !== undefined ? last.finishF : 1) * last.length };
    }
    return { purl: purl, loop: loop, purlCum: cumulative(purl), loopCum: cumulative(loop) };
  }

  function createRace(opts) {
    opts = opts || {};
    const level = opts.level || WW.LEVEL, plates = opts.plates || WW.PLATES, T = opts.tuning || WW.TUNING;
    const seed = (opts.seed >>> 0) || 1;
    const rng = WW.rng(seed);
    const course = buildCourse(level, plates);
    const PS = course.purl, LS = course.loop;
    const segIndex = {};
    PS.forEach(function (s) { segIndex[s.id] = s.index; });

    /* Everything random about Loop is drawn up front, so his race never depends on frame timing or the player. */
    const form = rng.range(T.loopForm[0], T.loopForm[1]);
    const jitter = LS.map(function () { return 1 + rng.range(-T.loopSpeedJitter, T.loopSpeedJitter); });
    const loopTasks = [];
    LS.forEach(function (s) {
      s.events.forEach(function (e) {
        if (e.type !== 'task') return;
        const t = { seg: s.index, f: e.f, kind: e.kind, done: false };
        if (e.kind === 'hesitate') {
          t.active = rng.chance(T.loopHesitateChance);
          t.dur = rng.range(T.loopHesitate[0], T.loopHesitate[1]);
        } else if (e.kind === 'hop') {
          t.miss = rng.chance(T.loopHopMissChance);
          t.drop = rng.chance(T.loopDropOnStumbleChance);
        }
        loopTasks.push(t);
      });
    });

    /* Six unique thread IDs. Purl's gold is delivered by the butterfly, so it starts unavailable. */
    const items = {};
    PS.forEach(function (s) {
      eventsOf(s.events, 'pickup').forEach(function (e) {
        items['purl.' + e.item] = { id: 'purl.' + e.item, owner: 'purl', color: e.item, status: 'uncollected',
          available: e.item !== 'gold', seg: s.index, f: e.f, lane: e.lane || 0, size: e.size,
          heldSeq: 0, dropTime: null, fromF: null, fromLane: null };
      });
    });
    LS.forEach(function (s) {
      eventsOf(s.events, 'pickup').forEach(function (e) {
        items['loop.' + e.item] = { id: 'loop.' + e.item, owner: 'loop', color: e.item, status: 'uncollected',
          available: true, seg: s.index, f: e.f, pathF: e.pathF, lane: 0, size: e.size,
          heldSeq: 0, dropTime: null };
      });
    });

    const state = {
      mode: 'intro', paused: false, pauseReason: null,
      time: 0, countdown: T.countdown, seed: seed,
      purl: { seg: 0, segId: PS[0].id, f: PS[0].startF || 0, lane: 0, laneX: 0, jumpT: -1, jumpH: 0, jumpBuffer: -1,
              speed: 0, action: 'idle', airborne: false, immuneUntil: -1, tangledUntil: -1, slowUntil: -1,
              distance: 0, progress: 0, finishTime: null, rank: null, trans: null, failAt: null },
      loop: { seg: 0, segId: LS[0].id, f: 0, laneX: 0, jumpT: -1, jumpH: 0, speed: 0, action: 'idle',
              distance: 0, progress: 0, finishTime: null, rank: null, stumbleUntil: -1, hesitateUntil: -1,
              pendingStumble: null, form: form },
      items: items,
      held: { purl: 0, loop: 0 },
      snagling: { state: 'concealed', t: 0, targetLane: 0, targetF: 0, pass: 0, armed: true, contactConsumed: false, hit: false },
      butterfly: { state: 'rest', t: 0 },
      tassels: { t: -1 },
      gate: { state: 'closed', t: 0, opener: null },
      objective: PS[0].def.objective, phase: PS[0].def.phase,
      message: null, hint: null, leader: null,
      result: null,
      stats: { hits: 0, dodges: 0, recoveries: 0, jumps: 0, lanes: 0, loops: 0 }
    };
    let heldCounter = 0, lastOvertake = -10;

    // ---------------------------------------------------------------- helpers
    function countHeld() {
      let p = 0, l = 0;
      for (const id in items) if (items[id].status === 'held') { if (items[id].owner === 'purl') p++; else l++; }
      state.held.purl = p; state.held.loop = l;
    }
    function say(text, kind, secs) { state.message = { text: text, kind: kind || 'info', until: state.time + (secs || 1.6) }; }
    function hint(text, secs) { state.hint = { text: text, until: state.time + (secs || 3.5) }; }
    function laneSpacing(seg, f) { return seg.kind === 'plate' ? WW.path.sample(seg.path, f).lane : 0; }
    function purlSeg() { return PS[state.purl.seg]; }
    function droppedOn(segI) {
      for (const id in items) {
        const it = items[id];
        if (it.owner === 'purl' && it.status === 'dropped' && it.seg === segI) return it;
      }
      return null;
    }
    function startJump(r, ev, who) {
      r.jumpT = 0; r.jumpH = 0;
      ev.push({ type: 'jump', who: who });
    }
    function tickJump(r, dt) {
      if (r.jumpT < 0) return false;
      r.jumpT += dt;
      if (r.jumpT >= T.jumpTime) { r.jumpT = -1; r.jumpH = 0; return true; }
      r.jumpH = Math.sin(Math.PI * r.jumpT / T.jumpTime);
      return false;
    }
    function progressOf(cum, segs, r) {
      const s = segs[r.seg];
      const along = s.kind === 'plate' && s.exitF !== undefined ? Math.min(r.f, s.exitF) : U.clamp(r.f, 0, 1);
      return U.clamp((cum.start[r.seg] + along * s.length) / cum.total, 0, 1);
    }

    // ---------------------------------------------------------------- Purl
    function collect(it, ev, recovered) {
      it.status = 'held';
      it.heldSeq = ++heldCounter;
      countHeld();
      if (recovered) {
        state.stats.recoveries++;
        say('THREAD RECOVERED', 'recover');
        ev.push({ type: 'recover', item: it.id });
      } else {
        ev.push({ type: 'pickup', item: it.id });
      }
    }

    function finishPurl(ev) {
      const p = state.purl;
      p.finishTime = state.time;
      p.rank = state.loop.finishTime === null ? 1 : 2;
      p.action = 'finishing';
      openGate('purl', ev);
      say(p.rank === 1 ? 'YOU WIN!' : 'LEVEL 1 COMPLETE', 'info', 3);
      state.mode = 'finished';
      state.result = { purlTime: p.finishTime, loopTime: state.loop.finishTime, purlRank: p.rank,
                       loopRank: state.loop.rank, winner: p.rank === 1 ? 'purl' : 'loop',
                       loopStillRacing: state.loop.finishTime === null };
      ev.push({ type: 'finish', who: 'purl', time: p.finishTime });
    }

    function enterSeg(r, segs, index, carryM, ev, who) {
      r.seg = index;
      r.segId = segs[index].id;
      r.f = U.clamp(carryM / segs[index].length, 0, 0.5);
      ev.push({ type: 'segment', who: who, segId: r.segId });
    }

    function updatePurl(dt, ev) {
      const p = state.purl;
      if (tickJump(p, dt) && p.jumpBuffer >= 0) {
        if (state.time - p.jumpBuffer <= T.inputBufferTime) startJump(p, ev, 'purl');
        p.jumpBuffer = -1;
      }
      p.airborne = p.jumpH > 0.001;
      if (p.failAt !== null) {
        p.speed = 0;
        if (state.time >= p.failAt) { state.mode = 'failed'; p.action = 'failed'; ev.push({ type: 'fail' }); }
        return;
      }
      const tangled = state.time < p.tangledUntil;

      // Speed: full run, tangled stop, short slowdown after a hit, easing to a stop after the finish.
      let target = T.purlSpeed;
      if (tangled) target = 0;
      else if (state.time < p.slowUntil) target = T.purlSpeed * T.slowAfterHit;
      const seg = purlSeg();
      if (p.finishTime !== null) {
        const left = (seg.exitF - p.f) * seg.length;
        target = left > 0.05 ? Math.min(T.purlSpeed * 0.7, Math.max(0.6, left * 2.2)) : 0;
      }
      p.speed = U.approach(p.speed, target, T.purlAccel * dt);
      p.distance += p.speed * dt;
      p.action = p.finishTime !== null ? (p.speed > 0.05 ? 'finishing' : 'finished')
        : tangled ? 'tangled' : p.trans ? 'looping' : seg.kind === 'connector' ? 'transition' : 'run';

      // Recovery loop on the landing: Purl circles back to its entry for another go at his thread.
      if (p.trans) {
        p.trans.t += dt / p.trans.dur;
        if (p.trans.t >= 1) {
          p.f = p.trans.toF;
          p.trans = null;
          const sn = state.snagling;
          sn.armed = true; sn.state = 'concealed'; sn.t = 0;
          ev.push({ type: 'loop-return' });
        }
        p.laneX = U.approach(p.laneX, p.lane, dt / T.laneChangeTime);
        return;
      }

      const prevF = p.f;
      p.f += p.speed * dt / seg.length;

      if (seg.kind === 'connector') {
        if (p.f >= 1) enterSeg(p, PS, p.seg + 1, (p.f - 1) * seg.length, ev, 'purl');
        p.laneX = U.approach(p.laneX, p.lane, dt / T.laneChangeTime);
        return;
      }

      // Lanes collapse to single file where the painted route is narrow.
      if (laneSpacing(seg, Math.min(p.f, 1)) < T.minLane) p.lane = 0;
      p.laneX = U.approach(p.laneX, p.lane, dt / T.laneChangeTime);

      // Route events crossed this step.
      seg.events.forEach(function (e) {
        if (!(e.f > prevF && e.f <= p.f)) return;
        if (e.type === 'hint' && e.text) hint(e.text, 4);
        else if (e.type === 'reveal') reveal(ev);
        else if (e.type === 'butterfly' && state.butterfly.state === 'rest') {
          state.butterfly.state = 'emerge'; state.butterfly.t = 0; ev.push({ type: 'butterfly' });
        } else if (e.type === 'tassels' && state.tassels.t < 0) { state.tassels.t = 0; ev.push({ type: 'tassels' }); }
      });

      // Threads: required pickups are on Purl's line and cannot be missed; drops need the right lane.
      const r = T.pickupRadiusM / seg.length;
      for (const id in items) {
        const it = items[id];
        if (it.owner !== 'purl' || it.seg !== p.seg) continue;
        if (it.status === 'uncollected' && it.available && p.f >= it.f - r) collect(it, ev, false);
        else if (it.status === 'dropped' && state.time >= it.dropTime + T.dropLandTime &&
                 Math.abs(p.f - it.f) <= r && Math.abs(p.laneX - it.lane) < T.dropPickupLane) collect(it, ev, true);
      }

      // Finish line: all three threads, or a guided return for the missing one (never a dead end).
      if (seg.finishF !== null && p.finishTime === null && prevF < seg.finishF && p.f >= seg.finishF) {
        if (state.held.purl === 3) finishPurl(ev);
        else {
          ev.push({ type: 'gate-blocked' });
          say(level.missingMessage, 'hit', 2.4);
          let back = null;
          ['coral', 'teal', 'gold'].forEach(function (c) {
            const it = items['purl.' + c];
            if (!back && it && it.status !== 'held') back = it;
          });
          const toSeg = back ? back.seg : p.seg;
          p.trans = { kind: 'return', t: 0, dur: T.recoveryLoopTime, plate: PS[toSeg].plate, fromSeg: p.seg, fromF: p.f,
                      toSeg: toSeg, toF: PS[toSeg].plate === 'p04' ? PS[toSeg].loopReturnF : 0 };
          p.seg = toSeg; p.segId = PS[toSeg].id;
          if (back && back.status === 'uncollected') back.available = true;
          return;
        }
      }

      // Leaving the scene.
      if (p.f >= seg.exitF) {
        if (p.finishTime !== null || p.seg === PS.length - 1) { p.f = seg.exitF; return; }
        const lost = droppedOn(p.seg);
        if (lost) {
          state.stats.loops++;
          p.trans = { kind: 'loop', t: 0, dur: T.recoveryLoopTime, plate: seg.plate, fromSeg: p.seg, fromF: seg.exitF,
                      toSeg: p.seg, toF: seg.loopReturnF };
          p.f = seg.exitF;
          hint('Circle back and grab your thread!', 3);
          ev.push({ type: 'loop-start' });
          return;
        }
        enterSeg(p, PS, p.seg + 1, (p.f - seg.exitF) * seg.length, ev, 'purl');
      }
    }

    // ---------------------------------------------------------------- Snagling (p04)
    function reveal(ev) {
      const s = state.snagling, p = state.purl, seg = purlSeg();
      if (!s.armed || s.state !== 'concealed' || p.finishTime !== null) return;
      s.armed = false; s.state = 'hop'; s.t = 0; s.pass++;
      s.targetLane = p.lane;
      s.targetF = Math.min(seg.exitF - 0.05, p.f + Math.max(p.speed, T.purlSpeed * 0.5) * T.snagRevealToContact / seg.length);
      s.contactConsumed = false; s.hit = false;
      ev.push({ type: 'reveal' });
    }

    function hitPurl(ev) {
      const p = state.purl, s = state.snagling, seg = purlSeg();
      s.contactConsumed = true;
      if (state.time < p.immuneUntil) { ev.push({ type: 'immune-ignored' }); return; }
      s.hit = true;
      state.stats.hits++;
      p.jumpT = -1; p.jumpH = 0; p.jumpBuffer = -1;
      p.speed = 0;
      ev.push({ type: 'hit' });
      if (state.held.purl === 0) {
        p.tangledUntil = Infinity;
        p.failAt = state.time + T.failDelay;
        say('ALL TANGLED UP!', 'hit', 3);
        return;
      }
      let newest = null;
      for (const id in items) {
        const it = items[id];
        if (it.owner === 'purl' && it.status === 'held' && (!newest || it.heldSeq > newest.heldSeq)) newest = it;
      }
      newest.status = 'dropped';
      newest.seg = p.seg;
      newest.fromF = p.f; newest.fromLane = p.laneX;
      newest.f = Math.min(seg.exitF - 0.08, p.f + T.dropAheadM / seg.length);
      newest.lane = p.lane >= 1 ? 0 : p.lane + 1;
      newest.dropTime = state.time;
      countHeld();
      p.tangledUntil = state.time + T.snagTangle;
      p.slowUntil = p.tangledUntil + T.slowAfterHitTime;
      p.immuneUntil = state.time + T.hitImmunity;
      say('SNAGGED!', 'hit', 1.8);
      hint(newest.lane > p.lane ? 'Swipe → to grab your thread!' : 'Swipe ← to grab your thread!', 3);
      ev.push({ type: 'drop', item: newest.id, f: newest.f, lane: newest.lane });
    }

    function updateSnagling(dt, ev) {
      const s = state.snagling, p = state.purl;
      if (s.state === 'concealed') return;
      s.t += dt;
      if (s.state === 'hop') {
        if (s.t >= T.snagRevealToContact) { s.state = 'strike'; s.t = 0; }
        return;
      }
      if (s.state === 'strike') {
        const onLanding = !p.trans && purlSeg().plate === 'p04';
        if (!s.contactConsumed && onLanding && Math.abs(p.laneX - s.targetLane) < 0.55 &&
            p.jumpH < T.jumpAirborneAbove) hitPurl(ev);
        if (s.t >= T.snagContactWindow) {
          if (!s.hit) { state.stats.dodges++; ev.push({ type: 'dodge' }); say(p.jumpH > 0 ? 'NICE JUMP!' : 'DODGED!', 'dodge', 1.2); }
          s.state = s.hit ? 'tangle' : 'retreat'; s.t = 0;
        }
        return;
      }
      if (s.state === 'tangle') { if (s.t >= T.snagTangle) { s.state = 'retreat'; s.t = 0; } return; }
      if (s.state === 'retreat' && s.t >= T.snagRetreat) { s.state = 'concealed'; s.t = 0; }
    }

    // ---------------------------------------------------------------- butterfly, tassels, gate
    function updateButterfly(dt, ev) {
      const b = state.butterfly;
      if (b.state === 'rest' || b.state === 'gone') return;
      b.t += dt;
      const order = [['emerge', T.butterflyEmerge], ['fly', T.butterflyFly], ['place', T.butterflyPlace], ['exit', T.butterflyExit]];
      for (let i = 0; i < order.length; i++) {
        if (b.state !== order[i][0] || b.t < order[i][1]) continue;
        b.t -= order[i][1];
        if (b.state === 'place') {
          const g = items['purl.gold'];
          if (g) g.available = true;
          ev.push({ type: 'gold-placed' });
        }
        b.state = i + 1 < order.length ? order[i + 1][0] : 'gone';
        break;
      }
    }

    function openGate(who, ev) {
      if (state.gate.state !== 'closed') return;
      state.gate.state = 'opening'; state.gate.t = 0; state.gate.opener = who;
      ev.push({ type: 'gate-open', who: who });
    }
    function updateGate(dt) {
      const g = state.gate;
      if (g.state === 'opening') { g.t += dt; if (g.t >= 1.2) g.state = 'open'; }
    }

    // ---------------------------------------------------------------- Loop
    function updateLoop(dt, ev) {
      const L = state.loop;
      const landed = tickJump(L, dt);
      if (landed && L.pendingStumble) {
        const task = L.pendingStumble;
        L.pendingStumble = null;
        L.stumbleUntil = state.time + T.loopStumble;
        ev.push({ type: 'loop-stumble' });
        if (task.drop && state.held.loop > 0) {
          let newest = null;
          for (const id in items) {
            const it = items[id];
            if (it.owner === 'loop' && it.status === 'held' && (!newest || it.heldSeq > newest.heldSeq)) newest = it;
          }
          const s = LS[L.seg];
          newest.status = 'dropped'; newest.seg = L.seg;
          newest.f = Math.min(s.kind === 'plate' ? s.window[1] : 1, L.f + 2.4 / s.length);
          newest.pathF = s.kind === 'plate' ? U.clamp(s.toPath(newest.f), 0, 1) : null;
          newest.dropTime = state.time;
          countHeld();
          ev.push({ type: 'loop-drop', item: newest.id });
        }
      }
      if (L.finishTime === null && state.purl.finishTime === null && L.stumbleUntil > state.time) L.action = 'stumble';

      const seg = LS[L.seg];
      let target = T.loopSpeed * L.form * jitter[L.seg];
      if (state.time < L.stumbleUntil) target = 0;
      else if (state.time < L.hesitateUntil) target *= 0.3;
      if (L.finishTime !== null) {
        const left = (1 - L.f) * seg.length;
        target = left > 0.05 ? Math.min(T.loopSpeed * 0.7, Math.max(0.6, left * 2.2)) : 0;
      }
      L.speed = U.approach(L.speed, target, T.purlAccel * dt);
      L.distance += L.speed * dt;
      const prevF = L.f;
      L.f += L.speed * dt / seg.length;
      L.action = L.finishTime !== null ? (L.speed > 0.05 ? 'finishing' : 'finished')
        : state.time < L.stumbleUntil ? 'stumble' : state.time < L.hesitateUntil ? 'hesitate'
        : seg.kind === 'connector' ? 'transition' : 'run';

      loopTasks.forEach(function (t) {
        if (t.done || t.seg !== L.seg || !(t.f > prevF && t.f <= L.f)) return;
        t.done = true;
        if (t.kind === 'hesitate' && t.active) { L.hesitateUntil = state.time + t.dur; ev.push({ type: 'loop-task', kind: 'hesitate' }); }
        if (t.kind === 'hop') {
          startJump(L, ev, 'loop');
          if (t.miss) L.pendingStumble = t;
          ev.push({ type: 'loop-task', kind: 'hop' });
        }
      });

      const r = T.pickupRadiusM / seg.length;
      for (const id in items) {
        const it = items[id];
        if (it.owner !== 'loop' || it.seg !== L.seg) continue;
        if (it.status === 'uncollected' && L.f >= it.f - r) {
          it.status = 'held'; it.heldSeq = ++heldCounter; countHeld(); ev.push({ type: 'loop-pickup', item: it.id });
        } else if (it.status === 'dropped' && state.time >= it.dropTime + T.loopRecover && L.f >= it.f - r) {
          it.status = 'held'; it.heldSeq = ++heldCounter; countHeld(); ev.push({ type: 'loop-recover', item: it.id });
        }
      }
      // A dropped thread is always ahead of him; he waits for it rather than leaving it behind.
      let waitFor = null;
      for (const id in items) {
        const it = items[id];
        if (it.owner === 'loop' && it.status === 'dropped' && it.seg === L.seg) waitFor = it;
      }
      if (waitFor && L.f > waitFor.f) L.f = waitFor.f;

      if (seg.finishF !== null && L.finishTime === null && prevF < seg.finishF && L.f >= seg.finishF && state.held.loop === 3) {
        L.finishTime = state.time;
        L.rank = state.purl.finishTime === null ? 1 : 2;
        openGate('loop', ev);
        ev.push({ type: 'finish', who: 'loop', time: L.finishTime });
        if (state.result) {
          state.result.loopTime = L.finishTime; state.result.loopRank = L.rank; state.result.loopStillRacing = false;
        } else if (state.purl.failAt === null) say('LOOP REACHED THE GATE!', 'info', 2.2);
      }

      if (L.f >= 1) {
        if (L.seg === LS.length - 1) { L.f = 1; return; }
        enterSeg(L, LS, L.seg + 1, (L.f - 1) * seg.length, ev, 'loop');
      }
    }

    // ---------------------------------------------------------------- HUD-facing derived state
    function updateDerived(ev) {
      const p = state.purl, L = state.loop;
      p.progress = progressOf(course.purlCum, PS, p);
      L.progress = progressOf(course.loopCum, LS, L);
      if (state.message && state.time >= state.message.until) state.message = null;
      if (state.hint && state.time >= state.hint.until) state.hint = null;

      // Objective / phase text for the HUD. During a connector the scene just left still names the goal.
      const seg = purlSeg();
      const objSeg = seg.kind === 'plate' ? seg : PS[p.seg - 1];
      const nextPlate = seg.kind === 'plate' ? seg : PS[p.seg + 1];
      const own = eventsOf(objSeg.events, 'pickup')[0];
      const done = !own || items['purl.' + own.item].status === 'held';
      state.phase = nextPlate.def.phase;
      if (p.finishTime !== null) state.objective = level.completeObjective;
      else if (droppedOn(p.seg) || (p.trans && p.trans.kind === 'loop')) state.objective = objSeg.def.objectiveDrop || 'GET YOUR THREAD BACK';
      else if (seg.kind === 'connector') state.objective = objSeg.def.objectiveDone || nextPlate.def.objective;
      else state.objective = (done && objSeg.def.objectiveDone) || objSeg.def.objective;

      // Lead changes (only while both are still racing).
      if (state.mode === 'running' && p.finishTime === null && L.finishTime === null && state.time > 2) {
        const leader = p.progress >= L.progress ? 'purl' : 'loop';
        if (state.leader && leader !== state.leader && state.time - lastOvertake > 4 && Math.abs(p.progress - L.progress) > 0.002) {
          lastOvertake = state.time;
          ev.push({ type: 'overtake', who: leader });
          if (!state.message) say(leader === 'purl' ? 'YOU PASSED LOOP!' : 'LOOP TOOK THE LEAD!', 'info', 1.4);
        }
        state.leader = leader;
      }

      // Results: Loop keeps racing after Purl finishes, up to finishWaitForLoop seconds.
      if (state.result && state.result.loopStillRacing && p.finishTime !== null &&
          state.time - p.finishTime > T.finishWaitForLoop) state.result.loopStillRacing = false;
    }

    // ---------------------------------------------------------------- public
    function step(dt) {
      const ev = [];
      if (state.paused || state.mode === 'intro' || state.mode === 'failed') return ev;
      if (state.mode === 'countdown') {
        const before = Math.ceil(state.countdown);
        state.countdown -= dt;
        if (Math.ceil(state.countdown) !== before && state.countdown > 0) ev.push({ type: 'count', n: Math.ceil(state.countdown) });
        if (state.countdown <= 0) {
          state.countdown = 0;
          state.mode = 'running';
          state.purl.action = 'run'; state.loop.action = 'run';
          ev.push({ type: 'go' });
        }
        return ev;
      }
      state.time += dt;
      updatePurl(dt, ev);
      updateLoop(dt, ev);
      updateSnagling(dt, ev);
      updateButterfly(dt, ev);
      if (state.tassels.t >= 0) state.tassels.t += dt;
      updateGate(dt);
      updateDerived(ev);
      return ev;
    }

    function input(cmd) {
      const ev = [];
      if (state.paused || state.mode !== 'running' || !cmd) return ev;
      const p = state.purl;
      if (p.finishTime !== null || p.failAt !== null || state.time < p.tangledUntil) return ev;
      const dir = cmd.type === 'tap' ? 'up' : cmd.dir;
      if (dir === 'left' || dir === 'right') {
        const seg = purlSeg();
        if (p.trans || seg.kind !== 'plate' || laneSpacing(seg, p.f) < T.minLane) { ev.push({ type: 'lane-blocked' }); return ev; }
        const next = U.clamp(p.lane + (dir === 'left' ? -1 : 1), -1, 1);
        if (next === p.lane) { ev.push({ type: 'lane-blocked' }); return ev; }
        p.lane = next;
        state.stats.lanes++;
        ev.push({ type: 'lane', who: 'purl', lane: next });
      } else if (dir === 'up') {
        if (p.jumpT < 0) { startJump(p, ev, 'purl'); state.stats.jumps++; }
        else if (T.jumpTime - p.jumpT <= T.inputBufferTime) p.jumpBuffer = state.time;
      } else if (dir === 'down') {
        if (p.jumpT >= 0) p.jumpT = Math.max(p.jumpT, T.jumpTime * 0.8);   // drop quickly back to the carpet
      }
      return ev;
    }

    const race = {
      state: state,
      course: course,
      tuning: T,
      step: step,
      input: input,
      start: function () { if (state.mode === 'intro') { state.mode = 'countdown'; state.countdown = T.countdown; } },
      pause: function (reason) { state.paused = true; state.pauseReason = reason || 'user'; },
      resume: function () { state.paused = false; state.pauseReason = null; },
      debug: {
        teleport: function (who, segId, f) {
          const r = state[who], segs = who === 'purl' ? PS : LS;
          const i = segs.findIndex(function (s) { return s.id === segId; });
          if (i < 0) throw new Error('No segment ' + segId);
          r.seg = i; r.segId = segId; r.f = f; if (who === 'purl') r.trans = null;
        },
        setItem: function (id, patch) { Object.assign(items[id], patch); countHeld(); },
        forceReveal: function () { const ev = []; state.snagling.armed = true; state.snagling.state = 'concealed'; reveal(ev); return ev; },
        segIndex: segIndex
      }
    };
    return race;
  }

  WW.sim = { createRace: createRace, buildCourse: buildCourse };
})(globalThis.WW = globalThis.WW || {});
