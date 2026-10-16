/* Plate p07 — 07-finish. Purl arrives on the round terrace and races to the flower gate; Loop comes up from the
   right-hand runner. There is no ground below the terrace's front rim (y ≈ 1500), so both paths start on it. */
(function (WW) {
  'use strict';
  WW.PLATES.p07 = {
    id: 'p07', image: 'p07', approved: '07-finish.png',
    camera: { zMax: 1.45, anchorY: 0.80 },
    purl: {
      // terrace front rim → approved finish spot (407, 1214, w 193) → the gate's steps
      path: [[410, 1492, 266, 70], [410, 1400, 242, 56], [408, 1300, 216, 38], [407, 1214, 193, 18], [408, 1150, 176, 0], [410, 1112, 167, 0]],
      events: [
        { type: 'finish', f: 0.66 },
        { type: 'exit', f: 1 }
      ]
    },
    loop: {
      // right runner → approved Loop spot (636, 1329, w 204) → beside Purl at the gate's right pillar
      path: [[742, 1500, 244], [690, 1410, 225], [636, 1329, 204], [598, 1252, 188], [572, 1190, 176], [560, 1150, 169]],
      events: [
        { type: 'finish', f: 0.62 }
      ]
    },
    gate: { x: 415, y: 900, arch: [[318, 1112], [322, 900], [346, 790], [380, 720], [415, 692], [450, 720], [484, 790], [508, 900], [512, 1112]] },
    occluders: [],
    wipe: { x0: 0, x1: 120 }
  };
})(globalThis.WW = globalThis.WW || {});
