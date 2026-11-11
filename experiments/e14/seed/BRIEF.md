# Gloamreach: brief

Build **Gloamreach**, a dark, punishing action RPG in the souls-like tradition, seen from a locked overhead camera and played in a desktop browser, where
**everything on screen is drawn with small text characters**: the ground, grass, trees and their leaves, water, stone walls,
buildings, fog, fire, the player, the enemies, the bosses and the interface. It must be obvious at a glance that the world is
made of characters, and it must also look genuinely beautiful: atmospheric, detailed, well lit and alive.

It is an original game: its own world, names, characters, story and art. Do not use names, characters, places, text or
assets from any existing game.

It runs from a static build (`npm run build` produces a folder any static server can serve; `npm start` builds and serves it),
in current Chrome and Firefox, at a steady 60 frames per second on an ordinary laptop (never below 30), using npm-installable
libraries as needed.

## The look

- The whole frame is a fine grid of coloured characters: at least 240 columns across a 1920-pixel-wide window, more on
  higher settings. Characters carry colour (and may carry a tinted background), so the picture has real colour, light and
  shade, not green-on-black.
- Materials read through the choice of characters as well as colour: grass, leaves, bark, water, stone, wood, cloth, metal,
  bone, flame and fog each have their own character vocabulary, and surfaces show detail (moss on stone, cracks, ripples).
- Real lighting: torches, bonfires and spells light their surroundings and flicker; shadows; fog and distance fade into
  atmosphere; day-less gloom with moonlight, firelight and the glow of the depths.
- The player and every enemy are readable silhouettes made of characters, with animation for walking, running, rolling,
  attacking, staggering, blocking and dying, so a player can read an attack coming.
- The art in `references/art/` sets each place's mood and palette; `references/look-*.png` are rough static mock-ups of the
  character-grid style and the HUD (health, stamina, flask charges, currency, boss bar). The game should look better than
  the mock-ups, and moving.

## The camera

- A locked camera, as in top-down action games and MOBAs: it looks down on the player from a fixed, elevated angle (about
  55 degrees) and follows them smoothly. It never rotates and the player cannot move it; the mouse does not turn it.
- The view always shows enough around the player to read attacks coming, including from behind; it may pull back a little
  in boss arenas and large spaces.
- Anything between the camera and the player (walls, roofs, tree canopies) fades or turns see-through, so the player is
  never hidden; leaving a building's interior shows its roof again.

## A world that moves

- **Wind**: a wind that changes in strength and direction over time and by place. Grass bends and ripples in waves as gusts
  pass, trees sway, leaves shiver and are torn off and blown along, banners and cloth flap, fog and smoke drift with it,
  embers and ash stream from fires. The player's movement and attacks disturb grass and leaves too.
- **Water**: lakes, rivers and a waterfall. Water ripples where rain, the player, enemies and thrown things touch it; rivers
  flow and carry floating debris; the waterfall falls, sprays and mists; waves lap at shores; water reflects light and the
  world above it. Wading slows the player; deep water is deadly or swum through.
- **Weather and air**: rain, drizzle, drifting mist, falling ash in the depths; light through mist and smoke.
- **Physical things**: barrels, crates, pots and furniture can be knocked over and broken; bodies fall and slide on slopes;
  thrown objects arc and bounce.

## Play

- **Controls**, the genre's standard layout, rebindable, with a gamepad supported throughout (Gamepad API):
  - Keyboard and mouse: WASD move (relative to the screen: W is up), the mouse cursor aims (the character turns to face it when
    attacking, blocking, casting and shooting), Space tapped rolls / dodges in the movement direction and held sprints, left mouse light
    attack, Shift + left mouse heavy attack, right mouse block (hold), Ctrl parry (with a shield or parrying tool), Q lock on
    to a target, which then sets the facing instead of the cursor (mouse wheel or Q again switches target), E interact (doors, levers, items, checkpoints), R use the equipped
    item (the healing flask by default), 1-4 switch right weapon / left hand / item / spell, F two-hand the weapon, Esc menu.
  - Gamepad: left stick move, right stick aims (facing), right shoulder light attack, right trigger heavy, left shoulder block,
    left trigger parry, face buttons roll/sprint, interact, use item and two-hand, right stick click lock-on, d-pad to switch.
- **Combat**, deliberate and punishing, as the genre is known for: a stamina bar that every attack, roll, block and sprint
  drains; rolls with invincibility frames and a recovery; poise and stagger; backstabs and ripostes after a parry; weight
  (equipment load) that changes roll speed; attacks that commit the player to their animation; enemies that hit hard,
  punish greed, fight in groups and use the terrain. No difficulty setting. Hard but fair: every attack is readable and
  avoidable, and deaths should feel like the player's mistake.
- **Death and recovery**: dying returns the player to the last checkpoint with the currency they carried left where they
  fell, recoverable only by reaching it without dying again. An original death message, not one from another game.
- **Checkpoints**: resting at one heals the player, refills the healing flask (limited charges, upgradable), respawns ordinary
  enemies, and is where the player levels up. Checkpoints can be travelled between once enough are found.
- **Character**: a class choice at the start (at least four), levelling by spending the currency on attributes (at least
  six: vitality, endurance, strength, dexterity, attunement for spells, faith or intelligence for scaling), equipment
  load, and stat scaling on weapons.
- **Gear**: at least ten weapons with distinct movesets (straight sword, greatsword, dagger, spear, axe, hammer, curved
  sword, halberd, bow, catalyst for spells), shields, at least five armour sets, rings with effects, upgrades with materials
  at a blacksmith, and at least eight spells or miracles.
- **The world**: one interconnected world, not levels: at least seven areas that loop back on themselves with locked doors,
  shortcuts opened from the far side, ladders, lifts and secrets (illusory walls, hidden paths). Each area takes its mood
  from a painting in `references/art/`:
  - a graveyard and ruined abbey among dead oaks (`abbey.jpg`), where the game begins;
  - a lake with a walled isle of tombs and cypresses, reached by boat or a hidden causeway (`isle.jpg`);
  - a grey, empty shore under a vast sky (`monk.jpg`);
  - fog-filled crags and peaks above a sea of mist (`wanderer.jpg`);
  - a fortress on cliffs over a roaring gorge and waterfall (`fortress.jpg`);
  - a ruined classical city by moonlit water (`ruins.jpg`);
  - the molten depths below everything, a vast burning hall (`depths.jpg`).
- **Enemies and bosses**: at least fourteen enemy kinds with their own movesets, including a few mini-bosses; at least five
  major bosses, each in its own arena with a fog-wall-style entrance, a health bar with its name, two or more phases,
  telegraphed attack patterns to learn, and a reward. A final boss ends the game; reaching it should take hours for a first
  player.
- **People and story**: at least six non-player characters with dialogue, some with small quest lines; a merchant and a
  blacksmith; the story told mostly through item descriptions, places and sparse dialogue.

## Everything around the play

- Title screen (new game, continue, settings, credits), character creation with a character-drawn preview, pause menu,
  inventory and equipment screens, level-up screen, map of found checkpoints, item descriptions.
- Settings: graphics (character density / resolution, effects quality, view distance), camera zoom level,
  key bindings and gamepad bindings, audio volumes (master, music, effects), reduced camera shake. Settings persist.
- Saving: the game saves continuously (position, inventory, flags, opened shortcuts, bosses beaten) and continues after a
  reload. Several save slots.
- Sound: footsteps by surface, weapon swings and impacts, wind, rain, water, fire, enemy sounds, boss music; generated with
  the Web Audio API if there are no audio files.

## Done means

The game can be played from character creation through all seven areas and five bosses to the end, with every control and
system above working, the wind, water and weather visibly alive, the whole world drawn in characters and looking good,
no errors in the browser console during normal play, and a steady frame rate.
