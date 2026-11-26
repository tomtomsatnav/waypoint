# Tobin at 24, a knight, drawn from measurements of the reference figures:
# about 78 px tall; head 11 px wide and 17 tall with the beard (a real adult head, shaded, eyes in shadowed sockets);
# shoulders about 29 px (2.6 head-widths) with a mail coif thickening the neck; a long surcoat to below the knee so only
# greaves and sabatons show; long arms reaching mid-thigh; a cloak falling in an A to the ankle; dark gunmetal plate.
from PIL import Image
import random, math
W,H=62,94; G=89; T=(0,0,0,0)
def c(h): return tuple(int(h[i:i+2],16) for i in (1,3,5))+(255,)
OUT=c('#120e0c')
SKIN=[c('#dba882'),c('#b47a55'),c('#83523a'),c('#523225')]
HAIR=[c('#9a5c38'),c('#74432a'),c('#4f2c1c'),c('#301a12')]
STEEL=[c('#a9b0ba'),c('#747a85'),c('#4a4f59'),c('#2a2d34')]
MAIL=[c('#8b919b'),c('#62676f'),c('#40444b'),c('#26282d')]
BLUE=[c('#5f7fae'),c('#3f5d8c'),c('#2a4166'),c('#18283f')]
CREAM=[c('#e2dac3'),c('#bab19a'),c('#8a8371'),c('#5a554a')]
LEA=[c('#7a5238'),c('#553625'),c('#372218'),c('#22150f')]
GOLD=[c('#e7c96a'),c('#c09a3a'),c('#7f6222')]
WHITE=[c('#f2efe4'),c('#c3c9d6')]
MUD=[c('#6a5a40'),c('#4d4130'),c('#352c21')]
RUST=[c('#8a5230'),c('#6e3d25')]
def draw():
    img=Image.new('RGBA',(W,H),T); px=img.load()
    def P(x,y,col):
        if 0<=x<W and 0<=y<H: px[x,y]=col
    def op(x,y): return 0<=x<W and 0<=y<H and px[x,y][3]!=0
    def span(y,x0,x1,pal,lit=2,dark=2,deep=1):
        for x in range(x0,x1+1):
            i=x-x0; j=x1-x
            P(x,y, pal[0] if i<lit else pal[3] if j<deep else pal[2] if j<deep+dark else pal[1])
    L=lambda a,b,t: round(a+(b-a)*t)
    inner=[]
    # ---- cloak, behind everything: an A from the shoulders to the ankle
    for y in range(22,84):
        t=(y-22)/61
        x0=L(15,6,t**0.8); x1=L(46,55,t**0.8)
        span(y,x0,x1,CREAM,2,6,2)
        for fx,tone in ((x0+3,2),(x0+5+(1 if (y//6)%2 else 0),3),(x0+8,2),(x1-3,3),(x1-6+(1 if (y//5)%2 else 0),3),(x1-9,2)):
            if y>30 or fx<20 or fx>41: P(fx,y,CREAM[tone])
        if y%9<6: P(x0+1,y,CREAM[0]); 
        if y%11<7: P(x0+6,y,CREAM[0])
    for x in range(6,56):                                     # hem: a blue band with gilt studs, ragged
        for y in (80,81,82): 
            if op(x,y): P(x,y,BLUE[1] if y!=81 or x%4 else GOLD[1])
        if x%5==2: P(x,83,T); P(x,82,BLUE[3])
        elif x%5==4: P(x,84,BLUE[2])
    # ---- legs: greaves and sabatons under the surcoat
    for y in range(64,81):
        span(y,23,28,STEEL,1,2,1); span(y,32,37,STEEL,1,2,1)
    for y in (68,74): 
        for x in range(23,29): P(x,y,STEEL[3])
        for x in range(32,38): P(x,y-1,STEEL[3])
    for y,(a,b) in zip(range(80,90),[(22,29),(22,29),(21,29),(21,29),(20,29),(19,29),(19,29),(18,29),(18,29),(18,29)]): span(y,a,b,STEEL,2,2,1)
    for y,(a,b) in zip(range(79,88),[(32,38),(32,38),(32,39),(32,39),(32,40),(32,41),(32,41),(32,42),(32,42)]): span(y,a,b,STEEL,2,2,1)
    for x in range(18,30): P(x,89,STEEL[3])
    for x in range(32,43): P(x,87,STEEL[3])
    for y in (83,86): 
        for x in range(19,30): 
            if op(x,y): P(x,y,STEEL[3])
    for y in (82,85):
        for x in range(32,42):
            if op(x,y): P(x,y,STEEL[3])
    for y in range(66,80): P(29,y,OUT); P(30,y,CREAM[3]); P(31,y,OUT)
    # ---- surcoat: long, to below the knee, split at the front
    for y in range(24,67):
        t=(y-24)/42
        x0=L(22,19,t); x1=L(38,41,t)
        span(y,x0,x1,BLUE,2,4,1)
    for y in range(26,66):
        for fx in (24,27,33,36):
            if y>46 or fx in (24,36): P(fx+(1 if y>56 and fx>30 else 0),y,BLUE[2] if y%5 else BLUE[3])
        if y>48 and y%3: P(22,y,BLUE[0]); 
    for y in range(52,67): P(30,y,OUT); P(29,y,BLUE[3]); P(31,y,BLUE[3])       # the split
    for x in range(19,42):
        if x%4==1: P(x,66,T)
        elif x%4==3: P(x,67,BLUE[3])
    # device: a white river across the chest
    for x in range(22,39):
        yy=31+round(1.5*math.sin((x-22)/2.6))
        P(x,yy,WHITE[0]); P(x,yy+1,WHITE[0]); P(x,yy+2,WHITE[1])
    for x in (24,25,31,32,36): P(x,37+(x%2),WHITE[1])
    # sword belt, slung low on one side, gilt buckle, hanging tail
    for x in range(20,41):
        yy=45+round((x-20)*0.12)
        P(x,yy-1,LEA[3]); P(x,yy,LEA[0] if x%3 else LEA[1]); P(x,yy+1,LEA[3])
    for (dx,dy,t) in [(-1,-1,2),(0,-1,1),(1,-1,2),(-1,0,1),(0,0,0),(1,0,1),(-1,1,2),(0,1,1),(1,1,2)]: P(31+dx,46+dy,GOLD[t])
    for y in range(48,57): P(33,y,LEA[1]); P(34,y,LEA[3])
    P(33,57,GOLD[1])
    # ---- scabbard on his left hip (viewer's left), hanging back at an angle
    for i in range(30):
        x=19-round(i*0.28); y=47+i
        P(x-1,y,LEA[3]); P(x,y,LEA[1]); P(x+1,y,LEA[2]); P(x+2,y,OUT)
    for (x,y,t) in [(10,77,1),(11,77,2),(10,78,2),(11,78,3),(10,79,3)]: P(x,y,STEEL[t])
    for (x,y) in [(17,54),(18,54),(15,62),(16,62)]: P(x,y,GOLD[1])
    # ---- arms: plate, long. Viewer's right arm hangs; viewer's left hand rests on the hilt
    for y in range(28,39): span(y,39,44,STEEL,2,2,1); inner.append((38,y)); inner.append((45,y))
    for y in (39,40,41): span(y,39,45,STEEL,2,2,1)                                # couter
    P(42,40,STEEL[0])
    for y in range(42,52): span(y,40,45,STEEL,2,2,1); inner.append((39,y)); inner.append((46,y))
    for y in (45,48): 
        for x in range(40,46): P(x,y,STEEL[3])
    for y in range(52,58): span(y,40,46,STEEL,2,2,1)                              # gauntlet
    for x in (41,43,45): P(x,57,STEEL[3])
    P(41,53,STEEL[0]); P(42,53,STEEL[0])
    for y in range(28,38): span(y,16,21,STEEL,2,2,1); inner.append((22,y))
    for y in (38,39,40): span(y,15,21,STEEL,2,2,1)
    P(17,39,STEEL[0])
    for i,y in enumerate(range(41,46)): span(y,16+i//2,22+i//2,STEEL,2,2,1); inner.append((23+i//2,y)); inner.append((15+i//2,y))
    for y in range(44,49): span(y,18,24,STEEL,2,2,1)                              # gauntlet closed over the pommel
    for x in (19,21,23): P(x,48,STEEL[3])
    P(19,45,STEEL[0]); P(20,45,STEEL[0])
    # hilt: cross-guard and grip showing under the hand, pommel above it
    for x in range(14,27): P(x,49,GOLD[1]); P(x,50,GOLD[2])
    P(13,49,GOLD[2]); P(27,49,GOLD[2])
    for (x,y,t) in [(20,41,1),(21,41,0),(22,41,1),(20,42,1),(21,42,0),(22,42,2),(21,43,2)]: P(x,y,GOLD[t])
    # ---- pauldrons: layered, modest, dark
    for (x0,flip) in ((14,False),(38,True)):
        rows=[(20,2,7),(21,1,8),(22,0,9),(23,0,9),(24,0,9),(25,0,9),(26,1,9),(27,1,8),(28,2,7)]
        for y,a,b in rows:
            xa,xb=(x0+a,x0+b) if not flip else (x0+9-b,x0+9-a)
            span(y,xa,xb,STEEL,2,3,1)
        for y in (23,26):
            for x in range(x0,x0+10):
                if px[x,y] in STEEL: P(x,y,STEEL[3])
        P(x0+(2 if not flip else 3),21,c('#d7dce3')); P(x0+(3 if not flip else 4),21,STEEL[0])
        P(x0+(4 if not flip else 5),24,GOLD[1])
    # ---- mail coif pushed back round the neck: a thick collar
    for y,(a,b) in zip(range(17,24),[(24,36),(22,38),(21,39),(21,39),(21,39),(22,38),(23,37)]):
        for x in range(a,b+1): P(x,y,MAIL[1] if (x+y)%2 else (MAIL[0] if x<28 else MAIL[2] if x<35 else MAIL[3]))
    for x in range(23,38): P(x,23,MAIL[3])
    P(29,22,GOLD[1]); P(30,22,GOLD[0]); P(31,22,GOLD[1])                           # cloak clasp
    for (x,y) in [(20,24),(21,24),(39,24),(40,24)]: P(x,y,GOLD[1])
    # ---- head: narrow, long, shaded; cropped hair, short full beard
    for y,(a,b) in zip(range(1,7),[(28,32),(26,34),(25,35),(24,36),(24,36),(24,36)]): span(y,a,b,HAIR,2,3,1)
    for (x,y) in [(24,3),(36,3),(27,1),(33,1)]: P(x,y,T)
    for (x,y) in [(26,3),(28,2),(31,3),(27,4),(33,4)]: P(x,y,HAIR[2])
    for (x,y) in [(25,4),(26,2),(29,3)]: P(x,y,HAIR[0])
    for y in range(6,15): span(y,25,35,SKIN,2,2,1)
    for y in range(6,11): P(24,y,HAIR[1]); P(36,y,HAIR[3]); 
    P(25,6,HAIR[1]); P(35,6,HAIR[3]); P(26,6,HAIR[1]); P(34,6,HAIR[2])
    for x in range(26,35): P(x,7,SKIN[0] if x<30 else SKIN[1])                     # forehead
    for x in (26,27,28,29): P(x,8,SKIN[3])                                         # heavy brows
    for x in (31,32,33,34): P(x,8,SKIN[3])
    P(30,8,SKIN[1])
    for x in (26,27,28): P(x,9,SKIN[2])                                            # eyes sit in shadow
    for x in (32,33,34): P(x,9,SKIN[3])
    P(27,9,OUT); P(33,9,OUT); P(29,9,SKIN[1]); P(30,9,SKIN[0]); P(31,9,SKIN[2])
    P(25,10,SKIN[1]); P(26,10,SKIN[0]); P(27,10,SKIN[0]); P(28,10,SKIN[1]); P(29,10,SKIN[1]); P(30,10,SKIN[0]); P(31,10,SKIN[3]); P(32,10,SKIN[1]); P(33,10,SKIN[2]); P(34,10,SKIN[2]); P(35,10,SKIN[3])
    P(26,11,SKIN[1]); P(27,11,SKIN[1]); P(28,11,SKIN[2]); P(29,11,SKIN[1]); P(30,11,SKIN[0]); P(31,11,SKIN[3]); P(32,11,SKIN[2]); P(33,11,SKIN[2]); P(34,11,SKIN[3])
    for x in range(27,34): P(x,12,HAIR[1] if x<31 else HAIR[2])                    # moustache
    P(29,12,HAIR[0])
    for y,(a,b) in zip(range(11,20),[(25,25),(25,26),(25,35),(25,35),(25,35),(26,34),(26,34),(27,33),(28,32)]):
        if y>=13: span(y,a,b,HAIR,2,3,1)
    P(25,11,HAIR[1]); P(25,12,HAIR[1]); P(35,11,HAIR[3]); P(35,12,HAIR[3]); P(26,12,HAIR[1]); P(34,12,HAIR[3])
    for x in range(28,33): P(x,13,HAIR[3])                                         # mouth, in the beard
    for (x,y) in [(27,15),(30,16),(32,15),(29,18)]: P(x,y,HAIR[2])
    for (x,y) in [(26,14),(27,16),(28,17)]: P(x,y,HAIR[0])
    for (x,y) in [(33,7),(33,10),(34,11)]: P(x,y,c('#e9c4ae'))                     # a scar through the brow to the cheek
    P(33,8,SKIN[2])
    # ---- cloak front edges: a blue band with gilt studs, down each side of the body
    for y in range(30,80):
        t=(y-25)/55
        for xe,side in ((L(21,13,t),-1),(L(39,48,t),1)):
            for d in (0,1):
                x=xe+side*d
                if op(x,y) and px[x,y] in CREAM: P(x,y,BLUE[1] if (y%5 or d) else GOLD[1])
            inner.append((xe-side,y))
    # ---- a hard road: mud, a cut in the cloak, rust, dents, stains
    random.seed(9)
    for _ in range(90):
        x=random.randrange(6,56); y=random.randrange(64,85)
        if op(x,y) and (px[x,y] in CREAM or px[x,y] in BLUE): P(x,y,random.choice(MUD))
    for _ in range(26):
        x=random.randrange(8,54); y=random.randrange(28,64)
        if op(x,y) and px[x,y] in CREAM: P(x,y,random.choice([CREAM[2],CREAM[3]]))
    for y in range(44,66): P(50-(1 if y%6<2 else 0)+ (y-44)//9,y,OUT if y%3 else CREAM[3])
    for _ in range(34):
        x=random.randrange(12,48); y=random.randrange(20,90)
        if op(x,y) and px[x,y] in STEEL: P(x,y,random.choice([STEEL[3],STEEL[3],RUST[0],RUST[1]]))
    for _ in range(12):
        x=random.randrange(20,41); y=random.randrange(40,66)
        if op(x,y) and px[x,y] in BLUE: P(x,y,random.choice([BLUE[3],MUD[1]]))
    for y in range(84,90):
        for x in range(18,43):
            if op(x,y) and px[x,y] in STEEL and random.random()<.3: P(x,y,random.choice(MUD))
    # ---- outline
    s=img.copy().load()
    for y in range(H):
        for x in range(W):
            if s[x,y][3]==0 and any(0<=x+dx<W and 0<=y+dy<H and s[x+dx,y+dy][3] for dx,dy in((1,0),(-1,0),(0,1),(0,-1))): px[x,y]=OUT
    for (x,y) in inner:
        if op(x,y): P(x,y,OUT)
    return img
if __name__=='__main__':
    k=draw(); k.save('art-target/tobin-24.png')
    bram=Image.open('art-target/bram.png')
    ref=Image.open('references/sprites-figures-closeup.jpg').convert('RGBA').crop((310,575,650,900))
    K=6; ref=ref.resize((int(ref.width*K/2.45),int(ref.height*K/2.45)),Image.NEAREST)
    g=Image.new('RGBA',(bram.width+k.width+30,104),c('#56613f')); gp=g.load(); random.seed(4)
    for _ in range(g.width*g.height//9):
        x=random.randrange(g.width); y=random.randrange(g.height); gp[x,y]=random.choice([c('#667348'),c('#4a5537'),c('#7a8455'),c('#3f4a30'),c('#5f5540')])
    for sp,x,foot in ((bram,8,83),(k,bram.width+18,G)):
        for yy in range(95,100):
            for xx in range(x+6,x+sp.width-4):
                if ((xx-x-6)/(sp.width-10)-0.5)**2*4+((yy-97)/3)**2<1: gp[xx,yy]=c('#2f3626')
        g.alpha_composite(sp,(x,94-foot))
    big=g.resize((g.width*K,g.height*K),Image.NEAREST)
    sheet=Image.new('RGBA',(ref.width+big.width+60,max(ref.height,big.height)+40),c('#20242c'))
    sheet.alpha_composite(ref,(20,20)); sheet.alpha_composite(big,(ref.width+40,sheet.height-big.height-20)); sheet.save('art-target/tobin-24-beside-reference.png')
