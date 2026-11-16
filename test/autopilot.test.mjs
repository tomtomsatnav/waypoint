import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, parseUsage } from '../lib/usage.mjs';
import { pick, record, rate } from '../lib/routing.mjs';
import { planPrompt, reviewPrompt, researchPrompt, approachPrompt, stuckResearchPrompt, overheadLeft, reviewSpec, STANDIN_VERIFY } from '../lib/autopilot.mjs';

const H = 3600000, NOW = Date.UTC(2026, 10, 8, 12);
const usage = (u5, u7) => parseUsage({ status: 'allowed', unifiedWindows: { five_hour: { utilization: u5, resetsAt: (NOW + 2 * H) / 1000, status: 'allowed' }, seven_day: { utilization: u7, resetsAt: (NOW + 60 * H) / 1000, status: 'allowed' } } }, NOW);

test('usage: plenty of headroom runs up to the worker limit; a full 5-hour window waits for its reset', () => {
  const d = decide(usage(0.1, 0.3), { maxWorkers: 3 }, NOW);
  assert.deepEqual([d.action, d.workers], ['run', 3]);
  assert.equal(decide(usage(0.7, 0.3), { maxWorkers: 3 }, NOW).workers, 1);
  const w = decide(usage(0.92, 0.3), {}, NOW);
  assert.equal(w.action, 'wait');
  assert.equal(w.untilMs, NOW + 2 * H + 60000, 'one minute after the 5-hour reset');
});

test('usage: the weekly ceiling and a rejected status both wait for the right reset', () => {
  assert.equal(decide(usage(0.1, 0.86), { weeklyCeiling: 0.85 }, NOW).untilMs, NOW + 60 * H + 60000);
  const rejected = parseUsage({ status: 'rejected', unifiedWindows: { five_hour: { utilization: 1, resetsAt: (NOW + H) / 1000, status: 'rejected' } } }, NOW);
  assert.equal(decide(rejected, {}, NOW).untilMs, NOW + H + 60000);
});

test('usage: ahead of the weekly pace drops to one worker', () => {
  const paceFrom = { at: NOW - 10 * H, util: 0.5 }; // 10 h into a 70 h span from 50% to an 85% ceiling: ~55% planned by now
  assert.equal(decide(usage(0.1, 0.52), { maxWorkers: 3, paceFrom }, NOW).workers, 3);
  const ahead = decide(usage(0.1, 0.62), { maxWorkers: 3, paceFrom }, NOW);
  assert.equal(ahead.workers, 1);
  assert.match(ahead.reason, /ahead of the weekly pace/);
});

test('routing: code starts on Haiku and climbs on blocks; UI starts on Sonnet', () => {
  assert.deepEqual([0, 1, 2, 5].map((a) => pick('code-complex', a)), ['haiku', 'sonnet', 'opus', 'opus']);
  assert.equal(pick('ui-design', 0), 'sonnet');
  assert.equal(pick('mystery', 0), 'haiku', 'unknown types use the code ladder');
});

test('routing: a model that keeps failing a task type is skipped for it; one early failure is not enough', () => {
  const s = {};
  record(s, 'code-complex', 'haiku', { done: false });
  assert.equal(pick('code-complex', 0, s), 'haiku');
  record(s, 'code-complex', 'haiku', { done: false }); record(s, 'code-complex', 'haiku', { done: false });
  assert.ok(rate(s['code-complex'].haiku) < 0.5);
  assert.equal(pick('code-complex', 0, s), 'sonnet');
  assert.equal(pick('code-simple', 0, s), 'haiku', 'other types are unaffected');
});

test('autopilot: the planner is told to write tests and checks, not the implementation; the guard protects tests', () => {
  const p = planPrompt({ brief: 'make a game', references: ['ref/a.png'] }, '/x/milestone-1.json');
  assert.match(p, /make a game/);
  assert.match(p, /ref\/a\.png/);
  assert.match(p, /Do not write the implementation/);
  assert.match(p, /web-smoke\.mjs/);
  assert.match(STANDIN_VERIFY, /--diff-filter=DM \{base\}/);
});

test('autopilot: the strong model reviews within the overhead share; past it, or when usage is tight, on a small budget', () => {
  const st = { policy: { budgetUsd: 60, strongModel: 'claude-fable-5-1' }, overheadUsd: 0 };
  assert.equal(overheadLeft(st), 18, '30% of $60 by default');
  assert.deepEqual(reviewSpec(st), { model: 'claude-fable-5-1', budget: 3, light: false }, 'the strong model decides, capped at $3');
  st.overheadUsd = 16.5;
  assert.deepEqual(reviewSpec(st), { model: 'claude-fable-5-1', budget: 1.5, light: false }, 'a review never spends more than is left');
  st.overheadUsd = 17.6;
  assert.deepEqual(reviewSpec(st), { model: 'claude-fable-5-1', budget: 1, light: true }, 'below $1 left: a small review so the loop can still plan');
  assert.deepEqual(reviewSpec({ ...st, overheadUsd: 0 }, 'tight'), { model: 'claude-fable-5-1', budget: 1, light: true }, 'tight usage: small');
  assert.equal(reviewSpec({ policy: { budgetUsd: 60, strongModel: 'x', reviewModel: 'sonnet' }, overheadUsd: 0 }).model, 'sonnet', 'an explicit review model still wins');
  assert.equal(overheadLeft({ policy: {}, overheadUsd: 99 }), Infinity, 'no budget, no cap');
  assert.equal(overheadLeft({ policy: { budgetUsd: 100, overheadShare: 0.3 }, overheadUsd: 0 }), 30);
});

test('autopilot: the researcher looks for unstated expectations, each with a check; the plan must cover them', () => {
  const r = researchPrompt({ brief: 'make an MMORPG' });
  assert.match(r, /make an MMORPG/);
  assert.match(r, /WebSearch/);
  assert.match(r, /EXPECTATIONS\.md/);
  assert.match(r, /Check:/);
  assert.match(r, /Do not write code/);
  const withExp = planPrompt({ brief: 'b', expectations: true }, '/x/m.json');
  assert.match(withExp, /EXPECTATIONS\.md/);
  assert.doesNotMatch(planPrompt({ brief: 'b' }, '/x/m.json'), /EXPECTATIONS\.md/, 'only when research wrote one');
  assert.match(withExp, /thin slice of the whole product/, 'milestone 1 is a usable slice, not every foundation');
});

test('autopilot: reviews play as an experienced user unless light; a confirm review is framed as the final check', () => {
  const st = { brief: 'b', expectations: true };
  const full = reviewPrompt(st, 2, '/x/r.json', 'evidence');
  assert.match(full, /Playwright/);
  assert.match(full, /experienced user/);
  assert.match(full, /EXPECTATIONS\.md/);
  const light = reviewPrompt(st, 2, '/x/r.json', 'evidence', { light: true });
  assert.doesNotMatch(light, /Playwright/);
  assert.match(light, /do not run the app/);
  assert.match(reviewPrompt(st, 2, '/x/r.json', 'e', { confirm: true }), /final reviewer/);
});

test('autopilot: stuck research gets the task, its failing checks and where to write notes', () => {
  const p = stuckResearchPrompt({ id: 'm2-combat', goal: 'tab-target combat' }, '- combat test\nexpected 1 got 0', '/r/m2-combat.md');
  assert.match(p, /m2-combat: tab-target combat/);
  assert.match(p, /expected 1 got 0/);
  assert.match(p, /\/r\/m2-combat\.md/);
  assert.match(p, /do not change it/);
});

test('autopilot: the technical research looks for hard problems, tools, reference projects and practices, as advice', () => {
  const a = approachPrompt({ brief: 'a souls-like drawn in characters', expectations: true });
  for (const re of [/souls-like drawn in characters/, /WebSearch/, /APPROACH\.md/, /Tech choices/, /Reference projects/, /licence/, /Practices/, /advice for the planner, not requirements/, /EXPECTATIONS\.md/])
    assert.match(a, re);
  const p = planPrompt({ brief: 'b', approach: true }, '/x/m.json');
  assert.match(p, /APPROACH\.md/);
  assert.match(p, /advice, not requirements/);
  assert.doesNotMatch(planPrompt({ brief: 'b' }, '/x/m.json'), /APPROACH\.md/, 'only when the research wrote one');
});
