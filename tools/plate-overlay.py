#!/usr/bin/env python3
"""Draw a plate's authored route data over the clean plate for visual checking.

  python3 tools/plate-overlay.py p01 out.png [--scale 0.6] [--approved] [--clean]

Draws Purl's three lanes (centre solid, sides dashed), Purl sprites at the route
start, at every event and at the exit (scaled by the path's w), Loop's route and
sprites, event markers with labels, the stitch tap target, feature geometry
(ribbon/shortcut bands, tassels, butterfly flight, Snagling, gate arch) and the
occluder polygons. --approved uses the approved screenshot as the backdrop
(useful for matching scale/position); --clean draws only sprites (no lines).
Geometry is evaluated by game/src/core/path.js through Node, so the overlay is
exactly what the game uses.
"""
import argparse
import json
import os
import subprocess

from PIL import Image, ImageDraw

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
KIT = os.path.join(REPO, 'kit', 'Wishweave-Level1-Complete-Visual-Kit')

NODE = r"""
const path=require('path'); const R=process.argv[1]; const id=process.argv[2];
for (const f of ['core/ww.js','core/path.js','data/asset-data.js','data/plates/'+id+'.js']) require(path.join(R,'game/src',f));
const P=WW.PLATES[id]; const out={plate:P, purl:{}, loop:{}};
const S=(pts,f,l)=>WW.path.racerPoint(pts,f,l||0,0);
const dense=(pts,lane)=>{const a=[];for(let i=0;i<=200;i++)a.push(S(pts,i/200,lane));return a;};
out.purl.lanes=[-1,0,1].map(l=>dense(P.purl.path,l));
const fs=new Set([0,1]); for(const e of P.purl.events||[]) if(typeof e.f==='number') fs.add(e.f);
out.purl.samples=[...fs].sort((a,b)=>a-b).map(f=>S(P.purl.path,f,0));
if(P.loop&&P.loop.path){ out.loop.line=dense(P.loop.path,0);
  const lf=new Set([0,0.5,1]); for(const e of P.loop.events||[]) if(typeof e.f==='number') lf.add(e.f);
  out.loop.samples=[...lf].sort((a,b)=>a-b).map(f=>S(P.loop.path,f,0)); }
out.events=(P.purl.events||[]).filter(e=>typeof e.f==='number').map(e=>({e, p:S(P.purl.path,e.f,e.lane||0)}));
out.loopEvents=((P.loop&&P.loop.events)||[]).filter(e=>typeof e.f==='number').map(e=>({e, p:S(P.loop.path,e.f,0)}));
out.frames=WW.ASSETS.frames; out.images=WW.ASSETS.images;
console.log(JSON.stringify(out));
"""

APPROVED = {'p01': '01-ribbon', 'p02': '02-shortcut', 'p03': '03-tassels', 'p04': '04-snagged',
            'p06': '06-butterfly', 'p07': '07-finish'}


def load(pid):
    res = subprocess.run(['node', '-e', NODE, REPO, pid], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


def sprite(data, cache, name, width):
    fr = data['frames'][name]
    key = fr['img']
    if key not in cache:
        cache[key] = Image.open(os.path.join(REPO, 'game', data['images'][key]['file'])).convert('RGBA')
    img = cache[key].crop((fr['x'], fr['y'], fr['x'] + fr['w'], fr['y'] + fr['h']))
    s = width / fr['w']
    img = img.resize((max(1, int(fr['w'] * s)), max(1, int(fr['h'] * s))), Image.LANCZOS)
    return img, fr['px'] * s, fr['py'] * s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('plate')
    ap.add_argument('out')
    ap.add_argument('--scale', type=float, default=0.6)
    ap.add_argument('--approved', action='store_true')
    ap.add_argument('--clean', action='store_true')
    a = ap.parse_args()
    d = load(a.plate)
    P = d['plate']
    if a.approved:
        base = Image.open(os.path.join(KIT, 'approved', APPROVED[a.plate] + '.png')).convert('RGBA').resize((841, 1870))
    else:
        base = Image.open(os.path.join(REPO, 'game', d['images'][P['image']]['file'])).convert('RGBA').resize((841, 1870))
    layer = Image.new('RGBA', base.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    cache = {}
    lines = not a.clean

    if lines:
        for occ in P.get('occluders', []):
            dr.polygon([tuple(p) for p in occ['poly']], fill=(255, 0, 255, 50), outline=(255, 0, 255, 220))
        for key in ('ribbon', 'shortcut'):
            band = (P.get(key) or {}).get('band')
            if band:
                for x, y, hw in band:
                    dr.line([(x - hw, y), (x + hw, y)], fill=(255, 140, 0, 200), width=3)
                dr.line([(x, y) for x, y, _ in band], fill=(255, 140, 0, 255), width=2)
        for i, lane in enumerate(d['purl']['lanes']):
            pts = [(p['x'], p['y']) for p in lane]
            dr.line(pts, fill=(255, 60, 90, 255) if i == 1 else (255, 160, 170, 160), width=4 if i == 1 else 2)
        if d['loop'].get('line'):
            dr.line([(p['x'], p['y']) for p in d['loop']['line']], fill=(0, 220, 230, 255), width=4)
        st = P.get('stitch')
        if st:
            dr.ellipse([st['x'] - st['r'], st['y'] - st['r'], st['x'] + st['r'], st['y'] + st['r']], outline=(255, 230, 0, 255), width=4)
        bf = P.get('butterfly')
        if bf:
            for k in ('flight', 'exit'):
                if bf.get(k):
                    dr.line([(p[0], p[1]) for p in bf[k]], fill=(255, 200, 0, 230), width=3)
        gate = P.get('gate')
        if gate and gate.get('arch'):
            dr.polygon([tuple(p) for p in gate['arch']], outline=(255, 255, 255, 230))

    for t in P.get('tassels', []):
        img, px, py = sprite(d, cache, 'prop.swinging-tassel', t['w'])
        layer.alpha_composite(img, (int(t['x'] - px), int(t['y'] - py)))
        if lines:
            dr.line([(t['x'], t['y']), (t['x'], t['y'] - t['lift'])], fill=(255, 255, 0, 200), width=2)
    for pv in P.get('previews', []):
        img, px, py = sprite(d, cache, 'prop.%s-thread' % ('golden' if pv['item'] == 'gold' else pv['item']), pv['size'])
        layer.alpha_composite(img, (int(pv['x'] - px), int(pv['y'] - py)))
    sn = P.get('snagling')
    if sn:
        for k, frame in (('hide', 'snag.peek'), ('peek', 'snag.alert')):
            if sn.get(k):
                img, px, py = sprite(d, cache, frame, sn[k]['w'])
                img.putalpha(img.getchannel('A').point(lambda v: v // 2 if k == 'hide' else v))
                layer.alpha_composite(img, (int(sn[k]['x'] - px), int(sn[k]['y'] - py)))
    if P.get('cameo'):
        c = P['cameo']
        img, px, py = sprite(d, cache, 'snag.peek', c['w'])
        layer.alpha_composite(img, (int(c['x'] - px), int(c['y'] - py)))
    if bf := P.get('butterfly'):
        r = bf['rest']
        img, px, py = sprite(d, cache, 'feat.butterfly-open', r['w'])
        layer.alpha_composite(img, (int(r['x'] - px), int(r['y'] - py)))

    for ev in d['events']:
        e, p = ev['e'], ev['p']
        if e['type'] == 'pickup':
            name = 'prop.%s-thread' % ('golden' if e['item'] == 'gold' else e['item'])
            img, px, py = sprite(d, cache, name, e.get('size', 60))
            layer.alpha_composite(img, (int(p['x'] - px), int(p['y'] - py)))
    for ev in d['loopEvents']:
        e, p = ev['e'], ev['p']
        if e['type'] == 'pickup':
            name = 'prop.%s-thread' % ('golden' if e['item'] == 'gold' else e['item'])
            img, px, py = sprite(d, cache, name, e.get('size', 40))
            layer.alpha_composite(img, (int(p['x'] - px), int(p['y'] - py)))
    for p in d['loop'].get('samples', []):
        img, px, py = sprite(d, cache, 'loop.run-left', p['w'])
        img.putalpha(img.getchannel('A').point(lambda v: v * 3 // 4))
        layer.alpha_composite(img, (int(p['x'] - px), int(p['y'] - py)))
    for p in d['purl']['samples']:
        img, px, py = sprite(d, cache, 'purl.run-left', p['w'])
        img.putalpha(img.getchannel('A').point(lambda v: v * 3 // 4))
        layer.alpha_composite(img, (int(p['x'] - px), int(p['y'] - py)))

    if lines:
        for ev in d['events'] + [{'e': dict(e['e'], type='L:' + e['e']['type']), 'p': e['p']} for e in d['loopEvents']]:
            e, p = ev['e'], ev['p']
            dr.ellipse([p['x'] - 9, p['y'] - 9, p['x'] + 9, p['y'] + 9], fill=(255, 255, 255, 255), outline=(0, 0, 0, 255))
            label = '%s %s f=%.3f' % (e['type'], e.get('item') or e.get('stitch') or e.get('kind') or '', e['f'])
            dr.rectangle([p['x'] + 12, p['y'] - 12, p['x'] + 14 + 7 * len(label), p['y'] + 4], fill=(0, 0, 0, 170))
            dr.text((p['x'] + 14, p['y'] - 10), label, fill=(255, 255, 255, 255))

    out = Image.alpha_composite(base, layer)
    out = out.resize((int(841 * a.scale), int(1870 * a.scale)), Image.LANCZOS)
    out.convert('RGB').save(a.out)
    print('wrote', a.out)


if __name__ == '__main__':
    main()
