from PIL import Image
import colorsys, random, math
def hsv(c): return colorsys.rgb_to_hsv(c[0]/255,c[1]/255,c[2]/255)
def kind(c):
    if c[3]==0: return None
    h,s,v=hsv(c)
    if v<0.14: return 'out'
    if (h<0.03 or h>0.96) and s>0.35: return 'red'
    if s<0.2 and v>0.62: return 'cream'
    if 0.08<h<0.2 and s<0.4 and v>0.55: return 'cream'
    if s<0.22: return 'steel'
    if 0.5<h<0.75 and s<0.4: return 'steel'
    if 0.02<=h<0.12 and s>0.3: return 'brown'
    return 'other'
def outline(im):
    px=im.load(); W,H=im.size; s=im.copy().load()
    for y in range(H):
        for x in range(W):
            if s[x,y][3] and any(not(0<=x+dx<W and 0<=y+dy<H) or s[x+dx,y+dy][3]==0 for dx,dy in((1,0),(-1,0),(0,1),(0,-1))): px[x,y]=(23,17,15,255)
    return im
def ravage(src,seed,front):
    r=src.copy(); px=r.load(); random.seed(seed); W,H=r.size
    for y in range(H):
        for x in range(W):
            c=px[x,y]; k=kind(c)
            if k=='red': h,s_,v=hsv(c); q=colorsys.hsv_to_rgb(0.02,s_*0.72,v*0.8); px[x,y]=tuple(round(t*255) for t in q)+(255,)
            elif k=='cream': px[x,y]=(round(c[0]*0.8),round(c[1]*0.76),round(c[2]*0.68),255)
    ys=[y for y in range(H) for x in range(W) if px[x,y][3]]; top,bot=min(ys),max(ys)
    # torn hems: bite ragged notches out of the bottom of surcoat and cloak
    for x in range(W):
        col=[y for y in range(H) if px[x,y][3] and kind(px[x,y]) in ('red','cream')]
        if not col: continue
        low=max(col)
        if low<bot-22: continue
        bite=random.choice((0,0,1,2,3,5)) if x%3 else random.choice((2,4,6))
        for y in range(low-bite+1,low+2):
            if 0<=y<H and kind(px[x,y]) in ('red','cream','out'): 
                below=[kind(px[x,yy]) for yy in range(y+1,min(H,y+4)) if px[x,yy][3]]
                if 'brown' not in below and 'steel' not in below: px[x,y]=(0,0,0,0)
    # a long tear in the cloak, and a crude stitched repair across the surcoat
    reds=[(x,y) for y in range(H) for x in range(W) if kind(px[x,y])=='red' and top+40<y<bot-16]
    if reds:
        x0=min(p_[0] for p_ in reds)+2; x1=max(p_[0] for p_ in reds)-2; ym=(top+bot)//2+8
        for i,x in enumerate(range(x0,x1+1)):
            y=ym+round((x-x0)*0.45)
            if kind(px[x,y])=='red':
                px[x,y]=(40,18,16,255)
                if i%3==0:
                    for dy in (-1,1):
                        if kind(px[x,y+dy])=='red': px[x,y+dy]=(196,186,160,255)
    # dents, pits and rust on the plate
    steel=[(x,y) for y in range(H) for x in range(W) if kind(px[x,y])=='steel']
    for (x,y) in random.sample(steel,len(steel)//5): px[x,y]=random.choice([(52,44,40,255),(110,61,37,255),(138,82,48,255),(40,42,48,255)])
    for _ in range(7):
        x,y=random.choice(steel)
        for dx,dy in ((0,0),(1,0),(0,1),(1,1)):
            if 0<=x+dx<W and 0<=y+dy<H and kind(px[x+dx,y+dy])=='steel': px[x+dx,y+dy]=(34,30,30,255) if dx+dy<2 else (120,66,40,255)
    # mud to the knees, stains higher up
    for y in range(bot-30,bot+1):
        for x in range(W):
            if px[x,y][3] and kind(px[x,y])!='out' and random.random()<(y-(bot-30))/30*0.75: px[x,y]=random.choice([(106,90,64,255),(77,65,48,255),(53,44,33,255)])
    for _ in range(60):
        x=random.randrange(W); y=random.randrange(top+20,bot-25)
        if kind(px[x,y]) in ('red','cream'): px[x,y]=tuple(round(q*0.7) for q in px[x,y][:3])+(255,)
    
    if front:
        # the face: a longer, wilder beard and two pale scars
        head=[(x,y) for y in range(top,top+16) for x in range(W) if px[x,y][3]]
        hx=sorted(p_[0] for p_ in head); cx=hx[len(hx)//2]
        for dx,dy in ((-2,15),(-1,16),(0,16),(1,16),(2,15),(0,17),(-3,13),(3,13),(-1,17)):
            x,y=cx+dx,top+dy
            if 0<=y<H and px[x,y][3]: px[x,y]=(34,31,36,255)
        for dx,dy in ((2,5),(2,6),(3,7),(-3,8),(-2,9)):
            x,y=cx+dx,top+dy
            if px[x,y][3] and kind(px[x,y])!='out': px[x,y]=(226,196,176,255)
        
    return outline(r)
