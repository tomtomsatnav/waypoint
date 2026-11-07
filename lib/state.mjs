// The queue (written by a human or another tool) and waypoint's own state (written only by waypoint).
// Both live in the state directory: $WAYPOINT_DIR, or <repo>/.waypoint.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';

export const DEFAULTS = {
  verify: 'aos-orch verify --base {base}', // the external guard; null only when the queue says so explicitly
  maxBlocks: 6,        // our own cap on Stop blocks per task, below Claude Code's default of 8
  stallLimit: 2,       // consecutive blocks with no new commit and no newly passing check
  checkTimeoutSec: 300,
  outputTailChars: 4000,
};

export function stateDir(cwd = process.cwd()) {
  return resolve(process.env.WAYPOINT_DIR || join(cwd, '.waypoint'));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
}

// Normalise a check: a string is shorthand for { name: <cmd>, run: <cmd> }.
function normaliseCheck(c, i) {
  if (typeof c === 'string') return { name: c, run: c, hidden: false };
  if (!c || typeof c.run !== 'string') throw new Error(`check ${i}: needs a "run" command`);
  return { name: c.name || c.run, run: c.run, hidden: !!c.hidden, timeoutSec: c.timeoutSec };
}

// Load and validate the queue. Goals may be inline text or a goalFile (relative to the queue file).
export function loadQueue(queuePath) {
  const q = readJson(queuePath);
  if (!Array.isArray(q.tasks) || q.tasks.length === 0) throw new Error('queue: "tasks" must be a non-empty array');
  const base = dirname(resolve(queuePath));
  const ids = new Set();
  const tasks = q.tasks.map((t, i) => {
    const id = t.id || `task-${i + 1}`;
    if (ids.has(id)) throw new Error(`queue: duplicate task id "${id}"`);
    ids.add(id);
    let goal = t.goal;
    if (!goal && t.goalFile) goal = readFileSync(isAbsolute(t.goalFile) ? t.goalFile : join(base, t.goalFile), 'utf8');
    if (!goal || !goal.trim()) throw new Error(`queue: task "${id}" has no goal`);
    const checks = (t.checks || []).map(normaliseCheck);
    return { id, goal, checks };
  });
  // "verify" must be stated as null to switch the guard off; leaving it out keeps aos-orch verify.
  const verify = Object.prototype.hasOwnProperty.call(q, 'verify') ? q.verify : DEFAULTS.verify;
  return {
    verify,
    maxBlocks: q.maxBlocks ?? DEFAULTS.maxBlocks,
    stallLimit: q.stallLimit ?? DEFAULTS.stallLimit,
    checkTimeoutSec: q.checkTimeoutSec ?? DEFAULTS.checkTimeoutSec,
    outputTailChars: q.outputTailChars ?? DEFAULTS.outputTailChars,
    cumulativeChecks: q.cumulativeChecks ?? true,
    // false drops the "do not edit tests" sentences from the prompts, so verify alone guards (an experiment arm).
    guardText: q.guardText ?? true,
    tasks,
  };
}

export function statePath(dir) { return join(dir, 'state.json'); }

export function loadState(dir) {
  const p = statePath(dir);
  return existsSync(p) ? readJson(p) : null;
}

export function saveState(dir, state) {
  // The state dir usually sits inside the repo: make it ignore itself, so `git add -A` never commits it,
  // `git status` in the re-anchor stays clean and verify never sees it as a change.
  const gi = join(dir, '.gitignore');
  if (!existsSync(gi)) { mkdirSync(dir, { recursive: true }); writeFileSync(gi, '*\n'); }
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(statePath(dir), state);
}

// Fresh state for a run. The queue is copied in so hooks never depend on the original file staying put.
export function initState({ queue, queuePath, base, head }) {
  return {
    version: 1,
    queuePath: resolve(queuePath),
    queue,
    runBase: base,
    current: 0,
    finished: null, // null while running; 'done' | 'blocked' | 'limit' once over
    tasks: queue.tasks.map((t, i) => ({
      id: t.id,
      status: i === 0 ? 'active' : 'pending', // pending | active | done | blocked
      startSha: i === 0 ? head : null,
      blocks: 0,
      stalls: 0,
      lastHead: i === 0 ? head : null,
      bestPassing: [],
      lastCheck: null,
    })),
    events: [],
  };
}

export function activeTask(state) {
  if (!state || state.finished) return null;
  const t = state.tasks[state.current];
  if (!t || t.status !== 'active') return null;
  return { rec: t, spec: state.queue.tasks[state.current], index: state.current };
}
