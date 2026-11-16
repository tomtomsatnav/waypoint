// The stop hook sets WAYPOINT_DIR in its own process; the finish-line checks must not inherit it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFinishLine } from '../lib/checks.mjs';

test('checks do not inherit WAYPOINT_DIR or git repo-pinning variables from the hook process', () => {
  const names = ['WAYPOINT_DIR', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) process.env[n] = '/tmp/live-state-for-test';
  try {
    const probe = names.map((n) => `echo "${n}=\${${n}-unset}"`).join('; ');
    const out = runFinishLine({ checks: [{ name: 'env', run: probe }], verify: null, cwd: process.cwd(), timeoutSec: 10 }).results[0].output;
    for (const n of names) assert.match(out, new RegExp(`^${n}=unset$`, 'm'), n);
  } finally {
    for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
  }
});
