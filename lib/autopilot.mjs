// The autopilot: one brief in, a shipped project out, running for as long as it takes.
//
//   plan    a strong model turns the brief into SPEC.md (its assumptions recorded, "shipped" defined), the first milestone's
//           tasks (each with a type) and visible acceptance tests, committed before any work starts
//   work    each task runs under waypoint (Stop-hook finish line) on the model routing.mjs picks for its type; a blocked task
//           climbs the model ladder; earlier tasks' checks stay in the finish line
//   review  after a milestone, or when a task is stuck, the strong model looks at git, the checks and screenshots of the
//           running app and decides: next milestone, fixes, changed checks, or ship
//   pace    every session reports plan usage; the loop paces to the weekly window and waits out limits until they reset
//
// Everything lives in <repo>/.git/autopilot (state.json, routing.json, ledger.jsonl, runs/), so the loop can be stopped and
// resumed at any point, including after the machine restarts.

import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { run as runQueue, runSession } from './runner.mjs';
import { writeJsonAtomic } from './state.mjs';
import { decide, parseUsage, probeUsage } from './usage.mjs';
import { pick, record, loadStats, saveStats, summary as routingSummary, DEFAULT_LADDERS, TASK_TYPES } from './routing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SMOKE = resolve(HERE, '..', 'scripts', 'web-smoke.mjs');
// The default finish-line guard: no test that existed when a task started may be modified or deleted. (aos-orch verify is
// stricter but rejected every change to a repo whose existing tests it disliked; pass --verify to use it.)
export const STANDIN_VERIFY = "git diff --quiet --diff-filter=DM {base} -- ':(glob)**/test/**' ':(glob)**/tests/**' ':(glob)**/*.test.mjs' ':(glob)**/*.test.js' ':(glob)**/*.test.ts'";
const TASK_BUDGET = { haiku: 3, sonnet: 6, opus: 10 };

const now = () => new Date().toISOString();
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const gitOk = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function apDir(repo) { return join(git(repo, 'rev-parse', '--absolute-git-dir'), 'autopilot'); }
export function loadAp(repo) { const p = join(apDir(repo), 'state.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; }
function saveAp(repo, st) { st.updatedAt = now(); writeJsonAtomic(join(apDir(repo), 'state.json'), st); }
function ledger(repo, entry) { appendFileSync(join(apDir(repo), 'ledger.jsonl'), JSON.stringify({ at: now(), ...entry }) + '\n'); }
function commitAll(repo, msg) { gitOk(repo, 'add', '-A'); spawnSync('git', ['-c', 'user.name=autopilot', '-c', 'user.email=autopilot@localhost', 'commit', '-q', '--no-verify', '-m', msg], { cwd: repo }); }

function cleanEnv(configDir, extra = {}) {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if ((/^CLAUDE/.test(k) && k !== 'CLAUDE_CONFIG_DIR') || k === 'WAYPOINT_DIR' || /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)$/.test(k)) delete e[k];
  if (configDir) e.CLAUDE_CONFIG_DIR = configDir;
  delete e.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  return { ...e, ...extra };
}

// One headless call to the strong model (planner or reviewer), with file tools in the repo. Returns {ok, text, costUsd, usage}.
async function strongCall(repo, st, kind, prompt, { budget = 4, wallSec = 3600 } = {}) {
  const dir = apDir(repo);
  const logPath = join(dir, 'runs', `${kind}-${Date.now()}.jsonl`);
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', st.policy.strongModel, '--max-budget-usd', String(budget),
    '--strict-mcp-config', '--tools', 'Read,Glob,Grep,Bash,Write,Edit', '--allowedTools', 'Read,Glob,Grep,Bash,Write,Edit',
    '--permission-mode', 'acceptEdits', '--session-id', randomUUID(), '--autocompact', '200000'];
  const s = await runSession({ bin: st.policy.claude, args, env: cleanEnv(st.policy.configDir), cwd: repo, logPath, wallClockSec: wallSec });
  const usage = s.rateLimit ? parseUsage(s.rateLimit) : null;
  if (usage) st.usage = usage;
  st.spentUsd = +(st.spentUsd + (s.costUsd || 0)).toFixed(4);
  ledger(repo, { kind, model: st.policy.strongModel, costUsd: s.costUsd, ok: !s.killed && !s.result?.is_error, usage });
  return { ok: !s.killed && !s.result?.is_error, text: s.result?.result || '', costUsd: s.costUsd || 0, usage, limited: s.rateLimit?.status === 'rejected' };
}

const TYPES_HELP = `Task types (the model is chosen from the type, so type honestly): ${TASK_TYPES.join(', ')}. Use code-simple|moderate|complex for
programming, ui-design for layout and look-and-feel decisions, visual-polish for refining how it looks, architecture for structural
decisions, test-writing, docs.`;

const PLAN_FORMAT = (n, file) => `Write the milestone as JSON to ${file}:
{ "title": "...", "tasks": [ { "id": "m${n}-short-id", "type": "<task type>", "goal": "self-contained instruction for the worker",
  "checks": [ { "name": "...", "run": "shell command, exit 0 = pass, run in the repo root" } ] } ] }
Rules for tasks and checks:
- 3 to 8 tasks per milestone, each a coherent unit a worker can finish in one sitting, in dependency order.
- Every task needs at least one check that fails now and passes only when the task is genuinely done. Prefer tests you write now in
  tests/ (node:test, *.test.mjs, testing behaviour through public interfaces; assert every subprocess result you start). Keep pure
  logic in modules that tests can import without a browser or a bundler.
- For anything visible in a browser, add a check that runs: node ${SMOKE} --root <the directory that serves the built app> --keys "..."
  (it loads the page in a real browser, fails on console/page errors or a blank screen, and saves screenshots). If the app needs a
  build step, put the build in the same check: e.g. "npm run build && node ${SMOKE} --root dist".
- Do not write the implementation. You may write tests, fixtures and SPEC.md; nothing else.
${TYPES_HELP}`;

export function planPrompt(st, file) {
  return `You are the planner for a project that will be built autonomously by cheaper models over hours or days, with no human to ask.
THE BRIEF (from the owner):
<brief>
${st.brief}
</brief>
${st.references?.length ? `Reference images (read them with the Read tool): ${st.references.join(', ')}\n` : ''}
1. Write SPEC.md in the repo root: the product as you will hold the workers to it; every assumption you make instead of asking, marked
   "Assumption:"; the tech choices (keep them conventional and installable from npm); and "Definition of shipped": the checks that,
   all passing, mean the project is done (list them as shell commands).
2. Write the first milestone (the foundation others build on).
${PLAN_FORMAT(1, file)}
Also write ${join(dirname(file), 'ship.json')} as { "checks": [ { "name": "...", "run": "..." } ] } for the definition of shipped.
Reply with one line: the milestone title and the number of tasks.`;
}

export function reviewPrompt(st, n, file, evidence) {
  return `You are the reviewer for a project being built autonomously from a brief. You decide what happens next; no human is available.
Read SPEC.md (you wrote it; you may revise it, recording why). The brief:
<brief>
${st.brief}
</brief>
${st.references?.length ? `Reference images: ${st.references.join(', ')}\n` : ''}
Progress so far (facts, not opinions):
${evidence}
Look at the screenshots listed above with the Read tool, compare with the brief and the references, and read the code where needed.
Then write ${file} as JSON:
{ "verdict": "continue" | "ship",
  "assessment": "3-6 sentences: what works, what is missing or poor, against the brief and the references",
  "checkFixes": [ { "task": "<id>", "reason": "...", "checks": [ ...replacement checks... ] } ],   // only if a check is wrong
  "milestone": { ...next milestone, same format as before... } }      // required when verdict is continue
${PLAN_FORMAT(n, file + ' (inside "milestone")')}
Fold stuck work into the next milestone (split it, reword it, or change its checks if they were wrong). Say "ship" only when the
definition of shipped holds and the product genuinely matches the brief; otherwise plan the next most valuable milestone.
Reply with one line: the verdict and the next milestone's title.`;
}

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

function normaliseMilestone(m, n) {
  if (!m || !Array.isArray(m.tasks) || !m.tasks.length) return null;
  return { n, title: String(m.title || `milestone ${n}`), status: 'active', tasks: m.tasks.map((t, i) => ({
    id: String(t.id || `m${n}-t${i + 1}`), type: TASK_TYPES.includes(t.type) ? t.type : 'code-moderate', goal: String(t.goal || ''),
    checks: (t.checks || []).filter((c) => c && typeof c.run === 'string').map((c) => ({ name: String(c.name || c.run).slice(0, 80), run: c.run, timeoutSec: c.timeoutSec || 900 })),
    status: 'pending', attempts: 0, history: [] })) };
}

// Run one task under waypoint on the routed model. Returns {outcome, costUsd, usage, model}.
async function workTask(repo, st, ms, task, stats) {
  const model = st.policy.forceModel || pick(task.type, task.attempts, stats, st.policy.ladders || DEFAULT_LADDERS);
  const dir = apDir(repo);
  const regress = ms.tasks.filter((t) => t.status === 'done').flatMap((t) => t.checks);
  const qPath = join(dir, 'runs', `queue-${task.id}-${task.attempts}.json`);
  writeJsonAtomic(qPath, { verify: st.policy.verify, checkTimeoutSec: 900, maxBlocks: 6, stallLimit: 2,
    tasks: [{ id: task.id, goal: `${task.goal}\n\nThe product is described in SPEC.md (read it first). Commit your work with git as you go.`,
      checks: [...task.checks, ...regress.map((c) => ({ ...c, name: `regression: ${c.name}` }))] }] });
  const report = await runQueue({ cwd: repo, queuePath: qPath, model, budgetUsd: TASK_BUDGET[model] ?? 4, wallClockSec: st.policy.taskWallSec,
    configDir: st.policy.configDir, claudeBin: st.policy.claude, fresh: true, autocompact: 200000, handoff: false, log: () => {} });
  const s = report.sessions?.[0] || {};
  const usage = s.rateLimit ? parseUsage(s.rateLimit) : null;
  if (usage) st.usage = usage;
  st.spentUsd = +(st.spentUsd + (report.costUsd || 0)).toFixed(4);
  ledger(repo, { kind: 'work', task: task.id, type: task.type, model, attempt: task.attempts, outcome: report.outcome, costUsd: report.costUsd, maxContext: s.maxContext, usage });
  return { outcome: report.outcome, costUsd: report.costUsd || 0, model, limited: s.cap === 'usage-limit' };
}

function smokeEvidence(repo, st, n) {
  const out = join(apDir(repo), 'shots', `m${n}`);
  const ship = readJson(join(apDir(repo), 'ship.json'))?.checks || [];
  const smoke = ship.find((c) => c.run.includes('web-smoke'));
  if (!smoke) return { text: '(no browser smoke check in the definition of shipped)', ok: null };
  const cmd = smoke.run.includes('--out') ? smoke.run : `${smoke.run} --out ${out}`;
  const r = spawnSync('bash', ['-c', cmd], { cwd: repo, encoding: 'utf8', timeout: 900000, env: cleanEnv(null) });
  return { text: `Smoke run (${smoke.name}): exit ${r.status}\n${(r.stdout || '').slice(-3000)}${(r.stderr || '').slice(-1000)}`, ok: r.status === 0 };
}

function runChecks(repo, checks) {
  return checks.map((c) => { const r = spawnSync('bash', ['-c', c.run], { cwd: repo, encoding: 'utf8', timeout: (c.timeoutSec || 900) * 1000, env: cleanEnv(null) });
    return { name: c.name, ok: r.status === 0, tail: `${r.stdout || ''}${r.stderr || ''}`.slice(-800) }; });
}

// The loop. opts: { repo, brief?, references?, budgetUsd, deadlineHours, strongModel, claude, configDir, verify, weeklyCeiling,
//                   fiveHourCeiling, maxWorkers, forceModel, taskWallSec, log }
export async function autopilot(opts) {
  const repo = resolve(opts.repo);
  const say = opts.log || ((m) => process.stderr.write(`[autopilot ${now().slice(11, 19)}] ${m}\n`));
  mkdirSync(join(apDir(repo), 'runs'), { recursive: true });
  let st = loadAp(repo);
  if (!st) {
    if (!opts.brief) throw new Error('no autopilot state here: give a brief to start');
    st = { version: 1, brief: opts.brief, references: opts.references || [], createdAt: now(), spentUsd: 0, milestones: [], shipped: false, finished: null,
      policy: { budgetUsd: opts.budgetUsd, deadline: Date.now() + (opts.deadlineHours ?? 48) * 3600000, strongModel: opts.strongModel || 'claude-fable-5-1',
        claude: opts.claude || process.env.WAYPOINT_CLAUDE || 'claude', configDir: opts.configDir, verify: opts.verify || STANDIN_VERIFY,
        weeklyCeiling: opts.weeklyCeiling ?? 0.85, fiveHourCeiling: opts.fiveHourCeiling ?? 0.9, maxWorkers: 1, forceModel: opts.forceModel || null,
        taskWallSec: opts.taskWallSec ?? 7200 }, usage: null, paceFrom: null };
    saveAp(repo, st);
  }
  const statsPath = join(apDir(repo), 'routing.json');
  const stats = loadStats(statsPath);

  const gate = async () => {
    for (;;) {
      if (!st.usage || Date.now() - (st.usage.at || 0) > 30 * 60000) { const u = probeUsage({ claude: st.policy.claude, configDir: st.policy.configDir }); if (u) st.usage = u; }
      if (st.usage && !st.paceFrom) st.paceFrom = { at: Date.now(), util: st.usage.sevenDay?.util ?? 0 };
      const d = decide(st.usage, { weeklyCeiling: st.policy.weeklyCeiling, fiveHourCeiling: st.policy.fiveHourCeiling, maxWorkers: st.policy.maxWorkers, paceFrom: st.paceFrom });
      st.lastGate = { at: now(), ...d }; saveAp(repo, st);
      if (d.action === 'run') return d;
      const until = Math.min(d.untilMs, st.policy.deadline);
      say(`pausing until ${new Date(until).toISOString()}: ${d.reason}`);
      ledger(repo, { kind: 'pause', until: new Date(until).toISOString(), reason: d.reason });
      while (Date.now() < until) await sleep(Math.min(600000, until - Date.now()));
      st.usage = null;
      if (Date.now() >= st.policy.deadline) return d;
    }
  };
  const outOfTime = () => Date.now() >= st.policy.deadline;
  const outOfMoney = () => st.policy.budgetUsd && st.spentUsd >= st.policy.budgetUsd;

  // Plan.
  if (!st.milestones.length) {
    await gate();
    const file = join(apDir(repo), 'milestone-1.json');
    say('planning');
    const r = await strongCall(repo, st, 'plan', planPrompt(st, file), { budget: 6 });
    const m = normaliseMilestone(readJson(file), 1);
    if (!m) { st.finished = 'plan-failed'; saveAp(repo, st); throw new Error(`the planner did not write a usable milestone (${r.text.slice(0, 200)})`); }
    commitAll(repo, 'autopilot: spec, first milestone and its acceptance tests');
    st.milestones.push(m); saveAp(repo, st);
    say(`milestone 1: ${m.title} (${m.tasks.length} tasks)`);
  }

  while (!st.finished) {
    if (outOfTime()) { st.finished = 'deadline'; break; }
    if (outOfMoney()) { st.finished = 'budget'; break; }
    const ms = st.milestones.at(-1);
    const next = ms.tasks.find((t) => t.status === 'pending' || t.status === 'retry');
    if (next) {
      await gate();
      if (outOfTime()) continue;
      say(`work ${next.id} (${next.type}) attempt ${next.attempts + 1}`);
      const r = await workTask(repo, st, ms, next, stats);
      next.history.push({ at: now(), model: r.model, outcome: r.outcome, costUsd: r.costUsd });
      if (r.limited) { st.usage = { ...(st.usage || {}), status: 'rejected' }; saveAp(repo, st); continue; } // not the task's fault: retry after the reset
      record(stats, next.type, r.model, { done: r.outcome === 'done', costUsd: r.costUsd }); saveStats(statsPath, stats);
      if (r.outcome === 'done') next.status = 'done';
      else { next.attempts++; const ladder = (st.policy.ladders || DEFAULT_LADDERS)[next.type] || DEFAULT_LADDERS['code-moderate'];
        next.status = !st.policy.forceModel && next.attempts < ladder.length ? 'retry' : 'stuck'; }
      say(`  ${next.id}: ${r.outcome} on ${r.model} ($${(r.costUsd || 0).toFixed(2)}; total $${st.spentUsd.toFixed(2)})`);
      saveAp(repo, st);
      if (next.status !== 'stuck') continue;
    }
    // Review: the milestone is finished, or a task is stuck.
    ms.status = ms.tasks.every((t) => t.status === 'done') ? 'done' : 'reviewed-with-stuck';
    await gate();
    const n = ms.n + 1;
    const smoke = smokeEvidence(repo, st, ms.n);
    const ship = readJson(join(apDir(repo), 'ship.json'))?.checks || [];
    const shipResults = runChecks(repo, ship);
    const shots = existsSync(join(apDir(repo), 'shots', `m${ms.n}`)) ? readdirSync(join(apDir(repo), 'shots', `m${ms.n}`)).filter((f) => f.endsWith('.png')).map((f) => join(apDir(repo), 'shots', `m${ms.n}`, f)) : [];
    const evidence = [
      `Milestones so far: ${st.milestones.map((m) => `${m.n}. ${m.title} [${m.tasks.map((t) => `${t.id}:${t.status}`).join(', ')}]`).join('\n')}`,
      `git log (latest 40):\n${git(repo, 'log', '--oneline', '-40')}`,
      `Stuck tasks: ${ms.tasks.filter((t) => t.status === 'stuck').map((t) => `${t.id} (${t.history.map((h) => `${h.model}:${h.outcome}`).join(', ')})`).join('; ') || 'none'}`,
      `Definition-of-shipped checks now: ${shipResults.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.ok ? '' : `\n  ${c.tail.replace(/\n/g, '\n  ').slice(-500)}`}`).join('\n') || '(none)'}`,
      smoke.text, `Screenshots: ${shots.join(', ') || '(none)'}`,
      `Model routing learned so far:\n${routingSummary(stats) || '(nothing yet)'}`,
      `Spent $${st.spentUsd.toFixed(2)} of $${st.policy.budgetUsd}; ${((st.policy.deadline - Date.now()) / 3600000).toFixed(1)} h left.`,
    ].join('\n\n');
    say(`review after milestone ${ms.n}`);
    const file = join(apDir(repo), `review-${ms.n}.json`);
    await strongCall(repo, st, 'review', reviewPrompt(st, n, file, evidence), { budget: 6 });
    const rv = readJson(file);
    if (!rv) { say('review wrote nothing usable; retrying once'); await strongCall(repo, st, 'review', reviewPrompt(st, n, file, evidence), { budget: 6 }); }
    const review = readJson(file) || { verdict: 'continue' };
    ms.review = { verdict: review.verdict, assessment: review.assessment };
    if (review.verdict === 'ship' && shipResults.every((c) => c.ok) && (smoke.ok !== false)) { st.finished = 'shipped'; st.shipped = true; commitAll(repo, 'autopilot: shipped'); saveAp(repo, st); break; }
    const nm = normaliseMilestone(review.milestone, n);
    if (!nm) { st.finished = 'review-failed'; saveAp(repo, st); break; }
    commitAll(repo, `autopilot: review of milestone ${ms.n}; milestone ${n} planned`);
    st.milestones.push(nm); saveAp(repo, st);
    say(`milestone ${n}: ${nm.title} (${nm.tasks.length} tasks)`);
  }
  saveAp(repo, st);
  say(`finished: ${st.finished}; spent $${st.spentUsd.toFixed(2)}`);
  return st;
}

export function statusText(st) {
  if (!st) return 'no autopilot state here\n';
  const lines = [`finished: ${st.finished ?? 'no'}  spent: $${st.spentUsd.toFixed(2)}${st.policy.budgetUsd ? ` of $${st.policy.budgetUsd}` : ''}  deadline: ${new Date(st.policy.deadline).toISOString()}`];
  if (st.usage) lines.push(`usage: 5-hour ${Math.round((st.usage.fiveHour?.util ?? 0) * 100)}%, weekly ${Math.round((st.usage.sevenDay?.util ?? 0) * 100)}%  last gate: ${st.lastGate?.reason ?? '-'}`);
  for (const m of st.milestones) {
    lines.push(`milestone ${m.n}: ${m.title} [${m.status}]${m.review ? ` -> ${m.review.verdict}` : ''}`);
    for (const t of m.tasks) lines.push(`  ${t.status.padEnd(7)} ${t.id.padEnd(28)} ${t.type.padEnd(14)} ${t.history.map((h) => `${h.model}:${h.outcome}`).join(' ')}`);
  }
  return lines.join('\n') + '\n';
}
