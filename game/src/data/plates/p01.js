/* Plate p01 — 01-ribbon. DRAFT geometry: replace with carefully authored data. */
(function (WW) {
  WW.PLATES.p01 = {
    id: 'p01', image: 'p01', approved: '01-ribbon.png', draft: true,
    camera: { zMax: 1.8, anchorY: 0.80 },
    purl: {
      path: [[274, 1560, 300, 70], [300, 1440, 270, 40], [300, 1300, 230, 10], [240, 1130, 180, 0], [175, 960, 140, 0], [170, 820, 112, 0], [240, 700, 92, 0], [330, 630, 80, 0], [430, 600, 72, 0]],
      events: [
        { type: 'start', f: 0 },
        { type: 'stop', stitch: 'ribbon', f: 0.027, readyF: 0 },
        { type: 'pickup', item: 'coral', f: 0.833, lane: 0, size: 62 }
      ]
    },
    loop: {
      path: [[800, 1350, 190], [726, 1068, 145], [640, 900, 115], [590, 820, 100]],
      events: [
        { type: 'task', kind: 'stitch', f: 0.15, x: 760, y: 1200 },
        { type: 'pickup', item: 'coral', f: 0.75, size: 40 }
      ]
    },
    stitch: { id: 'ribbon', x: 417, y: 1405, r: 70 },
    ribbon: { band: [[330, 1420, 120], [300, 1250, 95], [235, 1090, 78], [175, 940, 66], [172, 810, 60], [245, 700, 55], [330, 645, 50]] },
    occluders: [],
    wipe: { x0: 200, x1: 420 }
  };
})(globalThis.WW = globalThis.WW || {});
