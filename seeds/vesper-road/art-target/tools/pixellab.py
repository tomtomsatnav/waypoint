#!/usr/bin/env python3
"""PixelLab helper for key characters. Needs the environment variable PIXELLAB_API_TOKEN (never write it to a file).
  pixellab.py balance
  pixellab.py front  <out.png> "<who they are and what they wear>" [--seed N] [--size 64x96] [--palette palette.png]
  pixellab.py rotate <front.png> <out-prefix> "<short description>"      -> 8 directions, 1 generation
  pixellab.py walk   <direction.png> <out-prefix> ["<action>"] [--frames 8]  -> one direction of an animation, 1 generation
Every call spends generations from the owner's plan: check `balance` first and log what you spend in PIXELLAB-LOG.md."""
import sys, os, json, base64, io, time, urllib.request
from PIL import Image
TOKEN = os.environ.get('PIXELLAB_API_TOKEN') or sys.exit('set PIXELLAB_API_TOKEN')
STYLE = ("gritty low-resolution 16-bit pixel art sprite, chunky pixels, flat matte colours, dull unpolished metal with no shine "
         "and no highlights, no sparkle, overcast flat lighting, limited muted palette, large plain areas of cloth, dark outline, "
         "full body standing upright, seen slightly from above, facing the viewer, realistic western medieval proportions, "
         "not anime, not cute, 1990s dark medieval strategy game sprite")
DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']  # order rotate returns
def b64(img):
    b = io.BytesIO(); img.save(b, 'PNG'); return {"type": "base64", "base64": base64.b64encode(b.getvalue()).decode()}
def unb64(d): return Image.open(io.BytesIO(base64.b64decode(d['base64']))).convert('RGBA')
def req(ver, path, body=None):
    r = urllib.request.Request(f'https://api.pixellab.ai/{ver}{path}', data=json.dumps(body).encode() if body is not None else None,
                               headers={'Authorization': f'Bearer {TOKEN}', 'content-type': 'application/json'})
    try: return json.load(urllib.request.urlopen(r, timeout=240))
    except urllib.error.HTTPError as e: sys.exit(f'PixelLab said {e.code}: {e.read()[:400].decode(errors="replace")}')
def wait(job):
    for _ in range(180):
        time.sleep(5); j = req('v2', '/background-jobs/' + job)
        if j.get('status') in ('completed', 'failed', 'error'): return j
    sys.exit('PixelLab job did not finish')
def opt(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
def swatch(path):
    """A palette image: the 64 commonest colours of a sprite (or the file itself if it is already a swatch)."""
    im = Image.open(path).convert('RGBA'); cols = [c for n, c in sorted(im.getcolors(99999), reverse=True) if c[3]][:64]
    sw = Image.new('RGBA', (8, 8)); [sw.putpixel((i % 8, i // 8), c) for i, c in enumerate(cols)]; return sw.resize((64, 64), Image.NEAREST)
cmd = sys.argv[1] if len(sys.argv) > 1 else 'help'
if cmd == 'balance': print(json.dumps(req('v2', '/balance')['subscription']))
elif cmd == 'front':
    out, desc = sys.argv[2], sys.argv[3]; w, h = map(int, opt('--size', '64x96').split('x'))
    body = dict(description=f'{desc}, {STYLE}', image_size={"width": w, "height": h}, no_background=True, outline="single color black outline",
                shading="basic shading", detail="medium detail", view="low top-down", direction="south", text_guidance_scale=9, seed=int(opt('--seed', 31)))
    if opt('--palette'): body['color_image'] = b64(swatch(opt('--palette')))
    unb64(req('v1', '/generate-image-pixflux', body)['image']).save(out); print('wrote', out)
elif cmd == 'rotate':
    src, prefix, desc = sys.argv[2], sys.argv[3], sys.argv[4]
    j = wait(req('v2', '/generate-8-rotations-v3', dict(first_frame=b64(Image.open(src).convert('RGBA')), first_frame_direction='south',
                                                    no_background=True, description=desc, seed=int(opt('--seed', 7))))['background_job_id'])
    for name, im in zip(DIRS, j['last_response']['images']): unb64(im).save(f'{prefix}-{name}.png')
    print('wrote', prefix, DIRS)
elif cmd == 'walk':
    src, prefix = sys.argv[2], sys.argv[3]
    action = sys.argv[4] if len(sys.argv) > 4 and not sys.argv[4].startswith('--') else 'walking forward at a steady march, long strides, legs clearly stepping, arms swinging slightly, cloak swaying behind'
    j = wait(req('v2', '/animate-with-text-v3', dict(first_frame=b64(Image.open(src).convert('RGBA')), action=action,
                                                 frame_count=int(opt('--frames', 8)), no_background=True, seed=int(opt('--seed', 5))))['background_job_id'])
    for i, im in enumerate(j['last_response']['images']): unb64(im).save(f'{prefix}-{i}.png')
    print('wrote', len(j['last_response']['images']), 'frames')
else: print(__doc__)
