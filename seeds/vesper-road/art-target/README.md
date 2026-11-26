# The figure standard

`bram.png` (native size) and `bram-6x.png` are Bram Holt drawn pixel by pixel, and are the standard for every person in
the game. `bram-beside-reference.png` shows him beside the reference figures. `draw-bram.py` is how he was drawn (run it
from the project root with Python and Pillow): spans of pixels per row, three or four tones per material, hand-placed
folds, a one-pixel dark outline, inner outlines where parts overlap. It is an example of the method, not a library.

What makes him work, and what every figure needs: about 80 native pixels tall; a small head on a broad body; a wide
A-shaped silhouette from a heavy cloak; a readable face (brow shadow, single-pixel eyes, nose, beard); flat tones with
hard-edged shadow shapes, no gradients; a planted stance with the hands doing something.

He is also deliberately **rugged**, and so is everyone in this county who works or fights: weathered skin, a scar, an
unkempt beard, patched and torn cloth, mud up from the hem and on the boots, scuffed leather, mismatched mended gear,
and one or two things that tell his past (a battered pauldron, an old sword-belt strap). Nobody looks freshly
laundered. Wear is drawn on after the clean figure, as the last section of the script shows; keep it readable, not
noisy.

`tobin-ages-6x.png` is the row that matters most to the story: Bram, then Tobin at 11, 15, 19 and 24 on one ground
line (`tobin-11.png` to `tobin-24.png` are the sprites). At 11 he reaches his father's chest, slight, bare-legged, a
sling in his hand. At 15 he is all length: a staff taller than he is, an apprentice's cape, a satchel. At 19 he has his
father's frame but not yet his width or his wear. At 24 he is a knight, built like Bram and a little taller: full plate (layered
pauldrons, gorget, vambraces and gauntlets, greaves and sabatons, mail at the thigh), a blue surcoat with his own
device, a white river, a heavy cream cloak edged in blue and gilt, and Bram's sword point-down under his gauntlet.
The plate is dented and rusting at the edges and the cloak is muddy and cut: a knight who has been on the road, not on
parade (`tobin-24-beside-reference.png`). The device is this game's own; do not use the reference's cross. The 19 and 24 figures were made from
Bram's own drawing, which is why the likeness holds; the 11 and 15 figures are simpler drafts and should be redrawn to
Bram's level of finish.


## What makes a figure read as a grown man (measured from the reference)

`draw-knight.py` drew Tobin at 24 from measurements of the reference figures, after an earlier knight looked childish.
The differences that mattered, for every adult:
- A **narrow, long head**: about 11 px wide and 17 tall with the beard, never a wide round one.
- **Eyes in shadow**: a dark brow band and sockets with a single dark pixel each. Never pale eye dots on a flat face.
- **Face planes**: lit forehead and cheek on one side, shadowed on the other, a nose with a shadow beside it.
- A **thick neck** (mail coif, collar, beard) so the head sits in the shoulders.
- **Shoulders about 2.6 head-widths**, no wider: huge pauldrons look like a toy.
- A **long garment** (surcoat or tunic to below the knee) so the legs are short and only boots or greaves show.
- **Long arms**, hands at mid-thigh, doing something (a hand on the hilt).
- **Dark, muted colour**: gunmetal plate with few highlights, not bright silver; dull cloth.
- A cloak falling in an **A to the ankle**.
