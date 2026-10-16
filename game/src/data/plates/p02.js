/* Plate p02 — 02-shortcut. Purl waits on the broad landing, the runner unrolls to the far roll, he crosses and turns
   right at the roll (never reaching the teal preview on the raised platform). Loop takes the upper right bypass. */
(function (WW) {
  'use strict';
  WW.PLATES.p02 = {
    id: 'p02', image: 'p02', approved: '02-shortcut.png',
    camera: { zMax: 1.8, anchorY: 0.80 },
    purl: {
      // broad landing → runner (narrows with depth) → stop short of the roll, bending right toward the tower
      path: [
        [342, 1592, 298, 95], [346, 1530, 292, 92], [366, 1400, 248, 80], [398, 1250, 212, 60],
        [418, 1120, 172, 35], [438, 1010, 130, 0], [462, 968, 110, 0], [510, 952, 104, 0]
      ],
      events: [
        { type: 'stop', stitch: 'shortcut', f: 0.057, readyF: 0 },
        { type: 'exit', f: 1 }
      ]
    },
    loop: {
      // enters from the right edge along the bypass's far half, ends behind the big tassel / corner posts
      path: [[880, 772, 132], [838, 752, 127], [775, 718, 118], [717, 687, 111], [655, 657, 104], [600, 634, 98], [560, 620, 93], [532, 612, 90]],
      events: [
        { type: 'task', kind: 'bypass', f: 0.97, x: 535, y: 612, extra: 3.5 }
      ]
    },
    stitch: { id: 'shortcut', x: 490, y: 1328, r: 70 },
    shortcut: { band: [[404, 1338, 268], [411, 1200, 244], [427, 1100, 200], [445, 1000, 150], [455, 955, 126], [465, 936, 124]],
      // renderer-only: the unwoven (ghosted) part starts mid-runner, as in approved 02 the near runner is laid; roll width
      // = rollK × band width (the plate's far roll is ≈ 0.9 × the band width)
      ghostFrom: 0.5, rollK: 0.9 },
    previews: [{ item: 'teal', x: 405, y: 724, size: 65 }],
    cameo: { x: 211, y: 742, w: 130,
      // renderer-only: visible area (everything right of the far-left post), so Snagling peeks from behind it
      clip: [[168, 560], [360, 560], [360, 752], [188, 752], [184, 728], [170, 712]] },
    occluders: [
      // big plum tassel hanging over the bypass end
      { id: 'big-tassel', poly: [[428, 410], [470, 382], [530, 420], [600, 455], [642, 500], [646, 560], [622, 596], [580, 618], [540, 630], [496, 626], [462, 602], [436, 562], [426, 480]], behindY: 700 },
      // railing posts at the bypass's upper-left end
      { id: 'corner-posts', poly: [[500, 628], [515, 614], [545, 612], [562, 626], [566, 680], [580, 700], [580, 790], [520, 790], [504, 700]], behindY: 790 }
    ],
    wipe: { x0: 575, x1: 705 }
  };
})(globalThis.WW = globalThis.WW || {});
