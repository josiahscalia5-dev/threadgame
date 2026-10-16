/* Plate p06 — 06-butterfly. DRAFT geometry: replace with carefully authored data. */
(function (WW) {
  WW.PLATES.p06 = {
    id: 'p06', image: 'p06', approved: '06-butterfly.png', draft: true,
    camera: { zMax: 1.7, anchorY: 0.80 },
    purl: {
      path: [[404, 1560, 310, 60], [410, 1400, 260, 45], [420, 1250, 210, 30], [432, 1120, 170, 15], [442, 1040, 150, 0], [452, 990, 140, 0], [520, 960, 128, 0]],
      events: [
        { type: 'stop', stitch: 'butterfly', f: 0.057, readyF: 0 },
        { type: 'pickup', item: 'gold', f: 0.69, lane: 0, size: 70 }
      ]
    },
    loop: {
      path: [[840, 1150, 150], [715, 990, 117], [640, 900, 100], [600, 860, 90]],
      events: [
        { type: 'task', kind: 'stitch', f: 0.2, x: 760, y: 1050, dur: 2.6 },
        { type: 'pickup', item: 'gold', f: 0.6, size: 36 }
      ]
    },
    stitch: { id: 'butterfly', x: 135, y: 990, r: 80 },
    butterfly: {
      rest: { x: 150, y: 760, w: 150, rot: 0 },
      flight: [[150, 760, 150], [260, 820, 220], [380, 930, 270], [443, 1030, 286]],
      exit: [[443, 1030, 286], [560, 820, 220], [700, 600, 160]]
    },
    occluders: [],
    wipe: { x0: 0, x1: 120 }
  };
})(globalThis.WW = globalThis.WW || {});
