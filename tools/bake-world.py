#!/usr/bin/env python3
"""Resamples pieces of the existing paintings into tileable textures (see tools/bake-world.cjs)."""
import json
import sys

import numpy as np
from PIL import Image, ImageOps


def bilinear(arr, xs, ys):
    h, w = arr.shape[:2]
    xs = np.clip(xs, 0, w - 1.001)
    ys = np.clip(ys, 0, h - 1.001)
    x0 = np.floor(xs).astype(int); y0 = np.floor(ys).astype(int)
    fx = (xs - x0)[..., None]; fy = (ys - y0)[..., None]
    a = arr[y0, x0]; b = arr[y0, x0 + 1]; c = arr[y0 + 1, x0]; d = arr[y0 + 1, x0 + 1]
    return (a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy)


def main(spec_path):
    jobs = json.load(open(spec_path))
    for job in jobs:
        if job['kind'] == 'carpet':
            arr = np.asarray(Image.open(job['image']).convert('RGB'), dtype=np.float32)
            rows = job['rows']; n = job['across']
            out = np.zeros((len(rows), n, 3), np.float32)
            u = (np.arange(n) + 0.5) / n
            for i, (iy, xl, xr) in enumerate(rows[::-1]):      # far rows at the top of the texture
                xs = xl + (xr - xl) * u
                out[i] = bilinear(arr, xs, np.full(n, iy))
            Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(job['out'], quality=90)
            print('carpet', job['id'], out.shape[1], 'x', out.shape[0], '->', job['out'])
        elif job['kind'] == 'crop':
            im = Image.open(job['image']).convert('RGB').crop(tuple(job['box']))
            im.save(job['out'], quality=92)
            print('crop', im.size, '->', job['out'])
        elif job['kind'] == 'sky':
            panels = []
            for path, hz in zip(job['images'], job['horizons']):
                im = Image.open(path).convert('RGB')
                top, bot = hz - job['above'], hz + job['below']
                pad_top = max(0, -top)
                band = im.crop((0, max(0, top), im.width, bot))
                if pad_top:
                    # extend the sky upward with a mirror image of the painting's own top rows (no streaks)
                    top_rows = band.crop((0, 0, band.width, min(pad_top, band.height)))
                    full = Image.new('RGB', (band.width, band.height + pad_top))
                    full.paste(ImageOps.flip(top_rows), (0, 0)); full.paste(band, (0, pad_top)); band = full
                h = round(band.height * job['panelW'] / band.width)
                panels.append(band.resize((job['panelW'], h), Image.LANCZOS))
            # 12 panels around the horizon: each painting and its mirror image, alternating, in two textures.
            seq = []
            for i, p in enumerate(panels):
                seq.append(p); seq.append(ImageOps.mirror(panels[(i + 3) % len(panels)]))
            for t in range(2):
                part = seq[t * 6:(t + 1) * 6]
                w = sum(p.width for p in part); h = part[0].height
                tex = Image.new('RGB', (w, h))
                x = 0
                for p in part:
                    tex.paste(p, (x, 0)); x += p.width
                # soften the seams between neighbouring panels
                a = np.asarray(tex, np.float32)
                for k in range(1, 6):
                    sx = k * part[0].width
                    for dx in range(-24, 24):
                        wgt = 0.5 + 0.5 * np.cos((dx + 24) / 48 * np.pi)
                        if 0 <= sx + dx < a.shape[1] and 0 <= sx - dx - 1 < a.shape[1]:
                            a[:, sx + dx] = a[:, sx + dx] * (1 - wgt * 0.5) + a[:, sx - dx - 1] * (wgt * 0.5)
                Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(job['out'] % t, quality=86)
                print('sky', t, w, 'x', h, '->', job['out'] % t)


if __name__ == '__main__':
    main(sys.argv[1])
