/* Plate p07 — 07-finish: round medallion terrace before the illuminated flower gate; Purl on the central approach,
   Loop on the adjacent right-hand line. The terrace ends at its gold rope rim (~y 1500); below is open sky. */
(function (WW) {
  'use strict';
  WW.PLATES.p07 = {
    id: 'p07', image: 'p07', approved: '07-finish.png',
    camera: { zMax: 1.25, anchorY: 0.70 },

    /* Purl: from the terrace's near rim straight up the medallion and the low steps to the gate threshold. */
    purl: {
      path: [
        [400, 1462, 256, 80],    // entry, on the carpet just inside the near rim
        [401, 1380, 232, 70],
        [402, 1300, 208, 56],
        [403, 1222, 184, 40],    // approved Purl (finish)
        [408, 1160, 166, 22],
        [414, 1120, 155, 8],     // low steps
        [420, 1092, 147, 0]      // gate threshold
      ],
      events: [
        { type: 'finish', f: 0.5802 }   // (403,1222) w 184 = approved Purl
      ]
    },

    /* Loop: from behind the right foreground post across the terrace's right side to the gate's right half. */
    loop: {
      path: [
        [756, 1560, 280],        // entry: climbing onto the terrace behind the right foreground post and railing
        [721, 1478, 258],
        [688, 1405, 238],
        [647, 1328, 214],        // approved Loop (finish)
        [606, 1250, 194],
        [566, 1180, 174],
        [530, 1128, 160],
        [500, 1100, 151]         // gate threshold, right of Purl's line
      ],
      events: [
        { type: 'finish', f: 0.4081 }   // (647,1328) w 214 = approved Loop
      ]
    },

    /* Opening polygon = the glowing sky inside the inner petals, base on the threshold step. */
    gate: {
      x: 432, y: 890,
      arch: [[309, 1086], [315, 1000], [325, 912], [340, 825], [356, 756], [377, 720], [421, 694],
             [465, 720], [494, 752], [515, 825], [534, 912], [546, 1000], [555, 1086]]
    },

    occluders: [
      // near-left rope post, coil and railing panel (always in front of both racers)
      { id: 'front-left', poly: [[0, 1350], [40, 1340], [78, 1330], [90, 1310], [178, 1310], [190, 1350], [185, 1440], [280, 1455], [300, 1490], [318, 1600], [318, 1870], [0, 1870]], behindY: 1870 },
      // near-right rope post, coil and railing panel: Loop enters the plate behind it
      { id: 'front-right', poly: [[540, 1460], [600, 1440], [687, 1395], [690, 1320], [700, 1308], [790, 1308], [800, 1330], [841, 1360], [841, 1870], [590, 1870], [588, 1780], [540, 1770]], behindY: 1870 }
    ],

    wipe: { x0: 0, x1: 120 }
  };
})(globalThis.WW = globalThis.WW || {});
