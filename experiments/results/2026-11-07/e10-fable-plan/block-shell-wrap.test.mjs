// Acceptance: block mode looks inside `sh -c '...'` / `bash -c "..."` and judges the inner command with the same rules
// (redirections, rm, sed -i, cd, dd, find, ...). A wrapped command that only reads is still allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'fenceline-hook.mjs');

function setup() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fl-shwrap-')));
  const repo = path.join(tmp, 'repo'); const home = path.join(tmp, 'home');
  const files = {
    'migrations/001.sql': 'create table users();\n', 'migrations/002.sql': 'alter table users;\n',
    'src/payments/receipt.js': 'x\n', 'src/utils/money.js': 'y\n', 'notes/todo.txt': 'todo\n',
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

test('a write wrapped in sh -c / bash -c is denied, with the user\'s rule in the reason', () => {
  const s = setup();
  const out = s.pre("sh -c 'echo x > migrations/001.sql'");
  assert.notEqual(out, '');
  const o = JSON.parse(out).hookSpecificOutput;
  assert.equal(o.permissionDecision, 'deny'); assert.match(o.permissionDecisionReason, /migrations: off-limits/);
  blockedMigration(s, 'migrations/001.sql');
  assert.ok(s.denied('bash -c "rm -rf migrations"'));
  blockedMigration(s);
  assert.ok(s.denied("/bin/bash -c 'sed -i s/a/b/ migrations/001.sql'"), 'full path to the shell');
  assert.ok(s.denied("bash -lc 'rm migrations/002.sql'"), '-c combined with another flag');
  assert.ok(s.denied("sh -c 'ls && echo y >> migrations/001.sql'"), 'a later command inside the wrapper');
});
test('cd is honoured inside and outside the wrapper', () => {
  const s = setup();
  assert.ok(s.denied("sh -c 'cd migrations && rm 001.sql'"));
  blockedMigration(s, 'migrations/001.sql');
  assert.ok(s.denied("cd migrations && sh -c 'rm 001.sql'"));
  blockedMigration(s, 'migrations/001.sql');
});
test('the new write forms are also seen inside a wrapper', () => {
  const s = setup();
  assert.ok(s.denied("sh -c 'find migrations -name \"*.sql\" -delete'"));
  assert.ok(s.denied("bash -c 'dd if=/dev/zero of=migrations/001.sql count=1'"));
});
test('a wrapped command that only reads, or writes outside the block fence, is not denied', () => {
  const s = setup();
  assert.ok(!s.denied("sh -c 'cat migrations/001.sql'"));
  assert.ok(!s.denied("bash -c 'ls migrations && grep -n users migrations/001.sql'"));
  assert.ok(!s.denied("sh -c 'echo x > src/utils/money.js'"), 'src is not fenced');
  assert.ok(!s.denied("sh -c 'rm notes/todo.txt'"), 'a warn fence is not enforced before the fact');
  assert.ok(!s.denied("echo \"sh -c 'rm migrations/001.sql'\" > notes/cmd.txt"), 'the wrapper is only text inside an echo');
  assert.ok(!s.denied('sh -c "exit 0"'));
});
