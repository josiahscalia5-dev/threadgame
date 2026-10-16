/* Plate p03 — 03-tassels: raised floral approach, three plum tassels, teal spool on the round landing. */
(function (WW) {
  'use strict';
  WW.PLATES.p03 = {
    id: 'p03', image: 'p03', approved: '03-tassels.png',
    camera: { zMax: 1.8, anchorY: 0.80 },

    /* Purl: central approach from the camera up to the round landing, then off its far right side. */
    purl: {
      path: [
        [412, 1556, 316, 118],   // entry
        [411, 1514, 294, 112],   // approved stop (stitch on the right rail)
        [400, 1420, 251, 98],
        [388, 1310, 203, 80],
        [377, 1200, 167, 62],
        [367, 1095, 132, 44],
        [362, 1000, 114, 30],
        [360, 935, 105, 20],
        [359, 887, 100, 8],      // teal spool on the round landing
        [382, 885, 98, 0],
        [405, 884, 97, 0]        // exit: heading right toward the landing's right post
      ],
      events: [
        { type: 'stop', stitch: 'tassels', f: 0.030, readyF: 0 },
        { type: 'pickup', item: 'teal', f: 0.894, lane: 0, size: 71 },
        { type: 'exit', f: 1 }
      ]
    },

    /* Loop: right teal bridge, from behind the lantern post to behind the central tower. */
    loop: {
      path: [
        [838, 1130, 136],
        [776, 1045, 125],
        [722, 972, 117],         // approved Loop
        [668, 952, 104],
        [618, 946, 94],
        [575, 950, 88],          // reaches the central tower's right edge
        [535, 952, 85]           // hidden behind the tower (bridge end is beyond the landing)
      ],
      events: [
        { type: 'task', kind: 'stitch', f: 0.35, x: 772, y: 952 },
        { type: 'pickup', item: 'teal', f: 0.65, size: 48 }
      ]
    },

    stitch: { id: 'tassels', x: 571, y: 1365, r: 70 },

    /* renderer-only: rope pivot height (the beam the lifts end under); tassels hang between Purl's route and the
       tower, so they sort in front of Loop's bridge end (depth y) */
    tasselBeamY: 205, tasselDepthY: 1000,

    /* TOP anchors (approved bottoms minus w * 498/319); lifts raise each top to just under the upper beam (~y 220). */
    tassels: [
      { x: 221, y: 390, w: 173, lift: 170 },
      { x: 386, y: 480, w: 177, lift: 260 },
      { x: 555, y: 583, w: 176, lift: 363 }
    ],

    occluders: [
      // central tower: Loop's bridge passes behind it at the end of his route
      // (starts below the lowered right tassel's bottom, y 858, so tassel pixels are never repainted)
      { id: 'tower', poly: [[476, 858], [576, 858], [578, 1010], [476, 1010]], behindY: 1000 },
      // lantern post at the right edge: Loop enters the plate behind it
      { id: 'lantern', poly: [[772, 1060], [788, 1020], [812, 1016], [841, 1030], [841, 1480], [760, 1480], [758, 1175], [770, 1165]], behindY: 1480 }
    ],

    wipe: { x0: 478, x1: 576 }
  };
})(globalThis.WW = globalThis.WW || {});
