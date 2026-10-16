/* Wishweave Wonders — Level 1 route (WW.LEVEL).

   route      Purl's connected route: the six scenes alternate with short "around the tower" connectors.
   loopRoute  Loop's route, index-aligned with `route` (same ids, kinds and plates) with his own lengths and the
              window of each scene segment in which he is on his painted path (outside it he is out of view,
              behind a tower or round a corner, but still simulated).

   Lengths are metres. A scene's length comes from its painted path: WW.path.widths(path) racer widths ×
   WW.TUNING.metresPerWidth, so Purl crosses every scene at the same on-screen pace. A connector lasts
   WW.TUNING.connectorTime seconds at Purl's speed. Loop's segments are exactly as long as Purl's (a fair race);
   his painted path fills the part of the segment it can cover at his own pace (the whole segment if it is longer,
   where he simply moves a little faster along it in the distance). */
(function (WW) {
  'use strict';
  const T = WW.TUNING;

  const route = [
    { id: 'ribbon', kind: 'plate', plate: 'p01', phase: 'LEVEL 1 · START', objective: 'RUN UP THE RIBBON', objectiveDone: 'RACE AROUND THE TOWER' },
    { id: 'c-ribbon', kind: 'connector', from: 'p01', to: 'p02', style: 'right' },
    { id: 'shortcut', kind: 'plate', plate: 'p02', phase: 'LEVEL 1 · MIDDLE', objective: 'TAKE THE SHORTCUT' },
    { id: 'c-shortcut', kind: 'connector', from: 'p02', to: 'p03', style: 'right' },
    { id: 'tassels', kind: 'plate', plate: 'p03', phase: 'LEVEL 1 · MIDDLE', objective: 'GRAB THE TEAL THREAD', objectiveDone: 'ON TO THE LANDING' },
    { id: 'c-tassels', kind: 'connector', from: 'p03', to: 'p04', style: 'right' },
    { id: 'landing', kind: 'plate', plate: 'p04', phase: 'LEVEL 1 · MIDDLE', objective: 'WATCH OUT FOR SNAGLING', objectiveDrop: 'GET YOUR THREAD BACK' },
    { id: 'c-landing', kind: 'connector', from: 'p04', to: 'p06', style: 'right' },
    { id: 'tapestry', kind: 'plate', plate: 'p06', phase: 'LEVEL 1 · FINAL', objective: 'CATCH THE GOLDEN THREAD', objectiveDone: 'RACE TO THE FLOWER GATE' },
    { id: 'c-tapestry', kind: 'connector', from: 'p06', to: 'p07', style: 'right' },
    { id: 'finish', kind: 'plate', plate: 'p07', phase: 'LEVEL 1 · FINAL', objective: 'REACH THE FLOWER GATE' }
  ];

  /* Where Loop's painted stretch sits inside his segment (0 = he is on it from the moment he enters, 0.5 = centred,
     1 = at the end). */
  const loopVisibleAt = { ribbon: 0, shortcut: 0.5, tassels: 0.5, landing: 0.5, tapestry: 0.5, finish: 1 };

  function plateLength(plate) { return WW.path.widths(WW.PLATES[plate].purl.path) * T.metresPerWidth; }
  function exitF(plate) {
    const e = (WW.PLATES[plate].purl.events || []).filter(function (x) { return x.type === 'exit'; })[0];
    return e ? e.f : 1;
  }
  function loopPathLength(plate) { return WW.path.widths(WW.PLATES[plate].loop.path) * T.metresPerWidth; }

  /* length: metres of the whole painted path (maps path fraction f to metres); run: metres Purl actually runs on
     the segment (to the scene's exit). */
  route.forEach(function (seg) {
    seg.length = seg.kind === 'plate' ? plateLength(seg.plate) : T.connectorTime * T.purlSpeed;
    seg.run = seg.kind === 'plate' ? seg.length * exitF(seg.plate) : seg.length;
  });

  const loopRoute = route.map(function (seg) {
    const out = { id: seg.id, kind: seg.kind };
    if (seg.kind === 'connector') {
      out.from = seg.from; out.to = seg.to; out.style = seg.style; out.length = seg.length;
      out.window = null;
      return out;
    }
    out.plate = seg.plate;
    const length = seg.run;              // Loop runs exactly as far as Purl does on every segment
    const span = Math.min(1, loopPathLength(seg.plate) / length), at = loopVisibleAt[seg.id];
    const a = (1 - span) * (at === undefined ? 0.5 : at);
    out.length = length;
    out.window = [a, a + span];          // segment fraction range mapped onto his painted path 0..1
    return out;
  });

  WW.LEVEL = {
    id: 'level1',
    route: route,
    loopRoute: loopRoute,
    completeObjective: 'LEVEL 1 COMPLETE',
    missingMessage: 'A THREAD IS MISSING'
  };
})(globalThis.WW = globalThis.WW || {});
