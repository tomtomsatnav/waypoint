#!/usr/bin/env node
// waypoint: keeps a long-running Claude Code agent on course (re-anchor) and moving (external finish line).

import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { stopHook } from '../lib/stop.mjs';
import { anchorHook, ANCHOR_MODES } from '../lib/anchor.mjs';
import { precompactHook } from '../lib/precompact.mjs';
import { run, worstCaseUsd, buildSettings, blockCapFor } from '../lib/runner.mjs';
import { initState, insideWorkTree, loadQueue, loadState, saveState, stateDir, statusReport, writeJsonAtomic } from '../lib/state.mjs';
import { head } from '../lib/git.mjs';
import { driftMetrics, readTranscript } from '../lib/transcript.mjs';
import { doctor } from '../lib/doctor.mjs';
import { build } from '../lib/build.mjs';
import { autopilot, loadAp, statusText, addNote, readNotes, apDir } from '../lib/autopilot.mjs';
import { setWebhook, webhookUrl, postUpdate } from '../lib/discord.mjs';
import { formatReport, readReport } from '../lib/report.mjs';

const USAGE = `waypoint <command>

  run --queue <file> --max-budget-usd <usd> [options]
      Run the queue in one headless Claude Code session with waypoint's hooks.
      Without --yes it only prints the plan and the worst-case spend.
        --model <name>            default: haiku
        --wall-clock <sec>        kill the session after this long (default 1800)
        --max-context <tokens>    kill the session above this context size
        --autocompact <tokens>    passed to claude --autocompact (default 200000, i.e. compaction near 160k, unless
                                  --autocompact-pct is given; "auto" keeps Claude Code's own default)
        --autocompact-pct <n>     sets CLAUDE_AUTOCOMPACT_PCT_OVERRIDE (unset by default, deliberately)
        --config-dir <dir>        CLAUDE_CONFIG_DIR for the session (sandbox away from ~/.claude)
        --relay <0|1>             after a cap: start this many fresh sessions from goal + handoff note (default 0)
        --handoff-budget-usd <n>  budget for the handoff note (default 0.05)
        --no-handoff              skip the handoff note after a cap
        --no-anchor               leave out the SessionStart re-anchor hook (control arm for E3)
        --anchor-mode <m>         auto (default: goal + facts at start, facts only after compaction), full, facts
        --precompact-notes        PreCompact hook: tell the compactor to keep what was learned from each file (fewer re-reads)
        --fresh                   discard an unfinished earlier run's state
        --claude <bin>            claude binary (default: $WAYPOINT_CLAUDE or claude)
        --yes                     actually start (spends money)

  init --queue <file>     Set up state for an interactive session and print the hook settings to use.
  status [--json]         Show the current state. --json prints one JSON object (no check output); exit 1 with no state.
  report <report.json>    Summary of a run report: outcome, cost, wall clock, tasks, sessions.
  build --brief-file <f> [--model sonnet] [--budget-usd 30] [--no-research] [--yes]
                          The default way to build from a brief (it did best in testing): a short research pass writes EXPECTATIONS.md
                          (what users expect that the brief does not say), then one plain session builds it, waiting out
                          usage limits and resuming after them or a restart. Run it again to carry on.
  autopilot start --brief-file <f> [--budget-usd <usd>, default none] [--hours 48] [--references a.png,b.png] [--strong-model m]
                          [--config-dir d] [--verify <cmd>] [--weekly-ceiling 0.85] [--force-model m]
                          [--review-model m] [--research-model m] [--tester-model haiku] [--overhead-share 0.3] [--no-research]
                          [--max-workers 1] [--yes]
                          From a brief to a shipped project in the current repo: plan, work, review, repeat, pacing on plan
                          usage and waiting out limits. Without --yes it only prints what it would do.
  autopilot resume [--yes]  Carry on from .git/autopilot after a stop or a restart.
  autopilot discord <webhook url> | test | off
                          Post development updates to a Discord channel: milestones, the tester's screenshots, reviews
                          and replies to your notes, images made for you, pauses and the end. The URL stays local.
  autopilot note "<text>" [--urgent]
                          A note from the owner to a running autopilot ("btw ..."): workers see it from their next task and
                          the planner folds it into the spec and plan at the next review (with --urgent, after the task in
                          progress). With no text, lists the notes and what became of them.
  autopilot status        Milestones, tasks, models, spend and usage.
  improve [--rounds 1] [--budget-usd N] [--reps 3] [--only id,id] [--engine build] [--model m] [--weekly-ceiling 0.85]
          [--no-pr] [--yes]
                          waypoint learns from its own runs: a strong model proposes one change to prompts/, config/routing.json
                          or skills/, the benchmark in bench/ runs with and without it, and a change that is better beyond the
                          noise (held-out briefs no worse) is opened as a draft pull request. Without --yes it prints the plan.
  bench [--reps 1] [--only id,id] [--engine build] [--yes]
                          Run the benchmark with this waypoint and print the scores (spends usage).
  doctor                  Check the tools waypoint needs (node, git, claude, aos-orch, bwrap). Starts nothing, spends nothing.
                          Exit 0 if all are present, 1 otherwise.
  drift <transcript>      Re-reads and re-edits after each compaction in a session transcript (JSON).
  hook stop|anchor        Hook entry points (read the hook payload on stdin).
`;

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (['yes', 'fresh', 'no-handoff', 'no-anchor', 'precompact-notes', 'help', 'json', 'no-research', 'urgent', 'no-pr'].includes(k)) { o[k] = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`--${k} needs a value`);
    o[k] = v;
  }
  return o;
}

function num(v, name) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const o = parseArgs(rest);
  if (!cmd || cmd === 'help' || o.help) { process.stdout.write(USAGE); return 0; }

  if (cmd === 'hook') {
    if (typeof o['state-dir'] === 'string') process.env.WAYPOINT_DIR = o['state-dir']; // this hook process only
    const raw = readStdin();
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const which = o._[0];
    if (which === 'precompact') { const t = precompactHook(payload); if (t) process.stdout.write(t + '\n'); return 0; } // plain text, not JSON
    const out = which === 'stop' ? stopHook(payload) : which === 'anchor' ? anchorHook(payload) : (() => { throw new Error(`unknown hook ${which}`); })();
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
    return 0;
  }

  if (cmd === 'run') {
    if (!o.queue) throw new Error('--queue is required');
    const budgetUsd = num(o['max-budget-usd'], 'max-budget-usd');
    if (!(budgetUsd > 0)) throw new Error('--max-budget-usd is required: every run needs a spend cap');
    const opts = {
      cwd: process.cwd(), queuePath: resolve(o.queue), model: o.model || 'haiku', budgetUsd,
      wallClockSec: num(o['wall-clock'], 'wall-clock') ?? 1800,
      maxContextTokens: num(o['max-context'], 'max-context'),
      // Default: compact against a 200k window (fires near 160k) whatever the model's own window. On Haiku 5.5 (1M) earlier
      // compaction was cheaper at the same quality (in testing: $0.18-0.35 near 100k, $0.57 near 200k, $1.77 uncompacted at 344k),
      // since prompts above 100k bill higher and each turn re-sends the context. `auto` keeps Claude Code's own default.
      // Only when --autocompact-pct is absent too, so a percentage keeps meaning "of the model's window".
      autocompact: o.autocompact === 'auto' ? undefined : o.autocompact !== undefined ? num(o.autocompact, 'autocompact') : o['autocompact-pct'] !== undefined ? undefined : 200000,
      autocompactPct: num(o['autocompact-pct'], 'autocompact-pct'),
      configDir: o['config-dir'], claudeBin: o.claude, relay: num(o.relay, 'relay') ?? 0,
      handoffBudgetUsd: num(o['handoff-budget-usd'], 'handoff-budget-usd') ?? 0.05,
      handoff: !o['no-handoff'], fresh: !!o.fresh, anchor: !o['no-anchor'], anchorMode: o['anchor-mode'], precompactNotes: !!o['precompact-notes'],
      log: (m) => process.stderr.write(m + '\n'),
    };
    if (opts.anchorMode && !ANCHOR_MODES.includes(opts.anchorMode)) throw new Error(`--anchor-mode must be one of ${ANCHOR_MODES.join(', ')}`);
    const queue = loadQueue(opts.queuePath);
    const worst = worstCaseUsd(opts);
    process.stderr.write([
      `[waypoint] queue: ${queue.tasks.length} task(s): ${queue.tasks.map((t) => t.id).join(', ')}`,
      `[waypoint] verify: ${queue.verify ?? '(off: the queue sets verify to null)'}`,
      `[waypoint] model ${opts.model}, budget $${budgetUsd}/session, wall clock ${opts.wallClockSec}s, relay ${opts.relay}`,
      `[waypoint] compaction: ${opts.autocompact ? `--autocompact ${opts.autocompact}` : 'Claude Code default window'}${opts.autocompactPct != null ? `, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=${opts.autocompactPct}` : ''}`,
      `[waypoint] Stop block cap set to ${blockCapFor(queue)}; waypoint's own caps: ${queue.maxBlocks} blocks/task, stall after ${queue.stallLimit}`,
      `[waypoint] worst-case spend: $${worst.toFixed(2)} (hard caps; typical runs cost far less)`,
      `[waypoint] state: ${stateDir(opts.cwd)}`,
      ...(insideWorkTree(opts.queuePath, opts.cwd) ? ['[waypoint] WARNING: the queue file is inside the repo, so the agent can read the checks and the verify command. Keep it outside.'] : []),
    ].join('\n') + '\n');
    if (!o.yes) { process.stderr.write('[waypoint] not started: pass --yes to run.\n'); return 0; }
    const report = await run(opts);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return report.outcome === 'done' ? 0 : 1;
  }

  if (cmd === 'init') {
    if (!o.queue) throw new Error('--queue is required');
    const cwd = process.cwd();
    const queue = loadQueue(resolve(o.queue));
    const h = head(cwd);
    if (!h) throw new Error('not a git repository with at least one commit');
    const dir = stateDir(cwd);
    saveState(dir, initState({ queue, queuePath: o.queue, base: h, head: h }));
    writeJsonAtomic(resolve(dir, 'settings.json'), buildSettings(queue));
    process.stdout.write(JSON.stringify(buildSettings(queue), null, 2) + '\n');
    process.stderr.write(`[waypoint] state in ${dir}. Start claude with --settings ${resolve(dir, 'settings.json')} and set CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=${blockCapFor(queue)}.\n`);
    return 0;
  }

  if (cmd === 'status') {
    const st = loadState(stateDir(process.cwd()));
    if (o.json) {
      if (!st) { process.stdout.write(JSON.stringify({ state: null }) + '\n'); return 1; }
      process.stdout.write(JSON.stringify(statusReport(st)) + '\n');
      return 0;
    }
    if (!st) { process.stdout.write('no waypoint state here\n'); return 1; }
    const lines = st.tasks.map((t, i) => `${i === st.current && !st.finished ? '>' : ' '} ${t.id.padEnd(20)} ${t.status.padEnd(8)} blocks ${t.blocks} stalls ${t.stalls}${t.lastCheck ? `  last check: ${t.lastCheck.passed ? 'pass' : 'fail'}` : ''}`);
    process.stdout.write(`finished: ${st.finished ?? 'no'}\n${lines.join('\n')}\n`);
    return 0;
  }

  if (cmd === 'report') {
    if (!o._[0]) throw new Error('report needs a report.json path');
    process.stdout.write(formatReport(readReport(o._[0])));
    return 0;
  }

  if (cmd === 'build') {
    if (!o['brief-file']) throw new Error('build needs --brief-file');
    if (!o.yes) { process.stderr.write('[build] not started: pass --yes to run (spends usage).\n'); return 0; }
    const st = await build({ repo: process.cwd(), briefFile: o['brief-file'], model: o.model, budgetUsd: num(o['budget-usd'], 'budget-usd'), research: o['no-research'] ? false : true });
    return st.end === 'stopped by itself' ? 0 : 1;
  }

  if (cmd === 'autopilot') {
    const sub = o._[0];
    if (sub === 'status') { process.stdout.write(statusText(loadAp(process.cwd()))); return 0; }
    if (sub === 'discord') {
      const dir = apDir(process.cwd()); mkdirSync(dir, { recursive: true });
      const arg = o._[1];
      if (arg === 'off') { setWebhook(dir, null); process.stdout.write('Discord updates off\n'); return 0; }
      if (arg && arg !== 'test') { setWebhook(dir, arg); process.stdout.write('Discord webhook saved (kept in .git/autopilot, never committed)\n'); }
      if (!webhookUrl(dir)) { process.stdout.write('no Discord webhook set: waypoint autopilot discord <webhook url>\n'); return 1; }
      const st = loadAp(process.cwd());
      const ok = await postUpdate(dir, { kind: 'milestone', title: 'waypoint is connected', description: st ? `Posting updates for this run: milestone ${st.milestones.length}, ${st.milestones.at(-1)?.title || 'planning'}.` : 'Posting updates for this run.' }, (e) => process.stderr.write(`discord: ${e}\n`));
      process.stdout.write(ok ? 'test message posted\n' : 'the test message failed (see above)\n');
      return ok ? 0 : 1;
    }
    if (sub === 'note') {
      const text = o._.slice(1).join(' ');
      if (!text) { for (const n of readNotes(process.cwd())) process.stdout.write(`${n.at.slice(0, 16)}  ${n.reviewed ? `folded in at the review of milestone ${n.reviewed.milestone}` : n.urgent ? 'urgent, waiting' : 'waiting for the next review'}  ${n.text}\n`); return 0; }
      const n = addNote(process.cwd(), text, { urgent: !!o.urgent });
      process.stdout.write(`noted${n.urgent ? ' (urgent: the planner reviews after the task in progress)' : ' (workers see it from their next task; the planner folds it in at the next review)'}\n`);
      return 0;
    }
    if (sub !== 'start' && sub !== 'resume') throw new Error('autopilot start|resume|status');
    const existing = loadAp(process.cwd());
    if (sub === 'start' && existing) throw new Error('an autopilot run already exists here: use autopilot resume');
    if (sub === 'resume' && !existing) throw new Error('nothing to resume here');
    const opts = { repo: process.cwd(), brief: o['brief-file'] ? readFileSync(o['brief-file'], 'utf8') : o.brief ? String(o.brief) : undefined,
      references: o.references ? String(o.references).split(',').map((s) => s.trim()).filter(Boolean) : [],
      budgetUsd: num(o['budget-usd'], 'budget-usd'), deadlineHours: num(o.hours, 'hours'), strongModel: o['strong-model'],
      configDir: o['config-dir'], claude: o.claude, verify: o.verify, weeklyCeiling: num(o['weekly-ceiling'], 'weekly-ceiling'),
      forceModel: o['force-model'], reviewModel: o['review-model'], researchModel: o['research-model'], testerModel: o['tester-model'], maxWorkers: num(o['max-workers'], 'max-workers'),
      overheadShare: num(o['overhead-share'], 'overhead-share'), research: o['no-research'] ? false : undefined };
    if (sub === 'start' && !opts.brief) throw new Error('autopilot start needs --brief-file <file> or --brief "<text>" (for a project already under way, the brief says what it should become)');
    if (sub === 'start' && opts.budgetUsd != null && !(opts.budgetUsd > 0)) throw new Error('--budget-usd must be positive (leave it out for no budget)');
    const shownBudget = opts.budgetUsd ?? existing?.policy.budgetUsd;
    process.stderr.write(`[autopilot] ${sub} in ${process.cwd()}: ${shownBudget ? `budget $${shownBudget}` : 'no budget (no spending caps; plan usage limits still pause it)'}, ${opts.deadlineHours ?? 48} h, strong model ${opts.strongModel ?? 'claude-fable-5-1'}\n`);
    if (!o.yes) { process.stderr.write('[autopilot] not started: pass --yes to run (spends money).\n'); return 0; }
    const st = await autopilot(opts);
    process.stdout.write(statusText(st));
    return st.shipped ? 0 : 1;
  }

  if (cmd === 'improve' || cmd === 'bench') {
    const { loadSuite, runSuite, summarise, table, RESULTS, WP_ROOT } = await import('../lib/bench.mjs');
    const suite = loadSuite();
    const only = o.only ? String(o.only).split(',').map((x) => x.trim()).filter(Boolean) : null;
    const unknown = (only || []).filter((id) => !suite.briefs.some((b) => b.id === id));
    if (unknown.length) throw new Error(`no such brief: ${unknown.join(', ')} (there are ${suite.briefs.map((b) => b.id).join(', ')})`);
    const reps = num(o.reps, 'reps') ?? (cmd === 'bench' ? 1 : 3);
    const n = only ? only.length : suite.briefs.length;
    const per = suite.perBriefBudgetUsd ?? 5, mins = suite.perBriefMinutes ?? 25;
    const plan = cmd === 'bench'
      ? `bench: ${n} briefs x ${reps} runs = ${n * reps} builds, each capped at $${per} and ${mins} min (worst case $${n * reps * per}, ${Math.round(n * reps * mins / 60)} h).`
      : `improve: ${num(o.rounds, 'rounds') ?? 1} round(s). The baseline (once per commit) and each proposal run ${n} briefs x ${reps} runs = ${n * reps} builds each, `
        + `capped at $${per} and ${mins} min apiece (worst case per suite $${n * reps * per}, ${Math.round(n * reps * mins / 60)} h)${o['budget-usd'] ? `; stops at $${o['budget-usd']} in all` : ''}.`;
    if (!o.yes) { process.stdout.write(`${plan}\nNot started: pass --yes to run (spends usage).\n`); return 0; }
    process.stderr.write(plan + '\n');
    if (cmd === 'bench') {
      const outDir = resolve(RESULTS, `bench-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
      const out = await runSuite({ waypointDir: WP_ROOT, outDir, reps, only, engine: o.engine || 'build', log: (m) => process.stderr.write(`[bench] ${m}\n`) });
      process.stdout.write(`${table(summarise(out.runs))}\n\nresults: ${outDir}\n`); return 0;
    }
    const { improve } = await import('../lib/improve.mjs');
    const r = await improve({ rounds: num(o.rounds, 'rounds') ?? 1, budgetUsd: num(o['budget-usd'], 'budget-usd'), reps, only, engine: o.engine || 'build',
      model: o.model, weeklyCeiling: num(o['weekly-ceiling'], 'weekly-ceiling'), pr: !o['no-pr'] });
    for (const x of r.rounds || []) process.stdout.write(`${x.verdict}: ${x.title}${x.reason ? ` (${x.reason})` : ''}${x.published?.url ? ` ${x.published.url}` : x.published?.note ? ` (${x.published.note})` : ''}\n`);
    process.stdout.write(`spent about $${(r.spent || 0).toFixed(2)}\n`);
    return 0;
  }

  if (cmd === 'doctor') {
    const d = doctor();
    process.stdout.write(d.lines.join('\n') + '\n');
    return d.ok ? 0 : 1;
  }

  if (cmd === 'drift') {
    if (!o._[0]) throw new Error('drift needs a transcript path');
    process.stdout.write(JSON.stringify(driftMetrics(readTranscript(o._[0])), null, 2) + '\n');
    return 0;
  }

  throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
}

main().then((c) => { process.exitCode = c; }, (e) => {
  process.stderr.write(`waypoint: ${e.message}\n`);
  // Exit 2 from a hook means "block" to Claude Code, so a crashing hook exits 1 (a non-blocking error) instead.
  process.exitCode = process.argv[2] === 'hook' ? 1 : 2;
});
