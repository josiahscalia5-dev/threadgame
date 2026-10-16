/* UI test harness — loaded by game/index.html ONLY with ?stubs=1 (never packaged for Android).

   Minimal fake WW.sim.createRace and WW.render.createRenderer implementing the docs/ARCHITECTURE.md §7/§8 contract
   surface the UI uses, so HUD, overlays, input and the loop can be exercised before the real modules exist.

   Fake race: walks WW.LEVEL.route at 5 m/s; halts at each plate's `stop` until the stitch is tapped (stitch becomes
   'ready', a tap animates it open); collects purl.* at the plate pickup fractions; on the landing Snagling hops at the
   reveal f — a jump (swipe up) dodges, otherwise a hit drops the newest thread one lane right (swipe right + run over
   it = THREAD RECOVERED; missing it runs a recovery loop); a hit at 0 threads fails. Loop runs his own lengths with
   short task pauses and picks up his IDs. Finish requires 3/3; results keep loopStillRacing until Loop arrives.
   ?scenario=win (default) | lose (fast Loop) | fail (no pickups, so the landing hit at 0 fails)
   race.debug: teleport(who, segId, f), setHeld(who, n), forceFail(), forceFinish(loopFirst), message(text, kind). */
(function (WW) {
  'use strict';

  const params = new URLSearchParams(location.search);
  const SCENARIO = params.get('scenario') || 'win';
  const T = WW.TUNING || {};
  const COLORS = ['coral', 'teal', 'gold'];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function plateEvents(plates, plateId, who) {
    const p = plates && plates[plateId];
    return (p && p[who] && p[who].events) || [];
  }

  function createRace(opts) {
    const level = opts.level || WW.LEVEL;
    const plates = opts.plates || WW.PLATES || {};
    const seed = opts.seed >>> 0;
    const rng = WW.rng ? WW.rng(seed) : { range: function (a, b) { return (a + b) / 2; } };
    const route = level.route, loopRoute = level.loopRoute || level.route;
    const loopSpeed = (SCENARIO === 'lose' ? 5.9 : 5.0) * rng.range(0.96, 1.04);

    /* per-segment authored fractions (with fallbacks when plate data is incomplete) */
    const segInfo = route.map(function (seg) {
      const info = { stop: null, pickup: null, reveal: null, finish: null };
      if (seg.kind !== 'plate') return info;
      plateEvents(plates, seg.plate, 'purl').forEach(function (e) {
        if (e.type === 'stop') info.stop = { stitch: e.stitch, f: Math.max(0.04, e.f + 0.04), readyF: e.readyF || 0 };
        if (e.type === 'pickup') info.pickup = { item: 'purl.' + e.item, f: e.f };
        if (e.type === 'reveal') info.reveal = e.f;
        if (e.type === 'finish') info.finish = e.f;
      });
      if (seg.id === 'landing' && info.reveal == null) info.reveal = 0.25;
      if (seg.id === 'finish' && info.finish == null) info.finish = 0.6;
      return info;
    });
    const loopInfo = loopRoute.map(function (seg) {
      const info = { task: null, pickup: null, finish: null };
      if (seg.kind !== 'plate') return info;
      plateEvents(plates, seg.plate, 'loop').forEach(function (e) {
        if (e.type === 'pickup') info.pickup = { item: 'loop.' + e.item, f: e.f };
        if (e.type === 'finish') info.finish = e.f;
      });
      if (['ribbon', 'shortcut', 'tassels', 'tapestry'].indexOf(seg.id) >= 0) info.task = { f: 0.15, dur: 1.6 };
      if (seg.id === 'finish' && info.finish == null) info.finish = 0.5;
      return info;
    });

    const items = {};
    ['purl', 'loop'].forEach(function (owner) {
      COLORS.forEach(function (c) {
        const id = owner + '.' + c;
        const segs = owner === 'purl' ? segInfo : loopInfo;
        let seg = 0, f = 0.5;
        segs.forEach(function (s, i) { if (s.pickup && s.pickup.item === id) { seg = i; f = s.pickup.f; } });
        items[id] = { id: id, owner: owner, color: c, status: 'uncollected', available: c !== 'gold',
          seg: route[seg].id, f: f, lane: 0, heldSeq: 0, dropTime: null };
      });
    });
    if (SCENARIO === 'fail') COLORS.forEach(function (c) { items['purl.' + c].available = false; });

    const state = {
      mode: 'intro', paused: false, pauseReason: null, time: 0, countdown: T.countdown || 3, seed: seed,
      purl: { seg: 0, segId: route[0].id, f: 0, lane: 0, laneX: 0, jumpT: 0, jumpH: 0, speed: 0, action: 'idle',
        airborne: false, immuneUntil: 0, tangledUntil: 0, distance: 0, finishTime: null, rank: null },
      loop: { seg: 0, segId: loopRoute[0].id, f: 0, laneX: 0.6, jumpH: 0, speed: 0, action: 'idle', task: null,
        distance: 0, finishTime: null, rank: null },
      items: items,
      held: { purl: 0, loop: 0 },
      stitches: {
        ribbon: { state: 'idle', t: 0, tappedAt: null }, shortcut: { state: 'idle', t: 0, tappedAt: null },
        tassels: { state: 'idle', t: 0, tappedAt: null, lifts: [0, 0, 0] },
        butterfly: { state: 'idle', t: 0, tappedAt: null, phase: 'dormant' }
      },
      loopTasks: {},
      snagling: { state: 'concealed', t: 0, targetLane: 0, contactF: null, result: null, pass: 0, armed: true, contactConsumed: false },
      gate: { state: 'closed', t: 0 },
      objective: route[0].objective, phase: route[0].phase,
      message: null, hint: null, transition: null, result: null,
      stats: { hits: 0, dodges: 0, recoveries: 0, taps: 0 }
    };
    let seq = 0, holdSeq = 0, loopTaskLeft = 0, loopTaskDone = {};
    let finishWait = 0, failAt = null, jumpBuffer = 0;

    function seg() { return route[state.purl.seg]; }
    function info() { return segInfo[state.purl.seg]; }
    function say(text, kind, dur) { state.message = { text: text, kind: kind || 'info', until: state.time + (dur || 1.6) }; }
    function recount() {
      let p = 0, l = 0;
      Object.keys(items).forEach(function (k) { if (items[k].status === 'held') { if (items[k].owner === 'purl') p++; else l++; } });
      state.held.purl = p; state.held.loop = l;
    }
    function objectiveFor() {
      const s = seg(), inf = info();
      if (!s.objective) return state.objective;
      if (s.id === 'landing') {
        const dropped = Object.keys(items).some(function (k) { return items[k].owner === 'purl' && items[k].status === 'dropped'; });
        return dropped && s.objectiveDrop ? s.objectiveDrop : s.objective;
      }
      const st = inf.stop && state.stitches[inf.stop.stitch];
      if (st && st.state === 'open') {
        const pk = inf.pickup && items[inf.pickup.item];
        if (pk && pk.status === 'held') return s.objectiveDone || s.objectiveOpen || s.objective;
        return s.objectiveOpen || s.objective;
      }
      return s.objective;
    }

    function enterSeg(i, ev) {
      state.purl.seg = i; state.purl.segId = route[i].id; state.purl.f = 0;
      const s = route[i];
      if (s.kind === 'plate') { state.phase = s.phase || state.phase; }
      state.transition = s.kind === 'connector' ? { kind: 'connector', from: s.from, to: s.to, style: s.style, t: 0 } : null;
      if (s.id === 'landing') { state.snagling.state = 'concealed'; state.snagling.armed = true; state.snagling.pass++; state.snagling.contactConsumed = false; state.snagling.result = null; }
      ev.push({ type: 'segment', who: 'purl', segId: s.id });
    }

    function stepPurl(dt, ev) {
      const p = state.purl, s = seg(), inf = info();
      // jumping
      if (p.jumpT > 0) {
        p.jumpT = Math.max(0, p.jumpT - dt / (T.jumpTime || 0.68));
        p.jumpH = Math.sin(Math.PI * (1 - p.jumpT));
        if (p.jumpT === 0) { p.jumpH = 0; if (jumpBuffer > 0) { jumpBuffer = 0; p.jumpT = 1; ev.push({ type: 'jump', who: 'purl' }); } }
      }
      jumpBuffer = Math.max(0, jumpBuffer - dt);
      p.airborne = p.jumpH > (T.jumpAirborneAbove || 0.3);
      p.laneX += clamp(p.lane - p.laneX, -dt / (T.laneChangeTime || 0.22), dt / (T.laneChangeTime || 0.22));

      let speed = 5;
      if (state.time < p.tangledUntil) { speed = 0; p.action = 'tangled'; }
      else p.action = s.kind === 'connector' ? 'transition' : 'run';

      let limit = 1;
      if (inf.stop) {
        const st = state.stitches[inf.stop.stitch];
        if (st.state === 'idle' && p.f >= inf.stop.readyF) { st.state = 'ready'; }
        if (st.state !== 'open') limit = inf.stop.f;
        if (st.state === 'ready' && p.f >= inf.stop.f - 1e-6) {
          state.hint = { text: 'Tap the glowing stitch', until: state.time + 0.5 };
        }
      }
      const df = speed * dt / s.length;
      p.f = Math.min(limit, p.f + df);
      if (p.f >= limit - 1e-6 && limit < 1) { p.action = 'wait'; p.speed = 0; } else { p.speed = speed; p.distance += speed * dt; }
      if (state.transition) state.transition.t = p.f;

      // pickups / recovery
      Object.keys(items).forEach(function (k) {
        const it = items[k];
        if (it.owner !== 'purl' || it.seg !== s.id || !it.available || it.status === 'held') return;
        if (Math.abs(p.f - it.f) > (T.pickupRadiusF || 0.035)) return;
        if (it.status === 'dropped' && Math.abs(p.laneX - it.lane) >= (T.dropPickupLane || 0.6)) return;
        const wasDropped = it.status === 'dropped';
        it.status = 'held'; it.heldSeq = ++holdSeq; recount();
        if (wasDropped) { state.stats.recoveries++; say('THREAD RECOVERED', 'recover', 1.8); ev.push({ type: 'recover', item: k }); }
        else ev.push({ type: 'pickup', item: k });
      });

      // Snagling on the landing
      if (s.id === 'landing') stepSnag(dt, ev);

      // finish
      if (s.id === 'finish' && p.f >= inf.finish && p.finishTime == null) {
        if (state.held.purl >= 3) {
          p.finishTime = state.time; p.rank = state.loop.finishTime != null ? 2 : 1; p.action = 'finished';
          state.mode = 'finished'; state.gate.state = 'opening';
          state.objective = s.objectiveDone || 'LEVEL 1 COMPLETE';
          ev.push({ type: 'gate-open' }, { type: 'finish', who: 'purl', time: p.finishTime });
          updateResult();
          return;
        }
        say('A THREAD IS MISSING', 'info', 2.2);
        ev.push({ type: 'gate-blocked' });
        const li = route.findIndex(function (r) { return r.id === 'landing'; });
        enterSeg(li, ev); p.f = 0.05;
        state.transition = { kind: 'return', from: 'finish', to: 'landing', t: 0 };
        return;
      }
      if (p.f >= 1) {
        // recovery loop if a thread is still on the landing
        if (s.id === 'landing' && Object.keys(items).some(function (k) { return items[k].owner === 'purl' && items[k].status === 'dropped'; })) {
          enterSeg(state.purl.seg, ev); p.f = 0.08;
          state.transition = { kind: 'loop', from: 'landing', to: 'landing', t: 0 };
          return;
        }
        if (state.purl.seg < route.length - 1) enterSeg(state.purl.seg + 1, ev);
      }
      if (state.transition && state.transition.kind !== 'connector') {
        state.transition.t += dt / 1.2;
        if (state.transition.t >= 1) state.transition = null;
      }
    }

    function stepSnag(dt, ev) {
      const sn = state.snagling, p = state.purl, inf = info();
      sn.t += dt;
      if (sn.state === 'concealed' && sn.armed && p.f >= inf.reveal) {
        sn.state = 'hop'; sn.t = 0; sn.targetLane = p.lane; sn.armed = false; sn.contactConsumed = false;
        ev.push({ type: 'reveal' });
      } else if (sn.state === 'hop' && sn.t >= (T.snagRevealToContact || 0.55) && !sn.contactConsumed) {
        sn.contactConsumed = true;
        const contact = Math.abs(p.laneX - sn.targetLane) < 0.55 && p.jumpH < (T.jumpAirborneAbove || 0.3);
        if (!contact) { sn.result = 'dodge'; sn.state = 'retreat'; sn.t = 0; state.stats.dodges++; ev.push({ type: 'dodge' }); return; }
        if (state.time < p.immuneUntil) { sn.result = 'immune'; ev.push({ type: 'immune-ignored' }); sn.state = 'retreat'; sn.t = 0; return; }
        sn.result = 'hit'; state.stats.hits++; ev.push({ type: 'hit' });
        const held = Object.keys(items).filter(function (k) { return items[k].owner === 'purl' && items[k].status === 'held'; });
        if (!held.length) { failAt = state.time + (T.failDelay || 1.2); p.tangledUntil = failAt + 5; sn.state = 'tangle'; sn.t = 0; return; }
        held.sort(function (a, b) { return items[b].heldSeq - items[a].heldSeq; });
        const it = items[held[0]];
        it.status = 'dropped'; it.seg = 'landing'; it.f = Math.min(0.85, p.f + (T.dropAheadF || 0.1)); it.lane = p.lane === 1 ? 0 : 1; it.dropTime = state.time;
        recount();
        say('SNAGGED!', 'hit', 1.6);
        p.tangledUntil = state.time + (T.snagTangle || 0.5); p.immuneUntil = state.time + (T.hitImmunity || 1.6);
        sn.state = 'tangle'; sn.t = 0;
        ev.push({ type: 'drop', item: it.id, f: it.f, lane: it.lane });
      } else if (sn.state === 'tangle' && sn.t > (T.snagTangle || 0.5)) { sn.state = 'retreat'; sn.t = 0; }
      else if (sn.state === 'retreat' && sn.t > (T.snagRetreat || 1.4)) { sn.state = 'done'; }
    }

    function stepLoop(dt, ev) {
      const l = state.loop;
      if (l.finishTime != null) return;
      const s = loopRoute[l.seg], inf = loopInfo[l.seg];
      if (loopTaskLeft > 0) {
        loopTaskLeft -= dt; l.action = 'task'; l.speed = 0;
        if (loopTaskLeft <= 0) { l.task = null; }
        return;
      }
      if (inf.task && !loopTaskDone[s.id] && l.f >= inf.task.f) {
        loopTaskDone[s.id] = true; loopTaskLeft = inf.task.dur; l.task = { kind: 'stitch', until: state.time + inf.task.dur };
        ev.push({ type: 'loop-task', kind: 'stitch' });
        return;
      }
      l.action = s.kind === 'connector' ? 'transition' : 'run'; l.speed = loopSpeed;
      l.f += loopSpeed * dt / s.length; l.distance += loopSpeed * dt;
      if (inf.pickup) {
        const it = items[inf.pickup.item];
        if (it.status === 'uncollected' && l.f >= inf.pickup.f) {
          it.available = true; it.status = 'held'; it.heldSeq = ++holdSeq; recount();
          ev.push({ type: 'pickup', item: it.id });
        }
      }
      if (s.id === 'finish' && l.f >= inf.finish && state.held.loop >= 3) {
        l.finishTime = state.time; l.rank = state.purl.finishTime != null ? 2 : 1; l.action = 'finished';
        ev.push({ type: 'finish', who: 'loop', time: l.finishTime });
        updateResult();
        return;
      }
      if (l.f >= 1 && l.seg < loopRoute.length - 1) { l.seg++; l.segId = loopRoute[l.seg].id; l.f = 0; ev.push({ type: 'segment', who: 'loop', segId: l.segId }); }
      l.f = Math.min(l.f, 1);
    }

    function updateResult() {
      const p = state.purl, l = state.loop;
      if (p.finishTime == null) return;
      state.result = {
        purlTime: p.finishTime, loopTime: l.finishTime, purlRank: p.rank, loopRank: l.rank,
        winner: p.rank === 1 ? 'purl' : 'loop', loopStillRacing: l.finishTime == null && finishWait < (T.finishWaitForLoop || 25)
      };
    }

    function stepStitches(dt, ev) {
      Object.keys(state.stitches).forEach(function (id) {
        const st = state.stitches[id];
        if (st.state !== 'animating') return;
        const dur = id === 'ribbon' ? (T.ribbonUnfurl || 1.3) : id === 'shortcut' ? (T.shortcutUnroll || 1.5)
          : id === 'tassels' ? 1.05 : 2.85;
        st.t = Math.min(1, st.t + dt / dur);
        if (id === 'tassels') st.lifts = [0, 1, 2].map(function (i) { return clamp((st.t * 1.05 - i * 0.28) / 0.45, 0, 1); });
        if (id === 'butterfly') st.phase = st.t < 0.25 ? 'emerge' : st.t < 0.85 ? 'fly' : 'place';
        if (st.t >= 1) {
          st.state = 'open';
          if (id === 'butterfly') { st.phase = 'done'; if (SCENARIO !== 'fail') items['purl.gold'].available = true; }
          ev.push({ type: 'stitch-open', id: id });
        }
      });
    }

    function step(dt) {
      const ev = [];
      if (state.paused || state.mode === 'intro' || state.mode === 'failed') return ev;
      if (state.mode === 'countdown') {
        state.countdown -= dt;
        if (state.countdown <= 0) { state.countdown = 0; state.mode = 'running'; state.time = 0; ev.push({ type: 'go' }); }
        return ev;
      }
      state.time += dt;
      if (state.mode === 'running') {
        stepStitches(dt, ev);
        stepPurl(dt, ev);
        if (failAt != null && state.time >= failAt) { state.mode = 'failed'; state.purl.action = 'failed'; ev.push({ type: 'fail' }); }
      } else if (state.mode === 'finished') {
        finishWait += dt;
        state.gate.t = Math.min(1, state.gate.t + dt / 1.2);
        if (state.gate.t >= 1) state.gate.state = 'open';
      }
      stepLoop(dt, ev);
      if (state.mode === 'finished') updateResult();
      if (state.mode === 'running') state.objective = objectiveFor();
      if (state.message && state.time > state.message.until) state.message = null;
      if (state.hint && state.time > state.hint.until) state.hint = null;
      return ev;
    }

    function input(cmd) {
      const ev = [];
      if (!cmd || state.paused || state.mode !== 'running') return ev;
      const p = state.purl;
      if (cmd.type === 'tap') {
        state.stats.taps++;
        const st = state.stitches[cmd.target];
        if (st && st.state === 'ready') { st.state = 'animating'; st.t = 0; st.tappedAt = state.time; state.hint = null; ev.push({ type: 'stitch-tap', id: cmd.target }); }
      } else if (cmd.type === 'swipe') {
        if (cmd.dir === 'up') {
          if (p.jumpT > 0) { if (p.jumpT < 0.25) jumpBuffer = T.inputBufferTime || 0.15; }
          else { p.jumpT = 1; ev.push({ type: 'jump', who: 'purl' }); }
        } else if (cmd.dir === 'left' || cmd.dir === 'right') {
          if (seg().id === 'landing') {
            const nl = clamp(p.lane + (cmd.dir === 'left' ? -1 : 1), -1, 1);
            if (nl !== p.lane) { p.lane = nl; ev.push({ type: 'lane', who: 'purl', lane: nl }); }
          }
        }
      }
      return ev;
    }

    return {
      state: state,
      step: step,
      input: input,
      start: function () { if (state.mode === 'intro') { state.mode = 'countdown'; state.countdown = T.countdown || 3; } return []; },
      pause: function (reason) { state.paused = true; state.pauseReason = reason || 'user'; return []; },
      resume: function () { state.paused = false; state.pauseReason = null; return []; },
      debug: {
        teleport: function (who, segId, f) {
          const r = who === 'loop' ? loopRoute : route;
          const i = r.findIndex(function (s) { return s.id === segId; });
          if (i < 0) return;
          if (who === 'loop') { state.loop.seg = i; state.loop.segId = segId; state.loop.f = f || 0; }
          else { enterSeg(i, []); state.purl.f = f || 0; state.phase = route[i].phase || state.phase; state.objective = objectiveFor(); }
        },
        setHeld: function (who, n) {
          COLORS.forEach(function (c, i) {
            const it = items[who + '.' + c];
            it.status = i < n ? 'held' : 'uncollected'; it.available = true; it.heldSeq = i < n ? ++holdSeq : 0;
          });
          recount();
        },
        openAll: function () { Object.keys(state.stitches).forEach(function (id) { state.stitches[id].state = 'open'; state.stitches[id].t = 1; }); },
        forceFail: function () { failAt = state.time; },
        forceFinish: function (loopFirst) {
          this.setHeld('purl', 3); this.setHeld('loop', 3);
          if (loopFirst) { state.loop.finishTime = Math.max(0, state.time - 2.4); state.loop.rank = 1; state.loop.action = 'finished'; }
          const fi = route.length - 1;
          this.teleport('purl', route[fi].id, segInfo[fi].finish - 0.001);
          if (!loopFirst) this.teleport('loop', loopRoute[fi].id, 0.2);
        },
        message: function (text, kind) { say(text, kind, 3); },
        scenario: SCENARIO
      }
    };
  }

  /* ---------------- fake renderer ---------------- */

  function createRenderer(opts) {
    const canvas = opts.canvas;
    const ctx = canvas.getContext('2d');
    const images = opts.images || {};
    const level = opts.level || WW.LEVEL;
    const plates = opts.plates || WW.PLATES || {};
    const D = WW.DESIGN || { w: 841, h: 1870 };
    let W = 1, H = 1, dpr = 1;
    let view = { x: 0, y: 0, w: 1, h: 1, s: 1 };
    let currentPlate = 'p01';
    let targets = [];
    const callouts = [];
    let clockT = 0;

    function resize(w, h, ratio) {
      W = w; H = h; dpr = Math.min(2, ratio || 1);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const s = Math.min(w / D.w, h / D.h);
      view = { x: (w - D.w * s) / 2, y: (h - D.h * s) / 2, w: D.w * s, h: D.h * s, s: s };
    }

    function plateFor(state) {
      const seg = level.route[state.purl.seg] || level.route[0];
      if (seg.kind === 'plate') return seg.plate;
      return (state.purl.f < 0.5 ? seg.from : seg.to) || 'p01';
    }

    function worldToScreen(plateId, x, y) { return { x: view.x + x * view.s, y: view.y + y * view.s }; }

    function render(state, dt) {
      clockT += dt || 0;
      currentPlate = plateFor(state);
      const img = images[currentPlate];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#2a1810';
      ctx.fillRect(0, 0, W, H);
      if (img) {
        // framing: cover-fit, darkened (stand-in for the real renderer's blurred copy)
        const cs = Math.max(W / D.w, H / D.h);
        ctx.globalAlpha = 0.35;
        ctx.drawImage(img, (W - D.w * cs) / 2, (H - D.h * cs) / 2, D.w * cs, D.h * cs);
        ctx.globalAlpha = 1;
        ctx.drawImage(img, view.x, view.y, view.w, view.h);
      }
      const seg = level.route[state.purl.seg] || {};
      // stitch target
      targets = [];
      const stitchId = Object.keys(state.stitches || {}).find(function (id) {
        return state.stitches[id].state === 'ready' && level.stitches[id] && level.stitches[id].seg === seg.id;
      });
      if (stitchId) {
        const sd = (plates[currentPlate] && plates[currentPlate].stitch) || { x: 560, y: 1380, r: 70 };
        const p = worldToScreen(currentPlate, sd.x, sd.y);
        const r = Math.max(44, sd.r * view.s);
        targets.push({ id: stitchId, x: p.x, y: p.y, r: r });
        const pulse = 1 + 0.12 * Math.sin(clockT * 6);
        ctx.strokeStyle = 'rgba(255, 214, 92, 0.95)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.7 * pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.font = '700 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#fff8e8'; ctx.fillRect(p.x - 52, p.y - r - 30, 104, 24);
        ctx.fillStyle = '#552916'; ctx.fillText('Tap the stitch', p.x, p.y - r - 13);
      }
      // dropped items
      Object.keys(state.items || {}).forEach(function (k) {
        const it = state.items[k];
        if (it.owner !== 'purl' || it.status !== 'dropped' || it.seg !== seg.id) return;
        const dfx = it.f - state.purl.f;
        const x = W / 2 + it.lane * W * 0.22, y = H * 0.8 - dfx * H * 2.2;
        ctx.fillStyle = '#18a3ad'; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
      });
      // Loop (teal circle) when on the same segment index
      if (state.loop && state.loop.seg === state.purl.seg && seg.kind === 'plate') {
        const dfl = state.loop.f - state.purl.f;
        const x = W * 0.72, y = clamp(H * 0.78 - dfl * H * 1.6, H * 0.3, H * 0.95);
        ctx.fillStyle = '#0b97a3'; ctx.beginPath(); ctx.arc(x, y, 22, 0, Math.PI * 2); ctx.fill();
      }
      // Purl (coral circle)
      const px = W / 2 + (state.purl.laneX || 0) * W * 0.22;
      const py = H * 0.8 - (state.purl.jumpH || 0) * H * 0.08;
      ctx.fillStyle = 'rgba(40,20,10,.35)'; ctx.beginPath(); ctx.ellipse(px, H * 0.8 + 30, 34, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = state.purl.action === 'tangled' ? '#a31b3c' : '#e8414f';
      ctx.beginPath(); ctx.arc(px, py, 34, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff3d6'; ctx.lineWidth = 3; ctx.stroke();
      // snagling
      if (seg.id === 'landing' && state.snagling && (state.snagling.state === 'hop' || state.snagling.state === 'tangle')) {
        ctx.fillStyle = '#7a1f4f'; ctx.beginPath(); ctx.arc(W * 0.22, H * 0.7, 26, 0, Math.PI * 2); ctx.fill();
      }
      // callouts
      for (let i = callouts.length - 1; i >= 0; i--) {
        const c = callouts[i];
        c.t += dt || 0;
        if (c.t > 1.2) { callouts.splice(i, 1); continue; }
        ctx.globalAlpha = 1 - c.t / 1.2;
        ctx.font = '900 18px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = c.good ? '#fff8e8' : '#ffdfe6';
        ctx.fillText(c.text, W * 0.66, H * 0.62 - c.t * 30);
        ctx.globalAlpha = 1;
      }
      if (opts.debug) {
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, H - 22, W, 22);
        ctx.fillStyle = '#fff'; ctx.font = '11px monospace'; ctx.textAlign = 'left';
        ctx.fillText('STUB ' + seg.id + ' f=' + state.purl.f.toFixed(3) + ' t=' + (state.time || 0).toFixed(2) + ' ' + state.mode, 6, H - 7);
      }
    }

    function handleEvents(events) {
      events.forEach(function (e) {
        if (e.type === 'pickup' && String(e.item).indexOf('purl.') === 0) callouts.push({ text: '+1 THREAD', good: true, t: 0 });
        if (e.type === 'recover') callouts.push({ text: '+1 THREAD', good: true, t: 0 });
        if (e.type === 'drop') callouts.push({ text: '−1 THREAD', good: false, t: 0 });
      });
    }

    return {
      resize: resize, render: render, handleEvents: handleEvents, worldToScreen: worldToScreen,
      getTapTargets: function () { return targets.slice(); },
      getLayout: function () { return { view: { x: view.x, y: view.y, w: view.w, h: view.h }, purl: { x: W / 2, y: H * 0.8, w: 68 } }; },
      isStub: true
    };
  }

  WW.sim = Object.assign({}, WW.sim, { createRace: createRace, isStub: true });
  WW.render = Object.assign({}, WW.render, { createRenderer: createRenderer, isStub: true });
})(globalThis.WW = globalThis.WW || {});
