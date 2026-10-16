#!/usr/bin/env python3
"""Contact sheet of captured frames: contact.py DIR OUT.jpg [cols] [height] [first] [step] [count]"""
import glob, sys
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 8
h = int(sys.argv[4]) if len(sys.argv) > 4 else 300
first = int(sys.argv[5]) if len(sys.argv) > 5 else 0
step = int(sys.argv[6]) if len(sys.argv) > 6 else 1
count = int(sys.argv[7]) if len(sys.argv) > 7 else 999
fs = sorted(glob.glob(d + '/f*.png'))[first::step][:count]
ims = [Image.open(f).convert('RGB') for f in fs]
w = int(ims[0].width * h / ims[0].height)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (w + 4), rows * (h + 4)), (255, 255, 255))
for i, im in enumerate(ims):
    im = im.resize((w, h))
    ImageDraw.Draw(im).text((4, 4), fs[i].split('/')[-1][1:5], fill=(255, 255, 0))
    sheet.paste(im, ((i % cols) * (w + 4), (i // cols) * (h + 4)))
sheet.save(out, quality=82)
print(len(ims), 'frames', sheet.size)
