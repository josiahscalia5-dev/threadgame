"""Contact sheet of harness captures: python3 render-sheet.py out.png width a.png b.png ..."""
import sys
from PIL import Image, ImageDraw
out, W = sys.argv[1], int(sys.argv[2])
ims = [Image.open(p).convert('RGB') for p in sys.argv[3:]]
H = int(ims[0].height * W / ims[0].width)
sheet = Image.new('RGB', (len(ims) * (W + 6), H + 14), 'white')
d = ImageDraw.Draw(sheet)
for i, (im, p) in enumerate(zip(ims, sys.argv[3:])):
    sheet.paste(im.resize((W, H)), (i * (W + 6), 14))
    d.text((i * (W + 6) + 2, 1), p.split('/')[-1], fill='black')
sheet.save(out)
