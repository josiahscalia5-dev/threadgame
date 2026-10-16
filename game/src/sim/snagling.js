/* Wishweave Wonders — simulation: Snagling on the p04 landing (docs/ARCHITECTURE.md §7.5, §12.2).

   concealed → hop (snagRevealToContact + snagContactWindow s) → tangle (hit, snagTangle s) or retreat →
   retreat (snagRetreat s) → done. Armed once per pass over the landing; a new pass (recovery loop / gate return)
   re-arms it. It reveals when Purl reaches the plate's `reveal` f while no stitch lock holds him and he is not in
   a loop/return transition. No warning precedes the reveal. Contact is tested from snagRevealToContact for
   snagContactWindow s: contact if |laneX - targetLane| < 0.55 and jumpH < jumpAirborneAbove. One damage event
   per attack. Snagling never moves Purl; it only stops him (tangle) where he stands.
     hit, holding ≥ 1   drop the most recent held ID ahead (dropAheadF) on carpet with lanes, lane +1 (0 when
                        Purl is in lane +1), "SNAGGED!", tangle, immunity, then slowAfterHit; 1 → 0 is not a fail
     hit, holding 0     fail after failDelay (gentle fail; Purl stays tangled meanwhile)
     during immunity    'immune-ignored' — nothing else happens
     no contact         'dodge' — no message, count unchanged */
(function (WW) {
  'use strict';
  const sim = WW.sim = WW.sim || {};
  const CONTACT_LANE = 0.55;

  function create() {
    return { state: 'concealed', t: 0, targetLane: 0, contactF: null, result: null, pass: 1, armed: true,
             contactConsumed: false, seg: null };
  }

  function revealSeg(ctx) {
    for (let i = 0; i < ctx.route.length; i++) if (ctx.route[i].reveal !== null) return ctx.route[i];
    return null;
  }

  function canReveal(ctx) {
    const st = ctx.state, p = st.purl, s = st.snagling, seg = revealSeg(ctx);
    if (!seg || !s.armed || s.state !== 'concealed' || st.mode !== 'running') return false;
    if (p.seg !== seg.index || p.f < seg.reveal - 1e-9 || p.f >= seg.exit) return false;
    if (p.finishTime !== null || p.failAt !== null) return false;
    if (st.transition && st.transition.kind !== 'connector') return false;
    return !sim.stitches.locked(ctx);
  }

  function reveal(ctx) {
    const st = ctx.state, p = st.purl, s = st.snagling, T = ctx.T, seg = ctx.route[p.seg];
    s.state = 'hop';
    s.t = 0;
    s.targetLane = p.lane;
    s.contactF = Math.min(seg.exit, p.f + p.speed * T.snagRevealToContact / seg.length);
    s.result = null;
    s.contactConsumed = false;
    s.armed = false;
    s.seg = seg.id;
    ctx.emit({ type: 'reveal', lane: p.lane, pass: s.pass });
  }

  /* Where a dropped thread lands: ahead of Purl, ≥ 0.08 before the exit, on a part of the path that still has
     lanes (so lane +1 is reachable), spaced from other drops by dropSpacingF. */
  function dropSpot(ctx, item) {
    const st = ctx.state, p = st.purl, T = ctx.T, seg = ctx.route[p.seg];
    const lane = p.lane === 1 ? 0 : 1;
    const maxF = seg.exit - 0.08;
    let f = Math.min(p.f + T.dropAheadF, maxF);
    if (lane !== 0 && seg.path) {
      while (f > p.f + 0.01 && WW.path.sample(seg.path, f).lane < T.laneMinSpacing * 1.25) f -= 0.005;
    }
    const others = Object.keys(st.items).map(function (k) { return st.items[k]; }).filter(function (it) {
      return it !== item && it.owner === 'purl' && it.status === 'dropped' && it.segIndex === seg.index;
    });
    for (let guard = 0; guard < 8; guard++) {
      const clash = others.filter(function (o) { return Math.abs(o.f - f) < T.dropSpacingF - 1e-9; })[0];
      if (!clash) break;
      f = clash.f + T.dropSpacingF <= maxF ? clash.f + T.dropSpacingF : clash.f - T.dropSpacingF;
    }
    return { f: Math.max(0, Math.min(maxF, f)), lane: lane };
  }

  function contact(ctx) {
    const st = ctx.state, p = st.purl, s = st.snagling, T = ctx.T;
    s.contactConsumed = true;
    if (st.time < p.immuneUntil) {
      s.result = 'immune';
      ctx.emit({ type: 'immune-ignored' });
      return;
    }
    s.result = 'hit';
    st.stats.hits += 1;
    ctx.emit({ type: 'hit', held: st.held.purl });
    ctx.message('SNAGGED!', 'hit');
    p.immuneUntil = st.time + T.hitImmunity;
    if (st.held.purl > 0) {
      const item = sim.inventory.mostRecentHeld(st, 'purl');
      const spot = dropSpot(ctx, item);
      sim.inventory.drop(ctx, item, p.seg, spot.f, spot.lane);
      p.tangledUntil = st.time + T.snagTangle;
      p.slowUntil = p.tangledUntil + T.slowAfterHitTime;
      ctx.refreshObjective();
    } else {
      p.tangledUntil = st.time + T.failDelay;
      p.failAt = st.time + T.failDelay;
    }
    p.speed = 0;
  }

  function update(ctx, dt) {
    const st = ctx.state, s = st.snagling, T = ctx.T, p = st.purl;
    if (s.state === 'concealed') {
      if (canReveal(ctx)) reveal(ctx);
      return;
    }
    s.t += dt;
    if (s.state === 'hop') {
      const t0 = T.snagRevealToContact, t1 = t0 + T.snagContactWindow;
      if (!s.contactConsumed && p.finishTime === null && s.t >= t0 - 1e-9 && s.t <= t1 + 1e-9 &&
          Math.abs(p.laneX - s.targetLane) < CONTACT_LANE && p.jumpH < T.jumpAirborneAbove) {
        contact(ctx);
      }
      if (s.t > t1 + 1e-9) {
        if (!s.contactConsumed) {
          s.result = 'dodge';
          st.stats.dodges += 1;
          ctx.emit({ type: 'dodge' });
        }
        s.state = s.result === 'hit' ? 'tangle' : 'retreat';
        s.t = 0;
      }
    } else if (s.state === 'tangle') {
      if (s.t >= T.snagTangle) { s.state = 'retreat'; s.t = 0; }
    } else if (s.state === 'retreat') {
      if (s.t >= T.snagRetreat) { s.state = 'done'; s.t = 0; }
    }
  }

  /* A new pass over the landing (recovery loop / gate return) re-arms Snagling. */
  function rearm(ctx) {
    const s = ctx.state.snagling;
    s.state = 'concealed'; s.t = 0; s.result = null; s.contactF = null; s.contactConsumed = false;
    s.armed = true; s.pass += 1;
  }

  /* Test helper: reveal now, wherever Purl is (still subject to nothing else). */
  function forceReveal(ctx) {
    const st = ctx.state;
    if (st.mode !== 'running') return false;
    st.snagling.state = 'concealed';
    st.snagling.armed = true;
    reveal(ctx);
    return true;
  }

  sim.snagling = { create: create, update: update, rearm: rearm, forceReveal: forceReveal, dropSpot: dropSpot,
                   CONTACT_LANE: CONTACT_LANE };
})(globalThis.WW = globalThis.WW || {});
