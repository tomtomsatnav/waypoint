import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, parseUsage } from '../lib/usage.mjs';
import { pick, record, rate } from '../lib/routing.mjs';
import { planPrompt, STANDIN_VERIFY } from '../lib/autopilot.mjs';

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
