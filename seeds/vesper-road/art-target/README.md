# The character standard

These figures are the standard for every person in the game. They were made with PixelLab from text descriptions, then
finished by hand. Match them: size, palette, flat matte finish, dark outline, grit.

| File | What it is |
|---|---|
| `knight/proud-<direction>.png` | Tobin at about 20, newly knighted: all 8 directions, 64x96, one character |
| `knight/worn-<direction>.png` | The same knight after the war, all 8 directions |
| `knight/walk-east-0..8.png`, `walk-east.gif` | His walk, east-facing (west is the mirror) |
| `knight/*-4x.png` | The sheets above enlarged, for looking at |
| `bram.png` | Bram Holt, his father: an old warrior turned farmhand, black hair going grey |
| `tobin-11-draft.png` | The boy: a draft only. The clothes are right, the face is too soft and must be redone |
| `tools/pixellab.py` | The helper that makes a front view, the 8 directions and a walk |
| `tools/wear.py` | `ravage(image, seed, front)`: the hand-edit that turns a proud figure into a war-worn one |

## Who gets which method

- **PixelLab, for the people the player looks at for hours** (about a dozen): Tobin at 11, 15, 19 and as a knight (proud
  and worn), Bram, Hesper Vane, the three claimants, the four powers of the seasons.
- **Everyone else** (villagers, soldiers, animals, crowds): drawn pixel by pixel in code to the same palette, size and
  outline, or recoloured and re-dressed from the PixelLab figures. Try https://github.com/SirLichDevCraft/PixelHand
  for this (research it first; it is unproven here). Buildings, trees and ground stay in Blender.
- Never upload the images in `references/` to PixelLab or any generator: they are another artist's work, here as a
  style guide for your eyes only. Describe the style in words.

## The recipe that worked (after many that did not)

1. **Front view**: `tools/pixellab.py front out.png "<description>" --palette art-target/knight/proud-south.png`
   - 64x96 for an adult (a figure about 80 px tall), 48x64 for a child. Larger comes out smooth and polished: wrong.
   - Always pass a palette: it is what keeps colours muted and stops shiny highlights. No near-white in it.
   - Describe the build plainly: "tall, lean, powerfully built, broad shoulders, narrow waist, long legs". Without
     this, armoured men come out fat. Say "long plain surcoat" so there are calm areas of cloth.
   - Say the age and the face: "a hard weathered man of thirty", "short black beard". Without it they come out as
     anime youths. Children come out cute whatever is said: fix the face by hand.
   - It will not draw a requested emblem (it draws a cross). Paint emblems on by hand afterwards.
   - Expect to try two or three seeds. Keep the best and stop.
2. **Hand fixes on the front view** before anything else: hair colour, emblem, stray specks. They carry into every
   direction.
3. **8 directions**: `tools/pixellab.py rotate front.png prefix "<short description>"`. One generation for all eight,
   and they match. Do not use the older single-image rotate or generate side views separately: they drift.
4. **Walk and other animations**: `tools/pixellab.py walk prefix-east.png walk-east`. One generation per direction.
   Animate east, north-east, north, south-east and south; mirror them for the other three.
5. **States of the same person** (proud, war-worn; a clean tunic, a patched one): edit by hand with `tools/wear.py`
   applied to every direction and frame, never by regenerating, so the person stays the same.
6. Check hair colour in every direction after rotating (it drifted brown in two views of the knight) and recolour.

## The story the clothes tell

- **As a boy**: threadbare homespun, patched and mended with care. Poor, never neglected.
- **When he first wears armour**: he looks after it and is proud. Clean cloth, even hems, unmarked plate.
- **After the war**: faded, torn, crudely stitched, pitted and rusted, mud to the knees. He stops looking after it.
- **Colours**: his surcoat is a dull red with one white wavy line across the chest (the river he was born on); a
  cream cloak with a pale fur collar; dark iron. Black hair, like his father's before it went grey.

## Spending

Every PixelLab call spends the owner's generations. Before each batch run `tools/pixellab.py balance`; keep a running
list in PIXELLAB-LOG.md of what each generation was for; if fewer than 20 remain, stop and tell the owner. A full
key character costs about 3 (front attempts) + 1 (directions) + 5 per animation.
