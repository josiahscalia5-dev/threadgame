/* Plate p02 — 02-shortcut. DRAFT geometry: replace with carefully authored data. */
(function (WW) {
  WW.PLATES.p02 = {
    id: 'p02', image: 'p02', approved: '02-shortcut.png', draft: true,
    camera: { zMax: 1.8, anchorY: 0.80 },
    purl: {
      path: [[346, 1560, 300, 60], [380, 1420, 260, 50], [398, 1250, 200, 30], [400, 1100, 160, 15], [395, 960, 130, 0], [340, 860, 112, 0], [230, 810, 98, 0], [140, 790, 90, 0]],
      events: [
        { type: 'stop', stitch: 'shortcut', f: 0.014, readyF: 0 }
      ]
    },
    loop: {
      path: [[830, 880, 140], [717, 687, 111], [640, 600, 95], [600, 560, 85]],
      events: [
        { type: 'task', kind: 'bypass', f: 0.3, extra: 3.5 }
      ]
    },
    stitch: { id: 'shortcut', x: 490, y: 1328, r: 70 },
    shortcut: { band: [[392, 1360, 190], [396, 1200, 160], [398, 1060, 132], [395, 930, 110]] },
    previews: [{ item: 'teal', x: 405, y: 724, size: 65 }],
    cameo: { x: 211, y: 742, w: 130 },
    occluders: [],
    wipe: { x0: 0, x1: 140 }
  };
})(globalThis.WW = globalThis.WW || {});
