/* Plate p04 — 04-snagged / 05-recovery (shared landing). DRAFT geometry. */
(function (WW) {
  WW.PLATES.p04 = {
    id: 'p04', image: 'p04', approved: ['04-snagged.png', '05-recovery.png'], draft: true,
    camera: { zMax: 1.7, anchorY: 0.80 },
    purl: {
      path: [[450, 1600, 330, 140], [450, 1455, 312, 130], [462, 1250, 250, 110], [505, 1100, 200, 90], [565, 985, 165, 60], [630, 910, 140, 30], [720, 870, 120, 0]],
      events: [
        { type: 'reveal', f: 0.183 },
        { type: 'loopReturn', f: 0.027 },
        { type: 'hint', f: 0.0, text: 'Swipe ← → to move · Swipe ↑ to jump' }
      ]
    },
    loop: {
      path: [[800, 930, 150], [649, 561, 111], [560, 470, 90]],
      events: [
        { type: 'task', kind: 'hop', f: 0.45 }
      ]
    },
    snagling: { hide: { x: 120, y: 1290, w: 190 }, peek: { x: 205, y: 1270, w: 202 } },
    occluders: [],
    wipe: { x0: 0, x1: 190 }
  };
})(globalThis.WW = globalThis.WW || {});
