/* Renderer harness only: a small deterministic stand-in for WW.sim that produces state in the
   docs/ARCHITECTURE.md §7.1/§12 shape (purl/loop route state, items with seg/f/lane, stitches with state/t,
   snagling, gate, transition). It is NOT the game simulation — it only scripts plausible moments so the renderer
   can be captured at every approved beat. Options:
     react     seconds between a stitch becoming ready and the scripted tap (default 1.6)
     snag      'hit' | 'dodge' for the p04 Snagling pass (default 'hit')
     lanes     [[time, lane], ...] scripted lane targets
     jumps     [time, ...] scripted jump starts
     recover   true: steer into the dropped spool's lane after a hit (default true)                          */
(function (WW) {
  'use strict';
  const TU = WW.TUNING, L = WW.LEVEL, PL = WW.PLATES;

  function ev(P, who, type, pred) {
    const list = (P && P[who] && P[who].events) || [];
    for (let i = 0; i < list.length; i++) if (list[i].type === type && (!pred || pred(list[i]))) return list[i];
    return null;
  }

  WW.harnessSim = function (opts) {
    opts = opts || {};
    const react = opts.react === undefined ? 1.6 : opts.react;
    const route = L.route, lroute = L.loopRoute;
    const times = { segStart: { 0: 3 }, loopSegStart: {}, stitch: {}, item: {} };
    const items = {};
    let seq = 0;
    route.forEach(function (seg) {
      if (seg.kind !== 'plate') return;
      const P = PL[seg.plate];
      ['purl', 'loop'].forEach(function (who) {
        ((P[who] && P[who].events) || []).forEach(function (e) {
          if (e.type !== 'pickup') return;
          const id = who + '.' + e.item;
          items[id] = { id: id, owner: who, color: e.item, status: 'uncollected', available: e.item !== 'gold',
            seg: seg.id, f: e.f, lane: e.lane || 0, heldSeq: 0, dropTime: null };
        });
      });
    });
    const S = {
      mode: 'countdown', paused: false, pauseReason: null, time: 0, countdown: 3, seed: 1,
      purl: { seg: 0, segId: route[0].id, f: 0, lane: 0, laneX: 0, jumpT: 0, jumpH: 0, speed: 0, action: 'idle',
        airborne: false, immuneUntil: 0, tangledUntil: 0, distance: 0, finishTime: null, rank: null },
      loop: { seg: 0, segId: route[0].id, f: 0, laneX: 0, jumpH: 0, speed: 0, action: 'idle', task: null, distance: 0, finishTime: null, rank: null },
      items: items, held: { purl: 0, loop: 0 },
      stitches: {
        ribbon: { state: 'idle', t: 0, tappedAt: null }, shortcut: { state: 'idle', t: 0, tappedAt: null },
        tassels: { state: 'idle', t: 0, tappedAt: null, lifts: [0, 0, 0] },
        butterfly: { state: 'idle', t: 0, tappedAt: null, phase: 'dormant' }
      },
      loopTasks: {},
      snagling: { state: 'concealed', t: 0, targetLane: 0, contactF: null, result: null, pass: 0, armed: true, contactConsumed: false },
      gate: { state: 'closed', t: 0 },
      objective: route[0].objective, phase: route[0].phase, message: null, hint: null, transition: null, result: null,
      stats: { hits: 0, dodges: 0, recoveries: 0, taps: 0 }
    };
    const clock = { wall: 0 };
    const P_ = { readyAt: {}, openAt: {}, jumpStart: null, loopTaskUntil: 0, loopHopStart: null, loopDone: {}, wait: 0, loopTrans: null };
    const events = [];

    function durOf(id) {
      if (id === 'ribbon') return TU.ribbonUnfurl;
      if (id === 'shortcut') return TU.shortcutUnroll;
      if (id === 'tassels') return TU.tasselStagger * 2 + TU.tasselLift;
      return TU.butterflyEmerge + TU.butterflyFly + TU.butterflyPlace;
    }

    function heldCount(who) { let n = 0; for (const id in items) if (items[id].owner === who && items[id].status === 'held') n++; return n; }

    function stepStitches(dt) {
      for (const id in S.stitches) {
        const st = S.stitches[id];
        if (st.state !== 'animating') continue;
        const el = S.time - st.tappedAt, d = durOf(id);
        st.t = Math.min(1, el / d);
        if (id === 'tassels') st.lifts = [0, 1, 2].map(function (i) { return Math.max(0, Math.min(1, (el - i * TU.tasselStagger) / TU.tasselLift)); });
        if (id === 'butterfly') {
          st.phase = el < TU.butterflyEmerge ? 'emerge' : el < TU.butterflyEmerge + TU.butterflyFly ? 'fly' : el < d ? 'place' : 'done';
        }
        if (st.t >= 1) {
          st.state = 'open'; P_.openAt[id] = S.time; events.push({ type: 'stitch-open', id: id });
          if (id === 'butterfly') { st.phase = 'done'; items['purl.gold'].available = true; items['loop.gold'].available = true; }
        }
      }
    }

    function nextSeg(who, R) {
      const r = who === 'purl' ? route : lroute;
      R.seg++; R.f = 0; R.segId = r[R.seg] && r[R.seg].id;
      if (who === 'purl') times.segStart[R.seg] = S.time; else times.loopSegStart[R.seg] = S.time;
      if (who === 'purl') {
        const seg = route[R.seg];
        if (seg && seg.kind === 'connector') S.transition = { kind: 'connector', from: seg.from, to: seg.to, style: seg.style, t: 0 };
        else { S.transition = null; if (seg) { S.objective = seg.objective; S.phase = seg.phase; } }
      }
    }

    function stepPurl(dt) {
      const p = S.purl, seg = route[p.seg];
      if (!seg) return;
      // jump
      if (opts.jumps) opts.jumps.forEach(function (t) { if (S.time >= t && S.time - dt < t && !p.airborne) { P_.jumpStart = S.time; events.push({ type: 'jump', who: 'purl' }); } });
      if (P_.jumpStart !== null) {
        const k = (S.time - P_.jumpStart) / TU.jumpTime;
        if (k >= 1) { P_.jumpStart = null; p.jumpH = 0; p.jumpT = 0; p.airborne = false; }
        else { p.jumpT = k; p.jumpH = Math.sin(Math.PI * k); p.airborne = p.jumpH > TU.jumpAirborneAbove; }
      }
      // lanes
      if (opts.lanes) opts.lanes.forEach(function (l) { if (S.time >= l[0] && S.time - dt < l[0]) p.lane = l[1]; });
      if (S.transition && S.transition.kind === 'loop') {
        const tr = S.transition;
        tr.t = Math.min(1, tr.t + dt / TU.recoveryLoopTime);
        p.distance += TU.purlSpeed * dt; p.action = 'looping';
        if (tr.t >= 1) { S.transition = null; p.f = ev(PL.p04, 'purl', 'loopReturn').f; S.snagling = { state: 'concealed', t: 0, targetLane: 0, result: null, pass: S.snagling.pass + 1, armed: true, contactConsumed: false }; p.action = 'run'; }
        return;
      }
      const lw = route[p.seg].kind === 'plate' ? WW.path.sample(PL[seg.plate].purl.path, p.f).lane : 0;
      const tgtLane = lw < 20 ? 0 : p.lane;
      p.laneX += Math.sign(tgtLane - p.laneX) * Math.min(Math.abs(tgtLane - p.laneX), dt / TU.laneChangeTime);
      if (seg.kind === 'connector') {
        p.speed = TU.purlSpeed; p.f += p.speed * dt / seg.length; p.distance += p.speed * dt; p.action = 'transition';
        S.transition.t = Math.min(1, p.f);
        if (p.f >= 1) nextSeg('purl', p);
        return;
      }
      const P = PL[seg.plate];
      const stop = ev(P, 'purl', 'stop');
      const exitE = ev(P, 'purl', 'exit'), exitF = exitE ? exitE.f : 1;
      if (stop) {
        const st = S.stitches[stop.stitch];
        if (st.state === 'idle' && p.f >= stop.readyF) { st.state = 'ready'; P_.readyAt[stop.stitch] = S.time; }
        if (st.state === 'ready' && S.mode === 'running' && S.time >= P_.readyAt[stop.stitch] + react + (stop.stitch === 'ribbon' ? 0 : 0)) {
          st.state = 'animating'; st.t = 0; st.tappedAt = S.time; S.stats.taps++; times.stitch[stop.stitch] = S.time;
          events.push({ type: 'stitch-tap', id: stop.stitch });
        }
      }
      if (S.mode !== 'running') { p.action = 'idle'; return; }
      if (S.time < p.tangledUntil) { p.speed = 0; p.action = 'tangled'; return; }
      let blocked = false;
      if (stop) {
        const st = S.stitches[stop.stitch];
        const free = st.state === 'open' && S.time >= P_.openAt[stop.stitch] + TU.routeSettle;
        if (!free && p.f >= stop.f - 1e-6) { p.f = Math.max(p.f, stop.f); blocked = p.f <= stop.f + 1e-6 || st.state !== 'open'; }
      }
      if (blocked) { p.speed = 0; p.action = 'wait'; return; }
      const slow = S.time < (p.slowUntil || 0) ? TU.slowAfterHit : 1;
      p.speed = Math.min(TU.purlSpeed * slow, p.speed + TU.purlAccel * dt);
      let nf = p.f + p.speed * dt / seg.length;
      if (stop && S.stitches[stop.stitch].state !== 'open' && p.f <= stop.f && nf > stop.f) nf = stop.f;
      p.f = nf; p.distance += p.speed * dt; p.action = 'run';
      // snagling (p04)
      if (seg.plate === 'p04') stepSnag(dt, P);
      // pickups / recoveries
      for (const id in items) {
        const it = items[id];
        if (it.owner !== 'purl' || it.seg !== seg.id || !it.available) continue;
        if (it.status === 'uncollected' && Math.abs(p.f - it.f) <= TU.pickupRadiusF) {
          it.status = 'held'; it.heldSeq = ++seq; times.item[id] = S.time; events.push({ type: 'pickup', item: id });
        } else if (it.status === 'dropped' && Math.abs(p.f - it.f) <= TU.pickupRadiusF && Math.abs(p.laneX - it.lane) < TU.dropPickupLane) {
          it.status = 'held'; it.heldSeq = ++seq; times.item[id + ':recover'] = S.time; S.stats.recoveries++;
          S.message = { text: 'THREAD RECOVERED', kind: 'recover', until: S.time + 1.5 }; events.push({ type: 'recover', item: id });
        }
      }
      // finish (p07)
      const fin = ev(P, 'purl', 'finish');
      if (fin && p.f >= fin.f) {
        p.f = fin.f;
        if (heldCount('purl') >= 3 && p.finishTime === null) {
          p.finishTime = S.time; p.action = 'finished'; p.speed = 0; S.gate.state = 'opening'; times.finish = S.time;
          events.push({ type: 'gate-open' }); events.push({ type: 'finish', who: 'purl', time: S.time });
        }
        if (p.finishTime !== null) { p.action = 'finished'; p.speed = 0; }
        return;
      }
      if (p.f >= exitF) {
        let dropped = false;
        for (const id in items) if (items[id].owner === 'purl' && items[id].status === 'dropped' && items[id].seg === seg.id) dropped = true;
        if (dropped && seg.plate === 'p04') { S.transition = { kind: 'loop', from: seg.id, to: seg.id, style: 'right', t: 0 }; times.loop = S.time; return; }
        nextSeg('purl', p);
      }
    }

    function stepSnag(dt, P) {
      const sn = S.snagling, p = S.purl;
      const reveal = ev(P, 'purl', 'reveal');
      sn.t += dt;
      if (sn.state === 'concealed' && sn.armed && reveal && p.f >= reveal.f) {
        sn.state = 'hop'; sn.t = 0; sn.armed = false; sn.targetLane = p.lane; sn.contactF = reveal.f + TU.purlSpeed * TU.snagRevealToContact / route[p.seg].length;
        times.reveal = S.time; events.push({ type: 'reveal' });
        if ((opts.snag || 'hit') === 'dodge') P_.jumpStart = S.time + TU.snagRevealToContact - 0.3;
      } else if (sn.state === 'hop' && sn.t >= TU.snagRevealToContact + TU.snagContactWindow) {
        const hit = (opts.snag || 'hit') === 'hit' && sn.pass === 0;
        if (hit) {
          sn.result = 'hit'; sn.state = 'tangle'; sn.t = 0; S.stats.hits++; times.hit = S.time;
          let best = null;
          for (const id in items) if (items[id].owner === 'purl' && items[id].status === 'held' && (!best || items[id].heldSeq > best.heldSeq)) best = items[id];
          if (best) {
            best.status = 'dropped'; best.seg = route[p.seg].id; best.f = Math.min(0.92, p.f + TU.dropAheadF); best.lane = p.lane === 1 ? 0 : 1;
            best.dropTime = S.time; times.drop = S.time; events.push({ type: 'drop', item: best.id, f: best.f, lane: best.lane });
            if (opts.recover !== false) { const tl = best.lane; const at = S.time + TU.snagTangle + 0.25; (opts.lanes = opts.lanes || []).push([at, tl]); }
          }
          p.tangledUntil = S.time + TU.snagTangle; p.immuneUntil = S.time + TU.hitImmunity; p.slowUntil = S.time + TU.snagTangle + TU.slowAfterHitTime;
          S.message = { text: 'SNAGGED!', kind: 'hit', until: S.time + 1.5 }; events.push({ type: 'hit' });
        } else { sn.result = 'dodge'; sn.state = 'retreat'; sn.t = 0; S.stats.dodges++; events.push({ type: 'dodge' }); }
      } else if (sn.state === 'tangle' && sn.t >= TU.snagTangle) { sn.state = 'retreat'; sn.t = 0; }
      else if (sn.state === 'retreat' && sn.t >= TU.snagRetreat) { sn.state = 'done'; sn.t = 0; }
    }

    function stepLoop(dt) {
      const l = S.loop, seg = lroute[l.seg];
      if (!seg || S.mode !== 'running') { l.action = l.finishTime !== null ? 'finished' : 'idle'; return; }
      if (l.finishTime !== null) { l.action = 'finished'; l.speed = 0; return; }
      if (P_.loopHopStart !== null) {
        const k = (S.time - P_.loopHopStart) / TU.jumpTime;
        if (k >= 1) { P_.loopHopStart = null; l.jumpH = 0; } else l.jumpH = Math.sin(Math.PI * k);
      }
      if (S.time < P_.loopTaskUntil) { l.speed = 0; l.action = 'task'; return; }
      if (l.task) { l.task = null; }
      if (seg.kind === 'connector') {
        l.speed = TU.loopSpeed; l.f += l.speed * dt / seg.length; l.distance += l.speed * dt; l.action = 'transition';
        if (l.f >= 1) nextSeg('loop', l);
        return;
      }
      const P = PL[seg.plate];
      const evs = (P.loop && P.loop.events) || [];
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i], key = l.seg + ':' + i;
        if (e.type !== 'task' || P_.loopDone[key] || l.f < e.f) continue;
        P_.loopDone[key] = true;
        if (e.kind === 'stitch') { P_.loopTaskUntil = S.time + 0.8 + (e.dur || 1.3); l.task = { kind: 'stitch', until: P_.loopTaskUntil }; l.action = 'task'; events.push({ type: 'loop-task', kind: 'stitch' }); return; }
        if (e.kind === 'hop') { P_.loopHopStart = S.time; events.push({ type: 'loop-task', kind: 'hop' }); }
        if (e.kind === 'bypass') { P_.loopTaskUntil = S.time + (e.extra || 0); l.task = { kind: 'bypass', until: P_.loopTaskUntil }; }
      }
      l.speed = Math.min(TU.loopSpeed, l.speed + TU.purlAccel * dt);
      l.f += l.speed * dt / seg.length; l.distance += l.speed * dt; l.action = 'run';
      for (const id in items) {
        const it = items[id];
        if (it.owner === 'loop' && it.seg === seg.id && it.available && it.status === 'uncollected' && Math.abs(l.f - it.f) <= TU.pickupRadiusF) { it.status = 'held'; it.heldSeq = ++seq; times.item[id] = S.time; }
      }
      const fin = ev(P, 'loop', 'finish');
      if (fin && l.f >= fin.f) { l.f = fin.f; if (heldCount('loop') >= 3) { l.finishTime = S.time; l.action = 'finished'; } return; }
      if (l.f >= 1) { l.f = 1; if (lroute[l.seg + 1]) nextSeg('loop', l); }
    }

    function step(dt) {
      if (S.paused) return;
      if (S.mode === 'countdown') {
        S.countdown = Math.max(0, 3 - clock.wall);
        if (clock.wall >= 3) { S.mode = 'running'; events.push({ type: 'go' }); }
      }
      clock.wall += dt;
      if (S.mode === 'running') S.time += dt;
      stepStitches(dt);
      stepPurl(dt);
      stepLoop(dt);
      if (S.gate.state === 'opening') { S.gate.t = Math.min(1, S.gate.t + dt / 1.2); if (S.gate.t >= 1) S.gate.state = 'open'; }
      S.held.purl = heldCount('purl'); S.held.loop = heldCount('loop');
      if (S.message && S.time > S.message.until) S.message = null;
    }

    return { state: S, step: step, events: events, times: times, clock: clock };
  };
})(globalThis.WW = globalThis.WW || {});
