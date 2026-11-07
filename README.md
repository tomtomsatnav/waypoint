# waypoint

Keeps a long-running Claude Code agent on course and moving, using what Claude Code already has (hooks, compaction, resume)
rather than a framework beside it.

- **Stopping:** a `Stop` hook runs the external finish line (the task's checks and `aos-orch verify`). Pass hands over the
  next task in the queue; fail blocks the stop with the failing output fenced as data. The agent saying "done" counts for nothing.
- **Drift:** a `SessionStart` hook (which also fires after every compaction, with `source: "compact"`) re-anchors the agent with
  the goal verbatim, `git log`, `git status` and the last check result. Facts only, never the agent's own summary.
- **Hard limits, outside the model:** a spend cap on every session, a wall clock, a context cap, waypoint's own count of Stop
  blocks, and a stall rule. On a cap, the runner kills the process group and asks the session for a handoff note.

**Status:** built, tested offline against a scripted fake `claude`, and run for real on Haiku 5.5 (E1, E2, E3, E5; $0.29 in
total): the queue loop finishes unattended, impossible tasks end cheaply, and the re-anchor reduces repeated work after compaction a
little. Results: [experiments/results/2026-11-07.md](experiments/results/2026-11-07.md). Plan and history: [HANDOFF.md](HANDOFF.md).

## Use

Node 18+, no dependencies. `aos-orch` on `PATH` (for example `npm link` in aos-orchestrator) unless the queue turns verify off.

```sh
cd <repo to work in>
node <waypoint>/bin/waypoint.mjs run --queue queue.json --max-budget-usd 0.25 --wall-clock 1800          # prints plan and worst case
node <waypoint>/bin/waypoint.mjs run --queue queue.json --max-budget-usd 0.25 --wall-clock 1800 --yes    # spends money
node <waypoint>/bin/waypoint.mjs status
node <waypoint>/bin/waypoint.mjs drift <transcript.jsonl>     # re-reads / re-edits after each compaction
```

`waypoint init --queue queue.json` sets up the state and prints the hook settings for an interactive session instead.

### The queue

```json
{
  "verify": "aos-orch verify --base {base}",
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
- `guardText: false` drops the "do not edit tests" sentences from the prompts (an experiment arm: verify alone guards).
- **Stall rule:** `stallLimit` blocks in a row with no new commit and no newly passing check end the task as blocked.
  `maxBlocks` caps blocks per task regardless.

State lives in `.waypoint/` in the repo (or `$WAYPOINT_DIR`); it ignores itself, so it never shows up in git. Each run writes
`.waypoint/runs/<id>/` with the session's stream-json log and a `report.json` (outcome, cost, every stop attempt).

### What the runner sets on every session

`-p --output-format stream-json --verbose --include-hook-events --model <m> --max-budget-usd <usd> --strict-mcp-config
--tools Bash,Edit,Write,Read,Glob,Grep --allowedTools <same> --permission-mode acceptEdits --session-id <uuid> --settings <hooks>`,
plus `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raised above waypoint's own caps, and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` unset unless
`--autocompact-pct` is given. Spawned with `detached: true`; caps kill with `process.kill(-pid, 'SIGKILL')` and wait for exit.

## Layout

| Path | What |
|---|---|
| `bin/waypoint.mjs` | CLI and hook entry points |
| `lib/stop.mjs` | Stop hook: finish line, handover, stall rule, block cap |
| `lib/anchor.mjs` | SessionStart re-anchor |
| `lib/checks.mjs` | Runs checks and verify; fences output |
| `lib/runner.mjs` | Spawns and watches the session; caps; handoff note and optional relay |
| `lib/transcript.mjs` | Context size and drift metrics from transcripts |
| `test/fake-claude.mjs` | Scripted stand-in for `claude -p` used by the tests |
| `experiments/e*-setup.sh` | Build the experiment repos and queues (free); the runs themselves are paid |
| `experiments/results/` | What was run and measured |

`npm test` runs everything offline.

Sibling repos: [aos-orchestrator](https://github.com/tomtomsatnav/aos-orchestrator) (`aos-orch verify`),
[fenceline](https://github.com/tomtomsatnav/fenceline), [lessons](https://github.com/tomtomsatnav/lessons).
