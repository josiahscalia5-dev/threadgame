/* Wishweave Wonders — simulation: the four stitch interactions (docs/ARCHITECTURE.md §7.3).

   idle → ready (Purl on the stitch's segment with f ≥ readyF, race running) → animating (on a tap) → open.
   Early taps are ignored without penalty; taps while animating/open do nothing. Opened routes never close and
   lifted tassels never lower. Purl's stop is passable once the stitch is open and `routeSettle` s have passed.
     ribbon     animating `ribbonUnfurl` s
     shortcut   animating `shortcutUnroll` s (no inventory change)
     tassels    three lifts staggered by `tasselStagger`, each `tasselLift` s; open when all three are clear
     butterfly  phase emerge → fly → place (`butterflyEmerge/Fly/Place`); at the end of `place` the gold item on
                that segment becomes available (3/3 happens only when Purl picks it up)
   Extra state fields: `elapsed` (s since the tap), `openedAt` (race time when it opened), `phaseT` (butterfly:
   0..1 within the current phase), `seg`/`f`/`readyF` (where Purl's stop is), `settle` (s since it opened, counted
   by sim steps so it also runs while the tutorial hold freezes the race clock).

   PULL stitches (level `interaction: 'pull'`, the opening ribbon — kit/pull-stitch, docs/PULL-STITCH.md):
   TOUCH → PULL → OPEN instead of a tap. While `ready`, input {type:'pull', target, phase, amount}:
     start   grips the gold loop (`gripping` = true); `pullBase` = the progress kept from earlier gestures
     move    `amount` = this gesture's largest downward drag / the drag target (0..1, never decreases within a
             gesture); `pull` = max(pull, pullBase + amount). At 1 the knot releases: `animating` (the unfurl)
     end / cancel   releases the grip; partial `pull` is kept, so a new touch continues from it
   Taps on a pull stitch do nothing. Completion happens once: later pulls/taps are ignored. Opening awards nothing. */
(function (WW) {
  'use strict';
  const sim = WW.sim = WW.sim || {};

  function totalTime(T, kind) {
    switch (kind) {
      case 'ribbon': return T.ribbonUnfurl;
      case 'shortcut': return T.shortcutUnroll;
      case 'tassels': return 2 * T.tasselStagger + T.tasselLift;
      case 'butterfly': return T.butterflyEmerge + T.butterflyFly + T.butterflyPlace;
      default: return 1;
    }
  }

  function create(ctx) {
    const out = {};
    const defs = ctx.level.stitches || {};
    Object.keys(defs).forEach(function (id) {
      const def = defs[id];
      const segIndex = ctx.segIndex[def.seg];
      if (segIndex === undefined) throw new Error('WW.sim: stitch "' + id + '" names unknown segment ' + def.seg);
      const seg = ctx.route[segIndex];
      const stop = seg.stops.filter(function (s) { return s.stitch === id; })[0];
      if (!stop) throw new Error('WW.sim: no stop event for stitch "' + id + '" on plate ' + seg.plate);
      const s = { id: id, kind: def.kind || id, state: 'idle', t: 0, elapsed: 0, tappedAt: null, openedAt: null,
                  settle: 0, seg: seg.id, segIndex: segIndex, f: stop.f, readyF: stop.readyF || 0,
                  interaction: def.interaction || 'tap', tutorial: !!def.tutorial };
      if (s.interaction === 'pull') { s.pull = 0; s.pullBase = 0; s.gripping = false; s.gestures = 0; }
      if (s.kind === 'tassels') s.lifts = [0, 0, 0];
      if (s.kind === 'butterfly') { s.phase = 'dormant'; s.phaseT = 0; }
      out[id] = s;
    });
    return out;
  }

  function passable(ctx, id) {
    const s = ctx.state.stitches[id];
    return !!s && s.state === 'open' && s.settle >= ctx.T.routeSettle - 1e-9;
  }

  /* True while a stitch on Purl's current segment still holds him (ready/animating/settling, stop ahead):
     the "stitch lock" during which Snagling may not attack. */
  function locked(ctx) {
    const st = ctx.state, p = st.purl;
    const ids = Object.keys(st.stitches);
    for (let i = 0; i < ids.length; i++) {
      const s = st.stitches[ids[i]];
      if (s.segIndex === p.seg && p.f <= s.f + 1e-6 && !passable(ctx, s.id)) return true;
    }
    return false;
  }

  function open(ctx, s) {
    s.state = 'open';
    s.t = 1;
    s.openedAt = ctx.state.time;
    if (s.kind === 'tassels') s.lifts = [1, 1, 1];
    if (s.kind === 'butterfly') {
      s.phase = 'done'; s.phaseT = 1;
      ctx.inventory.deliver(ctx, 'purl', s.segIndex);
    }
    ctx.emit({ type: 'stitch-open', id: s.id });
    ctx.refreshObjective();
  }

  function animate(ctx, s, dt) {
    const T = ctx.T;
    s.elapsed += dt;
    const total = totalTime(T, s.kind);
    s.t = Math.min(1, s.elapsed / total);
    if (s.kind === 'tassels') {
      for (let i = 0; i < 3; i++) s.lifts[i] = WW.util.clamp((s.elapsed - i * T.tasselStagger) / T.tasselLift, 0, 1);
      if (s.lifts[2] >= 1) open(ctx, s);
      return;
    }
    if (s.kind === 'butterfly') {
      const e = s.elapsed, a = T.butterflyEmerge, b = a + T.butterflyFly, c = b + T.butterflyPlace;
      if (e < a) { s.phase = 'emerge'; s.phaseT = e / a; }
      else if (e < b) { s.phase = 'fly'; s.phaseT = (e - a) / T.butterflyFly; }
      else if (e < c) { s.phase = 'place'; s.phaseT = (e - b) / T.butterflyPlace; }
      else open(ctx, s);
      return;
    }
    if (s.elapsed >= total - 1e-9) open(ctx, s);
  }

  function update(ctx, dt) {
    const st = ctx.state, p = st.purl;
    Object.keys(st.stitches).forEach(function (id) {
      const s = st.stitches[id];
      if (s.state === 'open' && s.settle < ctx.T.routeSettle) s.settle += dt;
      if (s.state === 'idle' && st.mode === 'running' && p.seg === s.segIndex && p.f >= s.readyF - 1e-9 &&
          p.f <= s.f + 1e-6) {
        s.state = 'ready';
      }
      if (s.state === 'animating') animate(ctx, s, dt);
    });
  }

  /* A tap from the renderer's hit test. Returns true when it started the interaction. */
  function tap(ctx, id) {
    const s = ctx.state.stitches[id];
    if (!s || s.state !== 'ready' || s.interaction === 'pull') return false;
    s.state = 'animating';
    s.tappedAt = ctx.state.time;
    s.elapsed = 0;
    s.t = 0;
    if (s.kind === 'butterfly') { s.phase = 'emerge'; s.phaseT = 0; }
    ctx.emit({ type: 'stitch-tap', id: id });
    return true;
  }

  /* A pull gesture on a pull stitch (see the header). Returns true when it changed the stitch. */
  function pull(ctx, id, phase, amount) {
    const s = ctx.state.stitches[id];
    if (!s || s.interaction !== 'pull') return false;
    if (phase === 'start') {
      if (s.state !== 'ready' || s.gripping) return false;
      s.gripping = true;
      s.pullBase = s.pull;
      s.gestures += 1;
      ctx.emit({ type: 'pull-start', id: id, pull: s.pull });
      return true;
    }
    if (!s.gripping || s.state !== 'ready') return false;
    let changed = false;
    if (amount > 0) {
      const p = WW.util.clamp(s.pullBase + amount, 0, 1);
      if (p > s.pull + 1e-9) { s.pull = p; changed = true; }
    }
    if (s.pull >= 1 - 1e-9) {
      s.pull = 1;
      s.gripping = false;
      s.state = 'animating';
      s.tappedAt = ctx.state.time;
      s.elapsed = 0;
      s.t = 0;
      ctx.emit({ type: 'stitch-tap', id: id });
      ctx.emit({ type: 'pull-complete', id: id });
      return true;
    }
    if (phase === 'end' || phase === 'cancel') {
      s.gripping = false;
      ctx.emit({ type: 'pull-release', id: id, pull: s.pull, cancelled: phase === 'cancel' });
      return true;
    }
    return changed;
  }

  /* Pausing, backgrounding or a lost pointer: let go of any grip (partial progress is kept). */
  function releaseAll(ctx) {
    const st = ctx.state.stitches;
    Object.keys(st).forEach(function (id) { if (st[id].gripping) st[id].gripping = false; });
  }

  sim.stitches = { create: create, update: update, tap: tap, pull: pull, releaseAll: releaseAll, passable: passable,
                   locked: locked, totalTime: totalTime };
})(globalThis.WW = globalThis.WW || {});
