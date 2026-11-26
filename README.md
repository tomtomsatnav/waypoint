# waypoint

## As a Claude Code plugin

```
/plugin install waypoint --marketplace tomtomsatnav/waypoint
```

Two skills: **waypoint** (Claude writes a brief with you, starts and steers the autopilot, shows the dashboard and relays
notes) and **expectations** (before building anything from a description, write down what users of that kind of product
expect, each with a check, then build to it). To share only the framework, without this repository's experiments, run
`scripts/export/export-framework.sh <new folder>` and publish that.

## The launcher

Double-click `Waypoint.command` (or `node bin/app.mjs --open`): a page to write a brief (Claude can draft it from a few
lines), add reference images, pick a folder and options, start the autopilot, and list, steer, stop and resume projects.
Projects started from the command line show up in it too.

## Improving waypoint

waypoint can learn from its own runs. The model stays the same; what changes is waypoint's instructions to it: the prompts
in `prompts/`, the routing in `config/routing.json` (which model builds what) and the skills in `skills/`.

```sh
bin/autopilot.sh improve --rounds 1 --yes          # in the background; autopilot.sh improve log | status | stop
node bin/waypoint.mjs improve --rounds 1 --yes     # or in the foreground; without --yes either prints the plan only
```

Each round:

1. **Baseline.** The benchmark in `bench/` (eight small briefs: a to-do app, a browser game, a data dashboard, a
   command-line tool, a JSON API, a bug fix in an existing repo, and, held out, a validated form and a feature added to an
   existing repo) is built three times with the current version using `waypoint build`, and each build is scored by its
   hidden acceptance checks (`bench/<id>/accept.mjs`, run outside the built repo). This is measured once per commit and kept.
2. **Proposal.** A strong model reads the training briefs' scores and failing checks, what real projects ran into (owner
   notes, tester reports, stuck tasks from every project in `~/.waypoint/projects.json`, grouped into themes that recur
   across projects) and earlier proposals, and makes one focused change, written as a general principle.
3. **Gate.** The round is thrown away if the change touches anything but `prompts/`, `config/routing.json` and `skills/`,
   if a prompt no longer loads, or if waypoint's own tests fail. Otherwise the suite is built three times with it. It is
   kept only if the training score rises by more than the noise (twice the spread between runs, at least 3 points) or holds
   while costing at least 15% less, the held-out briefs get no worse, and no single brief falls sharply.
4. **Your approval.** A kept change is pushed on its own branch and opened as a draft pull request with the before and
   after table and the reasoning. Nothing is merged automatically.

The first round makes 48 builds (24 for the baseline), later rounds 24; each build is capped at $5 and 25 minutes (see
`bench/suite.json`), and the whole thing pauses for your plan's limits like the autopilot. `--budget-usd N` stops it at a
total, `--only todo,cli` and `--reps 1` make a quick, rough round, and `node bin/waypoint.mjs bench --yes` just measures.
Results are in `bench/results/` and in the launcher's "Improving waypoint" card. `test/fixtures/bench-solutions/` holds a
reference solution for each brief, which the tests use to prove every acceptance check can be passed.

## Start here: `waypoint build`

To build something from a brief, run this in a git repo that holds the brief:

```sh
node <waypoint>/bin/waypoint.mjs build --brief-file BRIEF.md --yes
```

A short research pass writes `EXPECTATIONS.md`: what users of this kind of product take for granted that the brief does not
say (for a game: camera, controls, feel), each with a check. Then one plain Claude Code session (Sonnet) builds the brief with
that file as part of it and runs until it stops by itself. It waits out plan usage limits and resumes the same session after
them; run the command again after a restart and it carries on. Options: `--model`, `--budget-usd` (default 30),
`--no-research`.

Why this is the default: on the Emberfall MMORPG brief, judged by the owner, it beat both a bare session and the full
autopilot below ($6.95 and 80 minutes, against $36 and 49 hours for the autopilot). The one change that consistently helped
was writing down what the brief leaves unsaid; the rest of the machinery added cost, not quality, on a project that fits in
one long session ([experiments/results/2026-11-11.md](experiments/results/2026-11-11.md)). The autopilot remains for work too
big for one session.

## What else is here

Keeps a long-running Claude Code agent on course and moving, using what Claude Code already has (hooks, compaction, resume)
rather than a framework beside it.

- **Stopping:** a `Stop` hook runs the external finish line (the task's checks and `aos-orch verify`). Pass hands over the
  next task in the queue; fail blocks the stop with the failing output fenced as data. The agent saying "done" counts for nothing.
- **Drift:** a `SessionStart` hook (which also fires after every compaction, with `source: "compact"`) re-anchors the agent with
  `git log`, `git status`, the tasks already accepted and the last check result, plus the goal verbatim at startup. After a
  compaction it injects the facts only (`--anchor-mode auto`): re-injecting the goal there was followed by bulk re-reads in E3.
- **Hard limits, outside the model:** a spend cap on every session, a wall clock, a context cap, waypoint's own count of Stop
  blocks, and a stall rule. On a cap, the runner kills the process group and asks the session for a handoff note.

**Status:** built, tested offline against a scripted fake `claude`, and run for real on Haiku 5.5 (E1, E2, E3, E5; $0.29 in
total): the queue loop finishes unattended, impossible tasks end cheaply, and the re-anchor reduces repeated work after compaction a
little. Results: [experiments/results/2026-11-07.md](experiments/results/2026-11-07.md). Plan and history: [HANDOFF.md](HANDOFF.md).

## Use

Node 18+, no dependencies. `aos-orch` on `PATH` (`npm link` in aos-orchestrator) unless the queue turns verify off; on Linux its
check sandbox needs bubblewrap (`apt-get install bubblewrap`), and it fails closed without it. Give each run a fresh
`--config-dir`: the runner drops the parent's `CLAUDE*` environment, but a reused config dir keeps whatever account, skills and
plugins earlier sessions synced into it.

```sh
cd <repo to work in>
node <waypoint>/bin/waypoint.mjs run --queue queue.json --max-budget-usd 0.25 --wall-clock 1800          # prints plan and worst case
node <waypoint>/bin/waypoint.mjs run --queue queue.json --max-budget-usd 0.25 --wall-clock 1800 --yes    # spends money
node <waypoint>/bin/waypoint.mjs status
node <waypoint>/bin/waypoint.mjs report <run>/report.json     # outcome, cost, wall clock, tasks, sessions
node <waypoint>/bin/waypoint.mjs doctor                       # checks node, git, claude, aos-orch, bwrap; starts nothing
node <waypoint>/bin/waypoint.mjs drift <transcript.jsonl>     # re-reads / re-edits after each compaction
```

`waypoint init --queue queue.json` sets up the state and prints the hook settings for an interactive session instead.

### The queue

```json
{
  "verify": "aos-orch verify --repo . --base {base}",
  "maxBlocks": 6,
  "stallLimit": 2,
  "cumulativeChecks": true,
  "tasks": [
    { "id": "slugify", "goal": "Export slugify(s) from src/text.mjs ...", "checks": ["npm test"] },
    { "id": "parser", "goalFile": "goals/parser.md",
      "checks": [{ "name": "acceptance", "run": "node /outside/repo/accept.mjs", "hidden": true, "timeoutSec": 120 }] }
  ]
}
```

- `verify` runs at every stop, after the checks. `{base}` is the commit the task started from, `{runBase}` the run's start.
  Leaving it out keeps `aos-orch verify`; only an explicit `null` turns it off.
- A check passes on exit 0. `hidden: true` reports the failure but withholds the output, so acceptance tests stay hidden.
- `cumulativeChecks` (default on) keeps earlier tasks' checks in the finish line, so a later task cannot quietly break them.
- `prepare` (per task): a shell command waypoint runs when the task starts and commits as itself, e.g. to hand the task its
  acceptance tests. Verify protects whatever it adds from then on.
- `redact`: strings replaced with `<hidden>` in everything the agent is shown from the checks (keep hidden paths hidden).
- `guardText: false` drops the "do not edit tests" sentences from the prompts (an experiment arm: verify alone guards).
- **Stall rule:** `stallLimit` blocks in a row with no new commit and no newly passing check end the task as blocked.
  `maxBlocks` caps blocks per task regardless.

**Keep the queue file outside the repo**, and the state stays out of it too: by default in `.git/waypoint/` (or `$WAYPOINT_DIR`),
outside the working tree. In E2b, agents that could read the queue cited its verify command and changed their behaviour, so
anything the agent can browse is part of the experiment. Each run writes `<state>/runs/<id>/` with the session's stream-json log
and a `report.json` (config, outcome, cost, every stop attempt).

### What the runner sets on every session

`-p --output-format stream-json --verbose --include-hook-events --model <m> --max-budget-usd <usd> --strict-mcp-config
--tools Bash,Edit,Write,Read,Glob,Grep --allowedTools <same> --permission-mode acceptEdits --session-id <uuid> --settings <hooks>`,
plus `--autocompact 200000` by default (compaction near 160k: on Haiku 5.5 earlier compaction was cheaper at the same quality),
`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raised above waypoint's own caps, and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` unset unless
`--autocompact-pct` is given. Spawned with `detached: true`; caps kill with `process.kill(-pid, 'SIGKILL')` and wait for exit.

## Layout

| Path | What |
|---|---|
| `bin/waypoint.mjs` | CLI and hook entry points |
| `lib/stop.mjs` | Stop hook: finish line, handover, stall rule, block cap |
| `lib/anchor.mjs` | SessionStart re-anchor |
| `lib/checks.mjs` | Runs checks and verify; fences output |
| `lib/doctor.mjs` | `waypoint doctor`: finds the required tools on `PATH` (runs none of them) |
| `lib/report.mjs` | `waypoint report`: readable summary of a run's `report.json` |
| `lib/runner.mjs` | Spawns and watches the session; caps; handoff note and optional relay |
| `lib/transcript.mjs` | Context size and drift metrics from transcripts |
| `test/fake-claude.mjs` | Scripted stand-in for `claude -p` used by the tests |
| `experiments/e*-setup.sh` | Build the experiment repos and queues (free); the runs themselves are paid |
| `experiments/results/` | What was run and measured |

`npm test` runs everything offline.

Sibling repos: [aos-orchestrator](https://github.com/tomtomsatnav/aos-orchestrator) (`aos-orch verify`),
[fenceline](https://github.com/tomtomsatnav/fenceline), [lessons](https://github.com/tomtomsatnav/lessons).
