// Acceptance tests for `waypoint status --json` (dogfood task 2). Written by the owner; read them, do not change them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initState, saveState } from '../lib/state.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'waypoint.mjs');

function stateIn(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'wp-status-'));
  execFileSync('bash', ['-c', 'git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m s'], { cwd: dir });
  const queue = { verify: null, maxBlocks: 6, stallLimit: 2, checkTimeoutSec: 60, outputTailChars: 100, cumulativeChecks: true, redact: [],
    tasks: [{ id: 'one', goal: 'g1', checks: [{ name: 'c1', run: 'true' }] }, { id: 'two', goal: 'g2', checks: [] }] };
  const s = initState({ queue, queuePath: join(dir, 'q.json'), base: 'abc', head: 'abc' });
  mutate?.(s);
  saveState(join(dir, '.git', 'waypoint'), s);
  return dir;
}
const status = (cwd, ...a) => spawnSync(process.execPath, [BIN, 'status', ...a], { cwd, encoding: 'utf8' });

test('--json prints one JSON object: finished, current, and every task', () => {
  const r = status(stateIn(), '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.finished, null);
  assert.equal(j.current, 'one');
  assert.deepEqual(j.tasks.map((t) => [t.id, t.status, t.blocks, t.stalls]), [['one', 'active', 0, 0], ['two', 'pending', 0, 0]]);
});

test('--json gives the last check as passed plus the names of the failing checks, never their output', () => {
  const r = status(stateIn((s) => {
    s.tasks[0].blocks = 2;
    s.tasks[0].lastCheck = { at: 't', passed: false, results: [{ name: 'c1', kind: 'check', passed: false, outputHead: 'SECRET OUTPUT' }, { name: 'verify', kind: 'verify', passed: true }] };
  }), '--json');
  const t = JSON.parse(r.stdout).tasks[0];
  assert.equal(t.blocks, 2);
  assert.deepEqual(t.lastCheck, { passed: false, failing: ['c1'] });
  assert.doesNotMatch(r.stdout, /SECRET OUTPUT/);
});

test('a finished run reports finished and no current task', () => {
  const j = JSON.parse(status(stateIn((s) => { s.finished = 'done'; s.tasks.forEach((t) => { t.status = 'done'; }); }), '--json').stdout);
  assert.equal(j.finished, 'done');
  assert.equal(j.current, null);
});

test('no state: --json prints {"state":null} and exits 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp-status-none-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const r = status(dir, '--json');
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout), { state: null });
});

test('the plain-text status still works as before', () => {
  const r = status(stateIn());
  assert.equal(r.status, 0);
  assert.match(r.stdout, /finished: no/);
});
