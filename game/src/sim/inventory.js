/* Wishweave Wonders — simulation: thread inventory (docs/ARCHITECTURE.md §7.4, §12.1).

   Exactly six unique item IDs: purl.coral, purl.teal, purl.gold and loop.coral, loop.teal, loop.gold. Their
   locations come from the plate `pickup` events (Purl's path for purl.*, Loop's path for loop.*), read when the
   race is created. Status changes only through collect / drop / recover below; `state.held` is always derived
   from the statuses (never incremented by hand). A held item has no world visual, so it can never be collected
   twice, and each racer can only ever touch his own IDs. */
(function (WW) {
  'use strict';
  const sim = WW.sim = WW.sim || {};
  const COLORS = ['coral', 'teal', 'gold'];
  const OWNERS = ['purl', 'loop'];

  function create(ctx) {
    const items = {};
    OWNERS.forEach(function (owner) {
      const route = owner === 'purl' ? ctx.route : ctx.loopRoute;
      COLORS.forEach(function (color) {
        let found = null;
        route.forEach(function (seg) {
          seg.pickups.forEach(function (ev) { if (ev.item === color && !found) found = { seg: seg, ev: ev }; });
        });
        if (!found) throw new Error('WW.sim: no ' + owner + ' pickup event for "' + color + '" in the plates');
        const id = owner + '.' + color;
        items[id] = {
          id: id, owner: owner, color: color, status: 'uncollected',
          available: color !== 'gold',          // gold is delivered by the plate's stitch (butterfly / Loop's task)
          seg: found.seg.id, segIndex: found.seg.index, f: found.ev.f,
          lane: owner === 'purl' ? (found.ev.lane || 0) : 0,
          size: found.ev.size || 64,
          heldSeq: 0, dropTime: null,
          homeSeg: found.seg.id, homeF: found.ev.f   // original pickup point (for the gate fallback / tests)
        };
      });
    });
    return items;
  }

  function recount(state) {
    const held = { purl: 0, loop: 0 };
    Object.keys(state.items).forEach(function (id) {
      const it = state.items[id];
      if (it.status === 'held') held[it.owner] += 1;
    });
    state.held.purl = held.purl;
    state.held.loop = held.loop;
    return held;
  }

  function hitF(itemF, span, r) {
    const lo = Math.min(span.f0, span.f1), hi = Math.max(span.f0, span.f1);
    return itemF >= lo - r && itemF <= hi + r;
  }

  function ownItems(state, owner) {
    return Object.keys(state.items).map(function (id) { return state.items[id]; })
      .filter(function (it) { return it.owner === owner; });
  }

  /* Normal pickup: uncollected → held. */
  function collect(ctx, item) {
    const st = ctx.state;
    if (item.status !== 'uncollected' || !item.available) return false;
    item.status = 'held';
    item.heldSeq = ++ctx.heldCounter;
    recount(st);
    ctx.emit({ type: 'pickup', item: item.id, who: item.owner });
    return true;
  }

  /* Dropped → held, the same ID (never a new item). */
  function recover(ctx, item) {
    const st = ctx.state;
    if (item.status !== 'dropped') return false;
    item.status = 'held';
    item.heldSeq = ++ctx.heldCounter;
    item.dropTime = null;
    recount(st);
    if (item.owner === 'purl') {
      st.stats.recoveries += 1;
      ctx.emit({ type: 'recover', item: item.id });
      ctx.refreshObjective();
    } else {
      ctx.emit({ type: 'loop-recover', item: item.id });
    }
    return true;
  }

  /* Held → dropped at (segIndex, f, lane). Returns the item or null. */
  function drop(ctx, item, segIndex, f, lane) {
    const st = ctx.state;
    if (!item || item.status !== 'held') return null;
    const route = item.owner === 'purl' ? ctx.route : ctx.loopRoute;
    item.status = 'dropped';
    item.segIndex = segIndex;
    item.seg = route[segIndex].id;
    item.f = f;
    item.lane = lane;
    item.dropTime = st.time;
    recount(st);
    ctx.emit(item.owner === 'purl'
      ? { type: 'drop', item: item.id, f: f, lane: lane, seg: item.seg }
      : { type: 'loop-drop', item: item.id, f: f, seg: item.seg });
    return item;
  }

  /* The most recently collected held ID of a racer (max heldSeq), or null. */
  function mostRecentHeld(state, owner) {
    let best = null;
    ownItems(state, owner).forEach(function (it) {
      if (it.status === 'held' && (!best || it.heldSeq > best.heldSeq)) best = it;
    });
    return best;
  }

  /* The first (in route order) of a racer's IDs that is not held, or null. */
  function earliestMissing(ctx, owner) {
    let best = null;
    ownItems(ctx.state, owner).forEach(function (it) {
      if (it.status === 'held') return;
      if (!best || it.segIndex < best.segIndex || (it.segIndex === best.segIndex && it.f < best.f)) best = it;
    });
    return best;
  }

  /* Purl's pickups and drop recoveries for the path spans he covered this step. */
  function purlPickups(ctx, spans) {
    const st = ctx.state, T = ctx.T, p = st.purl;
    ownItems(st, 'purl').forEach(function (it) {
      if (it.status === 'held' || !it.available) return;
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        if (s.seg !== it.segIndex || !hitF(it.f, s, T.pickupRadiusF)) continue;
        if (it.status === 'uncollected') { collect(ctx, it); break; }
        if (it.status === 'dropped' && Math.abs(p.laneX - it.lane) < T.dropPickupLane) {
          recover(ctx, it);
          ctx.message('THREAD RECOVERED', 'recover');
          break;
        }
      }
    });
  }

  /* Loop's normal pickups (lane-agnostic; his drops are recovered by loop-ai). */
  function loopPickups(ctx, spans) {
    const T = ctx.T;
    ownItems(ctx.state, 'loop').forEach(function (it) {
      if (it.status !== 'uncollected' || !it.available) return;
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        if (s.seg === it.segIndex && hitF(it.f, s, T.pickupRadiusF)) { collect(ctx, it); break; }
      }
    });
  }

  /* Make every not-yet-available item of `owner` on route segment `segIndex` available (gold delivery). */
  function deliver(ctx, owner, segIndex) {
    const out = [];
    ownItems(ctx.state, owner).forEach(function (it) {
      if (!it.available && it.segIndex === segIndex) { it.available = true; out.push(it.id); }
    });
    return out;
  }

  function allHeld(state, owner) { return state.held[owner] === COLORS.length; }

  sim.inventory = {
    COLORS: COLORS,
    create: create, recount: recount, collect: collect, recover: recover, drop: drop,
    mostRecentHeld: mostRecentHeld, earliestMissing: earliestMissing,
    purlPickups: purlPickups, loopPickups: loopPickups, deliver: deliver, allHeld: allHeld, ownItems: ownItems
  };
})(globalThis.WW = globalThis.WW || {});
