import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pressure, shapeAttempt, parseUsage } from '../lib/usage.mjs';
import { pressurePolicy } from '../lib/autopilot.mjs';
import { readyTasks, addWorktree, dropWorktree, integrate, autopilot, taskWallSec, acceptanceGuard, STANDIN_VERIFY, CHEAP_LADDERS, parseLooseJson, CALL_MINUTES } from '../lib/autopilot.mjs';
import { pick } from '../lib/routing.mjs';
import { buildArgs } from '../lib/runner.mjs';
import { makeRepo, sh, ROOT } from './helpers.mjs';

const H = 3600000, NOW = Date.UTC(2026, 10, 9, 12);
const u = (util, resetIn) => parseUsage({ status: 'allowed', unifiedWindows: { five_hour: { utilization: util, resetsAt: (NOW + resetIn) / 1000, status: 'allowed' }, seven_day: { utilization: 0.3, resetsAt: (NOW + 80 * H) / 1000, status: 'allowed' } } }, NOW);

test('pressure: room to spare near the reset is flush; little left is tight; otherwise normal', () => {
  assert.equal(pressure(u(0.3, 0.5 * H), {}, NOW).level, 'flush', '60% left, resets in 30 min: use it or lose it');
  assert.equal(pressure(u(0.3, 4 * H), {}, NOW).level, 'normal', 'the same room with hours to go is normal');
  const t = pressure(u(0.8, 2 * H), {}, NOW);
  assert.equal(t.level, 'tight');
  assert.equal(t.canWait, true);
  assert.equal(pressure(null).level, 'normal');
  const ahead = pressure(u(0.1, 3 * H), { paceFrom: { at: NOW - 10 * H, util: 0.1 } }, NOW);
  assert.equal(ahead.level, 'tight', 'ahead of the weekly pace');
  assert.equal(ahead.canWait, false, 'waiting for the 5-hour reset does not fix the weekly pace');
});

test('shapeAttempt: effort follows pressure; flush lifts hard tasks a rung; tight holds the top rung for the reset', () => {
  const code = ['haiku', 'sonnet', 'opus'];
  assert.deepEqual(shapeAttempt({ type: 'code-simple', attempt: 0, model: 'haiku', ladder: code, level: 'normal' }), { model: 'haiku', effort: 'medium', wait: false, why: null });
  assert.equal(shapeAttempt({ type: 'code-complex', attempt: 0, model: 'haiku', ladder: code, level: 'normal' }).effort, 'high');
  const f = shapeAttempt({ type: 'code-complex', attempt: 0, model: 'haiku', ladder: code, level: 'flush' });
  assert.deepEqual([f.model, f.effort], ['sonnet', 'xhigh']);
  assert.equal(shapeAttempt({ type: 'code-simple', attempt: 0, model: 'haiku', ladder: code, level: 'flush' }).model, 'haiku', 'routine work stays cheap');
  assert.equal(shapeAttempt({ type: 'code-simple', attempt: 0, model: 'haiku', ladder: code, level: 'tight' }).effort, 'low');
  assert.equal(shapeAttempt({ type: 'code-complex', attempt: 2, model: 'opus', ladder: code, level: 'tight' }).wait, true);
  assert.equal(shapeAttempt({ type: 'code-complex', attempt: 2, model: 'opus', ladder: code, level: 'tight', canWait: false }).wait, false);
  assert.equal(shapeAttempt({ type: 'code-complex', attempt: 1, model: 'sonnet', ladder: code, level: 'tight' }).wait, false);
});

test('buildArgs passes the effort level', () => {
  const a = buildArgs({ prompt: 'p', model: 'haiku', budgetUsd: 1, sessionId: 's', effort: 'low' });
  assert.equal(a[a.indexOf('--effort') + 1], 'low');
  assert.ok(!buildArgs({ prompt: 'p', model: 'haiku', budgetUsd: 1, sessionId: 's' }).includes('--effort'));
});

test('readyTasks: no "after" means after every earlier task; "after" lists real needs; a stuck need blocks', () => {
  const ms = { tasks: [
    { id: 'a', status: 'pending', after: [] }, { id: 'b', status: 'pending', after: [] },
    { id: 'c', status: 'pending', after: ['a', 'b'] }, { id: 'd', status: 'pending', after: null }] };
  assert.deepEqual(readyTasks(ms).map((t) => t.id), ['a', 'b']);
  ms.tasks[0].status = 'done';
  assert.deepEqual(readyTasks(ms).map((t) => t.id), ['b']);
  ms.tasks[1].status = 'done';
  assert.deepEqual(readyTasks(ms).map((t) => t.id), ['c']);
  ms.tasks[2].status = 'stuck';
  assert.deepEqual(readyTasks(ms).map((t) => t.id), [], 'd comes after c, which is stuck');
  assert.deepEqual(readyTasks({ tasks: [{ id: 'x', status: 'retry', after: ['gone'] }] }).map((t) => t.id), ['x'], 'unknown ids do not block');
});

test('integrate: a worker branch reaches main only on top of the latest work and with every check passing', () => {
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const w1 = addWorktree(repo, { id: 'one', attempts: 0 }), w2 = addWorktree(repo, { id: 'two', attempts: 0 });
  sh(w1.dir, 'echo 1 > one.txt && git add -A && git commit -qm one');
  sh(w2.dir, 'echo 2 > two.txt && git add -A && git commit -qm two');
  assert.deepEqual(integrate(repo, w1, [{ name: 'one', run: 'test -f one.txt' }]), { ok: true });
  assert.deepEqual(integrate(repo, w2, [{ name: 'one', run: 'test -f one.txt' }, { name: 'two', run: 'test -f two.txt' }]), { ok: true },
    'the second worker picks up the first one\'s work before its checks run');
  assert.ok(existsSync(join(repo, 'one.txt')) && existsSync(join(repo, 'two.txt')));
  dropWorktree(repo, w1); dropWorktree(repo, w2);

  const w3 = addWorktree(repo, { id: 'three', attempts: 0 }), w4 = addWorktree(repo, { id: 'four', attempts: 0 });
  sh(w3.dir, 'echo a > same.txt && git add -A && git commit -qm a');
  sh(w4.dir, 'echo b > same.txt && git add -A && git commit -qm b');
  assert.equal(integrate(repo, w3, []).ok, true);
  const c = integrate(repo, w4, []);
  assert.equal(c.ok, false);
  assert.match(c.why, /conflict/);
  assert.equal(readFileSync(join(repo, 'same.txt'), 'utf8').trim(), 'a', 'main keeps the first worker\'s version');
  dropWorktree(repo, w3); dropWorktree(repo, w4);

  const w5 = addWorktree(repo, { id: 'five', attempts: 0 });
  sh(w5.dir, 'git rm -q one.txt && git commit -qm "break one"');
  const head = sh(repo, 'git rev-parse HEAD');
  const f = integrate(repo, w5, [{ name: 'one', run: 'test -f one.txt' }]);
  assert.equal(f.ok, false);
  assert.match(f.why, /checks fail/);
  assert.equal(sh(repo, 'git rev-parse HEAD'), head, 'a branch that breaks an earlier check never reaches main');
  dropWorktree(repo, w5);
});

test('autopilot end to end: independent tasks run at the same time in worktrees, the dependent one after; all merged', async () => {
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const log = join(repo, '..', `${repo.split('/').pop()}-ap.log`);
  const plan = { title: 'slice', tasks: [
    { id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] },
    { id: 'm1-b', type: 'code-simple', after: [], goal: 'create b.txt', checks: [{ name: 'b', run: 'test -f b.txt' }] },
    { id: 'm1-c', type: 'code-simple', after: ['m1-a', 'm1-b'], goal: 'create c.txt', checks: [{ name: 'c', run: 'test -f c.txt' }] }] };
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan), FAKE_AP_UTIL: '0.1' });
  const st = await autopilot({ repo, brief: 'test brief', budgetUsd: 20, deadlineHours: 1, maxWorkers: 3, claude: join(ROOT, 'test', 'fake-autopilot.mjs'), log: () => {} });
  assert.equal(st.finished, 'shipped');
  for (const f of ['a.txt', 'b.txt', 'c.txt', 'EXPECTATIONS.md']) assert.ok(existsSync(join(repo, f)), `${f} is on main`);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.map((c) => c.role).filter((r) => r !== 'work'), ['research', 'research-approach', 'plan', 'tester', 'review'],
    'the strong model researches, plans and reviews (so no separate ship confirmation); a cheap tester plays the build first');
  const by = (r) => calls.find((c) => c.role === r);
  assert.equal(by('research').model, 'claude-fable-5-1');
  assert.equal(by('research-approach').model, 'claude-fable-5-1', 'the strong model researches the technical approach too');
  assert.ok(existsSync(join(repo, 'APPROACH.md')), 'APPROACH.md is committed for the planner and the builders');
  assert.match(by('plan').prompt + '', /technical researcher wrote APPROACH\.md|APPROACH\.md/, 'the planner is told about it');
  assert.equal(by('plan').model, 'claude-fable-5-1');
  assert.equal(by('review').model, 'claude-fable-5-1');
  assert.equal(by('tester').model, 'haiku');
  assert.match(readFileSync(log + '.review-prompts', 'utf8'), /<tester-report>[\s\S]*works: everything tried/, 'the review is given the tester\'s report');
  assert.ok(st.overheadUsd < st.spentUsd, 'the tester counts as work, not overhead');
  const work = calls.filter((c) => c.role === 'work');
  assert.equal(work.length, 3);
  const [x, y, z] = work.sort((p, q) => p.start - q.start);
  assert.ok(x.cwd.includes('/autopilot/wt/') && y.cwd.includes('/autopilot/wt/'), 'the two independent tasks ran in worktrees');
  assert.ok(y.start < x.end, 'and at the same time');
  assert.ok(z.start >= Math.max(x.end, y.end), 'the dependent task started after both');
  assert.ok(work.every((c) => c.effort === 'medium'), 'effort was set from the usage pressure');
  assert.equal(sh(repo, 'git worktree list | wc -l'), '1', 'worktrees are cleaned up');
  assert.equal(sh(repo, 'git status --porcelain'), '');
  delete process.env.FAKE_AP_PLAN;
});

test('time limits: routine tasks get 45 minutes, hard ones 90; an explicit policy wins', () => {
  assert.equal(taskWallSec({ policy: {} }, 'code-moderate'), 2700);
  assert.equal(taskWallSec({ policy: {} }, 'code-complex'), 5400);
  assert.equal(taskWallSec({ policy: { taskWallSec: 60 } }, 'code-complex'), 60);
});

test('autopilot: an attempt killed by its time limit is charged its spending cap, never $0', async () => {
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const log = join(repo, '..', `${repo.split('/').pop()}-ap.log`);
  const plan = { title: 'hang', tasks: [{ id: 'm1-h', type: 'code-simple', after: [], goal: 'create h.txt', checks: [{ name: 'h', run: 'test -f h.txt' }] }] };
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan), FAKE_AP_HANG: '1' });
  try {
    const st = await autopilot({ repo, brief: 'b', budgetUsd: 100, deadlineHours: 1, taskWallSec: 2, research: false, claude: join(ROOT, 'test', 'fake-autopilot.mjs'), log: () => {} });
    const work = readFileSync(join(repo, '.git', 'autopilot', 'ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter((e) => e.kind === 'work');
    assert.deepEqual(work.map((e) => [e.model, e.costUsd, e.costEstimated]), [['haiku', 3, true], ['sonnet', 6, true]],
      'builders stay cheap: after Haiku and Sonnet the task goes back to the planner, not up to Opus');
    assert.ok(st.spentUsd >= 9, `spent ${st.spentUsd} includes the two caps`);
    assert.equal(st.milestones[0].tasks[0].status, 'stuck');
  } finally { delete process.env.FAKE_AP_HANG; delete process.env.FAKE_AP_PLAN; }
});

test('autopilot: without --max-workers, independent tasks still run one at a time in the main repo', async () => {
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const log = join(repo, '..', `${repo.split('/').pop()}-ap.log`);
  const plan = { title: 's', tasks: [
    { id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] },
    { id: 'm1-b', type: 'code-simple', after: [], goal: 'create b.txt', checks: [{ name: 'b', run: 'test -f b.txt' }] }] };
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan) });
  try {
    const st = await autopilot({ repo, brief: 'b', budgetUsd: 20, deadlineHours: 1, research: false, claude: join(ROOT, 'test', 'fake-autopilot.mjs'), log: () => {} });
    assert.equal(st.finished, 'shipped');
    const work = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).filter((c) => c.role === 'work').sort((p, q) => p.start - q.start);
    assert.equal(work.length, 2);
    assert.ok(work.every((c) => !c.cwd.includes('/autopilot/wt/')), 'no worktrees');
    assert.ok(work[1].start >= work[0].end, 'one after the other');
  } finally { delete process.env.FAKE_AP_PLAN; }
});

test('guard: only the planner\'s acceptance tests are frozen; older runs keep the old guard', () => {
  const old = acceptanceGuard({ policy: { verify: STANDIN_VERIFY } });
  assert.deepEqual(old, { verify: STANDIN_VERIFY, guardText: true }, 'a run without protectedTests keeps the old behaviour');
  const none = acceptanceGuard({ policy: { verify: STANDIN_VERIFY }, protectedTests: [] });
  assert.equal(none.verify, null);
  assert.match(none.guardText, /yours to fix/);
  const g = acceptanceGuard({ policy: { verify: STANDIN_VERIFY }, protectedTests: ['tests/a.test.mjs', "tests/it's.test.mjs"] });
  assert.equal(g.verify, `git diff --quiet --diff-filter=DM {base} -- 'tests/a.test.mjs' 'tests/it'\\''s.test.mjs'`);
  assert.match(g.guardText, /tests\/a\.test\.mjs/);
  assert.match(g.guardText, /including ones earlier workers wrote, is yours to fix/);
  assert.equal(acceptanceGuard({ policy: { verify: 'aos-orch verify' }, protectedTests: ['x'] }).verify, 'aos-orch verify', 'an explicit --verify is kept');
});

test('autopilot: the tests the planner commits are the frozen ones, and workers are told so', async () => {
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const log = join(repo, '..', `${repo.split('/').pop()}-ap.log`);
  const plan = { title: 's', tasks: [{ id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] }] };
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan), FAKE_AP_ACCEPT: '1' });
  try {
    const st = await autopilot({ repo, brief: 'b', budgetUsd: 20, deadlineHours: 1, research: false, claude: join(ROOT, 'test', 'fake-autopilot.mjs'), log: () => {} });
    assert.equal(st.finished, 'shipped');
    assert.deepEqual(st.protectedTests, ['tests/accept.test.mjs']);
    const q = JSON.parse(readFileSync(join(repo, '.git', 'autopilot', 'runs', 'queue-m1-a-0.json'), 'utf8'));
    assert.match(q.verify, /'tests\/accept\.test\.mjs'$/);
    assert.match(q.guardText, /acceptance tests the planner wrote \(tests\/accept\.test\.mjs\)/);
  } finally { delete process.env.FAKE_AP_ACCEPT; delete process.env.FAKE_AP_PLAN; }
});

test('builders: Haiku codes and Sonnet does UI, each with exactly one step up', () => {
  for (const t of ['code-simple', 'code-moderate', 'code-complex', 'test-writing', 'docs'])
    assert.deepEqual([0, 1].map((a) => pick(t, a, {}, CHEAP_LADDERS)), ['haiku', 'sonnet'], t);
  for (const t of ['ui-design', 'visual-polish', 'architecture'])
    assert.deepEqual([0, 1].map((a) => pick(t, a, {}, CHEAP_LADDERS)), ['sonnet', 'opus'], t);
  assert.ok(Object.values(CHEAP_LADDERS).every((l) => l.length === 2), 'one step up, then back to the planner');
});

test('autopilot: a planning run that stops before the milestone gets a second, shorter run instead of ending everything', async () => {
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const log = join(repo, '..', `${repo.split('/').pop()}-ap.log`);
  const plan = { title: 's', tasks: [{ id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] }] };
  const said = [];
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan), FAKE_AP_PLAN_FAIL_ONCE: join(repo, '..', `${repo.split('/').pop()}-planfail`) });
  try {
    const st = await autopilot({ repo, brief: 'b', budgetUsd: 60, deadlineHours: 1, research: false, claude: join(ROOT, 'test', 'fake-autopilot.mjs'), log: (m) => said.push(m) });
    assert.equal(st.finished, 'shipped');
    const roles = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).map((c) => c.role);
    assert.deepEqual(roles.slice(0, 2), ['plan', 'plan'], 'two planning runs');
    assert.ok(said.some((m) => /stopped before writing the first milestone \(error_max_budget_usd/.test(m)), 'the log says why');
    assert.match(readFileSync(log, 'utf8'), /previous planning run stopped before it finished/, 'the second run is told to finish, not restart');
  } finally { delete process.env.FAKE_AP_PLAN_FAIL_ONCE; delete process.env.FAKE_AP_PLAN; }
});

test('no-budget mode: no spending cap on any call or builder session; usage limits and time limits still apply', async () => {
  const { buildArgs } = await import('../lib/runner.mjs');
  assert.ok(!buildArgs({ prompt: 'p', model: 'haiku', budgetUsd: Infinity, sessionId: 's' }).includes('--max-budget-usd'));
  assert.throws(() => buildArgs({ prompt: 'p', model: 'haiku', sessionId: 's' }), /max-budget-usd/, 'a missing cap is still an error');
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const log = join(repo, '..', `${repo.split('/').pop()}-ap.log`);
  const plan = { title: 's', tasks: [{ id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] }] };
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan) });
  try {
    const st = await autopilot({ repo, brief: 'b', deadlineHours: 1, claude: join(ROOT, 'test', 'fake-autopilot.mjs'), log: () => {} });
    assert.equal(st.finished, 'shipped');
    assert.equal(st.policy.unlimited, true);
    assert.equal(st.policy.budgetUsd, null);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual([...new Set(calls.map((c) => c.role))].sort(), ['plan', 'research', 'research-approach', 'review', 'tester', 'work']);
    assert.ok(calls.every((c) => c.capped === false), `no call had --max-budget-usd: ${calls.filter((c) => c.capped).map((c) => c.role)}`);
  } finally { delete process.env.FAKE_AP_PLAN; }
});

test('no-budget mode: running ahead of the weekly pace does not lower effort; real closeness to a limit still does', () => {
  const paceFrom = { at: NOW - 10 * H, util: 0.1 };
  const ahead = u(0.2, 3 * H); // 20% of the 5-hour window used, weekly 30%: well ahead of an even pace from 10% ten hours ago
  const budgeted = { policy: { fiveHourCeiling: 0.9, weeklyCeiling: 0.85 }, paceFrom };
  const unlimited = { policy: { fiveHourCeiling: 0.9, weeklyCeiling: 0.85, unlimited: true }, paceFrom };
  assert.equal(pressure(ahead, pressurePolicy(budgeted), NOW).level, 'tight', 'budgeted runs keep the even weekly pacing');
  assert.equal(pressure(ahead, pressurePolicy(unlimited), NOW).level, 'normal', 'no-budget runs do not');
  assert.equal(pressure(u(0.8, 2 * H), pressurePolicy(unlimited), NOW).level, 'tight', 'little of the 5-hour window left still counts');
  const weekly = parseUsage({ status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: (NOW + 3 * H) / 1000, status: 'allowed' }, seven_day: { utilization: 0.8, resetsAt: (NOW + 80 * H) / 1000, status: 'allowed' } } }, NOW);
  const w = pressure(weekly, pressurePolicy(unlimited), NOW);
  assert.deepEqual([w.level, w.canWait], ['tight', false], 'weekly use past 75% counts, without waiting for a 5-hour reset');
});

test('reviews: JSON with comments, trailing commas, fences or prose is read; a URL with // in a string survives', () => {
  assert.deepEqual(parseLooseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseLooseJson('{ "verdict": "continue", // only if\n "m": [1,2,], "u": "http://x//y" /* c */ }'), { verdict: 'continue', m: [1, 2], u: 'http://x//y' });
  assert.deepEqual(parseLooseJson('Here it is:\n```json\n{"x": "a\\"b"}\n```\nDone.'), { x: 'a"b' });
  assert.equal(parseLooseJson('not json at all'), null);
});

for (const [mode, expectReviews] of [['comments', 1], ['nomilestone-once', 2]]) {
  test(`reviews: a review written ${mode === 'comments' ? 'with // comments is accepted' : 'without a milestone is retried with the reason, not the end of the run'}`, async () => {
    const repo = makeRepo();
    sh(repo, 'git config user.email t@x && git config user.name t');
    const log = join(repo, '..', `${repo.split('/').pop()}-ap.log`);
    const plan = { title: 's', tasks: [{ id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] }] };
    const said = [];
    Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan), FAKE_AP_REVIEW_MODE: mode });
    try {
      const st = await autopilot({ repo, brief: 'b', deadlineHours: 1, research: false, claude: join(ROOT, 'test', 'fake-autopilot.mjs'), log: (m) => said.push(m) });
      assert.equal(st.finished, 'shipped');
      const reviews = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).filter((c) => c.role === 'review');
      assert.equal(reviews.length, expectReviews);
      if (mode !== 'comments') {
        assert.ok(said.some((m) => /review attempt 1 not usable \(it has no "milestone" with tasks/.test(m)));
        assert.match(readFileSync(log + '.review-prompts', 'utf8'), /Your previous attempt at .* was not usable: it has no "milestone"/);
      }
    } finally { delete process.env.FAKE_AP_REVIEW_MODE; delete process.env.FAKE_AP_PLAN; }
  });
}

test('thinking calls have time limits, stated in their prompts; no spending cap needed', async () => {
  assert.deepEqual([CALL_MINUTES.review, CALL_MINUTES.plan, CALL_MINUTES.research, CALL_MINUTES['research-stuck']], [15, 30, 20, 10]);
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const log = join(repo, '..', `${repo.split('/').pop()}-ap.log`);
  const plan = { title: 's', tasks: [{ id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] }] };
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan) });
  try {
    await autopilot({ repo, brief: 'b', deadlineHours: 1, research: false, claude: join(ROOT, 'test', 'fake-autopilot.mjs'), log: () => {} });
    assert.match(readFileSync(log + '.review-prompts', 'utf8'), /Time limit: about 15 minutes for this whole job/);
  } finally { delete process.env.FAKE_AP_PLAN; }
});

test('a thinking call refused by the usage limit waits for the reset and runs again, not counted as a failed attempt', async () => {
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const log = join(repo, '..', `${repo.split('/').pop()}-ap.log`);
  const plan = { title: 's', tasks: [{ id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] }] };
  const said = [];
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan), FAKE_AP_REVIEW_LIMIT_ONCE: join(repo, '..', `${repo.split('/').pop()}-rl`) });
  try {
    const st = await autopilot({ repo, brief: 'b', deadlineHours: 1, research: false, limitMarginMs: 500, claude: join(ROOT, 'test', 'fake-autopilot.mjs'), log: (m) => said.push(m) });
    assert.equal(st.finished, 'shipped');
    const roles = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).map((c) => c.role);
    assert.deepEqual(roles.filter((r) => /review/.test(r)), ['review-limited', 'review'], 'refused once, then the same review ran after the reset');
    assert.ok(!said.some((m) => /review attempt 1 not usable/.test(m)), 'the refusal did not use up a review attempt');
  } finally { delete process.env.FAKE_AP_REVIEW_LIMIT_ONCE; delete process.env.FAKE_AP_PLAN; }
});
