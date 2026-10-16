/* Draws Purl's (and Loop's) routes over each painting so they can be checked against the carpet and its rails:
   centre line, the two side lanes (dashed), Purl's foot span every 0.1 of the path, the exit (red) and labels.
     node tools/route-overlay.cjs OUT_DIR [plate...]       (writes OUT_DIR/route-<plate>.png) */
const path = require('path'), fs = require('fs');
const { load } = require('../tests/unit/bot.cjs');
const WW = load();
const { execFileSync } = require('child_process');
const out = process.argv[2];
const ids = process.argv.slice(3).length ? process.argv.slice(3) : ['p01', 'p02', 'p03', 'p04', 'p06', 'p07'];
fs.mkdirSync(out, { recursive: true });
for (const id of ids) {
  const P = WW.PLATES[id], exit = (P.purl.events.find(e => e.type === 'exit') || { f: 1 }).f;
  const data = { image: path.join(__dirname, '..', 'game', WW.ASSETS.images[P.image].file), exit, purl: [], lanes: [], loop: [], marks: [] };
  for (let i = 0; i <= 200; i++) {
    const f = i / 200;
    data.purl.push(WW.path.racerPoint(P.purl.path, f, 0, 0));
    data.lanes.push([WW.path.racerPoint(P.purl.path, f, -1, 0), WW.path.racerPoint(P.purl.path, f, 1, 0)]);
    data.loop.push(WW.path.racerPoint(P.loop.path, f, 0, 0));
  }
  for (let i = 0; i <= 10; i++) data.marks.push(Object.assign({ f: i / 10 }, WW.path.racerPoint(P.purl.path, i / 10, 0, 0)));
  const json = path.join(out, 'route-' + id + '.json');
  fs.writeFileSync(json, JSON.stringify(data));
  execFileSync('python3', ['-I', '-c', `
import json, sys
from PIL import Image, ImageDraw
d = json.load(open(sys.argv[1])); im = Image.open(d['image']).convert('RGB'); g = ImageDraw.Draw(im)
def line(pts, col, w, dash=False):
    for i in range(len(pts) - 1):
        if dash and (i // 4) % 2: continue
        g.line([(pts[i]['x'], pts[i]['y']), (pts[i+1]['x'], pts[i+1]['y'])], fill=col, width=w)
line(d['loop'], (0, 230, 255), 4)
line([l[0] for l in d['lanes']], (255, 255, 255), 2, True); line([l[1] for l in d['lanes']], (255, 255, 255), 2, True)
n = len(d['purl']); cut = int(d['exit'] * (n - 1))
line(d['purl'][:cut+1], (40, 255, 40), 5); line(d['purl'][cut:], (255, 40, 40), 5)
for m in d['marks']:
    x, y, w = m['x'], m['y'], m['w']
    g.line([(x - w * 0.22, y), (x + w * 0.22, y)], fill=(255, 220, 0), width=4)   # Purl's foot span
    g.text((x + w * 0.24, y - 10), '%.1f' % m['f'], fill=(255, 255, 0))
im.save(sys.argv[2])
`, json, path.join(out, 'route-' + id + '.png')]);
  console.log('wrote', path.join(out, 'route-' + id + '.png'));
}
