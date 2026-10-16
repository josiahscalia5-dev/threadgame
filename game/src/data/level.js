/* Wishweave Wonders — Level 1 route (WW.LEVEL), docs/ARCHITECTURE.md §6.

   route      Purl's connected route: the six plates alternate with "around the tower" connectors.
   loopRoute  Loop's own route, index-aligned with `route` (same ids, kinds and plates) but with his own lengths.
   stitches   the four tap interactions and the route segment that owns each one.
   loop       Loop's per-race variation (see below); read by sim/loop-ai.js.

   `length` is metres; a racer at speed v advances df = v * dt / length. Every fraction (stops, pickups, reveal,
   finish, Loop's tasks...) lives in the plate data (WW.PLATES[plate].purl/loop.events) and is read by the sim at
   createRace time — nothing here repeats a plate fraction.

   Pacing — race clock (s since GO), measured with `node tests/unit/bot.cjs --sweep=50 [--profile=first]` on the final
   p06/p07 data, verified by tests/unit/pacing.test.cjs (bot profiles are described in tests/unit/bot.cjs):
     profile                                                      Purl     Loop over seeds 1–50          Purl wins
     competent  taps 1.0 s after each cue, jumps 0.3 s after reveal 99.92    94.0–116.9 (mean 103.3, sd 5.2)  36/50 (72 %)
     first      taps 2.0 s after each cue, one hit, steers into
                the dropped thread 0.4 s later, same-pass recovery  105.03   (same Loop races)               16/50 (32 %)
   Purl's time does not depend on the seed; Loop's does (per-race form, per-segment jitter, reactions, hesitations,
   bypass line, hop mistakes) and never on the player. Add the 3 s countdown for the wall-clock attempt length.
   The two profiles differ by ~5 s: 4 × 1 s of extra stitch reaction + ~1.1 s for the tangle/slow-down of one hit.
   Documented seeds (Loop's finish time; competent Purl 99.92 s, first-time Purl 105.03 s):
     competent  Purl wins: 1 (Loop 103.11), 8 (108.93), 12 (108.15)   Loop wins: 4 (94.41), 30 (96.44), 36 (93.96)
     first      Purl wins: 7 (114.58), 8 (108.93), 19 (111.38)        Loop wins: 1 (103.11), 2 (99.22), 4 (94.41)
     photo finish: seed 6, Loop 105.00 vs first-time Purl 105.03
   Snagling dodge window (reaction measured from the reveal, 1/60 s steps): jump started 0.04–0.48 s after the
   reveal clears contact; a lane change started 0.00–0.41 s after it moves Purl out of the target lane in time.
   Lengths: every plate is ~15 m per racer width of its path (WW.path.widths), so Purl crosses each plate at a
   similar on-screen pace; connectors are 19 m (≈ 3.8 s turns around a tower). The landing (38 m) puts the
   Snagling reveal ~1.9 s after Purl enters it. Objective texts: `objective` on entry, `objectiveOpen` once the
   plate's stitch is open, `objectiveDone` once its thread is held, `objectiveDrop` while a thread lies dropped. */
(function (WW) {
  'use strict';

  const route = [
    { id: 'ribbon', kind: 'plate', plate: 'p01', length: 128,
      phase: 'LEVEL 1 · START', objective: 'UNFURL THE RIBBON',
      objectiveOpen: 'Collect the coral thread', objectiveDone: 'FOLLOW THE RIBBON' },
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
    'ribbon': 121, 'c-ribbon': 19, 'shortcut': 49, 'c-shortcut': 19, 'tassels': 69, 'c-tassels': 19,
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
      ribbon: { seg: 'ribbon', kind: 'ribbon', interaction: 'pull', tutorial: true },  // TOUCH → PULL → OPEN (kit/pull-stitch)
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
    /* Measured pacing and documented seeds (see the header); tests/unit/pacing.test.cjs checks them. */
    pacing: {
      competent: { purl: 99.92, purlWins: [1, 8, 12], loopWins: [4, 30, 36] },
      first: { purl: 105.03, purlWins: [7, 8, 19], loopWins: [1, 2, 4] }
    },
    completeObjective: 'LEVEL 1 COMPLETE',
    missingMessage: 'A THREAD IS MISSING'
  };
})(globalThis.WW = globalThis.WW || {});
