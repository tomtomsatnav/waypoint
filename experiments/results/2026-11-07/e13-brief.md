# Emberfall: brief

Build **Emberfall**, a browser MMORPG: many players share one persistent world, fight, quest, trade and group up, in real time.
It has two parts: a game server (Node.js, WebSockets) that owns the world state and persists it to a database (SQLite is fine),
and a browser client (3D or 2.5D with Three.js or another npm-installable library) that is served by the same server.
`npm start` must start the server and serve the client; several players must be able to connect from different browser tabs.

## Accounts and characters

- Register and log in with a username and password (stored hashed). Sessions survive a page reload.
- Each account has up to three characters. Character creation: name (unique), one of three classes (Warden: melee tank;
  Arcanist: ranged caster; Wayfinder: agile hybrid with a pet), and a choice of appearance colours.
- Character select screen showing each character's class, level and last location.

## The world

- At least three zones: a starting village (safe, no combat), a forest wilds zone (levels 1-10), and a ruined highland zone
  (levels 8-20) with a dungeon entrance. Zones connect through portals or edges; changing zone loads the new area.
- Players see each other move in real time, with names and levels above their heads. Movement is server-authoritative (the
  server rejects impossible moves); the client predicts and smooths.
- Non-player characters: a quest giver, a merchant and a trainer in the village, each with dialogue.
- Monsters spawn in the wilds and highlands, wander, notice players, chase and attack them, and respawn after a while. At least
  eight monster kinds across the zones, with a named elite in each combat zone.
- A five-player instanced dungeon with three boss fights, each boss with at least two distinct mechanics.

## Play

- Tab-targeting combat: select a target, auto-attack, and use abilities from a hotbar (keys 1-8) with cooldowns and a resource
  (Warden: rage, Arcanist: mana, Wayfinder: focus). Each class has at least six abilities, unlocked as it levels.
- Health, death and respawn at the zone's graveyard. Experience and levels up to 20, with stats that grow per level.
- Loot: monsters drop gold and items. Items have rarity (common to epic), stats, and equipment slots (at least head, chest, legs,
  weapon, off-hand, two trinkets). Equipping changes stats and the character's look.
- Inventory with stacking and a bag limit; a bank in the village.
- Quests: at least twelve, with kill, collect and talk-to objectives, a quest log, quest tracker and rewards; quest chains.
- Merchants buy and sell; player-to-player trading with both sides confirming.
- Parties of up to five with shared quest credit and experience, party frames, and a loot rule.
- Chat: say (nearby), zone, party, and whisper, with a chat window and channels; basic profanity filter and rate limiting.
- Friends list with online status.

## Everything around the play

- Settings: graphics quality, audio volumes, key bindings, UI scale. Persisted per account.
- Sound effects and music (Web Audio is fine if there are no audio files).
- An admin view or commands (for the account named "admin") to see online players, kick, and spawn items.
- Basic anti-cheat on the server: validate movement speed, ability cooldowns, trade contents and item ownership.
- Persistence: characters, inventories, banks, quests, friends and the world's state survive a server restart.

## Look

The UI follows the three reference images in `references/` (login and character select, the in-world HUD, the inventory and trade
windows): dark translucent panels with rounded corners, an ember-orange accent, gold for currency, unit frames top left, target
frame top centre, minimap top right with the zone name, quest tracker on the right, chat bottom left, the ability hotbar (1-8) at
bottom centre with cooldown sweeps. The world should be stylised low-poly with warm light.

## Done means

All of the above works: two or more players can log in from separate tabs, see each other, group up, fight monsters together,
complete quests, trade, chat, and run the dungeon; everything persists across a server restart; no errors in the browser console
or the server log during normal play.

## Art direction

`references/art/` holds six paintings as concept art for the world's mood, light and palette (see `references/art/ART.md`).
Translate them into the game's stylised low-poly world; do not copy them literally:

- **Cinderhold, the starting village** (`village.jpg`): pastoral, golden late-afternoon light, soft greens, a lake and distant peaks.
- **Whisperwood, the forest wilds** (`wilds.jpg`): wild, dense and stormy, dark greens, mist and low cloud over crags.
- **The Ruined Highlands** (`ruins.jpg`, `bard.jpg`): broken columns and arches, a moonlit lake, a fortress on sheer cliffs.
- **Skies and distance** (`sierra.jpg`): luminous, hazy, warm skies with depth and atmospheric perspective.
- **The Hollow Crypt dungeon** (`dungeon.jpg`): a vast underground hall lit by molten fire, deep reds and black.

Each zone should be recognisable from its painting's palette and mood.
