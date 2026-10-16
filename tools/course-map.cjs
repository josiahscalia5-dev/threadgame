/* Draws an overhead map of the connected course (road edges, centre line, painting cameras and their view
   wedges, heights) from the game's own world data:  node tools/course-map.cjs out.png [W H] */
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const { load } = require('../tests/unit/bot.cjs');
const WW = load();
require('../game/src/data/world-layout.js');
require('../game/src/world/build.js');
const world = WW.world.build({ areas: Object.keys(WW.WORLD_LAYOUT.areas) });
const data = { segs: world.segs.map(s => ({ id: s.id, kind: s.kind, area: s.area ? s.area.id : null,
  pts: s.track.filter((t, i) => i % 2 === 0 || i === s.track.length - 1).map(t => { const R = WW.world.right(t.phi);
    return { c: [t.p[0], t.p[2]], y: t.p[1], l: [t.p[0] + R[0] * t.latL, t.p[2] + R[2] * t.latL], r: [t.p[0] + R[0] * t.latR, t.p[2] + R[2] * t.latR] }; }) })),
  cams: Object.values(world.areas).filter(a => a.camPos).map(a => ({ id: a.id, p: [a.camPos[0], a.camPos[2]], phi: a.camPhi, h: a.camPos[1] })) };
const tmp = path.join(require('os').tmpdir(), 'course-map.json');
fs.writeFileSync(tmp, JSON.stringify(data));
execFileSync('python3', ['-I', '-c', `
import json, math, sys
from PIL import Image, ImageDraw, ImageFont
d = json.load(open(sys.argv[1])); W, H = int(sys.argv[3]), int(sys.argv[4])
xs = [p[k][0] for s in d['segs'] for p in s['pts'] for k in ('l','r')] + [c['p'][0] for c in d['cams']]
zs = [p[k][1] for s in d['segs'] for p in s['pts'] for k in ('l','r')] + [c['p'][1] for c in d['cams']]
pad = int(40 * W / 600.0); sc = min((W - 2*pad) / (max(xs) - min(xs)), (H - 2*pad - 90) / (max(zs) - min(zs)))
ox, oz = min(xs), min(zs)
P = lambda x, z: (pad + (x - ox) * sc, int(110 * W / 600.0) + pad + (z - oz) * sc)
im = Image.new('RGB', (W, H), (253, 247, 236)); g = ImageDraw.Draw(im)
k = W / 600.0
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', int(15 * k)); fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', int(13 * k))
g.text((14, 12), 'Overhead map of the connected course', fill=(85, 41, 22), font=f)
g.text((14, 12 + int(24 * k)), '1 grid square = 2 Purl widths. Numbers = road height.', fill=(110, 70, 40), font=fs)
for gx in range(int(ox) - 2, int(max(xs)) + 3, 2):
    g.line([P(gx, oz - 2), P(gx, max(zs) + 2)], fill=(238, 228, 212))
for gz in range(int(oz) - 2, int(max(zs)) + 3, 2):
    g.line([P(ox - 2, gz), P(max(xs) + 2, gz)], fill=(238, 228, 212))
col = {'p01': (226, 70, 100), 'p02': (20, 150, 160), 'p03': (180, 90, 160), 'p04': (90, 130, 200), 'p06': (230, 120, 60), 'p07': (200, 160, 40)}
for c in d['cams']:
    x, z = c['p']; ph = c['phi']
    for a in (-0.21, 0.21):
        g.line([P(x, z), P(x + math.sin(ph + a) * 9, z - math.cos(ph + a) * 9)], fill=(170, 150, 130), width=max(1, int(k)))
    g.ellipse([P(x, z)[0] - 5, P(x, z)[1] - 5, P(x, z)[0] + 5, P(x, z)[1] + 5], fill=(60, 40, 30))
    g.text((P(x, z)[0] - 60, P(x, z)[1] + 8), 'camera, painting ' + c['id'][2:], fill=(60, 40, 30), font=fs)
for s in d['segs']:
    poly = [P(*p['l']) for p in s['pts']] + [P(*p['r']) for p in s['pts'][::-1]]
    fill = col.get(s['area'], (232, 180, 70)) if s['kind'] == 'plate' else (232, 180, 70)
    g.polygon(poly, fill=fill, outline=(120, 70, 30))
    g.line([P(*p['c']) for p in s['pts']], fill=(255, 255, 255), width=max(2, int(2 * k)))
    for i in range(0, len(s['pts']), max(1, len(s['pts']) // 3)):
        p = s['pts'][i]; g.text((P(*p['c'])[0] + 6, P(*p['c'])[1] - 6), '%.1f' % p['y'], fill=(40, 30, 20), font=fs)
names = {'ribbon': ['Ribbon', '(painting 1)'], 'c-ribbon': ['New connecting road:', 'turns right, ramps down'], 'shortcut': ['Shortcut', '(painting 2)']}
offs = {'ribbon': (int(30 * k), int(40 * k)), 'c-ribbon': (int(-40 * k), int(-110 * k)), 'shortcut': (int(-120 * k), int(50 * k))}
for s in d['segs']:
    m = s['pts'][len(s['pts']) // 2]; x, y = P(*m['c']); dx, dy = offs.get(s['id'], (14, 10))
    for k_, line in enumerate(names.get(s['id'], [s['id']])):
        g.text((x + dx, y + dy + k_ * int(20 * k)), line, fill=(85, 41, 22), font=f)
st = d['segs'][0]['pts'][0]['c']; x, y = P(*st)
g.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(226, 54, 90)); g.text((x + 10, y + 2), 'START', fill=(226, 54, 90), font=f)
im.save(sys.argv[2])
`, tmp, process.argv[2], process.argv[3] || '600', process.argv[4] || '650']);
console.log('wrote', process.argv[2]);
