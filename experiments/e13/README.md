# E13: Emberfall on your own machine

Three arms build the same browser MMORPG (`seed/BRIEF.md`, with the UI mock-ups and six public-domain paintings in
`seed/references/`) for up to 52 hours, on your Claude plan:

| Arm | What it is |
|---|---|
| `autopilot` | waypoint autopilot: Fable plans and reviews, Haiku/Sonnet/Opus build one checked task at a time, budget $60 |
| `single` | one Claude Code session (Sonnet) with the brief, until it stops by itself |
| `loop` | Claude Code (Sonnet), told "continue" every time it stops |

All three pause near the plan's 5-hour and weekly limits (90% and 85%) and carry on after the reset. A session cut off by a
limit or a reboot is resumed, not counted as stopping.

## Run it (macOS or Linux)

Needs Node 18+, git, and Claude Code logged in with your plan (`claude` once, then `/login`). Keep the Mac plugged in; it is kept
awake with `caffeinate` while this runs, but closing a laptop lid still sleeps it.

```sh
git clone -b claude/new-session-jrkt12 https://github.com/tomtomsatnav/waypoint.git ~/waypoint
~/waypoint/experiments/e13/run-e13.sh start
```

The first start installs Playwright and Chromium into `~/emberfall-e13/tools` (about 200 MB), copies the seed into
`~/emberfall-e13/{autopilot,single,loop}` and starts a supervisor that relaunches anything that dies every five minutes.

- `run-e13.sh status`: running or not, time left. It says nothing about which arm is doing better: the review is blind.
- `run-e13.sh stop`, then `run-e13.sh start` again: carries on where it was (also after a reboot). The 52 h deadline is fixed
  at the first start.
- At the end (deadline, or all three finished) everything stops and the three games start **blind** on
  http://localhost:3101, 3102 and 3103 in a random order, with a macOS notification. Play them (two tabs = two players), give
  feedback by port number, and only then `run-e13.sh reveal`.

Your own Claude Code settings, hooks, plugins and CLAUDE.md are kept out of all three arms (`--setting-sources project,local`).

## E13b: the revised autopilot against E13's winner

After E13 the autopilot gained a research step (EXPECTATIONS.md: what users of the genre expect, each with a check), a
playable first milestone, Sonnet reviews with Fable confirming a ship, a 20% cap on research, planning and reviews, and
research on stuck tasks. To rerun only the autopilot on the same brief and budget, judged blind against E13's winner:

```sh
cd ~/waypoint && git pull
E13_WORK=~/emberfall-e13b E13_ARMS=autopilot E13_COMPARE=~/emberfall-e13/single ~/waypoint/experiments/e13/run-e13.sh start
```

Use the same `E13_WORK=~/emberfall-e13b` in front of `status`, `stop` and `reveal`. At the end the two games are served on
ports 3101 and 3102 in a random order.

## Afterwards

Judging uses the hidden rubric in `.judge.b64` (a base64 tarball, kept opaque so the builders do not read it; do not open it
before the blind review). Archive `~/emberfall-e13` without `node_modules`
(`tar --exclude node_modules --exclude tools -czf e13.tgz -C ~ emberfall-e13`) for the write-up.
