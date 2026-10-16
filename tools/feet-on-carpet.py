#!/usr/bin/env python3
"""Checks where Purl's feet land on a painting along his route: on the carpet (coral/crimson weave and its
gold-yellow flower stitches) or off it (cream underside, sky, wood, tassels).

  python3 tools/feet-on-carpet.py plate.webp route.json [exitF]
route.json: [[x, y, w], ...] sampled along the route (see tools/route-overlay.cjs data). Feet are at ±0.2 w."""
import colorsys, json, sys
from collections import Counter
from PIL import Image

im = Image.open(sys.argv[1]).convert('RGB')
route = json.load(open(sys.argv[2]))
exit_f = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0

def cls(p):
    r, g, b = [c / 255 for c in p]
    h, s, v = colorsys.rgb_to_hsv(r, g, b); h *= 360
    if v < 0.35: return 'dark'
    if s < 0.22 and v > 0.75: return 'cream'
    if (h >= 330 or h < 12) and s > 0.45: return 'carpet'
    if 12 <= h < 50 and s > 0.45 and v > 0.7: return 'carpet'      # gold-yellow flower stitches / braid
    if 12 <= h < 50: return 'tan'
    if 260 <= h < 330: return 'purple'
    return 'other'

def foot(x, y):
    c = Counter(cls(im.getpixel((min(im.width - 1, max(0, int(x + dx))), min(im.height - 1, max(0, int(y + dy))))))
                for dx in (-4, 0, 4) for dy in (-4, 0))
    return c.most_common(1)[0][0]

n = len(route) - 1
off = []
for i, (x, y, w) in enumerate(route):
    f = i / n
    if f > exit_f: break
    for side in (-1, 1):
        k = foot(x + side * 0.2 * w, y - 3)
        if k != 'carpet': off.append((round(f, 2), side, k))
total = 2 * (int(exit_f * n) + 1)
print('feet on carpet: %d / %d samples (%.0f%%)' % (total - len(off), total, 100 * (total - len(off)) / total))
if off:
    spans = Counter(o[2] for o in off)
    print('off the carpet:', dict(spans), ' at f =', sorted(set(o[0] for o in off))[:40])
