# The figure standard

`bram.png` (native size) and `bram-6x.png` are Bram Holt drawn pixel by pixel, and are the standard for every person in
the game. `bram-beside-reference.png` shows him beside the reference figures. `draw-bram.py` is how he was drawn (run it
from the project root with Python and Pillow): spans of pixels per row, three or four tones per material, hand-placed
folds, a one-pixel dark outline, inner outlines where parts overlap. It is an example of the method, not a library.

What makes him work, and what every figure needs: about 80 native pixels tall; a small head on a broad body; a wide
A-shaped silhouette from a heavy cloak; a readable face (brow shadow, single-pixel eyes, nose, beard); flat tones with
hard-edged shadow shapes, no gradients; a planted stance with the hands doing something.
