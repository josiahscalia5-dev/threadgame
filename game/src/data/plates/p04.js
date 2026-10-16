/* Plate p04 — broad floral landing shared by 04-snagged and 05-recovery. */
(function (WW) {
  'use strict';
  WW.PLATES.p04 = {
    id: 'p04', image: 'p04', approved: ['04-snagged.png', '05-recovery.png'],
    camera: { zMax: 1.6, anchorY: 0.80 },

    /* Purl: up the wide landing past the big left tower, then along the carpet's bend to the right. */
    purl: {
      path: [
        [450, 1458, 313, 130],   // entry = approved 04 Purl
        [437, 1406, 296, 128],   // approved 05 Purl
        [440, 1325, 258, 122],
        [452, 1240, 218, 110],   // level with the left tower's base (Snagling's hop)
        [462, 1162, 183, 94],
        [470, 1102, 158, 72],
        [488, 1064, 143, 42],    // far side of the landing, below the rail braid
        [530, 1074, 139, 12],
        [574, 1093, 138, 0]      // exit along the carpet's right-hand bend
      ],
      events: [
        { type: 'hint', f: 0, text: 'Swipe \u2190 \u2192 to move \u00b7 Swipe \u2191 to jump' },
        { type: 'loopReturn', f: 0.02 },
        { type: 'reveal', f: 0.245 },   // Purl at (445,1288), Snagling ahead-left; >= 1.5 s in when landing length >= 30 m
        { type: 'exit', f: 0.74 }       // before the carpet bends right and back toward the camera along the rail
      ]
    },

    /* Loop: the rising bridge from the right edge up to the column-top platform. */
    loop: {
      path: [
        [838, 662, 140],
        [745, 612, 125],
        [649, 561, 111],         // approved 04 Loop
        [586, 515, 96],
        [536, 477, 84],
        [506, 457, 78]           // column-top platform at the bridge's far end
      ],
      events: [
        { type: 'task', kind: 'hop', f: 0.33, x: 703, y: 590 }
      ]
    },

    /* hide: fully behind the left tower (see occluder); peek: approved 04 reveal pose. */
    snagling: { hide: { x: 92, y: 1235, w: 165 }, peek: { x: 205, y: 1270, w: 202 } },

    occluders: [
      // big left tower, its base ring and the teal-wrapped post in front of it
      { id: 'left-tower', poly: [[0, 780], [182, 780], [190, 905], [190, 1015], [177, 1030], [174, 1222], [187, 1240], [187, 1284], [172, 1300], [120, 1306], [80, 1302], [0, 1292]], behindY: 1300 }
    ],

    wipe: { x0: 0, x1: 180 }
  };
})(globalThis.WW = globalThis.WW || {});
