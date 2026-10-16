/* Plate p01 — 01-ribbon. Purl climbs the coral S-ribbon around the central tower; Loop runs the teal ribbon on the right. */
(function (WW) {
  'use strict';
  WW.PLATES.p01 = {
    id: 'p01', image: 'p01', approved: '01-ribbon.png',
    camera: { zMax: 1.8, anchorY: 0.80 },
    purl: {
      // near coral carpet → lower band → through the twist on its narrow coral fold (x ≈ 300, clear of the braid
      // and the cream underside) → middle band up-left → upper band up-right, kept on the middle of the coral
      // surface (measured from the painting row by row) → top band toward the tower
      path: [
        [272, 1532, 293, 100], [302, 1290, 218, 72], [312, 1170, 175, 40], [308, 1062, 142, 0], [291, 968, 128, 0],
        [214, 876, 118, 0], [166, 800, 112, 0], [194, 742, 108, 0], [238, 692, 104, 0], [298, 642, 100, 0],
        [350, 608, 97, 0], [412, 592, 95, 0], [462, 587, 94, 0]
      ],
      events: [
        { type: 'start', f: 0 },
        { type: 'hint', f: 0.004, text: 'Swipe \u2190 \u2192 to change lane \u00b7 Swipe \u2191 or tap to jump' },
        { type: 'pickup', item: 'coral', f: 0.831, lane: 0, size: 62 },
        { type: 'exit', f: 0.9 }        // hand over before the ribbon's top curl runs sideways along the rail
      ]
    },
    loop: {
      // teal ribbon: approved spot → up-left to the tower → behind the tower column
      path: [[726, 1068, 145], [692, 990, 130], [652, 935, 117], [608, 898, 107], [565, 880, 100], [512, 871, 95]],
      events: [
        { type: 'task', kind: 'hesitate', f: 0.3 },
        { type: 'pickup', item: 'coral', f: 0.6, size: 60 }
      ]
    },
    occluders: [
      // near-left railing post: hides Purl's left side when he runs in lane -1 beyond it
      { id: 'left-post', poly: [[38, 1214], [58, 1190], [88, 1180], [116, 1192], [128, 1226], [128, 1436], [112, 1456], [38, 1456]], behindY: 1450 },
      // central tower trunk: Loop slips behind it at the top of the teal ribbon
      { id: 'tower', poly: [[450, 742], [556, 742], [559, 800], [556, 868], [561, 1008], [450, 1008]], behindY: 1010 }
    ],
    wipe: { x0: 345, x1: 560 }
  };
})(globalThis.WW = globalThis.WW || {});
