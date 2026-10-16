"""Side-by-side: approved PNG (left) vs a 412x915@2 harness capture (right), both at the plate scale.
usage: python3 render-compare.py approved.png capture.png out.png [width] [x0,y0,x1,y1 crop in plate px]"""
import sys
from PIL import Image, ImageDraw
a = Image.open(sys.argv[1]).convert('RGB')
b = Image.open(sys.argv[2]).convert('RGB')
W = int(sys.argv[4]) if len(sys.argv) > 4 else 420
# capture: canvas 824x1830 device px; plate contain-fit s0 = min(412/841, 915/1870) css -> device x2
s0 = min(412 / 841, 915 / 1870) * 2
pw, ph = 841 * s0, 1870 * s0
ox, oy = (824 - pw) / 2, (1830 - ph) / 2
b = b.crop((round(ox), round(oy), round(ox + pw), round(oy + ph))).resize((841, 1870))
if len(sys.argv) > 5:
    box = tuple(int(v) for v in sys.argv[5].split(','))
    a, b = a.crop(box), b.crop(box)
H = int(a.height * W / a.width)
im = Image.new('RGB', (W * 2 + 8, H), 'white')
im.paste(a.resize((W, H)), (0, 0)); im.paste(b.resize((W, H)), (W + 8, 0))
im.save(sys.argv[3])
