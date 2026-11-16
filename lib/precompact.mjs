// PreCompact hook: steer what Claude Code's compaction summary keeps, so the agent does not have to re-read files to
// recover what it already knew. In 2.1.319 a PreCompact hook's stdout (plain text, cut at 10,000 characters) is passed to
// the compactor as extra summary instructions (newCustomInstructions). Measured motive: in testing, re-reads
// after compaction were 40-75% of everything the agent read.
//
// This only shapes the summary; the goal itself still comes back from facts (the SessionStart re-anchor), never from here.

import { activeTask, loadState, stateDir } from './state.mjs';
import { execFileSync } from 'node:child_process';

function changedFiles(cwd, base) {
  try {
    return execFileSync('git', ['diff', '--stat=120', base, '--'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd();
  } catch { return ''; }
}

export function precompactText(state, cwd) {
  const active = activeTask(state);
  if (!active) return null;
  const stat = changedFiles(cwd, active.rec.startSha);
  return [
    'Summary instructions from waypoint (keep the summary factual and specific; it replaces the files you have read):',
    '1. For every file you read or edited in this session, give its path and what you learned from it that you will need again:',
    '   exported names and signatures, key constants and formats, and anything surprising. Be concrete enough that you will',
    '   not need to read the file again to use it.',
    '2. For every file you changed, say what you changed and whether that change is finished.',
    '3. Name the checks or tests that are still failing, with the exact failing case if you know it.',
    '4. State the single next step.',
    'Do not restate the task goal: it is re-injected separately from the goal file after compaction.',
    ...(stat ? ['', `Files changed in this task so far (git diff --stat):`, stat.slice(0, 3000)] : []),
  ].join('\n');
}

// Hook entry point: payload on stdin, plain-text instructions on stdout.
export function precompactHook(payload) {
  if (process.env.WAYPOINT_DISABLE === '1') return null;
  const cwd = payload.cwd || process.cwd();
  return precompactText(loadState(stateDir(cwd)), cwd);
}
