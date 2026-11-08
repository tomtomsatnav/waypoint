// Hidden judge for the planner-vs-bare experiment on fenceline. Neither arm sees this file. Tests behaviour end to end
// through the real hook and CLI, so any sensible implementation of the goal passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO = process.env.FENCELINE_REPO;
const HOOK = path.join(REPO, 'hooks', 'fenceline-hook.mjs');
const BIN = path.join(REPO, 'bin', 'fenceline.mjs');

function setup() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'judge-')));
  const repo = path.join(tmp, 'repo'); const home = path.join(tmp, 'home');
  const patch = 'diff --git a/migrations/001.sql b/migrations/001.sql\n--- a/migrations/001.sql\n+++ b/migrations/001.sql\n@@ -1 +1 @@\n-create table users();\n+drop table users;\n';
  const safePatch = 'diff --git a/src/utils/money.js b/src/utils/money.js\n--- a/src/utils/money.js\n+++ b/src/utils/money.js\n@@ -1 +1 @@\n-y\n+z\n';
  const files = { 'migrations/001.sql': 'create table users();\n', 'migrations/002.sql': 'alter table users();\n', 'src/utils/money.js': 'y\n',
    'fix.patch': patch, 'safe.patch': safePatch,
    '.fenceline/fences.json': JSON.stringify({ fences: [
      { id: 'migrations', text: 'migrations: off-limits', kind: 'deny', mode: 'block', paths: ['migrations/**'] },
      { id: 'utils-warn', text: 'careful with utils', kind: 'deny', mode: 'warn', paths: ['src/utils/**'] },
    ] }) };
  for (const [rel, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), t); }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const sid = `j${Math.random().toString(36).slice(2)}`;
  const env = { ...process.env, FENCELINE_HOME: home }; delete env.NODE_TEST_CONTEXT;
  const hook = (payload) => execFileSync('node', [HOOK], { input: JSON.stringify({ session_id: sid, cwd: repo, ...payload }), env, encoding: 'utf8' });
  hook({ hook_event_name: 'SessionStart', source: 'startup' });
  const decision = (command) => { const o = hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }); return o.trim() ? JSON.parse(o).hookSpecificOutput?.permissionDecision ?? 'allow' : 'allow'; };
  const check = (command) => spawnSync(process.execPath, [BIN, 'check', command], { cwd: repo, env, encoding: 'utf8' });
  return { repo, decision, check };
}

const denied = [
  ['dd of= into the zone', 'dd if=/dev/zero of=migrations/001.sql bs=1 count=1'],
  ['find -delete in the zone', "find migrations -name '*.sql' -delete"],
  ['find -exec rm in the zone', 'find migrations -type f -exec rm {} +'],
  ['sh -c wrapping a redirect', "sh -c 'echo x > migrations/001.sql'"],
  ['bash -c wrapping rm', 'bash -c "rm migrations/002.sql"'],
  ['git apply of a patch touching the zone', 'git apply fix.patch'],
  ['patch < file touching the zone', 'patch -p1 < fix.patch'],
];
for (const [name, cmd] of denied) test(`blocked: ${name}`, () => assert.equal(setup().decision(cmd), 'deny', cmd));

const allowed = [
  ['dd reading the zone, writing elsewhere', 'dd if=migrations/001.sql of=/tmp/judge-copy.sql'],
  ['find without -delete', "find migrations -name '*.sql'"],
  ['sh -c that only reads', "sh -c 'cat migrations/001.sql'"],
  ['git apply of a patch outside the zone', 'git apply safe.patch'],
];
for (const [name, cmd] of allowed) test(`allowed: ${name}`, () => assert.notEqual(setup().decision(cmd), 'deny', cmd));

test('the existing cases still hold: rm into the zone denied, a warn fence not', () => {
  const s = setup();
  assert.equal(s.decision('rm migrations/001.sql'), 'deny');
  assert.notEqual(s.decision('echo z > src/utils/money.js'), 'deny');
});

test('fenceline check: crossing a block fence names it and exits 1', () => {
  const r = setup().check('rm migrations/001.sql');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /migrations/);
});
test('fenceline check: one of the new forms is recognised too', () => {
  const r = setup().check("find migrations -name '*.sql' -delete");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /migrations/);
});
test('fenceline check: crossing only a warn fence exits 0 but still names it', () => {
  const r = setup().check('echo z > src/utils/money.js');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /utils-warn/);
});
test('fenceline check: a harmless command crosses nothing and exits 0', () => {
  const r = setup().check('ls -la');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /migrations|utils-warn/);
});
