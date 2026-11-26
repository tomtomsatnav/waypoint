# Lantern Drop: a small catching game

A short, cheerful arcade game in the browser. Glowing lanterns drift down from the night sky; the player slides a little
basket left and right along the ground to catch them. Each catch scores a point; each lantern that reaches the ground
costs one of three lives. Lanterns come faster as the score rises. It should feel smooth and responsive, with a clear
title screen, score and lives on screen, a pause, a game-over screen with the final and best score, and a quick restart.

- Controls: Left/Right arrows or A/D move; Space or Enter starts from the title screen; P pauses and resumes; R restarts
  after game over.
- The basket never leaves the screen. The best score is kept between visits.

## Interface (for automated testing; keep these exactly)

Plain static files: `index.html` at the repository root (or in `dist/` after `npm run build`), served by any static web
server. The page exposes `window.game` with:
- `game.state()` returns `{ status, score, lives, best, playerX }`, where status is `"title"`, `"playing"`, `"paused"` or
  `"over"`, and playerX is the basket's centre in game pixels (0 at the left edge, `game.width` at the right).
- `game.width`: the play area's width in game pixels.
- `game.spawnLantern(x)`: drops one lantern from the top at x (used by tests; normal play spawns its own).
- `game.setAutoSpawn(on)`: turns the game's own spawning on or off (tests turn it off).

## Done means

Someone can open it, play a few rounds with the keyboard, and want one more go.
