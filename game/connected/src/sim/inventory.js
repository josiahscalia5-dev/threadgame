/* Wishweave Wonders — simulation: thread inventory on the connected course.

   Exactly six unique item IDs: purl.coral, purl.teal, purl.gold and loop.coral, loop.teal, loop.gold. Each thread
   type has one spool on the course (WW.LEVEL.threads → WW.ROUTE.collectibles: red at main s 30.2, teal at 104.7,
   gold at 161.1); a racer pulls his own thread from it when he passes it within reach (T.pickupReach metres
   sideways, jumping or not). Status changes only through collect / drop / recover; `state.held` is always derived
   from the statuses. A held ID can't be collected again and a racer can only touch his own IDs, so a repeated
   pickup can never stand in for a missing type.

   Missing a spool is forgiving, never a dead end: the same ID is offered again T.respawnAhead metres further on, in
   the racer's current line (event 'missed'), and at the latest just before the finish line. */
(function (WW) {
  'use strict';
  const sim = WW.sim = WW.sim || {};
  const COLORS = ['coral', 'teal', 'gold'];
  const OWNERS = ['purl', 'loop'];

  function create(ctx) {
    const items = {};
    const threads = ctx.level.threads || [];
    OWNERS.forEach(function (owner) {
      COLORS.forEach(function (color, order) {
        const th = threads.filter(function (t) { return t.color === color; })[0];
        if (!th || !th.spool) throw new Error('WW.sim: no spool for the ' + color + ' thread');
        const id = owner + '.' + color;
        items[id] = {
          id: id, owner: owner, color: color, order: order, status: 'uncollected', available: true,
          mainS: th.spool.mainS, lateral: th.spool.lateral, hover: th.spool.hover,
          spool: th.spool.id, homeS: th.spool.mainS, homeLateral: th.spool.lateral,
          offers: 0, heldSeq: 0, dropTime: null
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

  function ownItems(state, owner) {
    return Object.keys(state.items).map(function (id) { return state.items[id]; })
      .filter(function (it) { return it.owner === owner; });
  }

  function collect(ctx, item) {
    if (item.status !== 'uncollected' || !item.available) return false;
    item.status = 'held';
    item.heldSeq = ++ctx.heldCounter;
    recount(ctx.state);
    ctx.emit({ type: 'pickup', item: item.id, who: item.owner, color: item.color });
    return true;
  }

  function recover(ctx, item) {
    if (item.status !== 'dropped') return false;
    item.status = 'held';
    item.heldSeq = ++ctx.heldCounter;
    item.dropTime = null;
    recount(ctx.state);
    ctx.emit({ type: item.owner === 'purl' ? 'recover' : 'loop-recover', item: item.id });
    return true;
  }

  /* Held → dropped at (mainS, lateral) on the main road. */
  function drop(ctx, item, mainS, lateral) {
    if (!item || item.status !== 'held') return null;
    item.status = 'dropped';
    item.mainS = mainS;
    item.lateral = lateral;
    item.dropTime = ctx.state.time;
    recount(ctx.state);
    ctx.emit({ type: item.owner === 'purl' ? 'drop' : 'loop-drop', item: item.id, mainS: mainS, lateral: lateral });
    return item;
  }

  function mostRecentHeld(state, owner) {
    let best = null;
    ownItems(state, owner).forEach(function (it) {
      if (it.status === 'held' && (!best || it.heldSeq > best.heldSeq)) best = it;
    });
    return best;
  }

  /* The next (in course order) of a racer's IDs that is not held, or null. */
  function nextMissing(state, owner) {
    let best = null;
    ownItems(state, owner).forEach(function (it) {
      if (it.status === 'held') return;
      if (!best || it.mainS < best.mainS) best = it;
    });
    return best;
  }

  /* Pickups for one racer who moved from main progress m0 to m1 this step, at main-road lateral `lat`.
     finishS bounds where a missed thread may be offered again. */
  function passSpools(ctx, owner, m0, m1, lat, finishS) {
    const T = ctx.T;
    ownItems(ctx.state, owner).forEach(function (it) {
      if (it.status === 'held' || !it.available) return;
      if (!(it.mainS > m0 && it.mainS <= m1)) return;
      if (Math.abs(lat - it.lateral) <= T.pickupReach) {
        if (it.status === 'uncollected') collect(ctx, it);
        else recover(ctx, it);
        return;
      }
      // Missed: offer the same ID again further on, in his current line — never behind him, never past the line.
      it.offers += 1;
      const ahead = Math.min(m1 + T.respawnAhead, finishS - 6);
      it.mainS = ahead > m1 + 1 ? ahead : m1 + 1.5;
      it.lateral = Math.max(-2.2, Math.min(2.2, lat));
      ctx.emit({ type: 'missed', item: it.id, who: owner, color: it.color, mainS: it.mainS });
    });
  }

  function allHeld(state, owner) { return state.held[owner] === COLORS.length; }

  sim.inventory = {
    COLORS: COLORS,
    create: create, recount: recount, collect: collect, recover: recover, drop: drop,
    mostRecentHeld: mostRecentHeld, nextMissing: nextMissing, earliestMissing: function (ctx, owner) {
      return nextMissing(ctx.state, owner);
    },
    passSpools: passSpools, allHeld: allHeld, ownItems: ownItems
  };
})(globalThis.WW = globalThis.WW || {});
