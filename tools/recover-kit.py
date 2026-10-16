#!/usr/bin/env python3
"""Rebuild visual-kit files that were missing from a truncated Part 4 upload.

Part 4 of the four-part kit download arrived truncated, so 17 of its 20 files
were absent. This script restores them from data that did arrive, and records
exactly how each one was obtained in kit/RECOVERY-REPORT.json:

  exact        byte-identical to the original (SHA-256 matches Wishweave-Part-Index.json)
  pixel-exact  lossless crop of an intact atlas using the rectangle recorded in
               assets/individual/manifest.json (same RGBA pixels; PNG bytes differ)
  rebuilt      atlas reassembled from pixel-exact individual frames
  lossy        taken from the WebP copy embedded in Preview-Wishweave-Level1-Complete-Small.html

The approved reference PNGs are never modified. Re-uploading an intact Part 4
and re-extracting it over kit/ replaces every recovered file with the original.

Usage: python3 tools/recover-kit.py [kit-root]
"""
import base64
import hashlib
import json
import os
import re
import shutil
import sys
from io import BytesIO

from PIL import Image

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'kit'))
KIT = os.path.join(ROOT, 'Wishweave-Level1-Complete-Visual-Kit')
ASSETS = os.path.join(KIT, 'assets')


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def index_entries():
    with open(os.path.join(ROOT, 'Wishweave-Part-Index.json')) as f:
        data = json.load(f)
    return {e['path']: e for part in data['parts'] for e in part['originalEntries']}


def embedded_images():
    """WebP review copies embedded in the standalone preview, keyed by kit-relative path."""
    html = open(os.path.join(ROOT, 'Preview-Wishweave-Level1-Complete-Small.html'), encoding='utf-8').read()
    m = re.search(r'WW_EMBEDDED_ASSETS\s*=\s*', html)
    obj, _ = json.JSONDecoder().raw_decode(html[m.end():])
    out = {}
    for key, uri in obj.items():
        out[key.replace('../', '', 1)] = Image.open(BytesIO(base64.b64decode(uri.split(',', 1)[1]))).convert('RGBA')
    return out


def main():
    index = index_entries()
    individual = json.load(open(os.path.join(ASSETS, 'individual', 'manifest.json')))['assets']
    by_file = {'assets/' + a['file']: a for a in individual}
    features = json.load(open(os.path.join(ASSETS, 'features', 'feature-manifest.json')))
    embedded = None
    report = []

    def missing():
        return [p for p in index if not os.path.exists(os.path.join(ROOT, p))]

    def record(path, method, note):
        full = os.path.join(ROOT, path)
        digest = sha(full)
        exact = digest == index[path]['sha256']
        report.append({'path': path, 'method': 'exact' if exact else method,
                       'sha256': digest, 'originalSha256': index[path]['sha256'], 'note': note})
        print(('exact      ' if exact else method.ljust(11)), path)

    for path in missing():
        rel = path.split('Wishweave-Level1-Complete-Visual-Kit/', 1)[1]
        full = os.path.join(ROOT, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)

        # Identical originals recorded under another name (same SHA-256 in the index).
        twin = next((p for p, e in index.items() if p != path and e['sha256'] == index[path]['sha256']
                     and os.path.exists(os.path.join(ROOT, p))), None)
        if twin:
            shutil.copyfile(os.path.join(ROOT, twin), full)
            record(path, 'exact', 'copied from ' + twin + ' (identical original hash)')
            continue

        entry = by_file.get(rel)
        if entry:
            src = os.path.join(ASSETS, entry['sourceAtlas'])
            x, y, w, h = entry['rect']
            if os.path.exists(src):
                Image.open(src).convert('RGBA').crop((x, y, x + w, y + h)).save(full)
                record(path, 'pixel-exact', 'lossless crop of ' + entry['sourceAtlas'])
                continue
            embedded = embedded or embedded_images()
            key = 'assets/' + entry['sourceAtlas']
            if key in embedded:
                embedded[key].crop((x, y, x + w, y + h)).save(full)
                record(path, 'lossy', 'crop of embedded WebP review copy of ' + entry['sourceAtlas'])
                continue

        feature = next((v for k, v in features.get('individual', {}).items() if 'assets/' + v['file'] == rel), None)
        if feature:
            atlas = features['images']['feature-atlas']
            x, y, w, h = atlas['frames'][feature['atlasFrame']]
            Image.open(os.path.join(ASSETS, atlas['file'])).convert('RGBA').crop((x, y, x + w, y + h)).save(full)
            record(path, 'pixel-exact', 'lossless crop of feature-atlas frame %d' % feature['atlasFrame'])
            continue

        print('deferred   ', path)

    # Atlases: reassemble from individual frames now that every frame exists.
    for path in missing():
        rel = path.split('Wishweave-Level1-Complete-Visual-Kit/', 1)[1]
        name = os.path.basename(rel)
        frames = [a for a in individual if a.get('sourceAtlas') == name]
        if not frames:
            print('UNRECOVERED', path)
            continue
        manifest = json.load(open(os.path.join(ASSETS, 'manifest.json')))
        spec = manifest['images'][frames[0]['atlasKey']]
        atlas = Image.new('RGBA', (spec['width'], spec['height']), (0, 0, 0, 0))
        lossy = []
        for a in frames:
            frame_path = os.path.join(ASSETS, a['file'])
            atlas.alpha_composite(Image.open(frame_path).convert('RGBA'), tuple(a['rect'][:2]))
            prior = next((r for r in report if r['path'].endswith(a['file'])), None)
            if prior and prior['method'] == 'lossy':
                lossy.append(a['pose'])
        atlas.save(os.path.join(ROOT, path))
        record(path, 'rebuilt', 'reassembled from %d individual frames%s' % (
            len(frames), '; lossy frames: ' + ', '.join(lossy) if lossy else ''))

    with open(os.path.join(ROOT, 'RECOVERY-REPORT.json'), 'w') as f:
        json.dump({'reason': 'Wishweave-Level1-Part-4-of-4.zip upload was truncated at 9,501,637 bytes',
                   'still_missing': missing(), 'files': report}, f, indent=2)
    print('remaining missing:', len(missing()))


if __name__ == '__main__':
    main()
