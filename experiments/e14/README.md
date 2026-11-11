# E14: Gloamreach, a character-drawn souls-like (the "too big for one session" test)

The owner's brief (`seed/BRIEF.md`): a dark, punishing third-person action RPG in the souls-like tradition where everything is
drawn with small coloured characters, with wind, water, weather and physics, seven interconnected areas, five bosses, the
genre's controls and difficulty. Far larger than Emberfall: the test of whether the autopilot earns its cost on work that
does not fit in one long session, which E13c left open.

References in the seed: seven public-domain paintings (Friedrich, Böcklin, Martin, Cole; credits in
`seed/references/art/ART.md`), one per area, and four static mock-ups of the character-grid look made from them with
`asciify.py` (one with a sketch of the HUD).

## Arms

| Arm | What it is |
|---|---|
| `researched` | `waypoint build`'s recipe, E13c's winner: research writes EXPECTATIONS.md, then one plain Sonnet session until it stops by itself |
| `autopilot` | the autopilot with every fix since E13b: research, playable first milestone, capped Sonnet reviews, Fable confirms a ship, hang fix, killed attempts charged, only the planner's tests frozen, one worker at a time |

Both get $60 and 72 hours, and share the plan's usage (both pause near the limits). A plain session without research is left
out: it lost E13 and E13c.

## Run it (on the Mac)

```sh
cd ~/waypoint && git pull
E13_WORK=~/gloamreach-e14 E13_SEED=$HOME/waypoint/experiments/e14/seed E13_ARMS="autopilot researched" E13_HOURS=72 \
  ~/waypoint/experiments/e13/run-e13.sh start
```

Check on it with `E13_WORK=~/gloamreach-e14 ~/waypoint/experiments/e13/run-e13.sh status`, or open the dashboard:

```sh
node ~/waypoint/experiments/e13/dashboard.mjs ~/gloamreach-e14      # then http://localhost:3099 (refreshes every 30 s)
```

It shows the supervisor, the deadline, each arm's state (running, paused for usage, ended, down), spend, commits, the
autopilot's current task and milestone, plan usage and logs, with warnings for an arm that is down, an attempt near its
time limit, repeated wall-clock caps and long gaps without commits. It never shows the blind port mapping. At the end both games are served
blind on ports 3101 and 3102 with a notification; give a verdict before
`E13_WORK=~/gloamreach-e14 ~/waypoint/experiments/e13/run-e13.sh reveal`.

The researched arm will probably end within a few hours (one session stops by itself); the autopilot may run for days.
