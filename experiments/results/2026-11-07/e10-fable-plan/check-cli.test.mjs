// Acceptance: `fenceline check "<shell command>"` prints which fences the command would cross (one line per crossing,
// naming the fence id) and exits 1 if any block fence is crossed, 0 otherwise; the README documents it and its Limits
// section no longer lists dd / find -delete / sh -c / git apply as writes block mode cannot prevent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'fenceline.mjs');
const env = { ...process.env, FENCELINE_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'fl-check-home-')) }; delete env.NODE_TEST_CONTEXT;

function repo() {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fl-check-')));
  const files = {
    'migrations/001.sql': 'create table users();\n', 'migrations/002.sql': 'alter table users;\n',
    'src/payments/receipt.js': 'x\n', 'src/utils/money.js': 'y\n', 'notes/todo.txt': 'todo\n', '.env': 'A=1\n',
    'patches/mig.patch': 'diff --git a/migrations/001.sql b/migrations/001.sql\n--- a/migrations/001.sql\n+++ b/migrations/001.sql\n@@ -1 +1 @@\n-create table users();\n+create table people();\n',
    '.fenceline/fences.json': JSON.stringify({ schema: 'fenceline.fences/1', fences: [
      { id: 'no-migrations', text: 'migrations: off-limits', kind: 'deny', mode: 'block', paths: ['migrations/**'] },
      { id: 'notes-warn', text: 'leave notes alone', kind: 'deny', mode: 'warn', paths: ['notes/**'] },
      { id: 'secrets', text: 'never read .env', kind: 'deny', mode: 'block', paths: ['.env'], reads: true },
    ] }),
  };
  for (const [rel, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true }); fs.writeFileSync(path.join(r, rel), t); }
  const init = spawnSync('git', ['init', '-q'], { cwd: r, encoding: 'utf8' }); assert.equal(init.status, 0, init.stderr);
  return r;
}
const run = (r, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd: r, encoding: 'utf8', env });
const IDS = /no-migrations|notes-warn|secrets/;

test('check: a command that crosses a block fence exits 1 and names the fence', () => {
  const r = repo();
  const out = run(r, 'check', 'rm -rf migrations');
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stdout, /no-migrations/);
  assert.doesNotMatch(out.stdout, /notes-warn|secrets/);
  const rd = run(r, 'check', 'echo x > migrations/001.sql');
  assert.equal(rd.status, 1, rd.stderr); assert.match(rd.stdout, /no-migrations/);
});
test('check: a warn fence crossing is printed but exits 0', () => {
  const r = repo();
  const out = run(r, 'check', 'echo x > notes/todo.txt');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /notes-warn/);
  assert.doesNotMatch(out.stdout, /no-migrations|secrets/);
});
test('check: a command that crosses nothing exits 0 and names no fence', () => {
  const r = repo();
  for (const cmd of ['cat migrations/001.sql && ls notes', 'npm test', 'echo x > src/utils/money.js', "find migrations -name '*.sql'", 'dd if=migrations/001.sql of=src/utils/copy.sql']) {
    const out = run(r, 'check', cmd);
    assert.equal(out.status, 0, `${cmd}: ${out.stderr}`);
    assert.doesNotMatch(out.stdout, IDS, cmd);
  }
});
test('check: one line per crossing, each naming its fence id', () => {
  const r = repo();
  const out = run(r, 'check', 'rm notes/todo.txt; rm migrations/001.sql');
  assert.equal(out.status, 1, out.stderr);
  const lines = out.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(lines.some((l) => /no-migrations/.test(l) && !/notes-warn/.test(l)), out.stdout);
  assert.ok(lines.some((l) => /notes-warn/.test(l) && !/no-migrations/.test(l)), out.stdout);
});
test('check: uses the same reading of Bash as the hook (sh -c, find -delete, dd of=, git apply, patch)', () => {
  const r = repo();
  for (const cmd of ["sh -c 'find migrations -name \"*.sql\" -delete'", 'dd if=/dev/zero of=migrations/002.sql count=1', 'git apply patches/mig.patch', 'patch -p1 < patches/mig.patch', 'bash -c "rm migrations/001.sql"']) {
    const out = run(r, 'check', cmd);
    assert.equal(out.status, 1, `${cmd}: expected exit 1\n${out.stdout}${out.stderr}`);
    assert.match(out.stdout, /no-migrations/, cmd);
  }
});
test('check: a read of a block fence with reads: true crosses it, as in the hook', () => {
  const r = repo();
  const out = run(r, 'check', 'cat .env');
  assert.equal(out.status, 1, out.stderr); assert.match(out.stdout, /secrets/);
  const ok = run(r, 'check', 'cat src/utils/money.js');
  assert.equal(ok.status, 0, ok.stderr); assert.doesNotMatch(ok.stdout, IDS);
});
test('check: no command is a usage error (exit 2); the usage text lists check', () => {
  const r = repo();
  const out = run(r, 'check');
  assert.equal(out.status, 2);
  const usage = run(r);
  assert.equal(usage.status, 0, usage.stderr);
  assert.match(usage.stdout, /\bcheck\b/);
});
test('README documents fenceline check and its Limits section no longer lists the writes block mode now prevents', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /fenceline check/);
  const at = readme.indexOf('## Limits'); assert.ok(at >= 0, 'README has a Limits section');
  const rest = readme.slice(at + '## Limits'.length); const next = rest.search(/\n## /);
  const limits = next >= 0 ? rest.slice(0, next) : rest;
  for (const gone of ['dd of=', 'find -delete', 'sh -c', 'git apply']) assert.ok(!limits.includes(gone), `Limits still lists ${JSON.stringify(gone)}`);
});
