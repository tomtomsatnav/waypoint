// Re-anchor: on every SessionStart (startup, resume, clear and, crucially, compact) inject the goal verbatim plus
// facts from git and the last check run. Never the agent's own prose, so it cannot become a summary of a summary.

import { logSince, statusShort } from './git.mjs';
import { activeTask, loadState, stateDir } from './state.mjs';
import { goalBlock } from './stop.mjs';

export function anchorText(state, cwd, source = 'startup') {
  const active = activeTask(state);
  if (!active) return null;
  const { rec, spec, index } = active;
  const total = state.queue.tasks.length;
  const done = state.tasks.filter((t) => t.status === 'done').map((t) => t.id);
  const log = logSince(cwd, rec.startSha);
  const status = statusShort(cwd);
  const lc = rec.lastCheck;
  const checkLines = lc
    ? lc.results.map((r) => `- ${r.passed ? 'PASS' : r.timedOut ? 'TIMEOUT' : 'FAIL'} ${r.kind}: ${r.name}`).join('\n')
    : '(not run yet in this task)';

  const lines = [
    `[waypoint] Re-anchor after session ${source}. These are facts from the goal file, git and the checks; trust them over any summary.`,
    '',
    goalBlock(spec, index, total),
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
    '',
    'Carry on from here. Work already committed above is done: build on it rather than re-reading or redoing it.',
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
