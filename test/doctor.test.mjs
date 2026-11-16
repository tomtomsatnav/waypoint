// Acceptance tests for `waypoint doctor` (dogfood task 1). Written by the owner; the agent may read them but not change them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'waypoint.mjs');
const GIT = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

// A PATH holding only the tools named, as stubs (node and git are real).
function pathWith(names) {
  const d = mkdtempSync(join(tmpdir(), 'wp-doctor-'));
  symlinkSync(process.execPath, join(d, 'node'));
  symlinkSync(GIT, join(d, 'git'));
  for (const n of names) { writeFileSync(join(d, n), '#!/bin/sh\necho "stub 1.0"\n'); chmodSync(join(d, n), 0o755); }
  return d;
}
const doctor = (path) => spawnSync(process.execPath, [BIN, 'doctor'], { encoding: 'utf8', env: { PATH: path, HOME: tmpdir() } });

test('all present: exit 0, one "ok" line per tool', () => {
  const r = doctor(pathWith(['claude', 'aos-orch', 'bwrap']));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const n of ['node', 'git', 'claude', 'aos-orch', 'bwrap']) assert.match(r.stdout, new RegExp(`^ok\\s+${n}\\b`, 'm'), n);
});

test('aos-orch missing: exit 1, a "missing" line that says how to install it', () => {
  const r = doctor(pathWith(['claude', 'bwrap']));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^missing\s+aos-orch\b.*install-aos-orch\.sh/m);
  assert.match(r.stdout, /^ok\s+claude\b/m);
});

test('bwrap missing: exit 1, and the line says verify fails closed without it', () => {
  const r = doctor(pathWith(['claude', 'aos-orch']));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^missing\s+bwrap\b.*fails closed/m);
});

test('claude missing: exit 1', () => {
  const r = doctor(pathWith(['aos-orch', 'bwrap']));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^missing\s+claude\b/m);
});

test('doctor never starts a session or spends anything: it does not run claude -p', () => {
  const d = pathWith(['aos-orch', 'bwrap']);
  writeFileSync(join(d, 'claude'), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "-p" ] && { echo SPENT > "${d}/spent"; }; done\necho "stub 1.0"\n`);
  chmodSync(join(d, 'claude'), 0o755);
  const r = doctor(d);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(spawnSync('test', ['-e', join(d, 'spent')]).status, 1, 'claude -p must not be called');
});
