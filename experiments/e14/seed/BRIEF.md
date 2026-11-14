# Gloamreach: brief

Build **Gloamreach**, a dark, punishing, mythical action RPG with souls-like difficulty and MMO-style ability combat, played
alone or in a co-op party of up to four friends, seen from a locked overhead camera in a desktop browser, in a **pixel-art
style rendered from a real 3D world**: crisp pixels, a limited painterly palette and a thousand small living details. It
must look genuinely beautiful: atmospheric, detailed, well lit and alive.

It is an original game: its own world, names, characters, story and art. Do not use names, characters, places, text or
assets from any existing game.

It has two parts: a small game server (Node.js, WebSockets) that runs co-op sessions and keeps saves, and the browser client
it serves. `npm start` builds the client and starts the server; the game is then played at the address it prints, alone or
with friends who open the same address. It runs in current Chrome and Firefox at a steady 60 frames per second on an
ordinary laptop (never below 30), using npm-installable libraries as needed.

## The look

- **Pixel art from a real 3D world.** The world is a true 3D scene (terrain with height, real rigged and animated models
  for the player, enemies, trees, buildings and props, real perspective from the overhead camera), rendered at a low
  internal resolution and shown with crisp, square pixels and a limited, painterly palette, so every frame has true depth,
  light and motion and still reads as hand-made pixel art. Not a flat tile map, and not smooth modern 3D.
- **The style to match** is shown in `references/style-*.jpg` (200 frames from seven videos by another developer, used with
  permission; credits in `references/art/ART.md`; read a good spread of them): rich autumn forests in golds, rusts and deep
  greens; moody blue-grey night scenes; warm desert light; soft limited-colour shading with gentle dithering; light
  through leaves; a moving cape; footprints and shifting sand under the feet; fog that swirls and parts around the player;
  a forest pond full of tiny details (lily pads, ripples, fireflies); huge trees that turn see-through over the player
  instead of hiding them. Match that pixel density, palette discipline, lighting and density of small details, in
  Gloamreach's own world, palette and designs; do not copy that project's names, characters or content.
- **Pixel density**: one game pixel is about 3 to 4 screen pixels at the default setting (around 480 to 640 game pixels
  across a 1920-pixel window), integer-scaled with no blurring; the palette is limited per area (around 24 to 48 colours,
  chosen to fit each area's painting), with ordered dithering for gradients, fog and light.
- **Small living details everywhere**: grass and leaves that sway with the wind and bend as people pass, footprints that
  stay a while in sand, snow and mud, ripples and rings in water when anything touches it, fireflies, falling leaves,
  drifting motes, dust when landing, cloth and capes that move with movement and wind.
- **Water you can see the world in**: still water shows a rippling reflection of the player, enemies, trees and buildings,
  with lily pads and reeds; anything that touches it sends rings spreading out.
- **Monsters with glowing eyes**: hostile creatures have red (or otherwise eerie) glowing eyes that stay bright in the
  dark, and as they move the glow leaves a short fading afterglow trail behind them, so a pack moving through the gloom
  reads as streaks of red light.
- Real lighting: torches, bonfires and spells light their surroundings and flicker; soft shadows; fog and distance fade
  into atmosphere; moonlight, firelight and the glow of the depths; light through canopies.
- The player and every enemy are readable silhouettes with animation for walking, running, dodging, casting, attacking,
  staggering, blocking and dying, so a player can read an attack coming.
- **For play, not look**: `references/look-target-*` (frames from a different developer's character-drawn game, also used
  with permission) show how a party fight should play and read: a huge dragon and a giant spider with phased boss bars,
  ground telegraphs as circles, cones and rings, party frames, nameplates, the ability hotbar, death and reviving. Take the
  readability, HUD layout, telegraphs and creature scale from them, not their character-drawn rendering.
- The paintings in `references/art/` set each place's mood and palette; `references/look-*.png` are older static mock-ups
  of the HUD (health, resource, flask charges, currency, boss bar), useful for layout only.

## The camera

- A locked camera, as in top-down action games and MOBAs: it looks down on the player from a fixed, elevated angle (about
  55 degrees) and follows them smoothly. It never rotates and the player cannot move it; the mouse does not turn it.
- The view always shows enough around the player to read attacks coming, including from behind; it may pull back a little
  in boss arenas and large spaces.
- Anything between the camera and the player (walls, roofs, tree canopies) fades or turns see-through, so the player is
  never hidden; leaving a building's interior shows its roof again.

## The world's myths and travel

- **Mythical**: this is a world of old gods, curses and legends. Mythical creatures (wyrms, revenants, giants, spirits,
  things from the deep) among the enemies and bosses; relics with legends in their descriptions; shrines to dead or sleeping
  gods with covenants the player can join for rewards and lore; a story of an ancient wrong, told through places, items and
  sparse dialogue, with more than one ending decided by the player's choices.
- **Ships between areas**: the areas on the water (the lake and isle, the grey shore, the ruined city by the water, the
  fortress gorge) are linked by ships. Docks with a ferryman or captain; boarding a ship and sailing across in real time on
  open water with waves, wind in the sails and the coast passing by (the player can walk the deck); sometimes ambushed at sea.
  Routes open as the player finds docks and pays for passage; some are one-way until unlocked.
- **The Gloaming Fair**: a travelling dark carnival that sets up in the world on a schedule (for example every few in-game
  nights, announced by lanterns and a barker on the road), with striped tents lit by lanterns, a ringmaster, a fortune teller
  who reads omens, carnival games of skill that award tickets (a shooting gallery, a strength test, a creature-taming pen, a
  bell-ringing game), a ticket exchange with unique trinkets, cosmetics and a pet, food stalls, a creaky ride, and its own
  music. Eerie rather than jolly. It packs up and moves on, and the player can find out when and where it will be next. Its
  own design and names: not a copy of any existing game's fair.

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

- **Controls**, rebindable, with a gamepad supported throughout (Gamepad API):
  - Keyboard and mouse: WASD move (relative to the screen: W is up); the mouse cursor aims ground-targeted and directional
    abilities and shows a crosshair; left click selects a target (Tab cycles nearby enemies, F1-F4 select party members);
    **1 to 0 use the ten abilities on the hotbar**; Space dodges in the movement direction (with brief invulnerability and a
    cooldown); Shift sprints; E interacts (doors, levers, items, checkpoints, docks); R drinks the healing flask; Esc menu.
  - Gamepad: left stick move, right stick aims, face buttons and shoulders for the hotbar (with a modifier for the second
    half), a button to dodge, d-pad to cycle targets.
- **Combat**, ability-based, as in MMO games, and punishing, as the souls-likes are:
  - Each class has a hotbar of abilities unlocked as it levels (at least ten per class): instant strikes, cast-time spells
    with a visible cast bar that moving or being hit can interrupt, channels, ground-targeted areas, heals, shields, buffs,
    crowd control, and an ultimate, each with a cooldown and a resource (health plus mana, rage or focus by class), and a
    global cooldown between abilities.
  - Party roles: classes lean towards tanking, healing or dealing damage; enemies have threat, so a tank can hold their
    attention; a healer keeps the party alive; a party plays very differently from one player alone.
  - Deadly, readable attacks: enemies and bosses telegraph big attacks on the ground (dotted circles, cones, lines and rings
    of light that fill as the strike approaches), and standing in them hurts or kills. Every attack is readable and
    avoidable; deaths should feel like the player's mistake. Enemies hit hard, fight in groups and use the terrain. No
    difficulty setting; enemy health and damage scale with the number of players in the party.
- **Death and recovery**: in a party, a fallen player can be revived by another (a short channel next to them) or release
  to the last checkpoint; alone, or when the whole party falls, the player returns to the last checkpoint with the currency
  they carried left where they fell, recoverable only by reaching it without dying again. An original death message, not
  one from another game.
- **Checkpoints**: resting at one heals the player, refills the healing flask (limited charges, upgradable), respawns ordinary
  enemies, and is where the player levels up. Checkpoints can be travelled between once enough are found.
- **Character**: a class choice at the start (at least four, covering tank, healer and damage roles between them), levels
  that unlock abilities and raise attributes (at least six), and talents or attribute points to spend so two characters of
  one class can play differently.
- **Gear**: weapons, off-hands and armour with stats and rarities that change how abilities perform and how the character
  looks, at least ten weapon kinds, at least five armour sets per armour type, rings and trinkets with effects, upgrades with
  materials at a blacksmith, and loot dropped by enemies and bosses (shared fairly in a party).
- **The world**: one interconnected world, not levels: at least seven areas that loop back on themselves with locked doors,
  shortcuts opened from the far side, ladders, lifts and secrets (illusory walls, hidden paths). Each area takes its mood
  from a painting in `references/art/`:
  - a graveyard and ruined abbey among dead oaks (`abbey.jpg`), where the game begins;
  - a lake with a walled isle of tombs and cypresses, reached by boat or a hidden causeway (`isle.jpg`);
  - a grey, empty shore under a vast sky (`monk.jpg`);
  - fog-filled crags and peaks above a sea of mist (`wanderer.jpg`);
  - a fortress on cliffs over a roaring gorge and waterfall (`fortress.jpg`);
  - a ruined classical city by moonlit water (`ruins.jpg`);
  - the open water between them, crossed by ship;
  - the molten depths below everything, a vast burning hall (`depths.jpg`).
- **Enemies and bosses**: at least fourteen enemy kinds with their own abilities, including a few mini-bosses; at least five
  major bosses, huge creatures (a dragon and a giant spider among them), each in its own arena with a fog-wall-style
  entrance, a health bar along the top with its name and current phase ("phase 2"), three or more phases that change its
  attacks, ground telegraphs to learn, and a reward. A final boss ends the game; reaching it should take hours for a first
  player.
- **People and story**: at least six non-player characters with dialogue, some with small quest lines; a merchant and a
  blacksmith; the story told mostly through item descriptions, places and sparse dialogue.

## Playing with friends

- **Co-op parties of up to four**: one player hosts their world and friends join from the same address with a short invite
  code; everyone sees the same world, enemies and bosses in real time, with the server as the authority for positions,
  health, damage and loot (it rejects impossible moves and cooldowns). Joining and leaving mid-session works without breaking
  the host's world.
- **The party in view**: names above every player's head; party frames on the left (each member's pixel-art portrait, health, resource, level, and greyed out when down); party chat and quick pings on the ground; the target frame
  shows the target's target.
- **Progress**: each player keeps their own character, level and gear; bosses and story progress belong to the host's world,
  with rewards for everyone who took part.
- Alone, the whole game is playable with no one else connected.

## Everything around the play

- Title screen (new game, continue, join a friend, settings, credits), character creation with a live preview of the character, pause menu,
  inventory and equipment screens, level-up screen, map of found checkpoints, item descriptions.
- Settings: graphics (pixel scale / resolution, effects quality, view distance), camera zoom level,
  key bindings and gamepad bindings, audio volumes (master, music, effects), reduced camera shake. Settings persist.
- Saving: the game saves continuously (position, inventory, flags, opened shortcuts, bosses beaten) on the server, and
  continues after a reload or a server restart. Several save slots.
- HUD: player and target frames, party frames, the ability hotbar (1 to 0) with cooldown sweeps, cast bars, a boss bar along
  the top with name and phase, floating damage numbers, and the minimap.
- Sound: footsteps by surface, weapon swings and impacts, wind, rain, water, fire, enemy sounds, boss music; generated with
  the Web Audio API if there are no audio files.

## Done means

The game can be played from character creation through all seven areas and five bosses to an ending, alone and as a party
of up to four in separate browser tabs, sailing between the water areas and visiting the Gloaming Fair along the way, with
every control and system above working; the world is a 3D
scene rendered as pixel art that matches the style references, with the grass, wind, water reflections and weather visibly alive; no
errors in the browser console during normal play; and a steady frame rate.
