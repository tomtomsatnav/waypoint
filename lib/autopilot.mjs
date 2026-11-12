// The autopilot: one brief in, a shipped project out, running for as long as it takes.
//
//   research a cheaper model (with web search) writes EXPECTATIONS.md: what users of this kind of product take for granted
//           that the brief does not say (for a game: camera, controls, feel), each with a check; the planner must cover them
//   plan    a strong model turns the brief into SPEC.md (its assumptions recorded, "shipped" defined), the first milestone's
//           tasks (each with a type) and visible acceptance tests, committed before any work starts
//   work    each task runs under waypoint (Stop-hook finish line) on the model routing.mjs picks for its type; a blocked task
//           climbs the model ladder; earlier tasks' checks stay in the finish line
//   review  after a milestone, or when a task is stuck, a reviewer (Sonnet by default) looks at git, the checks and screenshots
//           of the running app and decides: next milestone, fixes, changed checks, or ship; the strong model confirms a ship
//   roles   (owner's design, 11 Nov) the strong model does all the thinking: research, the spec, milestones, tasks and checks,
//           every review decision and the diagnosis of stuck tasks; cheap models do the rest: Haiku builds (Sonnet only as
//           the second try, or first for UI), and a cheap tester plays each milestone and reports with screenshots, so the
//           strong model decides from evidence instead of spending its budget driving a browser
//   overhead research, planning and reviews together are held to policy.overheadShare (30%) of the budget, so most of the
//           money goes to building (in E13 Fable reviews alone took 56%); past the cap, reviews go light and cheap
//   stuck   before a blocked task climbs the model ladder, the researcher looks into why and its notes go to the next attempt
//   parallel tasks the planner marks independent run side by side (up to policy.maxWorkers, as usage allows), each in its own
//           git worktree; a finished one merges in the latest work, passes every check again, and only then fast-forwards
//           main; one that conflicts runs again on its own
//   shape   what is left of the 5-hour window sets each attempt's effort and model: near the reset with room to spare, hard
//           tasks start a rung up at high effort; when it is nearly spent, effort drops, reviews go light and work that
//           needs the strongest model waits for the reset
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
import { decide, parseUsage, probeUsage, pressure, shapeAttempt } from './usage.mjs';
import { pick, record, loadStats, saveStats, summary as routingSummary, DEFAULT_LADDERS, TASK_TYPES } from './routing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SMOKE = resolve(HERE, '..', 'scripts', 'web-smoke.mjs');
// The default finish-line guard: no test that existed when a task started may be modified or deleted. (aos-orch verify is
// stricter but rejected every change to a repo whose existing tests it disliked; pass --verify to use it.)
export const STANDIN_VERIFY = "git diff --quiet --diff-filter=DM {base} -- ':(glob)**/test/**' ':(glob)**/tests/**' ':(glob)**/*.test.mjs' ':(glob)**/*.test.js' ':(glob)**/*.test.ts'";
const TASK_BUDGET = { haiku: 3, sonnet: 6, opus: 10 };
// Builders (owner's rule): Haiku codes from the plan, Sonnet does UI; each gets one step up if it needs a better model
// (Haiku -> Sonnet, Sonnet -> Opus). A task that defeats both goes back to the strong model to be rethought (split,
// reworded, its checks fixed) rather than further up.
export const CHEAP_LADDERS = {
  'code-simple': ['haiku', 'sonnet'], 'code-moderate': ['haiku', 'sonnet'], 'code-complex': ['haiku', 'sonnet'],
  'test-writing': ['haiku', 'sonnet'], docs: ['haiku', 'sonnet'],
  architecture: ['sonnet', 'opus'], 'ui-design': ['sonnet', 'opus'], 'visual-polish': ['sonnet', 'opus'],
};

// Which tests are frozen. The stand-in guard used to freeze every test that existed when a task started; in E13b that froze
// flaky tests earlier workers had written, and later tasks could not fix them ("blocked on frozen-file edits"). Now only the
// acceptance tests the planner and reviewers wrote are frozen; workers may fix any other test.
export const TEST_FILE = /(^|\/)tests?\/|\.test\.(mjs|cjs|js|ts)$/;
const shq = (f) => `'${f.replace(/'/g, `'\\''`)}'`;
export function acceptanceGuard(st) {
  if (st.policy.verify !== STANDIN_VERIFY || !Array.isArray(st.protectedTests)) return { verify: st.policy.verify, guardText: true }; // older runs
  const files = st.protectedTests;
  if (!files.length) return { verify: null, guardText: 'Every test in the repo is yours to fix when it is wrong; do not weaken a test just to make it pass.' };
  const shown = files.slice(0, 20).join(', ') + (files.length > 20 ? `, and ${files.length - 20} more` : '');
  return { verify: `git diff --quiet --diff-filter=DM {base} -- ${files.map(shq).join(' ')}`,
    guardText: `The acceptance tests the planner wrote (${shown}) must not be edited, skipped or deleted: they define done. Every other test, including ones earlier workers wrote, is yours to fix when it is wrong; do not weaken a test just to make it pass.` };
}

// After a plan or review commit, freeze the test files it added or changed: those are acceptance tests.
function protectNewTests(repo, st, before) {
  if (!Array.isArray(st.protectedTests)) return;
  const after = git(repo, 'rev-parse', 'HEAD');
  if (!before || after === before) return;
  const files = git(repo, 'diff', '--name-only', '--diff-filter=AM', before, after).split('\n').filter((f) => f && TEST_FILE.test(f));
  st.protectedTests = [...new Set([...st.protectedTests, ...files])];
}
// How long one attempt may run. In E13b three attempts at a routine task each ran their full 2 hours waiting on a browser test
// that never finished; a routine task that is working ends well inside 45 minutes.
export const TASK_WALL_SEC = { 'code-simple': 2700, 'code-moderate': 2700, 'test-writing': 2700, docs: 2700 };
export const taskWallSec = (st, type) => st.policy.taskWallSec || TASK_WALL_SEC[type] || 5400;

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
async function strongCall(repo, st, kind, prompt, { budget = 4, wallSec = 3600, model = st.policy.strongModel, web = false, overhead = true } = {}) {
  if (st.policy.unlimited) budget = Infinity; // no-budget mode: no spending cap on any call (plan usage limits still pause the run)
  const dir = apDir(repo);
  const logPath = join(dir, 'runs', `${kind}-${Date.now()}.jsonl`);
  const tools = `Read,Glob,Grep,Bash,Write,Edit${web ? ',WebSearch,WebFetch' : ''}`;
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', model, ...(budget === Infinity ? [] : ['--max-budget-usd', String(+budget.toFixed(2))]),
    '--strict-mcp-config', '--tools', tools, '--allowedTools', tools,
    '--permission-mode', 'acceptEdits', '--session-id', randomUUID(), '--autocompact', '200000',
    ...(process.env.WAYPOINT_SETTING_SOURCES ? ['--setting-sources', process.env.WAYPOINT_SETTING_SOURCES] : [])];
  const s = await runSession({ bin: st.policy.claude, args, env: cleanEnv(st.policy.configDir), cwd: repo, logPath, wallClockSec: wallSec });
  const usage = s.rateLimit ? parseUsage(s.rateLimit) : null;
  if (usage) st.usage = usage;
  st.spentUsd = +(st.spentUsd + (s.costUsd || 0)).toFixed(4);
  if (overhead) st.overheadUsd = +((st.overheadUsd || 0) + (s.costUsd || 0)).toFixed(4); // the thinking calls are overhead; the tester is work
  ledger(repo, { kind, model, costUsd: s.costUsd, ok: !s.killed && !s.result?.is_error, usage });
  const ended = s.killed ? `killed: ${s.killed}` : s.result ? `${s.result.subtype}${s.result.terminal_reason ? `, ${s.result.terminal_reason}` : ''}, $${(s.costUsd || 0).toFixed(2)}` : `no result (exit ${s.exitCode})`;
  return { ok: !s.killed && !s.result?.is_error, text: s.result?.result || '', ended, costUsd: s.costUsd || 0, usage, limited: s.rateLimit?.status === 'rejected' };
}

// What is left of the overhead allowance (research + plan + reviews), in dollars. Unlimited without a budget.
export function overheadLeft(st) {
  if (!st.policy.budgetUsd) return Infinity;
  return (st.policy.overheadShare ?? 0.3) * st.policy.budgetUsd - (st.overheadUsd || 0);
}

// How the next review runs: the strong model decides, from the tester's report, within what is left of the allowance; with
// little left, or the 5-hour window nearly spent, it gets a small fixed budget so the loop can always plan its next milestone.
export function reviewSpec(st, level = 'normal') {
  const left = overheadLeft(st);
  const model = st.policy.reviewModel || st.policy.strongModel || 'claude-fable-5-1';
  if (level === 'tight' || left < 1) return { model, budget: 1, light: true };
  return { model, budget: Math.min(st.policy.reviewBudget ?? 3, left), light: false };
}

const TYPES_HELP = `Task types (the model is chosen from the type, so type honestly): ${TASK_TYPES.join(', ')}. Use code-simple|moderate|complex for
programming, ui-design for layout and look-and-feel decisions, visual-polish for refining how it looks, architecture for structural
decisions, test-writing, docs.`;

const PLAN_FORMAT = (n, file) => `Write the milestone as JSON to ${file}:
{ "title": "...", "tasks": [ { "id": "m${n}-short-id", "type": "<task type>", "after": ["m${n}-other-id"], "goal": "self-contained instruction for the worker",
  "checks": [ { "name": "...", "run": "shell command, exit 0 = pass, run in the repo root" } ] } ] }
Rules for tasks and checks:
- 3 to 8 tasks per milestone, each a coherent unit a worker can finish in one sitting, in dependency order.
- Give every task "after": the ids of the tasks it truly needs ([] for none). Tasks that need nothing from each other and do
  not edit the same files run at the same time, each in its own copy of the repo, so split work to make that possible
  (e.g. server module and client screen) but never at the cost of two tasks editing one file.
- Every task needs at least one check that fails now and passes only when the task is genuinely done. Prefer tests you write now in
  tests/ (node:test, *.test.mjs, testing behaviour through public interfaces; assert every subprocess result you start). Keep pure
  logic in modules that tests can import without a browser or a bundler.
- Every test must finish on its own: give it a timeout (node --test --test-timeout=120000), close any browser in a finally
  block, and stop any server it starts in an after hook. A check whose command can hang stops the whole project.
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
${st.references?.length ? `Reference images (read them with the Read tool): ${st.references.join(', ')}\n` : ''}${st.approach ? `A technical researcher wrote APPROACH.md (read it): the hardest technical problems, recommended libraries and
techniques, reference projects and practices. It is advice, not requirements: use it to choose the tech in SPEC.md and to
shape tasks, and record in SPEC.md where you depart from it and why.
` : ''}${st.expectations ? `A researcher wrote EXPECTATIONS.md (read it): what users of this kind of product take for granted that the brief does not
say, each with a check. Treat every item as part of the brief unless it contradicts the brief: each becomes a feature in
FEATURES.json, and the milestones must cover them.
` : ''}
1. Write SPEC.md in the repo root: the product as you will hold the workers to it, written as what and why, not how (over-specified
   implementation detail cascades into errors); every assumption you make instead of asking, marked "Assumption:"; the tech choices
   (conventional, installable from npm); an init.sh that installs, builds and serves the app so any session can run it in one step;
   and "Definition of shipped": the checks that, all passing, mean the project is done (shell commands).
2. Write the first milestone: a thin slice of the whole product that a person can already use end to end, rough but real
   (for a game: start it, log in, move with the controls and camera a player expects, meet the core loop once). Later
   milestones deepen and widen it. Do not build every system's foundation first: a person judges what they can use.
${PLAN_FORMAT(1, file)}
   Also write ${join(dirname(file), 'ship.json')} as { "checks": [ { "name": "...", "run": "..." } ] } for the definition of shipped.
3. Last, write FEATURES.json in the repo root: every user-visible feature the brief implies, as
   [ { "id": "...", "category": "...", "description": "...", "steps": ["how a person would verify it in the running app"], "passes": false } ].
   Be exhaustive but terse (one short line per field): a brief like this implies well over a hundred. Workers may only ever
   change "passes"; the reviewer verifies it.
Write the files in this order (the run cannot start without the milestone and ship.json), and keep each one as short as it can be.
Reply with one line: the milestone title and the number of tasks.`;
}

// The planner's second chance: the first call ended before the milestone was written (usually its budget).
export function planContinuePrompt(st, file, why) {
  return `You are the planner for a project that will be built autonomously from the brief in BRIEF.md (read it, and
EXPECTATIONS.md and APPROACH.md if present). Your previous planning run stopped before it finished (${why}). Keep whatever it
already wrote (SPEC.md, FEATURES.json, tests): read them, do not start again, and finish only what is missing, in this order:
SPEC.md (if missing or cut short), then the first milestone, then ship.json, then FEATURES.json (terse) if missing.
${PLAN_FORMAT(1, file)}
Also write ${join(dirname(file), 'ship.json')} as { "checks": [ { "name": "...", "run": "..." } ] } for the definition of shipped.
Reply with one line: the milestone title and the number of tasks.`;
}

export function testerPrompt(st, ms, reportFile, shotsDir) {
  return `You are the tester for a project being built autonomously from a brief; a planner will decide what happens next from
your report, so be accurate and specific, not kind. Do not change any code.
Milestone ${ms.n} has just ended: "${ms.title}". Its tasks: ${ms.tasks.map((t) => `${t.id} (${t.status})`).join(', ')}.
1. Start the app as SPEC.md and init.sh say (./init.sh, or the build and start commands).
2. Play it in a real browser with a short Playwright script via Bash (require('playwright') works; chromium.launch() needs no
   options): try what this milestone was meant to deliver, using the steps in FEATURES.json for its features${st.expectations ? ' and the checks in EXPECTATIONS.md' : ''},
   as a user of this kind of product would. Save screenshots of what you see into ${shotsDir} (PNG, named for what they show).
3. Write ${reportFile} in Markdown: what works (with the screenshot that shows it), what is broken or missing (exact steps,
   what happened, console or server errors), how it looks against the references in references/, and anything that would
   annoy a player. At most 80 lines.
Stop the app when you are done. Reply with one line: how many things work and how many are broken.`;
}

export function reviewPrompt(st, n, file, evidence, { light = false, confirm = false, report = null } = {}) {
  const play = report
    ? `A tester played the build and wrote the report below; Read its screenshots (listed in the report) before you decide.
Do not run the app yourself unless the report contradicts itself or misses something you must see.
<tester-report>
${report.slice(0, 12000)}
</tester-report>`
    : light
    ? `Budget is tight: do not run the app or a browser. Judge from the evidence below and the code, then write the file.`
    : `Run the app yourself (./init.sh or the build command, then drive it in a real browser with a short Playwright script
via Bash: require('playwright') works, chromium.launch() needs no options; take screenshots and Read them) and play it as an
experienced user of this kind of product would${st.expectations ?', checking EXPECTATIONS.md as well as the brief' : ''}. Keep the play
session short and write the file before your budget runs out.`;
  const role = confirm
    ? `You are the final reviewer: the reviewer below wants to ship. Confirm only if a person given the brief would be satisfied.`
    : `You are the reviewer for a project being built autonomously from a brief. You decide what happens next; no human is available.`;
  return `${role}
Read SPEC.md (you wrote it; you may revise it, recording why). The brief:
<brief>
${st.brief}
</brief>
${st.references?.length ? `Reference images: ${st.references.join(', ')}\n` : ''}
Progress so far (facts, not opinions):
${evidence}
Be a sceptical QA lead, not a cheerleader: a model reviewing work tends to find real problems and then talk itself into approving
anyway; do not. ${play}
Compare with the brief, the references${st.expectations ? ' and EXPECTATIONS.md' : ''}. Then update FEATURES.json: set "passes" true only for features you saw working end to
end, false for any that are broken (a feature marked passing that does not work is a regression; fix the flag and plan the fix).
Score design quality, originality, craft and functionality 1-5 each in your assessment.
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

export function researchPrompt(st) {
  return `You are the researcher for a project that will be planned and built autonomously from the brief below, with no human
to ask. Your job: find what the brief leaves unsaid but the people who use this kind of product take for granted, so the plan
does not miss it.
<brief>
${st.brief}
</brief>
Use WebSearch and WebFetch to look at two to four comparable products and how they work (if the web tools are unavailable,
use what you know). Then write EXPECTATIONS.md in the repo root with three sections:
- Conventions: controls, camera, navigation, UI, feedback and feel that users of this kind of product expect.
- What comparable products all have that the brief does not mention.
- Pitfalls: technical problems typical of this kind of build and how others avoid them.
Every item is one line: the expectation, then "Check:" and a concrete way a tester verifies it in the running product.
Drop anything you cannot give a check, anything the brief already says, and anything that contradicts the brief. At most 40
items, the most important first. Do not write code. Reply with one line: the number of items.`;
}

export function approachPrompt(st) {
  return `You are the technical researcher for a project that will be planned and built autonomously from the brief below, by
cheaper models following a plan, with no human to ask. Your job: find out how the hardest parts of this are best built today,
so the plan starts from proven approaches instead of trial and error.
<brief>
${st.brief}
</brief>
${st.expectations ? 'EXPECTATIONS.md (already in the repo) lists what users will expect; read it too.\n' : ''}First pick out the three to six hardest technical problems the brief poses. Then use WebSearch and WebFetch (if they are
unavailable, use what you know, and say so) to find how they are solved well now: libraries, engines and techniques, their
current versions and licences, and open-source projects that solve the same problems. Write APPROACH.md in the repo root:
- Hard problems: each one in a line or two.
- Tech choices: for each hard problem, the recommended library or technique (npm-installable where it is a library), why it
  suits this brief, its licence, and a source link; one alternative and when to prefer it.
- Reference projects: two to six open-source repositories worth studying for how they solve these problems, with a link,
  their licence, and what exactly to look at. They are for learning how something is done; code may only be copied where the
  licence allows it, with attribution.
- Practices: architecture (game loop, state, entity or scene structure, data-driven content), performance budgets and how to
  measure them, and how to test this kind of product automatically.
This is advice for the planner, not requirements: never contradict the brief, and prefer boring, well-maintained choices. At
most 120 lines. Do not write code. Reply with one line: the hard problems you found.`;
}

export function stuckResearchPrompt(task, failing, notesFile) {
  return `You are the researcher for an autonomous build. A worker could not finish this task; before a stronger model tries,
find out why and how it is usually done.
Task ${task.id}: ${task.goal}
Checks still failing:
${failing || '(none recorded)'}
Look at the code in the repo (do not change it) and, where it helps, search the web for how others solve this. Write at most 40
lines of concrete notes to ${notesFile}: the likely cause, the approach that works, and pitfalls to avoid. Do not write code
in the repo. Reply with one line: the likely cause.`;
}

// Models writing JSON by hand often keep the // comments from the format they were shown, leave trailing commas, or wrap
// the object in prose or a code fence (E14b's milestone-2 review was lost that way). Read it tolerantly.
export function parseLooseJson(text) {
  try { return JSON.parse(text); } catch { /* try harder */ }
  let t = String(text).replace(/^\uFEFF/, '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) t = t.slice(a, b + 1);
  let out = '', inStr = false, esc = false; // drop // and /* */ comments outside strings
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && t[i + 1] === '/') { while (i < t.length && t[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && t[i + 1] === '*') { i = t.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
    out += c;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(out); } catch { return null; }
}
function readJson(p) { try { return parseLooseJson(readFileSync(p, 'utf8')); } catch { return null; } }

function normaliseMilestone(m, n) {
  if (!m || !Array.isArray(m.tasks) || !m.tasks.length) return null;
  return { n, title: String(m.title || `milestone ${n}`), status: 'active', tasks: m.tasks.map((t, i) => ({
    id: String(t.id || `m${n}-t${i + 1}`), type: TASK_TYPES.includes(t.type) ? t.type : 'code-moderate', goal: String(t.goal || ''),
    checks: (t.checks || []).filter((c) => c && typeof c.run === 'string').map((c) => ({ name: String(c.name || c.run).slice(0, 80), run: c.run, timeoutSec: c.timeoutSec || 900 })),
    after: Array.isArray(t.after) ? t.after.map(String) : null,
    status: 'pending', attempts: 0, history: [] })) };
}

// Tasks that can start now: pending or retry, with everything they come after done. A task without "after" comes after every
// task listed before it (the old, one-at-a-time order); "after": [] means it needs nothing.
// In no-budget mode only real closeness to a limit lowers effort (under 15% of the 5-hour window, or weekly use past 75%);
// running ahead of an even weekly pace does not (owner, 12 Nov). Budgeted runs keep the even pacing.
export function pressurePolicy(st) {
  return { fiveHourCeiling: st.policy.fiveHourCeiling, weeklyCeiling: st.policy.weeklyCeiling, paceFrom: st.paceFrom,
    paceTight: !st.policy.unlimited, weeklyTight: st.policy.unlimited ? 0.75 : null };
}

export function readyTasks(ms) {
  const done = new Set(ms.tasks.filter((t) => t.status === 'done').map((t) => t.id));
  const ids = new Set(ms.tasks.map((t) => t.id));
  return ms.tasks.filter((t, i) => (t.status === 'pending' || t.status === 'retry')
    && (t.after ?? ms.tasks.slice(0, i).map((x) => x.id)).every((id) => done.has(id) || !ids.has(id)));
}

export function addWorktree(repo, task) {
  const name = `${task.id}-${task.attempts}-${Date.now().toString(36)}`;
  const dir = join(apDir(repo), 'wt', name), br = `autopilot/${name}`;
  mkdirSync(dirname(dir), { recursive: true });
  const r = spawnSync('git', ['worktree', 'add', '-q', '-b', br, dir, 'HEAD'], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git worktree add failed: ${r.stderr}`);
  return { dir, br };
}

export function dropWorktree(repo, wt) {
  spawnSync('git', ['worktree', 'remove', '--force', wt.dir], { cwd: repo });
  spawnSync('git', ['branch', '-D', '-q', wt.br], { cwd: repo });
}

// Bring a finished worker's branch into main: merge main's latest work into the branch, run every given check there, and
// only if all pass fast-forward main to it. Main never holds a combination that has not passed.
export function integrate(repo, wt, checks) {
  commitAll(wt.dir, 'autopilot: worker leftovers');
  const before = git(wt.dir, 'rev-parse', 'HEAD');
  const pkg = (rev) => spawnSync('git', ['show', `${rev}:package.json`], { cwd: wt.dir, encoding: 'utf8' }).stdout || '';
  const m = spawnSync('git', ['-c', 'user.name=autopilot', '-c', 'user.email=autopilot@localhost', 'merge', '--no-ff', '--no-edit', '-q', git(repo, 'rev-parse', 'HEAD')], { cwd: wt.dir, encoding: 'utf8' });
  if (m.status !== 0) { spawnSync('git', ['merge', '--abort'], { cwd: wt.dir }); return { ok: false, why: 'merge conflict with work merged meanwhile' }; }
  if (pkg('HEAD') && pkg('HEAD') !== pkg(before)) spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: wt.dir, timeout: 900000, env: cleanEnv(null) });
  const bad = runChecks(wt.dir, checks).filter((c) => !c.ok);
  if (bad.length) return { ok: false, why: `checks fail on top of the latest work: ${bad.map((c) => c.name).join(', ').slice(0, 200)}` };
  const ff = spawnSync('git', ['merge', '--ff-only', '-q', wt.br], { cwd: repo, encoding: 'utf8' });
  if (ff.status !== 0) return { ok: false, why: `could not fast-forward main: ${(ff.stderr || '').slice(0, 200)}` };
  return { ok: true };
}

// Run one task under waypoint on the routed model. Returns {outcome, costUsd, usage, model}.
async function workTask(repo, st, ms, task, stats, { cwd = repo, slot = 0, model: chosen, effort, parallel = false } = {}) {
  const model = chosen || st.policy.forceModel || pick(task.type, task.attempts, stats, st.policy.ladders || DEFAULT_LADDERS);
  const dir = apDir(repo);
  const regress = ms.tasks.filter((t) => t.status === 'done').flatMap((t) => t.checks);
  const qPath = join(dir, 'runs', `queue-${task.id}-${task.attempts}${parallel ? `-w${slot}` : ''}.json`);
  const guard = acceptanceGuard(st);
  writeJsonAtomic(qPath, { verify: guard.verify, guardText: guard.guardText, checkTimeoutSec: 900, maxBlocks: 6, stallLimit: 2,
    tasks: [{ id: task.id, goal: `${task.goal}\n\nThe product is described in SPEC.md (read it first). Commit your work with git as you go.`,
      checks: [...task.checks, ...regress.map((c) => ({ ...c, name: `regression: ${c.name}` }))] }] });
  // The worker's standing instructions follow the long-running-harness practice: orient from facts, run the app, test like a user.
  const q = JSON.parse(readFileSync(qPath, 'utf8'));
  const notes = join(dir, 'research', `${task.id}.md`);
  if (parallel) q.tasks[0].goal += `\n\nOther workers are building other tasks at the same time in their own copies of the repo; stay within this task. If you start a server, listen on the port in $PORT (${3200 + slot * 10}), not a fixed one.`;
  if (existsSync(notes)) q.tasks[0].goal += `\n\nA previous attempt at this task failed. Notes from looking into why:\n${readFileSync(notes, 'utf8').slice(0, 6000)}`;
  q.tasks[0].goal += '\n\nStart by reading SPEC.md, PROGRESS.md (if present), APPROACH.md (if present: technical advice on libraries, techniques and reference projects) and git log, and run ./init.sh to check the app still works before changing anything. Test what you build in a real browser as a user would (a short Playwright script via Bash works). Run tests in the foreground with a time limit (node --test --test-timeout=120000 ...), never in the background with a loop that waits for their output: a test that does not finish within its limit is a bug to fix (a missing timeout, a server or browser left open, an event that never comes), not something to wait for. When the task is done, append two or three lines to PROGRESS.md (what you did, what is next) and set "passes": true in FEATURES.json only for features you verified end to end. Never edit or delete anything else in FEATURES.json.';
  writeJsonAtomic(qPath, q);
  const report = await runQueue({ cwd, queuePath: qPath, model, effort, env: { PORT: String(3200 + slot * 10) }, budgetUsd: st.policy.unlimited ? Infinity : (TASK_BUDGET[model] ?? 4), wallClockSec: taskWallSec(st, task.type),
    configDir: st.policy.configDir, claudeBin: st.policy.claude, fresh: true, autocompact: 200000, handoff: false, log: () => {} });
  const s = report.sessions?.[0] || {};
  const usage = s.rateLimit ? parseUsage(s.rateLimit) : null;
  if (usage) st.usage = usage;
  // A session killed before it reports (wall clock, a crash) spent an unknown amount up to its cap: count the cap, so the
  // budget is never undercounted (E13b recorded $0.00 for three two-hour attempts).
  const unknown = (report.sessions || []).filter((x) => x.costUsd == null).length;
  if (unknown && !st.policy.unlimited) report.costUsd = (report.costUsd || 0) + unknown * (TASK_BUDGET[model] ?? 4);
  st.spentUsd = +(st.spentUsd + (report.costUsd || 0)).toFixed(4);
  ledger(repo, { kind: 'work', task: task.id, type: task.type, model, effort: effort || null, slot, costEstimated: unknown > 0, attempt: task.attempts, outcome: report.outcome, costUsd: report.costUsd, maxContext: s.maxContext, usage });
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
      protectedTests: [],
      policy: { budgetUsd: opts.budgetUsd || null, unlimited: !opts.budgetUsd, deadline: Date.now() + (opts.deadlineHours ?? 48) * 3600000, strongModel: opts.strongModel || 'claude-fable-5-1',
        claude: opts.claude || process.env.WAYPOINT_CLAUDE || 'claude', configDir: opts.configDir, verify: opts.verify || STANDIN_VERIFY,
        weeklyCeiling: opts.weeklyCeiling ?? 0.85, fiveHourCeiling: opts.fiveHourCeiling ?? 0.9, maxWorkers: opts.maxWorkers ?? 1, forceModel: opts.forceModel || null, // parallel workers stay off until a real run needs them
        taskWallSec: opts.taskWallSec ?? null, reviewModel: opts.reviewModel || null, researchModel: opts.researchModel || null,
        testerModel: opts.testerModel || 'haiku', ladders: opts.ladders || CHEAP_LADDERS,
        overheadShare: opts.overheadShare ?? 0.3, research: opts.research !== false }, usage: null, paceFrom: null, overheadUsd: 0 };
    saveAp(repo, st);
  }
  // On resume, the owner may raise the budget or extend the deadline.
  if (opts.budgetUsd && opts.budgetUsd !== st.policy.budgetUsd) { st.policy.budgetUsd = opts.budgetUsd; if (st.finished === 'budget') st.finished = null; }
  if (st.finished === 'plan-failed' || st.finished === 'review-failed') st.finished = null; // a resume tries again
  if (opts.deadlineHours && st.createdAt) { const d = Date.now() + opts.deadlineHours * 3600000; if (d > st.policy.deadline) { st.policy.deadline = d; if (st.finished === 'deadline') st.finished = null; } }
  saveAp(repo, st);
  spawnSync('git', ['worktree', 'prune'], { cwd: repo }); // workers interrupted by a restart start again
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

  // Research: what the brief leaves unsaid.
  if (!st.milestones.length && st.policy.research !== false && !st.researched) {
    await gate();
    say('researching what users of this kind of product expect');
    const budget = Math.min(3, Math.max(0.5, overheadLeft(st)));
    await strongCall(repo, st, 'research', researchPrompt(st), { model: st.policy.researchModel || st.policy.strongModel, budget, web: true, wallSec: 1800 });
    st.expectations = existsSync(join(repo, 'EXPECTATIONS.md'));
    st.researched = true; saveAp(repo, st);
    if (st.expectations) commitAll(repo, 'autopilot: research: EXPECTATIONS.md');
  }
  // Technical research: how the hardest parts are best built (advice for the plan, not requirements).
  if (!st.milestones.length && st.policy.research !== false && !st.approachResearched) {
    await gate();
    say('researching how the hardest parts are best built');
    await strongCall(repo, st, 'research-approach', approachPrompt(st), { model: st.policy.researchModel || st.policy.strongModel, budget: Math.min(3, Math.max(0.5, overheadLeft(st))), web: true, wallSec: 1800 });
    st.approach = existsSync(join(repo, 'APPROACH.md'));
    st.approachResearched = true; saveAp(repo, st);
    if (st.approach) commitAll(repo, 'autopilot: research: APPROACH.md');
  }

  // Plan.
  if (!st.milestones.length) {
    await gate();
    const file = join(apDir(repo), 'milestone-1.json');
    say('planning');
    const r = await strongCall(repo, st, 'plan', planPrompt(st, file), { budget: Math.min(10, Math.max(5, overheadLeft(st))) });
    let m = normaliseMilestone(readJson(file), 1);
    if (!m) {
      say(`the planner stopped before writing the first milestone (${r.ended}); giving it a second, shorter run`);
      const r2 = await strongCall(repo, st, 'plan-continue', planContinuePrompt(st, file, r.ended), { budget: Math.min(6, Math.max(3, overheadLeft(st))) });
      m = normaliseMilestone(readJson(file), 1);
      if (!m) { st.finished = 'plan-failed'; saveAp(repo, st); throw new Error(`the planner did not write a usable milestone (first run: ${r.ended}; second: ${r2.ended}) ${r2.text.slice(0, 200)}`); }
    }
    const before = git(repo, 'rev-parse', 'HEAD');
    commitAll(repo, 'autopilot: spec, first milestone and its acceptance tests');
    protectNewTests(repo, st, before);
    st.milestones.push(m); saveAp(repo, st);
    say(`milestone 1: ${m.title} (${m.tasks.length} tasks)`);
  }

  while (!st.finished) {
    if (outOfTime()) { st.finished = 'deadline'; break; }
    if (outOfMoney()) { st.finished = 'budget'; break; }
    const ms = st.milestones.at(-1);
    const ready = readyTasks(ms);
    if (ready.length && !ms.tasks.some((t) => t.status === 'stuck')) {
      const d = await gate();
      if (outOfTime()) continue;
      // How hard to push, from what is left of the 5-hour window: effort, model, and which work waits for the reset.
      const pr = pressure(st.usage, pressurePolicy(st));
      st.pressure = { at: now(), ...pr };
      const ladderOf = (t) => (st.policy.ladders || DEFAULT_LADDERS)[t.type] || DEFAULT_LADDERS['code-moderate'];
      const shaped = ready.map((t) => {
        const model = st.policy.forceModel || pick(t.type, t.attempts, stats, st.policy.ladders || DEFAULT_LADDERS);
        const sh = st.policy.forceModel ? { model, effort: null, wait: false } : shapeAttempt({ type: t.type, attempt: t.attempts, model, ladder: ladderOf(t), level: pr.level, canWait: pr.canWait });
        return { t, ...sh };
      });
      const runnable = shaped.filter((x) => !x.wait);
      if (!runnable.length) { // everything ready needs a strong model and the window is nearly spent: wait for the reset
        const until = Math.min((pr.resetsAt || Date.now() + 3600000) + 60000, st.policy.deadline);
        say(`pausing until ${new Date(until).toISOString()}: ${shaped.map((x) => x.why).join('; ')}`);
        ledger(repo, { kind: 'pause', until: new Date(until).toISOString(), reason: 'strong-model work waits for the 5-hour reset' });
        while (Date.now() < until) await sleep(Math.min(600000, until - Date.now()));
        st.usage = null; continue;
      }
      // How many at once: what the usage allows, the policy's cap, and one per conflict-free task. Pairs that have
      // conflicted before run alone.
      const width = Math.max(1, Math.min(d.workers || 1, st.policy.maxWorkers || 1, runnable.length));
      const batch = width > 1 ? runnable.filter((x) => !x.t.solo).slice(0, width) : [];
      if (batch.length < 2) batch.splice(0, batch.length, runnable[0]);
      const parallel = batch.length > 1;
      say(`${parallel ? `${batch.length} workers` : 'work'} [${pr.level}: ${pr.reason}] ${batch.map((x) => `${x.t.id} (${x.t.type}, ${x.model}/${x.effort || 'default'}${x.why ? `; ${x.why}` : ''}) attempt ${x.t.attempts + 1}`).join(', ')}`);
      if (parallel) commitAll(repo, 'autopilot: state before parallel work');
      const results = await Promise.all(batch.map(async (x, slot) => {
        const wt = parallel ? addWorktree(repo, x.t) : null;
        const r = await workTask(repo, st, ms, x.t, stats, { cwd: wt?.dir || repo, slot, model: x.model, effort: x.effort, parallel });
        return { x, r, wt };
      }));
      for (const { x, r, wt } of results) {
        const task = x.t;
        task.history.push({ at: now(), model: r.model, effort: x.effort, outcome: r.outcome, costUsd: r.costUsd, parallel });
        if (r.limited) { if (wt) dropWorktree(repo, wt); st.usage = { ...(st.usage || {}), status: 'rejected' }; continue; } // not the task's fault
        let outcome = r.outcome;
        if (outcome === 'done' && wt) { // bring the worker's branch in only if everything still passes on top of the latest work
          const m = integrate(repo, wt, [...task.checks, ...ms.tasks.filter((t) => t.status === 'done').flatMap((t) => t.checks)]);
          if (!m.ok) { say(`  ${task.id}: done in its worktree but not merged (${m.why}); it will run again on its own`); task.solo = true; task.status = 'retry'; ledger(repo, { kind: 'merge', task: task.id, ok: false, why: m.why }); dropWorktree(repo, wt); continue; }
          ledger(repo, { kind: 'merge', task: task.id, ok: true });
        }
        if (wt) dropWorktree(repo, wt);
        record(stats, task.type, r.model, { done: outcome === 'done', costUsd: r.costUsd }); saveStats(statsPath, stats);
        if (outcome === 'done') task.status = 'done';
        else { task.attempts++;
          task.status = !st.policy.forceModel && task.attempts < ladderOf(task).length ? 'retry' : 'stuck';
          if (task.status === 'retry' && st.policy.research !== false && overheadLeft(st) >= 0.5) {
            mkdirSync(join(apDir(repo), 'research'), { recursive: true });
            const failing = runChecks(repo, task.checks).filter((c) => !c.ok).map((c) => `- ${c.name}\n${c.tail.slice(-400)}`).join('\n');
            say(`  researching why ${task.id} is blocked`);
            await strongCall(repo, st, 'research-stuck', stuckResearchPrompt(task, failing, join(apDir(repo), 'research', `${task.id}.md`)),
              { model: st.policy.researchModel || st.policy.strongModel, budget: Math.min(1.5, overheadLeft(st)), web: true, wallSec: 1200 });
          } }
        say(`  ${task.id}: ${outcome} on ${r.model} ($${(r.costUsd || 0).toFixed(2)}; total $${st.spentUsd.toFixed(2)})`);
      }
      saveAp(repo, st);
      continue;
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
    // The cheap tester plays the build and reports with screenshots; the strong model then decides from that.
    let report = null;
    if (st.policy.tester !== false) {
      const shotsDir = join(apDir(repo), 'shots', `m${ms.n}-tester`); mkdirSync(shotsDir, { recursive: true });
      const reportFile = join(apDir(repo), `tester-${ms.n}.md`);
      say(`testing milestone ${ms.n} (${st.policy.testerModel || 'haiku'})`);
      await strongCall(repo, st, 'tester', testerPrompt(st, ms, reportFile, shotsDir), { model: st.policy.testerModel || 'haiku', budget: 1.5, wallSec: 1800, overhead: false });
      report = existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : null;
    }
    say(`review after milestone ${ms.n}`);
    const file = join(apDir(repo), `review-${ms.n}.json`);
    const rs = reviewSpec(st, pressure(st.usage, pressurePolicy(st)).level);
    // Up to three tries, each told exactly what was wrong with the last file; the review is usable when it ships or plans a
    // milestone with tasks. A review that still fails never ends the run: it waits and tries again (until the deadline).
    let review = null, problem = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const fix = problem ? `\n\nYour previous attempt at ${file} was not usable: ${problem}. Write valid JSON only (no comments, no trailing commas, no prose around it), with "verdict" and, unless the verdict is "ship", a "milestone" that has a title and at least one task.` : '';
      await strongCall(repo, st, 'review', reviewPrompt(st, n, file, evidence, { light: attempt > 1 || rs.light, report }) + fix, { model: rs.model, budget: attempt === 1 ? rs.budget : 2 });
      const raw = existsSync(file) ? readFileSync(file, 'utf8') : null;
      const got = raw == null ? null : parseLooseJson(raw);
      if (raw == null) problem = 'the file was not written';
      else if (!got) problem = 'the file is not valid JSON';
      else if (got.verdict !== 'ship' && !normaliseMilestone(got.milestone, n)) problem = 'it has no "milestone" with tasks (needed unless the verdict is "ship")';
      else { review = got; break; }
      say(`review attempt ${attempt} not usable (${problem})`);
    }
    if (!review) {
      say('no usable review after three tries; trying again in 15 minutes');
      ledger(repo, { kind: 'review-failed', milestone: ms.n, problem });
      await sleep(Math.min(15 * 60000, Math.max(0, st.policy.deadline - Date.now())));
      continue;
    }
    // A ship decision is confirmed by the strong model, once per milestone; it may overrule with a milestone of its own.
    if (review.verdict === 'ship' && shipResults.every((c) => c.ok) && smoke.ok !== false && rs.model !== st.policy.strongModel) {
      const cf = join(apDir(repo), `review-${ms.n}-confirm.json`);
      say('reviewer wants to ship; the strong model confirms');
      await strongCall(repo, st, 'confirm', reviewPrompt(st, n, cf, `${evidence}\n\nThe reviewer's assessment: ${review.assessment || ''}`, { confirm: true }), { budget: 4 });
      const c = readJson(cf);
      if (c && c.verdict !== 'ship' && c.milestone) review = c;
    }
    ms.review = { verdict: review.verdict, assessment: review.assessment };
    if (review.verdict === 'ship' && shipResults.every((c) => c.ok) && (smoke.ok !== false)) { st.finished = 'shipped'; st.shipped = true; commitAll(repo, 'autopilot: shipped'); saveAp(repo, st); break; }
    const nm = normaliseMilestone(review.milestone, n);
    if (!nm) continue; // cannot happen after the checks above; never end the run here
    const beforeReview = git(repo, 'rev-parse', 'HEAD');
    commitAll(repo, `autopilot: review of milestone ${ms.n}; milestone ${n} planned`);
    protectNewTests(repo, st, beforeReview);
    st.milestones.push(nm); saveAp(repo, st);
    say(`milestone ${n}: ${nm.title} (${nm.tasks.length} tasks)`);
  }
  saveAp(repo, st);
  say(`finished: ${st.finished}; spent $${st.spentUsd.toFixed(2)}`);
  return st;
}

export function statusText(st) {
  if (!st) return 'no autopilot state here\n';
  const lines = [`finished: ${st.finished ?? 'no'}  spent: $${st.spentUsd.toFixed(2)}${st.policy.budgetUsd ? ` of $${st.policy.budgetUsd}` : ''} (research, planning and reviews $${(st.overheadUsd || 0).toFixed(2)})  deadline: ${new Date(st.policy.deadline).toISOString()}`];
  if (st.usage) lines.push(`usage: 5-hour ${Math.round((st.usage.fiveHour?.util ?? 0) * 100)}%, weekly ${Math.round((st.usage.sevenDay?.util ?? 0) * 100)}%  last gate: ${st.lastGate?.reason ?? '-'}`);
  for (const m of st.milestones) {
    lines.push(`milestone ${m.n}: ${m.title} [${m.status}]${m.review ? ` -> ${m.review.verdict}` : ''}`);
    for (const t of m.tasks) lines.push(`  ${t.status.padEnd(7)} ${t.id.padEnd(28)} ${t.type.padEnd(14)} ${t.history.map((h) => `${h.model}:${h.outcome}`).join(' ')}`);
  }
  return lines.join('\n') + '\n';
}
