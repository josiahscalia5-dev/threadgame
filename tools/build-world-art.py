#!/usr/bin/env python3
"""Cut the 3D course's textures out of the user's approved Level 1 art (nothing invented).

  python3 tools/build-world-art.py

Source: kit/Wishweave-Level1-Complete-Visual-Kit/assets/backgrounds/*.png (the clean scenery plates of the seven
approved screens; never modified). Output: game/assets/world/*.webp, used by game/src/render/*.

Each carpet texture is the painted carpet itself, perspective-rectified to a top-down tile with a homography from
four points measured on its edges (inside the gold rope borders):
  carpet-main.webp  plate 03 (tassels), rows 1180–1440: the red/gold/teal flower carpet Purl runs on.
                    512 × 512 px = the 6 m road width × 6 m along the road (mirrored along the road in the game).
  carpet-side.webp  plate 02 (shortcut), rows 1000–1200: the teal carpet with pink/gold flowers (the side loop).
                    384 × 384 px = the 2.6 m side-loop width × 2.6 m.
"""
import os

import numpy as np
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PLATES = os.path.join(REPO, 'kit', 'Wishweave-Level1-Complete-Visual-Kit', 'assets', 'backgrounds')
OUT = os.path.join(REPO, 'game', 'assets', 'world')


def homography(src, dst):
    """PIL PERSPECTIVE coefficients mapping output points (dst) to input points (src)."""
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.array(a, float), np.array(b, float)).tolist()


def rectify(plate, quad, size):
    """quad = TL, TR, BR, BL in plate pixels (far edge first); size = (width, length) of the output tile."""
    im = Image.open(os.path.join(PLATES, plate)).convert('RGB')
    w, h = size
    return im.transform(size, Image.PERSPECTIVE, homography(quad, [(0, 0), (w, 0), (w, h), (0, h)]), Image.BICUBIC)


def save(img, name, quality=90):
    path = os.path.join(OUT, name)
    img.save(path, 'WEBP', quality=quality, method=6)
    print('wrote', os.path.relpath(path, REPO), img.size)


def main():
    os.makedirs(OUT, exist_ok=True)
    # The far edge of each quad is the top of the tile; flipping makes the tile run "away" from the camera
    # with v increasing along the road, as the course UVs expect.
    main_carpet = rectify('03-tassels.png', [(240, 1180), (522, 1180), (640, 1440), (150, 1440)], (512, 512))
    save(main_carpet.transpose(Image.FLIP_TOP_BOTTOM), 'carpet-main.webp')
    side = rectify('02-shortcut.png', [(300, 1000), (560, 1000), (605, 1200), (160, 1200)], (384, 384))
    save(side.transpose(Image.FLIP_TOP_BOTTOM), 'carpet-side.webp')


if __name__ == '__main__':
    main()
