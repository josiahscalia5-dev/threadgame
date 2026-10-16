/* Wishweave Wonders — Level 1 route (WW.LEVEL), docs/ARCHITECTURE.md §6.

   route      Purl's connected route: the six plates alternate with "around the tower" connectors.
   loopRoute  Loop's own route, index-aligned with `route` (same ids, kinds and plates) but with his own lengths.
   stitches   the four tap interactions and the route segment that owns each one.
   loop       Loop's per-race variation (see below); read by sim/loop-ai.js.

   `length` is metres; a racer at speed v advances df = v * dt / length. Every fraction (stops, pickups, reveal,
   finish, Loop's tasks...) lives in the plate data (WW.PLATES[plate].purl/loop.events) and is read by the sim at
   createRace time — nothing here repeats a plate fraction.

   Pacing (measured with tests/unit/bot.cjs, milestone 1 — Snagling not active yet; final table in milestone 2):
     competent run (stitch reaction 1 s)   race clock ~85.5 s       first-time reaction 2 s   ~89.5 s
     Loop over seeds 1–50                  81.5–96.7 s (avg 87.5)   Purl wins 34/50 resp. 13/50
   Connectors are ~3 s turns around a tower. Objective texts: `objective` on entry, `objectiveOpen` once the
   plate's stitch is open, `objectiveDone` once its thread is held, `objectiveDrop` while a thread lies dropped. */
(function (WW) {
  'use strict';

  const route = [
    { id: 'ribbon', kind: 'plate', plate: 'p01', length: 128,
      phase: 'LEVEL 1 · START', objective: 'UNFURL THE RIBBON',
      objectiveOpen: 'GRAB THE CORAL THREAD', objectiveDone: 'FOLLOW THE RIBBON' },
    { id: 'c-ribbon', kind: 'connector', from: 'p01', to: 'p02', length: 19, style: 'right' },
    { id: 'shortcut', kind: 'plate', plate: 'p02', length: 55,
      phase: 'LEVEL 1 · MIDDLE', objective: 'OPEN THE SHORTCUT',
      objectiveOpen: 'CROSS THE SHORTCUT' },
    { id: 'c-shortcut', kind: 'connector', from: 'p02', to: 'p03', length: 19, style: 'right' },
    { id: 'tassels', kind: 'plate', plate: 'p03', length: 69,
      phase: 'LEVEL 1', objective: 'LIFT THE TASSELS',
      objectiveOpen: 'GRAB THE TEAL THREAD', objectiveDone: 'RUN TO THE LANDING' },
    { id: 'c-tassels', kind: 'connector', from: 'p03', to: 'p04', length: 19, style: 'right' },
    { id: 'landing', kind: 'plate', plate: 'p04', length: 38,
      phase: 'LEVEL 1', objective: 'CROSS THE LANDING',
      objectiveDrop: 'GET YOUR THREAD BACK' },
    { id: 'c-landing', kind: 'connector', from: 'p04', to: 'p06', length: 19, style: 'right' },
    { id: 'tapestry', kind: 'plate', plate: 'p06', length: 45,
      phase: 'LEVEL 1', objective: 'WAKE THE EMBROIDERY',
      objectiveOpen: 'GRAB THE GOLDEN THREAD', objectiveDone: 'RACE TO THE FLOWER GATE' },
    { id: 'c-tapestry', kind: 'connector', from: 'p06', to: 'p07', length: 19, style: 'right' },
    { id: 'finish', kind: 'plate', plate: 'p07', length: 27,
      phase: 'LEVEL 1', objective: 'REACH THE FLOWER GATE', objectiveDone: 'LEVEL 1 COMPLETE' }
  ];

  /* Loop's lengths: his visible routes are the neighbouring teal ribbons/bypasses of each plate. */
  const loopLengths = {
    'ribbon': 131, 'c-ribbon': 19, 'shortcut': 49, 'c-shortcut': 19, 'tassels': 69, 'c-tassels': 19,
    'landing': 38, 'c-landing': 19, 'tapestry': 45, 'c-tapestry': 19, 'finish': 30
  };

  const loopRoute = route.map(function (seg) {
    const out = { id: seg.id, kind: seg.kind, length: loopLengths[seg.id] };
    if (seg.kind === 'plate') out.plate = seg.plate;
    else { out.from = seg.from; out.to = seg.to; out.style = seg.style; }
    return out;
  });

  WW.LEVEL = {
    id: 'level1',
    route: route,
    loopRoute: loopRoute,
    stitches: {
      ribbon: { seg: 'ribbon', kind: 'ribbon' },
      shortcut: { seg: 'shortcut', kind: 'shortcut' },
      tassels: { seg: 'tassels', kind: 'tassels' },
      butterfly: { seg: 'tapestry', kind: 'butterfly' }
    },
    /* Loop is a fallible computer rival. Besides the spec's per-segment speed jitter, reaction, hesitation and
       hop mistakes (WW.TUNING.loop*), his pace varies from race to race ("form": a whole-race multiplier on
       loopSpeed, independent of the player) and the line he takes over a bypass varies (± fraction of the plate's
       `extra` seconds). Both are symmetric — he is never slowed to guarantee a Purl win. A WW.TUNING value with
       the same name (loopForm, loopBypassJitter, loopDropAheadF) overrides these if it is ever added there. */
    loop: {
      form: [0.89, 1.11],
      bypassJitter: 0.4,
      dropAheadF: 0.05
    },
    completeObjective: 'LEVEL 1 COMPLETE',
    missingMessage: 'A THREAD IS MISSING'
  };
})(globalThis.WW = globalThis.WW || {});
