/* Plate p01 — 01-ribbon. Purl climbs the coral S-ribbon around the central tower; Loop runs the teal ribbon on the right. */
(function (WW) {
  'use strict';
  WW.PLATES.p01 = {
    id: 'p01', image: 'p01', approved: '01-ribbon.png',
    camera: { zMax: 1.8, anchorY: 0.80 },
    purl: {
      // near coral carpet → twist → lower band (up-left) → turn → upper band (right) → top curl at the tower
      path: [
        [272, 1532, 293, 100], [290, 1400, 255, 90], [305, 1280, 215, 70], [308, 1170, 175, 40],
        [292, 1060, 142, 0], [262, 960, 128, 0], [190, 870, 118, 0], [150, 780, 112, 0],
        [200, 680, 106, 0], [300, 616, 102, 0], [400, 600, 98, 0], [466, 597, 95, 0]
      ],
      events: [
        { type: 'start', f: 0 },
        { type: 'stop', stitch: 'ribbon', f: 0.004, readyF: 0 },
        { type: 'pickup', item: 'coral', f: 0.85, lane: 0, size: 62 },
        { type: 'exit', f: 1 }
      ]
    },
    loop: {
      // teal ribbon: approved spot → up-left to the tower → behind the tower column
      path: [[726, 1068, 145], [668, 990, 130], [610, 925, 116], [565, 890, 108], [520, 876, 102]],
      events: [
        { type: 'task', kind: 'stitch', f: 0.02, x: 640, y: 1105 },
        { type: 'pickup', item: 'coral', f: 0.6, size: 60 }
      ]
    },
    stitch: { id: 'ribbon', x: 417, y: 1405, r: 70 },
    ribbon: { band: [[330, 1135, 150], [320, 1050, 110], [275, 955, 105], [185, 862, 100], [150, 780, 95], [205, 680, 80], [300, 626, 60], [400, 608, 52], [466, 600, 42]] },
    occluders: [],
    wipe: { x0: 345, x1: 560 }
  };
})(globalThis.WW = globalThis.WW || {});
