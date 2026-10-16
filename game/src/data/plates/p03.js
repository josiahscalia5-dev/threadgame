/* Plate p03 — 03-tassels. DRAFT geometry: replace with carefully authored data. */
(function (WW) {
  WW.PLATES.p03 = {
    id: 'p03', image: 'p03', approved: '03-tassels.png', draft: true,
    camera: { zMax: 1.8, anchorY: 0.80 },
    purl: {
      path: [[411, 1560, 300, 60], [420, 1400, 250, 50], [402, 1210, 190, 30], [380, 1050, 150, 15], [362, 930, 125, 0], [350, 875, 115, 0], [400, 840, 105, 0], [520, 820, 95, 0]],
      events: [
        { type: 'stop', stitch: 'tassels', f: 0.025, readyF: 0 },
        { type: 'pickup', item: 'teal', f: 0.649, lane: 0, size: 71 }
      ]
    },
    loop: {
      path: [[840, 1200, 150], [722, 972, 117], [660, 880, 100], [620, 820, 90]],
      events: [
        { type: 'task', kind: 'stitch', f: 0.25, x: 700, y: 930 },
        { type: 'pickup', item: 'teal', f: 0.7, size: 38 }
      ]
    },
    stitch: { id: 'tassels', x: 571, y: 1365, r: 70 },
    tassels: [
      { x: 221, y: 390, w: 173, lift: 320 },
      { x: 386, y: 480, w: 177, lift: 340 },
      { x: 555, y: 583, w: 176, lift: 360 }
    ],
    occluders: [],
    wipe: { x0: 560, x1: 841 }
  };
})(globalThis.WW = globalThis.WW || {});
