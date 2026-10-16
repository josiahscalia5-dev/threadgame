"""render-pairs.py out.jpg tileWidth approvedName:capture.png[:x0,y0,x1,y1] ... -> approved|capture pairs side by side in plate space (412x915@2 captures)."""
import sys
from PIL import Image
A='/home/user/threadgame/kit/Wishweave-Level1-Complete-Visual-Kit/approved/'
def plate(cap):
    b=Image.open(cap).convert('RGB')
    s0=min(412/841,915/1870)*2; pw,ph=841*s0,1870*s0; ox,oy=(824-pw)/2,(1830-ph)/2
    return b.crop((round(ox),round(oy),round(ox+pw),round(oy+ph))).resize((841,1870))
out=sys.argv[1]; W=int(sys.argv[2]); items=sys.argv[3:]
tiles=[]
for it in items:
    parts=it.split(':'); name,cap=parts[0],parts[1]
    a=Image.open(A+name+'.png').convert('RGB').resize((841,1870)); b=plate(cap)
    if len(parts)>2:
        box=tuple(int(v) for v in parts[2].split(',')); a=a.crop(box); b=b.crop(box)
    tiles+= [a,b]
H=int(tiles[0].height*W/tiles[0].width)
im=Image.new('RGB',((W+6)*len(tiles),H),'white')
for i,t in enumerate(tiles):
    im.paste(t.resize((W,int(t.height*W/t.width))),(i*(W+6)+(3 if i%2 else 0)*0,0))
im.save(out,quality=88)
