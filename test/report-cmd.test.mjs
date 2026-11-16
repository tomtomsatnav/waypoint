// Acceptance tests for `waypoint report <report.json>` (dogfood task 3). Written by the owner; read them, do not change them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'waypoint.mjs');
const sample = {
  runId: '2026-11-08T12-00-00-000Z', outcome: 'blocked', wallClockSec: 754.2, costUsd: 0.4567,
  config: { model: 'haiku', budgetUsd: 3, anchor: true, anchorMode: 'auto' },
  tasks: [{ id: 'glob', status: 'done', blocks: 1, stalls: 0 }, { id: 'fences', status: 'blocked', blocks: 3, stalls: 2 }, { id: 'cli', status: 'pending', blocks: 0, stalls: 0 }],
  sessions: [{ label: 'session-1', sessionId: 's1', exitCode: 0, cap: null, costUsd: 0.4567, maxContext: 123456 }],
  stopAttempts: 6,
};
function file(obj) { const d = mkdtempSync(join(tmpdir(), 'wp-report-')); const f = join(d, 'report.json'); writeFileSync(f, JSON.stringify(obj)); return f; }
const report = (...a) => spawnSync(process.execPath, [BIN, 'report', ...a], { encoding: 'utf8' });

test('a readable summary: outcome, model, cost to the cent, wall clock in minutes, stop attempts', () => {
  const r = report(file(sample));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^outcome: blocked$/m);
  assert.match(r.stdout, /^model: haiku$/m);
  assert.match(r.stdout, /^cost: \$0\.46$/m);
  assert.match(r.stdout, /^wall clock: 12\.6 min$/m);
  assert.match(r.stdout, /^stop attempts: 6$/m);
});

test('one line per task with its status and blocks, in queue order', () => {
  const lines = report(file(sample)).stdout.split('\n').filter((l) => /^task /.test(l));
  assert.deepEqual(lines, ['task glob: done (1 block)', 'task fences: blocked (3 blocks)', 'task cli: pending (0 blocks)']);
});

test('peak context per session in thousands of tokens', () => {
  assert.match(report(file(sample)).stdout, /^session session-1: \$0\.46, peak context 123k$/m);
});

test('a missing or unreadable file: exit 2 with a message, no stack trace', () => {
  const r = report('/no/such/report.json');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /report/);
  assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/);
});
