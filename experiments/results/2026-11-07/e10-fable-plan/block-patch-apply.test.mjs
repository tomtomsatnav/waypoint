// Acceptance: block mode reads the files a patch touches from its ---/+++ headers before `git apply FILE`,
// `patch ... < FILE` or `patch ... -i FILE` runs. A patch that touches no fenced file, or a missing patch file, is allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'fenceline-hook.mjs');

const hunk = '@@ -1 +1 @@\n-create table users();\n+create table people();\n';
const PATCHES = {
  // git style, a/ b/ prefixes: applied with -p1
  'patches/mig.patch': `diff --git a/migrations/001.sql b/migrations/001.sql\nindex 1111111..2222222 100644\n--- a/migrations/001.sql\n+++ b/migrations/001.sql\n${hunk}`,
  'patches/safe.patch': 'diff --git a/src/utils/money.js b/src/utils/money.js\n--- a/src/utils/money.js\n+++ b/src/utils/money.js\n@@ -1 +1 @@\n-y\n+z\n',
  'patches/new.patch': 'diff --git a/migrations/003.sql b/migrations/003.sql\nnew file mode 100644\n--- /dev/null\n+++ b/migrations/003.sql\n@@ -0,0 +1 @@\n+create table x();\n',
  'patches/multi.patch': `--- a/src/utils/money.js\n+++ b/src/utils/money.js\n@@ -1 +1 @@\n-y\n+z\n--- a/migrations/002.sql\n+++ b/migrations/002.sql\n@@ -1 +1 @@\n-alter table users;\n+alter table people;\n`,
  // plain unified diff with no prefix and timestamps: applied with -p0
  'patches/plain.patch': `--- migrations/001.sql\t2026-01-01 00:00:00\n+++ migrations/001.sql\t2026-01-02 00:00:00\n${hunk}`,
};

function setup() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fl-patch-')));
  const repo = path.join(tmp, 'repo'); const home = path.join(tmp, 'home');
  const files = {
    'migrations/001.sql': 'create table users();\n', 'migrations/002.sql': 'alter table users;\n',
    'src/payments/receipt.js': 'x\n', 'src/utils/money.js': 'y\n', 'notes/todo.txt': 'todo\n', ...PATCHES,
    '.fenceline/fences.json': JSON.stringify({ fences: [
      { id: 'no-migrations', text: 'migrations: off-limits', kind: 'deny', mode: 'block', paths: ['migrations/**'] },
      { id: 'notes-warn', text: 'leave notes alone', kind: 'deny', mode: 'warn', paths: ['notes/**'] },
    ] }),
  };
  for (const [rel, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), t); }
  const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' }); assert.equal(init.status, 0, init.stderr);
  const sid = `t${Math.random().toString(36).slice(2)}`;
  const hook = (payload) => {
    const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: sid, cwd: repo, ...payload }), env: { ...process.env, FENCELINE_HOME: home }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout;
  };
  const events = () => fs.readFileSync(path.join(home, 'sessions', sid, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = () => events().at(-1);
  const noErrors = () => assert.ok(!fs.existsSync(path.join(home, 'hook-errors.log')), () => `hook logged an error:\n${fs.readFileSync(path.join(home, 'hook-errors.log'), 'utf8')}`);
  const pre = (command) => hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  const denied = (command) => { const out = pre(command); noErrors(); if (out === '') return false; return JSON.parse(out).hookSpecificOutput?.permissionDecision === 'deny'; };
  assert.equal(hook({ hook_event_name: 'SessionStart', source: 'startup' }), '');
  return { repo, home, sid, hook, events, last, pre, denied, noErrors };
}
const blockedMigration = (s, file) => {
  const e = s.last();
  assert.equal(e.kind, 'blocked');
  assert.ok(e.crossings.some((c) => c.fence === 'no-migrations' && c.prevented === true && (file ? c.file === file : c.file.startsWith('migrations/'))), JSON.stringify(e.crossings));
};

test('git apply of a patch that touches a block fence is denied, naming the file from the patch headers', () => {
  const s = setup();
  const out = s.pre('git apply patches/mig.patch');
  assert.notEqual(out, '');
  const o = JSON.parse(out).hookSpecificOutput;
  assert.equal(o.permissionDecision, 'deny'); assert.match(o.permissionDecisionReason, /migrations: off-limits/);
  blockedMigration(s, 'migrations/001.sql');
  assert.ok(s.denied('git apply -p1 patches/mig.patch'));
  assert.ok(s.denied('git apply patches/new.patch'), 'a new file (--- /dev/null) is a create inside the fence');
  blockedMigration(s, 'migrations/003.sql');
  assert.ok(s.denied('git apply patches/multi.patch'), 'the second file of a multi-file patch');
  blockedMigration(s, 'migrations/002.sql');
  assert.ok(s.denied(`git apply ${path.join(s.repo, 'patches/mig.patch')}`), 'absolute patch path');
});
test('patch < FILE and patch -i FILE are denied when the patch touches a block fence', () => {
  const s = setup();
  assert.ok(s.denied('patch -p1 < patches/mig.patch'));
  blockedMigration(s, 'migrations/001.sql');
  assert.ok(s.denied('patch -p1 -i patches/mig.patch'));
  blockedMigration(s, 'migrations/001.sql');
  assert.ok(s.denied('patch -p0 < patches/plain.patch'), 'plain headers without a/ b/, with timestamps');
  blockedMigration(s, 'migrations/001.sql');
  assert.ok(s.denied('patch -p1 < patches/multi.patch'));
  blockedMigration(s, 'migrations/002.sql');
});
test('a patch that touches no fenced file, or no patch at all, is not denied', () => {
  const s = setup();
  assert.ok(!s.denied('git apply patches/safe.patch'));
  assert.ok(!s.denied('patch -p1 < patches/safe.patch'));
  assert.ok(!s.denied('patch -p1 -i patches/safe.patch'));
  assert.ok(!s.denied('cat patches/mig.patch'), 'reading the patch file is a read');
  assert.ok(!s.denied('git diff > patches/out.patch'), 'writing a patch file outside the fence');
  assert.ok(!s.denied('git apply patches/does-not-exist.patch'), 'a missing patch file: nothing to deny, and the hook must not crash');
  assert.ok(!s.denied('patch -p1 < patches/does-not-exist.patch'));
  assert.ok(!s.denied('git log --oneline -- migrations'), 'other git commands still read');
});
