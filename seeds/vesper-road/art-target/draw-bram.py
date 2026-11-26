from PIL import Image
W,H=58,88
T=(0,0,0,0)
img=Image.new('RGBA',(W,H),T); px=img.load()
def c(h): return tuple(int(h[i:i+2],16) for i in (1,3,5))+(255,)
OUT=c('#140f0d')
SKIN=[c('#e8b58c'),c('#c4875c'),c('#8f5a3d'),c('#5e3a2a')]
HAIR=[c('#c9c2b4'),c('#9a6a47'),c('#6b4330'),c('#3f281e')]
BEARD=[c('#ece8dc'),c('#bdb7a9'),c('#8a8479'),c('#5b564f')]
LINEN=[c('#efe6cc'),c('#cbbd9a'),c('#9b8d6e'),c('#6a5e49')]
LEATH=[c('#b47c48'),c('#8a5a33'),c('#5e3b23'),c('#3a2417')]
WOOL=[c('#7d9463'),c('#5a7049'),c('#3d5035'),c('#283525')]
CLOAK=[c('#86694a'),c('#614a35'),c('#423224'),c('#2a2018')]
FUR=[c('#d6cbb0'),c('#a99c7f'),c('#7a6f59'),c('#4f4739')]
HOSE=[c('#74717f'),c('#504e5e'),c('#33323f'),c('#201f29')]
BOOT=[c('#7a5238'),c('#553625'),c('#372218'),c('#22150f')]
IRON=[c('#dfe2e6'),c('#9ea3ab'),c('#5d626b'),c('#34373d')]
def P(x,y,col):
    if 0<=x<W and 0<=y<H: px[x,y]=col
def span(y,x0,x1,pal,lit=2,dark=2,deep=0):
    """a row: `lit` pixels of highlight on the left, `dark` of shadow on the right, `deep` of deepest shadow at the far right"""
    for x in range(x0,x1+1):
        i=x-x0; j=x1-x
        P(x,y, pal[0] if i<lit else pal[3] if j<deep else pal[2] if j<deep+dark else pal[1])
lerp=lambda a,b,t: round(a+(b-a)*t)

# ---------- cloak back panels (drawn first, body goes on top)
for y in range(22,75):
    t=(y-22)/52
    L=lerp(11,7,t); R=lerp(46,50,t)
    span(y,L,R,CLOAK,lit=2,dark=5,deep=2)
# folds in the cloak: wobbling vertical dark streaks and a light ridge
for y in range(26,74):
    t=(y-22)/52
    for fx,tone in ((lerp(14,11,t),2),(lerp(17,15,t)+(1 if (y//5)%2 else 0),3),(lerp(43,46,t),3),(lerp(40,42,t)+(1 if (y//6)%2 else 0),2)):
        P(fx,y,CLOAK[tone])
    P(lerp(12,8,t)+1,y,CLOAK[0] if y%7 else CLOAK[1])
# ragged hem
for x in range(7,51):
    if x%4==1: P(x,74,T); P(x,73,CLOAK[3])
    elif x%4==3: P(x,75,CLOAK[2])
    else: P(x,74,CLOAK[3])

# ---------- legs and boots (left foot a little forward)
for y in range(56,71): span(y,20,27,HOSE,2,2,1); span(y,30,37,HOSE,2,2,1)
for y in range(58,68,3): P(23,y,HOSE[2]); P(33,y,HOSE[2])
for y,(a,b) in zip(range(69,84),[(20,27)]*6+[(20,27),(19,27),(19,27),(18,27),(18,28),(17,28),(17,28),(17,28),(17,28)]): span(y,a,b,BOOT,2,2,1)
for y,(a,b) in zip(range(68,82),[(30,37)]*6+[(30,37),(30,38),(30,38),(30,39),(30,40),(30,40),(30,40),(30,40)]): span(y,a,b,BOOT,2,2,1)
for x in range(17,29): P(x,83,BOOT[3])
for x in range(30,41): P(x,81,BOOT[3])
for (x,y) in [(20,69),(21,69),(22,69),(30,68),(31,68),(32,68)]: P(x,y,BOOT[0])           # boot cuffs
for (x,y) in [(22,74),(23,76),(33,73),(34,75)]: P(x,y,BOOT[2])                           # creases
for y in range(58,69): P(28,y,CLOAK[3]); P(29,y,CLOAK[3])

# ---------- wool tunic skirt, to the knee
for y in range(46,57):
    t=(y-46)/10
    span(y,lerp(19,17,t),lerp(38,40,t),WOOL,2,4,1)
for y in range(48,56):
    for fx in (22,27,33):
        P(fx+(1 if y>52 else 0),y,WOOL[2] if y%4 else WOOL[3])
    if y%3==0: P(24,y,WOOL[0])
for x in range(17,41):
    P(x,57,WOOL[3] if x%3 else T)

# ---------- torso: linen shirt, leather jerkin laced at the front, broad chest
for y in range(22,47):
    span(y,16,41,LINEN,2,4,1)
for y in range(24,47):
    span(y,19,38,LEATH,4,5,1)
for y in range(24,30):                                                                    # jerkin shoulders
    span(y,17,40,LEATH,4,5,1)
for y in range(26,44,2): P(28,y,LEATH[3]); P(29,y,LEATH[0])                              # lacing
for y in range(25,45): P(28,y,LEATH[2]) if y%2 else None
for x in range(19,39): P(x,36,LEATH[2])
for x in range(19,39): P(x,30,LEATH[2]) if x%2 else None                                                  # seam
for (x,y) in [(21,27),(22,28),(21,32),(22,34),(21,39),(22,41),(23,26)]: P(x,y,LEATH[0])          # worn highlights
# belt, buckle, knife and pouch
for x in range(18,40): P(x,44,BOOT[3]); P(x,45,BOOT[1]); P(x,46,BOOT[3])
for (x,y) in [(27,43),(28,43),(29,43),(30,43),(27,47),(28,47),(29,47),(30,47),(26,44),(26,45),(26,46),(31,44),(31,45),(31,46)]: P(x,y,IRON[2])
for (x,y) in [(27,44),(28,44),(29,44),(30,44),(27,46),(30,46)]: P(x,y,IRON[1])
P(27,44,IRON[0]); P(28,45,BOOT[1]); P(29,45,BOOT[1])
for y in range(47,56): P(34,y,LEATH[3]); P(35,y,LEATH[1]); P(36,y,LEATH[3])              # knife sheath
P(35,47,IRON[1]); P(35,46,IRON[0]); P(35,56,LEATH[3])
for y in range(47,52): span(y,20,24,LEATH,1,1,1)                                         # pouch
P(22,49,IRON[1])

# ---------- arms: bare forearms, heavy hands
# viewer-left arm: out of the cloak, across to rest a fist on the belt
arm=[(26,12,17),(27,11,18),(28,11,18),(29,10,18),(30,10,18),(31,10,18),(32,10,18),(33,11,18),(34,11,18)]
for y,a,b in arm: span(y,a,b,LINEN,2,2,1)
for y,a,b in [(35,11,19),(36,12,20)]: span(y,a,b,LINEN,1,3,1)                            # rolled cuff
fore=[(37,12,20),(38,13,21),(39,14,22),(40,15,23),(41,16,24),(42,17,25)]
for y,a,b in fore: span(y,a,b,SKIN,2,2,1)
for y,a,b in [(43,18,26),(44,19,26),(45,19,26),(46,20,25)]: span(y,a,b,SKIN,2,2,1)       # fist
for x in (22,24): P(x,45,SKIN[3])
# viewer-right arm: bent, hand gripping the staff
for y,a,b in [(26,40,45),(27,39,46),(28,39,47),(29,39,47),(30,39,47),(31,39,47),(32,39,47),(33,40,47)]: span(y,a,b,LINEN,2,3,1)
for y,a,b in [(34,40,47),(35,40,48)]: span(y,a,b,LINEN,1,3,1)
for y,a,b in [(36,41,48),(37,42,49),(38,43,50),(39,44,50)]: span(y,a,b,SKIN,2,3,1)
# staff: a hedging bill, behind the hand
for y in range(4,86): P(49,y,LEATH[1]); P(50,y,LEATH[3])
for y in range(4,86,6): P(49,y,LEATH[0])
for y in range(0,9):
    for x,t in ((46,1),(49,0),(50,2),(53,1)): P(x,y,IRON[t])
for x in range(46,54): P(x,9,IRON[1]); P(x,10,IRON[2])
for x in (46,53): P(x,0,T)
for y,a,b in [(39,47,51),(40,46,51),(41,46,51),(42,46,51),(43,47,50)]: span(y,a,b,SKIN,2,1,1)   # gripping hand over the staff
for x in (47,49): P(x,42,SKIN[3])

# ---------- fur-lined mantle over the shoulders, with a brooch
for y,a,b in [(18,19,38),(19,16,41),(20,13,44),(21,11,46),(22,10,47),(23,10,47),(24,11,46)]: span(y,a,b,FUR,3,5,1)
for y,a,b in [(25,11,19),(26,11,17),(25,38,46),(26,40,46)]: span(y,a,b,FUR,2,2,1)
for x in range(11,47,2): P(x,24 if (x//2)%2 else 25,FUR[3])                               # shaggy lower edge
for (x,y) in [(15,20),(18,21),(22,20),(34,20),(38,21),(42,21),(13,22),(44,23),(26,19),(31,19)]: P(x,y,FUR[2])
for (x,y) in [(14,21),(17,20),(21,19),(25,20),(12,23)]: P(x,y,FUR[0])
for (x,y) in [(27,22),(28,21),(29,21),(30,22),(28,23),(29,23)]: P(x,y,IRON[2])
P(28,22,IRON[0]); P(29,22,IRON[1])

# ---------- head: small for the body, seen slightly from above
for y,a,b in [(5,25,32),(6,23,34),(7,22,35),(8,22,35),(9,22,35)]: span(y,a,b,HAIR[1:]+[HAIR[3]],3,3,1)
for (x,y) in [(27,5),(28,6),(26,7),(30,6),(29,8),(25,8)]: P(x,y,c('#b98058'))  # hair swept back, grey at the temples
for x in range(26,32): P(x,4,HAIR[1])
P(25,4,HAIR[0]); P(32,4,HAIR[2])
for (x,y) in [(22,8),(22,9),(23,9),(23,8),(34,9),(26,5),(25,6)]: P(x,y,HAIR[0])
for (x,y) in [(28,6),(31,7),(29,8),(33,7)]: P(x,y,HAIR[2])
for y,a,b in [(10,23,34),(11,23,34),(12,23,34),(13,23,34),(14,23,34)]: span(y,a,b,SKIN,2,2,1)
for y in (10,11,12,13,14): P(22,y,HAIR[0] if y<13 else BEARD[1]); P(35,y,HAIR[3] if y<13 else BEARD[3]); P(23,y,HAIR[1] if y<12 else SKIN[0]); P(34,y,HAIR[2] if y<12 else SKIN[3])
for x in range(24,34): P(x,10,SKIN[1])                                                    # forehead
for x in range(24,33): P(x,11,SKIN[3])                                                    # heavy brow shadow
P(28,11,SKIN[2]); P(29,11,SKIN[2])
P(26,12,OUT); P(31,12,OUT); P(25,12,SKIN[2]); P(30,12,SKIN[3])
P(24,12,SKIN[2]); P(27,12,SKIN[1]); P(28,12,SKIN[0]); P(29,12,SKIN[2]); P(32,12,SKIN[3])
P(24,13,SKIN[0]); P(25,13,SKIN[1]); P(26,13,SKIN[1]); P(27,13,SKIN[1]); P(28,13,SKIN[0]); P(29,13,SKIN[3]); P(30,13,SKIN[2]); P(31,13,SKIN[2]); P(32,13,SKIN[3])
P(27,14,SKIN[1]); P(28,14,SKIN[0]); P(29,14,SKIN[3]); P(30,14,SKIN[3])                    # nose and its shadow
# beard: full, grey, squared
for y,a,b in [(14,23,26),(14,31,34),(15,22,35),(16,22,35),(17,22,35),(18,23,34),(19,23,34),(20,24,33),(21,25,32),(22,26,31),(23,27,30)]: span(y,a,b,BEARD,3,3,1)
for x in range(26,32): P(x,15,BEARD[0])                                                   # moustache
for x in range(27,31): P(x,16,BEARD[3])                                                   # mouth shadow
for (x,y) in [(25,18),(28,19),(31,18),(27,21),(30,20),(24,17)]: P(x,y,BEARD[2])
for (x,y) in [(24,16),(25,19),(26,20)]: P(x,y,BEARD[0])

# ---------- outline: one dark pixel all round, and inside where parts overlap
src=img.copy(); s=src.load()
for y in range(H):
    for x in range(W):
        if s[x,y][3]==0 and any(0<=x+dx<W and 0<=y+dy<H and s[x+dx,y+dy][3] for dx,dy in((1,0),(-1,0),(0,1),(0,-1))): px[x,y]=OUT
inner=[ # (x0,y0,x1,y1) lines separating overlapping parts
 *[(19,y,19,y) for y in range(27,37)], *[(38,y,38,y) for y in range(27,36)],            # arms against the chest
 *[(a-1,y,a-1,y) for y,a,b in fore], *[(b+1,y,b+1,y) for y,a,b in fore],                # forearm edges
 (19,43,19,46),(27,43,27,43),(46,39,46,43),(52,40,52,42),
 *[(18,y,18,y) for y in range(47,57)], *[(39,y,39,y) for y in range(47,57)], *[(19,y,19,y) for y in range(58,69)], *[(38,y,38,y) for y in range(58,68)],            # skirt against the cloak
 (22,15,22,15),(35,15,35,15)]
for x0,y0,x1,y1 in inner:
    for y in range(y0,y1+1):
        for x in range(x0,x1+1): P(x,y,OUT)
img.save('art-target/bram.png'); img.resize((W*6,H*6),Image.NEAREST).save('art-target/bram-6x.png')

# ---------- comparison sheet on a patch of ground, with a contact shadow
k=6
def onground(sprite):
    g=Image.new('RGBA',(sprite.width+16,sprite.height+10),c('#56613f')); gp=g.load()
    import random; random.seed(4)
    for _ in range(900):
        x=random.randrange(g.width); y=random.randrange(g.height); gp[x,y]=random.choice([c('#667348'),c('#4a5537'),c('#7a8455'),c('#3f4a30'),c('#5f5540')])
    for y in range(sprite.height+1,sprite.height+6):
        for x in range(14,sprite.width+2):
            if ((x-14)/(sprite.width-12)-0.5)**2*4+((y-sprite.height-3)/3)**2<1: gp[x,y]=c('#2f3626')
    g.alpha_composite(sprite,(8,5)); return g
big=onground(img).resize(((W+16)*k,(H+10)*k),Image.NEAREST)
ref=Image.open('references/sprites-figures-closeup.jpg').convert('RGBA').crop((310,575,650,900))
scale=k/2.45
ref=ref.resize((int(ref.width*scale),int(ref.height*scale)),Image.NEAREST)
sheet=Image.new('RGBA',(ref.width+big.width+60,max(ref.height,big.height)+40),c('#20242c'))
sheet.alpha_composite(ref,(20,20)); sheet.alpha_composite(big,(ref.width+40,sheet.height-big.height-20)); sheet.save('art-target/bram-beside-reference.png')
