#!/usr/bin/env python3
"""Side-by-side comparison of game captures with the seven approved screens.

  python3 tools/compare-approved.py SHOTS_DIR OUT_DIR [--height 900]

SHOTS_DIR holds captures named like the approved files (01-ribbon.png … 07-finish.png, as written by
tests/e2e/play.cjs --shots). For each pair it writes OUT_DIR/cmp-<name>.jpg (approved left, game right) and
OUT_DIR/compare-all.jpg with every available pair. Approved files are only read, never modified.
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFont

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
APPROVED = os.path.join(REPO, 'kit', 'Wishweave-Level1-Complete-Visual-Kit', 'approved')
NAMES = ['01-ribbon', '02-shortcut', '03-tassels', '04-snagged', '05-recovery', '06-butterfly', '07-finish']


def font(size):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def fit(im, h):
    return im.convert('RGB').resize((round(im.width * h / im.height), h), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('shots')
    ap.add_argument('out')
    ap.add_argument('--height', type=int, default=900)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    pairs = []
    f = font(max(14, a.height // 40))
    for name in NAMES:
        shot = os.path.join(a.shots, name + '.png')
        if not os.path.exists(shot):
            continue
        left = fit(Image.open(os.path.join(APPROVED, name + '.png')), a.height)
        right = fit(Image.open(shot), a.height)
        pad, top = 10, a.height // 18
        im = Image.new('RGB', (left.width + right.width + pad * 3, a.height + top + pad), (34, 20, 12))
        im.paste(left, (pad, top))
        im.paste(right, (left.width + pad * 2, top))
        d = ImageDraw.Draw(im)
        d.text((pad + 4, 6), 'APPROVED ' + name, fill=(255, 226, 160), font=f)
        d.text((left.width + pad * 2 + 4, 6), 'GAME CAPTURE', fill=(160, 235, 230), font=f)
        im.save(os.path.join(a.out, 'cmp-%s.jpg' % name), quality=88)
        pairs.append(im)
        print('wrote', os.path.join(a.out, 'cmp-%s.jpg' % name))
    if pairs:
        scale = 0.5
        small = [p.resize((int(p.width * scale), int(p.height * scale)), Image.LANCZOS) for p in pairs]
        cols = 4 if len(small) > 4 else len(small)
        rows = (len(small) + cols - 1) // cols
        w, h = max(p.width for p in small), max(p.height for p in small)
        sheet = Image.new('RGB', (cols * w, rows * h), (20, 12, 8))
        for i, p in enumerate(small):
            sheet.paste(p, ((i % cols) * w, (i // cols) * h))
        sheet.save(os.path.join(a.out, 'compare-all.jpg'), quality=85)
        print('wrote', os.path.join(a.out, 'compare-all.jpg'))


if __name__ == '__main__':
    main()
