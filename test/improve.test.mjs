import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';
import { summarise, gate, table, streamTotals, runMetrics, testerIssues, parseAccept } from '../lib/bench.mjs';
import { isEditable, changedPaths, protectedChanges, improve } from '../lib/improve.mjs';
import { collect, themes } from '../lib/feedback.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));
// A fake run of the suite: per-brief scores and costs for each repetition.
const runsOf = (reps, scores, { cost = 1, held = {} } = {}) => reps.map((jitter, i) => ({ rep: i + 1, results: [
  ...Object.entries(scores).map(([id, s]) => ({ id, heldOut: false, score: Math.min(1, Math.max(0, s + jitter)), costUsd: cost, minutes: 10, failures: [] })),
  ...Object.entries(held).map(([id, s]) => ({ id, heldOut: true, score: s, costUsd: cost, minutes: 10, failures: [] })),
] }));

test('gate: keeps a gain beyond the noise, refuses one inside it', () => {
  const base = summarise(runsOf([0, 0.02, -0.02], { a: 0.6, b: 0.7 }, { held: { h: 0.7 } }));
  const better = summarise(runsOf([0, 0.02, -0.02], { a: 0.75, b: 0.85 }, { held: { h: 0.7 } }));
  const tiny = summarise(runsOf([0, 0.02, -0.02], { a: 0.62, b: 0.71 }, { held: { h: 0.7 } }));
  assert.equal(gate(base, better).keep, true);
  const g = gate(base, tiny); assert.equal(g.keep, false); assert.match(g.reason, /noise/);
});

test('gate: held-out briefs getting worse, or one brief falling sharply, sinks a change', () => {
  const base = summarise(runsOf([0, 0, 0], { a: 0.6, b: 0.6, c: 0.9 }, { held: { h: 0.8 } }));
  const heldWorse = summarise(runsOf([0, 0, 0], { a: 0.8, b: 0.8, c: 0.9 }, { held: { h: 0.6 } }));
  assert.match(gate(base, heldWorse).reason, /held-out/);
  const oneFell = summarise(runsOf([0, 0, 0], { a: 1, b: 1, c: 0.5 }, { held: { h: 0.8 } }));
  assert.match(gate(base, oneFell).reason, /fell sharply: c/);
});

test('gate: as good and clearly cheaper is kept; the table shows both', () => {
  const base = summarise(runsOf([0, 0.01, -0.01], { a: 0.7 }, { cost: 2 }));
  const cheap = summarise(runsOf([0, 0.01, -0.01], { a: 0.7 }, { cost: 1.2 }));
  const g = gate(base, cheap); assert.equal(g.keep, true); assert.match(g.reason, /cheaper/);
  assert.match(table(base, cheap), /\| a \| 70\.0% \| 70\.0% \| \$2\.00 \| \$1\.20 \|/);
});

test('protected paths: only prompts, routing and skills may change', () => {
  for (const p of ['prompts/plan.md', 'config/routing.json', 'skills/waypoint/SKILL.md']) assert.ok(isEditable(p), p);
  for (const p of ['bench/suite.json', 'bench/todo/accept.mjs', 'lib/bench.mjs', 'lib/improve.mjs', 'test/x.test.mjs', 'config/other.json', 'prompts/sub/x.md', 'README.md'])
    assert.ok(!isEditable(p), p);
  const d = tmp('wp-prot-');
  execFileSync('bash', ['-c', 'git init -q && mkdir -p prompts bench && echo a > prompts/a.md && echo s > bench/s.json && git add -A && git -c user.name=t -c user.email=t@e commit -qm one'], { cwd: d });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: d, encoding: 'utf8' }).trim();
  writeFileSync(join(d, 'prompts', 'a.md'), 'b\n'); writeFileSync(join(d, 'bench', 'new.json'), '{}');
  assert.deepEqual(changedPaths(d, base).sort(), ['bench/new.json', 'prompts/a.md']);
  assert.deepEqual(protectedChanges(d, base), ['bench/new.json']);
});

test('metrics: tokens and turns from stream logs, a build run, an autopilot run, tester issues, acceptance output', () => {
  const d = tmp('wp-metrics-');
  const b = join(d, '.git', 'waypoint-build'); mkdirSync(b, { recursive: true });
  writeFileSync(join(b, 'state.json'), JSON.stringify({ spentUsd: 3.25, sessions: [{}, {}], end: 'stopped by itself' }));
  writeFileSync(join(b, 'session-1.jsonl'), [JSON.stringify({ type: 'assistant' }), JSON.stringify({ type: 'result', num_turns: 12, total_cost_usd: 1, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 5 } }), 'not json'].join('\n'));
  writeFileSync(join(b, 'research.jsonl'), JSON.stringify({ type: 'result', num_turns: 3, usage: { input_tokens: 1, output_tokens: 2 } }) + '\n');
  writeFileSync(join(b, 'ledger.jsonl'), JSON.stringify({ type: 'result', num_turns: 99 }) + '\n');
  const m = runMetrics(d);
  assert.deepEqual({ engine: m.engine, costUsd: m.costUsd, tokens: m.tokens, turns: m.turns, sessions: m.sessions, end: m.end },
    { engine: 'build', costUsd: 3.25, tokens: 338, turns: 15, sessions: 2, end: 'stopped by itself' });
  assert.deepEqual(streamTotals([join(b, 'missing.jsonl')]), { tokens: 0, turns: 0, costUsd: 0 });

  const a = join(d, '.git', 'autopilot'); mkdirSync(a, { recursive: true });
  writeFileSync(join(a, 'state.json'), JSON.stringify({ spentUsd: 9, finished: 'shipped', milestones: [{ tasks: [
    { status: 'done', history: [{ model: 'haiku', outcome: 'done' }] },
    { status: 'done', history: [{ model: 'haiku', outcome: 'blocked' }, { model: 'sonnet', outcome: 'done' }] },
    { status: 'stuck', history: [{ model: 'sonnet', outcome: 'blocked' }, { model: 'opus', outcome: 'blocked' }] },
    { status: 'pending', history: [] }] }] }));
  writeFileSync(join(a, 'tester-1.md'), '# Report\n## What works\n- start\n## Broken or missing\n- the pause key does nothing\n- no sound\n## Looks\n- fine\n');
  const m2 = runMetrics(d);
  assert.deepEqual({ tasks: m2.tasks, firstTime: m2.firstTime, escalations: m2.escalations, sentBack: m2.sentBack, testerIssues: m2.testerIssues },
    { tasks: 3, firstTime: 1, escalations: 2, sentBack: 1, testerIssues: 2 });
  assert.equal(testerIssues('**Problems**\n1. one\n2. two\n**Fine**\n- ok'), 2);
  assert.deepEqual(parseAccept('noise\n{"checks":[{"name":"x","ok":true}]}\n').checks.length, 1);
  assert.equal(parseAccept('nothing here'), null);
});

test('feedback: notes, tester problems and stuck tasks from known projects; themes need two projects', () => {
  const home = tmp('wp-home-');
  const mk = (name, notes, tester, stuck) => { const p = join(home, name); const a = join(p, '.git', 'autopilot'); mkdirSync(a, { recursive: true });
    writeFileSync(join(a, 'notes.json'), JSON.stringify(notes.map((text, i) => ({ id: `n${i}`, text, at: '2026-11-01T00:00:00Z' }))));
    writeFileSync(join(a, 'tester-1.md'), `## Broken\n${tester.map((t) => `- ${t}`).join('\n')}\n`);
    writeFileSync(join(a, 'state.json'), JSON.stringify({ milestones: [{ tasks: stuck.map((g, i) => ({ id: `t${i}`, type: 'code-moderate', goal: g, status: 'stuck', history: [] })) }] }));
    return p; };
  const a = mk('alpha', ['the camera controls feel sluggish'], ['menu text is unreadable'], ['flaky browser test hangs']);
  const b = mk('beta', ['camera controls are inverted'], ['settings menu text overlaps'], []);
  const c = mk('gamma', ['add a shop'], [], []);
  writeFileSync(join(home, 'projects.json'), JSON.stringify([{ path: a }, { path: b }, { path: c }, { path: join(home, 'gone') }]));
  const data = collect({ home });
  assert.deepEqual(data.projects, ['alpha', 'beta', 'gamma']);
  assert.equal(data.notes.length, 3); assert.equal(data.tester.length, 2); assert.equal(data.stuck.length, 1);
  const terms = themes(data).map((t) => t.term);
  assert.ok(terms.includes('camera controls'), terms.join(', '));
  assert.ok(terms.includes('menu text'), terms.join(', '));
  assert.ok(!terms.includes('shop'), 'a word from one project is not a theme');
});

// A full round with stand-ins for the model and the benchmark, on a copy of waypoint.
function copyOfWaypoint() {
  const d = tmp('wp-improve-');
  execFileSync('git', ['clone', '-q', ROOT, join(d, 'wp')]);
  execFileSync('git', ['-C', join(d, 'wp'), 'checkout', '-q', '-B', 'main']);
  return { dir: join(d, 'wp'), results: join(d, 'results'), work: join(d, 'work') };
}
const fakeSuite = async ({ waypointDir }) => {
  const better = readFileSync(join(waypointDir, 'prompts', 'build.md'), 'utf8').includes('Check every requirement');
  return { stopped: false, runs: runsOf([0, 0.01, -0.01], { a: better ? 0.85 : 0.6, b: better ? 0.8 : 0.6 }, { held: { h: 0.7 } }) };
};
const fakeUsage = () => null;

test('improve: a better change is committed with a fresh snapshot and opened as a pull request', async () => {
  const w = copyOfWaypoint(); const published = [];
  const r = await improve({ wp: w.dir, results: w.results, workDir: w.work, rounds: 1, reps: 3, runSuiteFn: fakeSuite, usageFn: fakeUsage, feedback: '(none)', log: () => {},
    testsFn: () => ({ status: 0 }),
    proposeFn: async (dir, prompt) => { assert.match(prompt, /a: 60%|brief 1: 60%/); assert.ok(!/\bh\b: 70/.test(prompt), 'held-out shown');
      appendFileSync(join(dir, 'prompts', 'build.md'), ' Check every requirement against the brief before you stop.\n'); return { text: 'Check requirements before stopping\nThe builds stopped early.', costUsd: 0.5 }; },
    publishFn: (wp, branch, x) => { published.push({ branch, ...x }); return { pushed: true, url: 'https://example.test/pr/1' }; } });
  const round = r.rounds[0];
  assert.equal(round.verdict, 'kept', round.reason);
  assert.equal(published.length, 1); assert.match(published[0].title, /Check requirements/); assert.match(published[0].body, /\| a \| 60\.0% \| 85\.0%/);
  const log = execFileSync('git', ['-C', w.dir, 'log', '--format=%s', `main..${round.branch}`], { encoding: 'utf8' });
  assert.match(log, /refresh the prompt snapshot/); assert.match(log, /improve: Check requirements/);
  const snap = execFileSync('git', ['-C', w.dir, 'show', `${round.branch}:test/fixtures/prompt-snapshot.json`], { encoding: 'utf8' });
  assert.match(snap, /Check every requirement/);
  assert.ok(existsSync(join(w.results, round.id, 'round.json')) && existsSync(join(w.results, round.id, 'report.md')));
  // The baseline is kept: a second round does not measure it again.
  let suites = 0;
  await improve({ wp: w.dir, results: w.results, workDir: w.work, rounds: 1, reps: 3, usageFn: fakeUsage, feedback: '', log: () => {}, testsFn: () => ({ status: 0 }),
    runSuiteFn: async (x) => { suites++; return fakeSuite(x); }, proposeFn: async () => ({ text: 'nothing', costUsd: 0 }), publishFn: () => ({}) });
  assert.equal(suites, 0, 'the baseline was measured again, or a no-op proposal was benchmarked');
});

test('improve: touching the benchmark, broken prompts, failing tests or no gain are all turned down', async () => {
  const w = copyOfWaypoint();
  const run = (proposeFn, extra = {}) => improve({ wp: w.dir, results: w.results, workDir: w.work, rounds: 1, reps: 3, runSuiteFn: fakeSuite, usageFn: fakeUsage, feedback: '', log: () => {},
    testsFn: () => ({ status: 0 }), publishFn: () => { throw new Error('must not publish'); }, proposeFn, ...extra }).then((r) => r.rounds[0]);
  const cheat = await run(async (dir) => { writeFileSync(join(dir, 'bench', 'suite.json'), '{"briefs":[]}'); appendFileSync(join(dir, 'prompts', 'build.md'), ' Check every requirement.\n'); return { text: 'cheat\n' }; });
  assert.equal(cheat.verdict, 'rejected'); assert.match(cheat.reason, /protected files: bench\/suite\.json/);
  const broken = await run(async (dir) => { appendFileSync(join(dir, 'prompts', 'build.md'), ' {{nosuchvalue}}\n'); return { text: 'broken\n' }; });
  assert.equal(broken.verdict, 'rejected'); assert.match(broken.reason, /do not load/);
  const red = await run(async (dir) => { appendFileSync(join(dir, 'prompts', 'build.md'), ' Check every requirement.\n'); return { text: 'red\n' }; },
    { testsFn: () => ({ status: 1, stdout: 'not ok 3 - something\n' }) });
  assert.equal(red.verdict, 'rejected'); assert.match(red.reason, /tests fail/);
  const flat = await run(async (dir) => { appendFileSync(join(dir, 'prompts', 'build.md'), ' Be nice.\n'); return { text: 'flat\n' }; });
  assert.equal(flat.verdict, 'not kept');
  const branches = execFileSync('git', ['-C', w.dir, 'branch', '--list', 'improve/*'], { encoding: 'utf8' }).trim();
  assert.equal(branches, '', 'rejected branches are deleted');
});
