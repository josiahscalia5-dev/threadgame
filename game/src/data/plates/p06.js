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
        [458, 1051, 118, 0]      // exit: right along the round end, toward the tower base
      ],
      events: [
        { type: 'stop', stitch: 'butterfly', f: 0.0927, readyF: 0 },   // = approved Purl (400,1457) w 300
        { type: 'pickup', item: 'gold', f: 0.8071, lane: 0, size: 70 },  // (392,1045) = approved spool
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
        [522, 930, 84]           // hidden behind the tower
      ],
      events: [
        { type: 'task', kind: 'stitch', f: 0.751, x: 527, y: 920, dur: 2.7 },  // at (612,940); sparkle on the bridge-end post's ball top
        { type: 'pickup', item: 'gold', f: 0.821, size: 50 }                // (586,936), before the tower edge
      ]
    },

    stitch: { id: 'butterfly', x: 137, y: 995, r: 72 },

    /* Butterfly points use the feat.butterfly-* bottom-centre pivot: [x, y, w] = bottom-centre and sprite width; rot in
       radians. rest covers the matching outline on the tapestry (outline bbox x 37..182, y 547..765, body axis x ~131).
       flight: lift off the tapestry, swing right and grow toward the camera through the approved mid-flight pose
       (445,885 w 268), ending directly above the gold pickup (392,1045) with the bottom 15 px above it.
       exit: up and away toward the distant flower gate, leaving the plate at the top right. */
    butterfly: {
      rest: { x: 113, y: 712, w: 168, rot: 0 },
      flight: [[113, 712, 168], [205, 700, 200], [330, 775, 240], [445, 885, 268], [398, 1030, 272]],
      exit: [[398, 1030, 272], [470, 860, 250], [610, 640, 205], [760, 430, 160], [900, 260, 120]]
    },

    occluders: [
      // central tower base and the ball-topped post at the bridge's far end: Loop's bridge runs behind them
      // (stops at y 1002, above Purl's round carpet end, so Purl is never repainted)
      { id: 'tower', poly: [[470, 600], [562, 600], [562, 1002], [470, 1002]], behindY: 1000 },
      // big near post at the right edge: Loop enters the plate behind it
      { id: 'right-post', poly: [[770, 1185], [783, 1163], [836, 1160], [841, 1165], [841, 1520], [770, 1520]], behindY: 1500 }
    ],
    wipe: { x0: 398, x1: 522 }
  };
})(globalThis.WW = globalThis.WW || {});
