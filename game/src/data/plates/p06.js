/* Plate p06 — 06-butterfly: tall teal tapestry on the left, butterfly outline and stitch fitting, gold spool on the
   coral carpet's round far end, Loop on the right-hand teal bridge. */
(function (WW) {
  'use strict';
  WW.PLATES.p06 = {
    id: 'p06', image: 'p06', approved: '06-butterfly.png',
    camera: { zMax: 1.7, anchorY: 0.78 },

    /* Purl: straight up the coral carpet from the camera, stopping below the tapestry; after the delivery he runs on
       to the gold spool at the carpet's round far end and turns right along it toward the central tower. */
    purl: {
      path: [
        [404, 1545, 340, 125],   // entry
        [400, 1457, 300, 115],   // approved stop (stitch on the tapestry's lower-left fitting)
        [397, 1360, 256, 96],
        [394, 1250, 207, 70],
        [392, 1160, 167, 48],
        [391, 1100, 140, 28],
        [391, 1064, 124, 10],
        [392, 1045, 115, 0],     // gold spool (approved spool position)
        [424, 1044, 116, 0],
        [460, 1052, 119, 0],
        [492, 1066, 124, 0]      // exit: along the round end toward the tower base
      ],
      events: [
        { type: 'stop', stitch: 'butterfly', f: 0, readyF: 0 },
        { type: 'pickup', item: 'gold', f: 0, lane: 0, size: 70 },
        { type: 'exit', f: 1 }
      ]
    },

    /* Loop: the near teal bridge, from behind the right foreground post up to behind the central tower. */
    loop: {
      path: [
        [838, 1205, 148],        // entry, behind the right foreground post
        [812, 1120, 136],
        [772, 1046, 125],
        [713, 984, 115],         // approved Loop
        [661, 954, 104],
        [612, 940, 96],
        [572, 934, 90],          // the bridge meets the tower base
        [534, 931, 85]           // hidden behind the tower
      ],
      events: [
        { type: 'task', kind: 'stitch', f: 0, x: 0, y: 0, dur: 2.7 },
        { type: 'pickup', item: 'gold', f: 0, size: 50 }
      ]
    },

    stitch: { id: 'butterfly', x: 137, y: 995, r: 72 },

    butterfly: {
      rest: { x: 112, y: 712, w: 175, rot: 0 },
      flight: [[112, 712, 175], [205, 700, 200], [330, 775, 240], [445, 885, 268], [398, 1030, 272]],
      exit: [[398, 1030, 272], [470, 860, 250], [610, 640, 205], [760, 430, 160], [900, 260, 120]]
    },

    occluders: [],
    wipe: { x0: 398, x1: 522 }
  };
})(globalThis.WW = globalThis.WW || {});
