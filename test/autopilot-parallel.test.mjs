import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pressure, shapeAttempt, parseUsage } from '../lib/usage.mjs';
import { readyTasks, addWorktree, dropWorktree, integrate, autopilot, taskWallSec } from '../lib/autopilot.mjs';
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
  assert.deepEqual(calls.map((c) => c.role).filter((r) => r !== 'work'), ['research', 'plan', 'review', 'confirm']);
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
    assert.deepEqual(work.map((e) => [e.model, e.costUsd, e.costEstimated]), [['haiku', 3, true], ['sonnet', 6, true], ['opus', 10, true]]);
    assert.ok(st.spentUsd >= 19, `spent ${st.spentUsd} includes the three caps`);
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
