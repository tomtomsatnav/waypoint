// Re-anchor: on every SessionStart (startup, resume, clear and compact) inject facts from git and the last check run, never
// the agent's own prose, so it cannot become a summary of a summary.
//
// Mode (state.anchorMode, set by the runner):
//   auto  (default) goal verbatim + facts on startup/resume/clear; facts only after a compaction
//   full  goal verbatim + facts on every source (the original design)
//   facts facts only, on every source
// Why auto: in E3 with the finish line hidden, re-injecting the goal verbatim after each compaction (it said "read each file
// before changing it") was followed by bulk re-reads of every file, 89 re-reads against 4 with no anchor. Claude Code's own
// compaction summary keeps the task; what it loses is facts. See experiments/results/2026-11-07.md.

import { logSince, statusShort } from './git.mjs';
import { activeTask, loadState, stateDir } from './state.mjs';
import { goalBlock } from './stop.mjs';
import { redact } from './checks.mjs';

export const ANCHOR_MODES = ['auto', 'full', 'facts'];

export function anchorText(state, cwd, source = 'startup', mode = state?.anchorMode || 'auto') {
  const active = activeTask(state);
  if (!active) return null;
  const { rec, spec, index } = active;
  const total = state.queue.tasks.length;
  const withGoal = mode === 'full' || (mode === 'auto' && source !== 'compact');
  const done = state.tasks.filter((t) => t.status === 'done').map((t) => t.id);
  const log = logSince(cwd, rec.startSha);
  const status = statusShort(cwd);
  const lc = rec.lastCheck;
  const checkLines = lc
    ? lc.results.map((r) => `- ${r.passed ? 'PASS' : r.timedOut ? 'TIMEOUT' : 'FAIL'} ${r.kind}: ${redact(r.name, state.queue.redact)}`).join('\n')
    : '(not run yet in this task)';

  const lines = [
    `[waypoint] Re-anchor after session ${source}. These are facts from ${withGoal ? 'the goal file, ' : ''}git and the checks; trust them over any summary.`,
    '',
    withGoal ? goalBlock(spec, index, total) : `Current task: "${spec.id}" (${index + 1} of ${total}); its goal is unchanged.`,
    '',
    `Tasks already finished and accepted (do not redo): ${done.length ? done.join(', ') : 'none'}.`,
    '',
    `Commits made on this task (git log --oneline ${String(rec.startSha).slice(0, 12)}..HEAD):`,
    log || '(none yet)',
    '',
    'Working tree (git status --short):',
    status || '(clean)',
    '',
    `Last finish-line run${lc ? ` (${lc.at})` : ''}:`,
    checkLines,
  ];
  return lines.join('\n');
}

export function anchorHook(payload) {
  if (process.env.WAYPOINT_DISABLE === '1') return null;
  const cwd = payload.cwd || process.cwd();
  const state = loadState(stateDir(cwd));
  const text = anchorText(state, cwd, payload.source || 'startup');
  if (!text) return null;
  const event = payload.hook_event_name || 'SessionStart';
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}
