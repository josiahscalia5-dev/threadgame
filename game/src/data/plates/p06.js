/* Plate p06 — 06-butterfly. Purl runs up the coral carpet beside the tall teal tapestry; the embroidered butterfly
   wakes as he passes, carries the golden spool and sets it on the carpet's far end. Loop crosses the right bridge. */
(function (WW) {
  'use strict';
  WW.PLATES.p06 = {
    id: 'p06', image: 'p06', approved: '06-butterfly.png',
    camera: { zMax: 1.8, anchorY: 0.80 },
    purl: {
      // carpet centre line, measured between the gold braid edges (w ≈ 0.48 × carpet width)
      path: [
        [402, 1500, 300, 100], [400, 1400, 267, 88], [404, 1300, 222, 66], [407, 1200, 184, 46],
        [407, 1120, 156, 26], [405, 1075, 142, 10], [403, 1046, 132, 0]
      ],
      events: [
        { type: 'butterfly', f: 0.02 },                       // the butterfly wakes as Purl enters
        { type: 'pickup', item: 'gold', f: 0.93, lane: 0, size: 82 },
        { type: 'exit', f: 1 }
      ]
    },
    loop: {
      // teal bridge on the right: from the plate edge up-left to behind the central tower
      path: [[852, 1078, 140], [780, 1026, 130], [711, 982, 120], [650, 948, 108], [600, 925, 100], [552, 910, 93], [512, 902, 88]],
      events: [
        { type: 'task', kind: 'hesitate', f: 0.2 },
        { type: 'pickup', item: 'gold', f: 0.55, size: 46 }
      ]
    },
    // rest = the embroidered outline on the tapestry (centre point, sprite width); the flight carries the spool to
    // just above its drop point on the carpet, then the butterfly leaves over the tower.
    butterfly: {
      rest: { x: 108, y: 680, w: 150, rot: -0.12 },
      flight: [[108, 680, 150], [190, 700, 200], [300, 760, 250], [380, 860, 250], [402, 960, 210]],
      exit: [[402, 960, 210], [470, 820, 190], [560, 640, 150], [650, 470, 110]]
    },
    occluders: [
      // central tower trunk: Loop's bridge ends behind it
      { id: 'tower', poly: [[404, 600], [560, 600], [562, 1000], [404, 1000]], behindY: 1000 }
    ],
    wipe: { x0: 404, x1: 560 }
  };
})(globalThis.WW = globalThis.WW || {});
