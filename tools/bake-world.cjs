/* Bakes the textures the connecting roads need, all cut from the existing paintings (no new art):

     node tools/bake-world.cjs            -> game/assets/world/*.webp + game/assets/world/manifest.json

   carpet-<plate>   the scene's walkable carpet, flattened: image rows sampled between the carpet edges, spaced
                    evenly in real (3D) distance along the road, so it can tile along a connector
   braid            the gold braid running across the shortcut's landing (a straight piece of rail)
   knit             the cream crochet underside of the ribbon (sides of the connector deck)
   sky-<n>          the sky-and-city band above each painting's horizon, aligned on the horizon, for the far
                    panorama seen between scenes
   Row positions are computed here with the game's own world builder; tools/bake-world.py does the resampling. */
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const { load } = require('../tests/unit/bot.cjs');
const WW = load();
require('../game/src/data/world-layout.js');
require('../game/src/world/build.js');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'assets', 'world');
fs.mkdirSync(OUT, { recursive: true });

const areaIds = Object.keys(WW.WORLD_LAYOUT.areas);
const world = WW.world.build({ areas: areaIds });

/* Carpet: sample a stretch of the scene's road (between distances d0 and d1 along Purl's path, in Purl widths). */
const CARPET = { p01: [1.2, 5.6], p02: [2.2, 7.4], p03: [1.0, 6.0], p04: [0.8, 5.0], p06: [0.6, 5.0], p07: [0.4, 3.4] };
const jobs = [];
for (const id of areaIds) {
  const A = world.areas[id], span = CARPET[id];
  if (!span) continue;
  const rows = [];
  const S = A.samples;
  const across = 256;
  const widthW = (() => { const m = S[Math.floor(S.length * 0.1)]; return Math.hypot(m.r[0] - m.l[0], m.r[2] - m.l[2]); })();
  const nRows = Math.round((span[1] - span[0]) / widthW * across);
  for (let k = 0; k < nRows; k++) {
    const d = span[0] + (span[1] - span[0]) * k / (nRows - 1);
    let i = 1;
    while (i < S.length - 1 && S[i].dist < d) i++;
    const a = S[i - 1], b = S[i], t = (d - a.dist) / Math.max(1e-9, b.dist - a.dist);
    const iy = a.iy + (b.iy - a.iy) * t;
    // carpet edges on that row, pulled in a little so the braid is not part of the tile
    const fi = a.fi + (b.fi - a.fi) * t;
    const L = WW.WORLD_LAYOUT.areas[id];
    const cp = A.plate.purl.path.map((p, j) => j === 0 ? 0 : j === A.plate.purl.path.length - 1 ? 1 : WW.path.project(A.plate.purl.path, p[0], p[1]));
    let e = L.edges[L.edges.length - 1];
    for (let j = 1; j < cp.length; j++) if (fi <= cp[j]) { const q = (fi - cp[j - 1]) / Math.max(1e-6, cp[j] - cp[j - 1]); e = [L.edges[j - 1][0] + (L.edges[j][0] - L.edges[j - 1][0]) * q, L.edges[j - 1][1] + (L.edges[j][1] - L.edges[j - 1][1]) * q]; break; }
    const inset = (e[1] - e[0]) * 0.08;
    rows.push([iy, e[0] + inset, e[1] - inset]);
  }
  jobs.push({ kind: 'carpet', id, image: path.join(ROOT, 'game', WW.ASSETS.images[A.image].file), out: path.join(OUT, 'carpet-' + id + '.webp'), across, rows, widthW });
}
const L = WW.WORLD_LAYOUT;
jobs.push({ kind: 'crop', image: path.join(ROOT, 'game', WW.ASSETS.images.p02.file), out: path.join(OUT, 'braid.webp'), box: [150, 1342, 470, 1373] });
jobs.push({ kind: 'crop', image: path.join(ROOT, 'game', WW.ASSETS.images.p01.file), out: path.join(OUT, 'knit.webp'), box: [392, 1052, 452, 1124] });
// Sky bands: every painting, aligned so its horizon row sits at the same height in the band.
const skyPlates = ['p01', 'p02', 'p03', 'p04', 'p06', 'p07'];
const HORIZON = { p01: 653, p02: 595, p03: 624, p04: 769, p06: 703, p07: 476 };
jobs.push({ kind: 'sky', images: skyPlates.map(id => path.join(ROOT, 'game', WW.ASSETS.images[id].file)), horizons: skyPlates.map(id => HORIZON[id]),
            above: 620, below: 90, out: path.join(OUT, 'sky-%d.webp'), panelW: 680 });
const spec = path.join(OUT, 'bake-spec.json');
fs.writeFileSync(spec, JSON.stringify(jobs));
execFileSync('python3', ['-I', path.join(__dirname, 'bake-world.py'), spec], { stdio: 'inherit' });
fs.unlinkSync(spec);
