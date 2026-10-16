/* Plate p07 — 07-finish. DRAFT geometry: replace with carefully authored data. */
(function (WW) {
  WW.PLATES.p07 = {
    id: 'p07', image: 'p07', approved: '07-finish.png', draft: true,
    camera: { zMax: 1.4, anchorY: 0.80 },
    purl: {
      path: [[420, 1490, 262, 50], [416, 1400, 248, 40], [411, 1300, 230, 30], [409, 1236, 216, 20], [412, 1150, 198, 0], [416, 1070, 182, 0]],
      events: [
        { type: 'finish', f: 0.609 }
      ]
    },
    loop: {
      path: [[720, 1520, 270], [648, 1336, 240], [560, 1200, 205], [480, 1090, 180]],
      events: [
        { type: 'finish', f: 0.45 }
      ]
    },
    gate: { x: 415, y: 860, arch: [[330, 1060], [330, 820], [372, 720], [415, 690], [458, 720], [500, 820], [500, 1060]] },
    occluders: [],
    wipe: { x0: 0, x1: 120 }
  };
})(globalThis.WW = globalThis.WW || {});
