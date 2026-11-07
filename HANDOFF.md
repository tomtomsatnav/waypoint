# Handoff: waypoint

Written 7 Nov 2026 at the end of a planning session in `tomtomsatnav/aos-orchestrator`. Read this before writing any code.

## The problem (in the owner's words, then made measurable)

> Agents will normally wander from the original task once they hit a certain context window, normally towards the million-token
> context window. And agents will stop and not continue with new work unless prompted. Also, I would like a way for agents to speak
> to each other better while completing these tasks.

| # | Problem | Solved means we observe |
|---|---|---|
| 1 | **Drift**: long sessions wander from the original goal | Hidden acceptance tests pass, `aos-orch verify` accepts, no files touched outside the goal's scope, and after a compaction the agent does not redo finished work (count re-reads of already-read files and re-edits of finished files) |
| 2 | **Stopping**: the agent ends its turn and waits for a human | Given a queue of N tasks, each with an external check, it finishes the queue with no human prompt, and ends only when every check and `verify` pass or a hard limit fires |
| 3 | **Communication** between agents | Not defined yet. Decide first what the messages are for (a stuck agent gets an answer without a human? two agents never edit the same file?) |

## The approach: build on Claude Code, do not reinvent it

The owner's direction: rely on what Claude Code already has (hooks, compaction, resume, its own agent teams), and make it better
instead of building a framework beside it. An earlier idea, a "relay" of fresh sessions handing notes to each other, was dropped as the
main loop. It survives only as the emergency exit.

Planned shape: **a settings file, two hook scripts and a small runner.** No planner, no parallel workers.

1. **Stopping → a Stop hook that runs the finish line.** When the agent tries to stop, the hook runs the task's checks and
   `aos-orch verify --base <start sha>`. Pass: allow the stop (or hand over the next task in the queue). Fail: block the stop with
   the failing output, fenced as data. The finish line always comes from outside the agent, never from it saying "done".
2. **Drift → re-anchor from facts, not summaries.** A `SessionStart` + `PostCompact` hook (optionally `UserPromptSubmit`) injects the
   goal verbatim from the goal file, `git log --oneline <base>..HEAD`, `git status --short` and the last check result. All derived from git
   and check output, never from the agent's prose, so it can never become a summary of a summary.
3. **Hard limits, outside the model (mandatory):** `--max-budget-usd` per session, a wall clock in the runner, our own count of Stop
   blocks (below Claude Code's cap), and a stall rule: two blocks in a row with no new commit and no newly passing check → allow the
   stop and mark the task blocked. "Unattended" must never mean "all night on a task it cannot finish".
4. **Emergency exit (the relay's remains):** if a session hits its cost or context cap, the runner kills its process group, confirms the
   exit, runs `claude -p --resume <id> --tools Write --max-turns 3` so the agent writes a handoff note (measured: $0.001), and may start
   one fresh session from goal + note.
5. **Communication → not built yet.** For one agent, the queue file and the re-anchor facts are the shared state. If a second agent is
   ever justified, probe Claude Code's own agent teams (`SendMessage`, shared task list) before building any channel.

## Why it is shaped this way (lessons already paid for; do not relitigate)

- **External finish line.** In aos-orchestrator's evals (21 Oct 2026, `evals/results/2026-10-21.md` there), Haiku rewrote a test with a
  wrong expected value and reported "all tests pass" 10/10 times. `aos-orch verify` caught every rewrite. A Stop hook that blocks while
  tests fail is pressure to game them, so `verify` runs at every stop, and acceptance tests stay hidden from the agent.
- **Keep it small.** The same evals found the full orchestrator (planner plus parallel workers) slower, dearer and less reliable than one
  bare session on every capability task, with every failure in the orchestration layer. One agent at a time until the single-agent loop is
  shown to work.
- **Dependency:** waypoint calls `aos-orch verify` as a CLI (`npm link` from aos-orchestrator, or a pinned version: decide). It must not
  import the orchestrator's planner/engine/worker code.

## Facts verified on Claude Code 2.1.319 (Haiku 5.5, by running it)

Full table and scripts: `tomtomsatnav/aos-orchestrator`, `orchestrator/spike/relay/` (PR #2).

- A nested `claude -p` logs in with its own `CLAUDE_CONFIG_DIR` (use it to sandbox runs away from `~/.claude`).
- Haiku 5.5 reports a **1,000,000-token** context window (`modelUsage.contextWindow`).
- Starting context: 42k tokens with the container's default tools and MCP servers; **8.2k** with
  `--strict-mcp-config --tools "Bash,Edit,Write,Read,Glob,Grep"`. `--allowedTools` only permits; `--tools` removes the rest.
- `--autocompact 100000` compacts at about **80k**. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` moves the trigger: 50 with `--autocompact 100000`,
  or 5 on the 1M default, compacts at about 50k. Cloud containers set it to 92 by default: set or unset it deliberately in every run.
- Each compaction writes `{"type":"system","subtype":"compact_boundary","compactMetadata":{"trigger","preTokens","postTokens",...}}`
  followed by a `user` record with `isCompactSummary: true`. Use this to detect compaction.
- **After compaction Haiku lost its place and redid work**: 23 tool calls to read 4 files (one run). This is problem 1 in miniature.
- A PostToolUse `hookSpecificOutput.additionalContext` instruction made Haiku write an accurate HANDOFF.md and stop (n=1); it made one
  extra tool call first.
- PostToolUse payload keys: `session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, effort, hook_event_name,
  tool_name, tool_input, tool_response, tool_use_id, duration_ms`. A failed Bash command fires `PostToolUseFailure` instead.
- Context size = `input + cache_creation_input + cache_read_input` tokens on the latest main-chain (`!isSidechain`) assistant record of the
  transcript (`<config dir>/projects/<cwd, non-alphanumerics → '-'>/<session>.jsonl`). At hook time it does not yet include the tool
  result just returned.
- `--resume <id>` works headless; `--max-turns` is accepted though not in `--help`; `--max-budget-usd` and `--session-id` work.
- **Killing a session:** spawn it from Node with `detached: true`, `process.kill(-pid, 'SIGKILL')`, and wait for `exit` before
  anything else touches the session. `setsid claude …` from bash forked, the kill missed, and the session kept working while another
  process resumed it: two writers on one transcript.
- **Every run needs `--max-budget-usd`.** One probe without it read ten files in parallel, reached 571k context in three turns and cost
  $0.65. Hooks cannot stop a single turn that adds hundreds of thousands of tokens.

## Present in the CLI binary but behaviour not yet verified

Found by string search of the 2.1.319 binary; test before relying on them:

- `Stop` / `SubagentStop` hooks with `stop_hook_active` and `last_assistant_message` in the payload; a blocking Stop hook
  (assumed `{"decision":"block","reason":"..."}`) returns "Stop hook feedback" to the model and the turn continues.
- A cap on consecutive Stop blocks, after which Claude Code ends the turn anyway; `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` changes it. Default
  value, and whether it resets, unknown.
- Whether Stop hooks fire under `-p`.
- `PreCompact` / `PostCompact` hooks (PostCompact carries `compact_summary`); whether PostCompact accepts `additionalContext`.
- Agent teams: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` or `--agent-teams`, tools `TeamCreate`, `SendMessage`, `ListAgents`,
  `TaskCreate/List/Update`, hooks `TeammateIdle`, `TaskCompleted`. Also needs a server-side flag; whether this account has it is unknown.

## Next: experiments, cheapest first (Haiku, notional list price)

| # | Tests | Pass when | Cost |
|---|---|---|---|
| E1 | Stop-hook loop: a throwaway repo, a queue of 3 small tasks with tests; the Stop hook blocks and hands over the next task | All 3 done, no human prompt, `verify` accepts; also records whether Stop fires under `-p` and what the block cap is | ~$0.25 (5 trials) |
| E2 | Hard limits: aos-orchestrator's `impossible-test` task under E1 | Ends via the stall rule or a cap, spend under $0.05 | < $0.05 |
| E5 | Do agent teams exist for this account? One `-p` call with the flag asking it to use `TeamCreate` | Tool present and works | ~$0.01 |
| E3 | Re-anchor vs plain compaction: compaction near 50k (P3b setup) on a 10-file task; arm A plain, arm B with the SessionStart/PostCompact injection, 3 trials each | Fewer re-reads and redone steps in B. Decides whether the relay note is needed at all | ~$0.60 |
| E4 | The relay as exit, only if E3 fails | — | ~$1–2 |

The owner approved the direction and asked for this handoff; **ask before every paid run** and print a cost estimate first. E1, E2 and
E5 together are about $0.30.

## Open decisions for the owner

- Who writes the task queue and its checks? The finish line is the real work; waypoint only enforces it.
- Is problem 3 wanted while the one-agent rule stands? (The owner does want better agent communication; the advice is to run E5, define
  the messages, and build only once the single-agent loop works.)
- `verify` adds seconds per stop: acceptable?
- Depend on `aos-orch` via `npm link` or a pinned version?

## Related repos

- `tomtomsatnav/aos-orchestrator`: `aos-orch verify` (the guard), the 21 Oct evals, and the probes behind the facts above.
- `tomtomsatnav/fenceline`: per-task fences with warn/block hooks and a session trail. Optional guardrail, and a source of drift data.
- `tomtomsatnav/lessons`: cross-project lessons written to `~/.claude/rules/lessons-*.md`; sessions load them automatically.

## Working style

- UK spelling in docs and output. Plain-English summaries.
- Haiku by default, model configurable. Keep spend low; cost estimate and a yes before any paid run.
- Tests without real API calls (fixture transcripts and hook payloads; a scripted fake `claude`, as aos-orchestrator's
  `orchestrator/test/fake-claude.mjs`). Zero dependencies, Node 18+, as in the sibling repos.
- Work on a branch, open a draft PR. Report what was built, what was measured and what is left, including what did not work.
