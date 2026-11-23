// Which model works on which kind of task, escalation when a task blocks, and weights learned from outcomes.
//
// Starting table, from testing: Haiku passed every check of a mid-sized build for under $1 and Sonnet/Opus added
// nothing on code with tests, so every kind of code starts on Haiku. Look-and-feel work (UI design, visual polish) has no
// evidence yet and starts on Sonnet, an expectation; the stats below decide whether that holds.
// Each type has a ladder; a blocked task climbs one rung per attempt.

import { readFileSync, existsSync } from 'node:fs';
import { writeJsonAtomic } from './state.mjs';
import { config } from './prompts.mjs';

const SKIP = { minAttempts: 3, minRate: 0.5, ...(config('routing').skip || {}) };

export const TASK_TYPES = ['code-simple', 'code-moderate', 'code-complex', 'ui-design', 'visual-polish', 'architecture', 'docs', 'test-writing'];

export const DEFAULT_LADDERS = {
  'code-simple': ['haiku', 'sonnet', 'opus'],
  'code-moderate': ['haiku', 'sonnet', 'opus'],
  'code-complex': ['haiku', 'sonnet', 'opus'],
  'test-writing': ['haiku', 'sonnet'],
  docs: ['haiku', 'sonnet'],
  architecture: ['sonnet', 'opus'],
  'ui-design': ['sonnet', 'opus'],
  'visual-polish': ['sonnet', 'opus'],
};

// stats: { [type]: { [model]: { attempts, done, blocked, costUsd } } }
export function loadStats(path) { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}; }
export function saveStats(path, stats) { writeJsonAtomic(path, stats); }

export function record(stats, type, model, { done, costUsd = 0 }) {
  const s = ((stats[type] ||= {})[model] ||= { attempts: 0, done: 0, blocked: 0, costUsd: 0 });
  s.attempts++; if (done) s.done++; else s.blocked++; s.costUsd = +(s.costUsd + (costUsd || 0)).toFixed(4);
  return stats;
}

// Success rate with a prior (as if 2 of 3 attempts had succeeded), so one early failure does not condemn a model.
export const rate = (s) => ((s?.done ?? 0) + 2) / ((s?.attempts ?? 0) + 3);

// The model for a task's attempt n (0-based). Rungs whose learned success rate for this type has fallen below 0.5 after
// at least 3 attempts are skipped; the last rung is never skipped. Unknown types use the code-moderate ladder.
export function pick(type, attempt, stats = {}, ladders = DEFAULT_LADDERS) {
  const ladder = ladders[type] || ladders['code-moderate'];
  const usable = ladder.filter((m, i) => i === ladder.length - 1 || !((stats[type]?.[m]?.attempts ?? 0) >= SKIP.minAttempts && rate(stats[type][m]) < SKIP.minRate));
  return usable[Math.min(attempt, usable.length - 1)];
}

// A readable table of what has been learned, for the review step and the owner.
export function summary(stats) {
  return Object.entries(stats).flatMap(([type, ms]) => Object.entries(ms).map(([m, s]) =>
    `${type.padEnd(14)} ${m.padEnd(7)} ${s.done}/${s.attempts} done, $${s.costUsd.toFixed(2)}`)).join('\n');
}
