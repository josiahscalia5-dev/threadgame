#!/usr/bin/env python3
"""Build the game's runtime art from the visual kit (kit/ stays untouched).

Outputs (all regenerated; do not hand-edit):
  game/assets/plates/*.webp    six clean scene plates, normalised to 841x1870 design pixels
  game/assets/atlas/*.webp     sprite atlases (original layouts, lossy WebP with full alpha)
  game/assets/ui/*.webp        individual interface pieces for the DOM HUD
  game/src/data/asset-data.js  WW.ASSETS: image files and named frames with trimmed
                               rectangles and stable pivots (see docs/ARCHITECTURE.md)

Frame pivots: characters/enemy use a foot pivot measured from the alpha mask
(bottom-most opaque row; x = centre of opaque pixels in the lowest 10% of the
sprite) so poses do not jitter when frames change. Props use the anchor recorded
in the kit manifests (spools bottom-centre, tassels top-centre).

Usage: python3 tools/build-runtime-assets.py
"""
import json
import os

from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
KIT = os.path.join(REPO, 'kit', 'Wishweave-Level1-Complete-Visual-Kit')
ASSETS = os.path.join(KIT, 'assets')
OUT = os.path.join(REPO, 'game', 'assets')
DATA = os.path.join(REPO, 'game', 'src', 'data', 'asset-data.js')
DESIGN = (841, 1870)
ALPHA = 8

PLATES = {
    'p01': '01-ribbon', 'p02': '02-shortcut', 'p03': '03-tassels',
    'p04': '04-snagged', 'p06': '06-butterfly', 'p07': '07-finish',
}

# atlas key in kit manifest -> (runtime image key, frame-name prefix, frame names, pivot mode)
ATLASES = [
    ('purl-rear', 'purl', 'purl', None, 'foot'),
    ('loop-rear', 'loop', 'loop', None, 'foot'),
    ('purl-atlas', 'purlFront', 'purlFront', ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'], 'foot'),
    ('loop-atlas', 'loopFront', 'loopFront', ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'], 'foot'),
    ('snagling-atlas', 'snag', 'snag', ['idle', 'reach', 'cheer', 'walk', 'spin', 'peek', 'alert', 'grab'], 'foot'),
    ('props-atlas', 'props', 'prop', None, 'anchor'),
    ('feature-atlas', 'features', 'feat', None, 'anchor'),
]
UI = ['logo', 'pill', 'pause', 'bubble-coral', 'bubble-teal']


def trim(img, rect):
    x, y, w, h = rect
    crop = img.crop((x, y, x + w, y + h))
    mask = crop.getchannel('A').point(lambda a: 255 if a > ALPHA else 0)
    bbox = mask.getbbox()
    if not bbox:
        raise ValueError('empty frame %r' % (rect,))
    l, t, r, b = bbox
    return (x + l, y + t, r - l, b - t), mask.crop(bbox)


def foot_pivot(mask):
    w, h = mask.size
    band = max(2, int(h * 0.10))
    xs = total = 0
    px = mask.load()
    for yy in range(h - band, h):
        for xx in range(w):
            if px[xx, yy]:
                xs += xx
                total += 1
    return (xs / total if total else w / 2), float(h)


def main():
    kit_manifest = json.load(open(os.path.join(ASSETS, 'manifest.json')))['images']
    feature_manifest = json.load(open(os.path.join(ASSETS, 'features', 'feature-manifest.json')))['images']
    specs = dict(kit_manifest)
    specs.update(feature_manifest)
    for sub in ('plates', 'atlas', 'ui'):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)

    images, frames = {}, {}

    for key, name in PLATES.items():
        src = Image.open(os.path.join(ASSETS, 'backgrounds', name + '.png')).convert('RGB')
        if src.size != DESIGN:
            src = src.resize(DESIGN, Image.LANCZOS)
        rel = 'assets/plates/%s.webp' % name
        src.save(os.path.join(REPO, 'game', rel), 'WEBP', quality=90, method=6)
        images[key] = {'file': rel, 'w': DESIGN[0], 'h': DESIGN[1]}

    for atlas_key, image_key, prefix, names, mode in ATLASES:
        spec = specs[atlas_key]
        img = Image.open(os.path.join(ASSETS, spec['file'])).convert('RGBA')
        rel = 'assets/atlas/%s.webp' % atlas_key
        img.save(os.path.join(REPO, 'game', rel), 'WEBP', quality=92, alpha_quality=100, method=6)
        images[image_key] = {'file': rel, 'w': img.width, 'h': img.height}
        poses = names or spec.get('poses')
        anchors = spec.get('anchors')
        for i, rect in enumerate(spec['frames']):
            (x, y, w, h), mask = trim(img, rect)
            if mode == 'foot':
                px, py = foot_pivot(mask)
            else:
                ax, ay = anchors[i] if anchors else (0.5, 1.0)
                px, py = ax * w, ay * h
            frames['%s.%s' % (prefix, poses[i])] = {
                'img': image_key, 'x': x, 'y': y, 'w': w, 'h': h,
                'px': round(px, 1), 'py': round(py, 1)}

    ui = Image.open(os.path.join(ASSETS, 'ui-atlas.png')).convert('RGBA')
    for i, rect in enumerate(kit_manifest['ui-atlas']['frames']):
        (x, y, w, h), _ = trim(ui, rect)
        rel = 'assets/ui/%s.webp' % UI[i]
        ui.crop((x, y, x + w, y + h)).save(os.path.join(REPO, 'game', rel), 'WEBP', quality=92, alpha_quality=100, method=6)
        images['ui.' + UI[i]] = {'file': rel, 'w': w, 'h': h}

    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, 'w') as f:
        f.write('/* Generated by tools/build-runtime-assets.py from kit/. Do not edit by hand. */\n')
        f.write('(function (WW) {\n  WW.ASSETS = ')
        json.dump({'design': {'w': DESIGN[0], 'h': DESIGN[1]}, 'images': images, 'frames': frames}, f, indent=1)
        f.write(';\n})(globalThis.WW = globalThis.WW || {});\n')
    total = sum(os.path.getsize(os.path.join(dp, fn)) for dp, _, fns in os.walk(OUT) for fn in fns)
    print('images %d, frames %d, runtime bytes %d' % (len(images), len(frames), total))


if __name__ == '__main__':
    main()
