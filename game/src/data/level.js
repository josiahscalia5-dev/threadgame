/* Wishweave Wonders — Level 1 on the connected course (WW.LEVEL).

   The course itself is WW.ROUTE (game/src/data/route.js, generated from the Connected World kit's route.json):
   one continuous 201.3 m road from Spoolwake Pier to the Flowergate, with the Tassel side loop (main s 81.4–97.4).
   This file adds the race layer on top of it: section names, the three wish threads and their spools, the
   objective texts, the side-loop speed ribbon and Loop's per-race variation.

   Milestone 1 (docs/CONNECTED-WORLD-PLAN.md §4): the Snagling, the butterfly and the opening pull lesson are not
   placed on the course yet (their rule modules return after the review), so there are no stitches here. */
(function (WW) {
  'use strict';

  const R = WW.ROUTE;
  if (!R) throw new Error('WW.LEVEL needs WW.ROUTE (load src/data/route.js first)');
  const spool = function (type) {
    return R.collectibles.filter(function (c) { return c.type === type; })[0];
  };

  WW.LEVEL = {
    id: 'level1',
    course: R,

    /* HUD phase text per course section (WW.ROUTE.sections ids). */
    sections: {
      spoolwake: 'SPOOLWAKE PIER',
      bellspindle: 'BELLSPINDLE BEND',
      tassel: 'TASSEL SWITCH',
      snagling: 'SNAGLING LANDING',
      butterfly: 'BUTTERFLY REACH',
      flowergate: 'FLOWERGATE CREST'
    },

    /* The three distinct wish threads, in course order. Each spool is a shared station: each racer pulls his own
       thread (purl.<color> / loop.<color>) from it when he passes within reach. */
    threads: [
      { color: 'coral', spool: spool('red') },
      { color: 'teal', spool: spool('teal') },
      { color: 'gold', spool: spool('gold') }
    ],

    objectives: {
      first: 'RACE TO THE FIRST THREAD',
      city: 'RACE THROUGH THE LOOM CITY',
      teal: 'GRAB THE TEAL THREAD',
      gold: 'FIND THE GOLDEN THREAD',
      gate: 'RACE TO THE FLOWER GATE',
      missed: 'MISSED IT — THE {color} THREAD IS AHEAD',
      approach: 25                   // m before a spool at which the objective names it
    },

    /* The Tassel side loop: a teal speed ribbon, announced before the fork. */
    sideLoop: {
      id: R.branches[0].id,
      hint: '← STAY LEFT FOR THE SIDE LOOP'
    },

    /* Loop is a fallible computer rival; nothing about him depends on the player. form = whole-race pace
       multiplier, rolled per seed (symmetric: he is never slowed to guarantee a Purl win). */
    loop: { form: [0.93, 1.07] },

    /* Measured pacing (tests/unit/connected.test.cjs keeps it honest); filled in by tests/unit/bot.cjs --course. */
    pacing: null,

    completeObjective: 'LEVEL 1 COMPLETE',
    missingMessage: 'A THREAD IS MISSING'
  };
})(globalThis.WW = globalThis.WW || {});
