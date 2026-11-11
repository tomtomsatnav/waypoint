"""Render a painting as dense, coloured ASCII: the target look for E14's references.
Each cell picks a glyph from its brightness, or an edge glyph (/ \\ | - _) where the image has a strong edge, and takes
the cell's average colour, lifted a little so dark scenes stay readable. Optional HUD overlay drawn in ASCII.
Usage: python3 -I asciify.py <in.jpg> <out.png> <columns> [hud]"""
import sys, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

src, out, cols = sys.argv[1], sys.argv[2], int(sys.argv[3])
hud = len(sys.argv) > 4
FONT = '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf'
font = ImageFont.truetype(FONT, 12)
cw = font.getbbox('M')[2]; ch = 15
RAMP = " .'`,:;-~=+*^!ivlrcxtfjyzunoaeszwkhbdpqgXYUJCLQ0OZmMW#%&8@"

img = Image.open(src).convert('RGB')
rows = int(img.height / img.width * cols * cw / ch)
small = img.resize((cols, rows), Image.LANCZOS)
gray = small.convert('L')
gx = gray.filter(ImageFilter.Kernel((3, 3), [-1, 0, 1, -2, 0, 2, -1, 0, 1], 1, 128))
gy = gray.filter(ImageFilter.Kernel((3, 3), [-1, -2, -1, 0, 0, 0, 1, 2, 1], 1, 128))
P, G, X, Y = small.load(), gray.load(), gx.load(), gy.load()

canvas = Image.new('RGB', (cols * cw, rows * ch), (6, 6, 8))
d = ImageDraw.Draw(canvas)
for y in range(rows):
    for x in range(cols):
        r, g, b = P[x, y]
        lum = G[x, y] / 255
        ex, ey = X[x, y] - 128, Y[x, y] - 128
        mag = math.hypot(ex, ey)
        if mag > 115 and lum > 0.12:  # strong edge: a glyph along it
            ang = (math.degrees(math.atan2(ey, ex)) + 180) % 180
            glyph = '|' if ang < 22 or ang >= 158 else '/' if ang < 67 else '_' if ang < 112 else '\\'
        else:
            glyph = RAMP[min(len(RAMP) - 1, int(lum ** 0.8 * (len(RAMP) - 1)))]
        col = tuple(min(255, int(255 * (c / 255) ** 0.62 * 1.12 + 6)) for c in (r, g, b))
        bg = tuple(int(c * 0.30) for c in (r, g, b))  # a dark tint of the cell's colour behind the glyph
        d.rectangle([x * cw, y * ch, (x + 1) * cw - 1, (y + 1) * ch - 1], fill=bg)
        d.text((x * cw, y * ch), glyph, font=font, fill=col)

if hud:  # a souls-like HUD drawn in ASCII: health, stamina, flask charges, souls, a boss bar
    def text(x, y, s, c): d.text((x * cw, y * ch), s, font=font, fill=c)
    def bar(x, y, n, full, c):
        text(x, y, '[' + '█' * full + '·' * (n - full) + ']', c)
    d.rectangle([0, 0, 46 * cw, 4 * ch], fill=(6, 6, 8))
    bar(1, 1, 40, 31, (200, 40, 40)); bar(1, 2, 32, 25, (70, 170, 70))
    text(1, 3, '¤ flask x3      ~ wind: NW, rising', (215, 170, 80))
    d.rectangle([cols * cw - 22 * cw, rows * ch - 2 * ch, cols * cw, rows * ch], fill=(6, 6, 8))
    text(cols - 20, rows - 2, 'embers  12 480', (230, 220, 200))
    bx = cols // 2 - 31
    d.rectangle([bx * cw, rows * ch - 4 * ch, (bx + 64) * cw, rows * ch - 1 * ch], fill=(6, 6, 8))
    text(bx + 1, rows - 4, 'THE HOLLOW WARDEN', (220, 210, 190))
    bar(bx, rows - 3, 60, 44, (170, 30, 30))
canvas.save(out)
print(out, canvas.size, f'{cols}x{rows} cells')
