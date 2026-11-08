// Acceptance: block mode sees `dd ... of=FILE` and `find DIR ... -delete` / `find DIR ... -exec rm ...` as writes
// before they run, and reads through dd/find stay reads. Driven through the real hook process, like test/hook.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'fenceline-hook.mjs');

function setup() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fl-ddfind-')));
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
  // the hook swallows its own errors (exit 0, empty stdout), so an "allowed" result is only trusted when nothing was logged
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

test('dd of= into a block fence is denied before it runs, whatever the operand order', () => {
  const s = setup();
  assert.ok(s.denied('dd if=/dev/zero of=migrations/001.sql bs=1 count=1'));
  blockedMigration(s, 'migrations/001.sql');
  assert.ok(s.denied('dd of=migrations/002.sql if=/dev/urandom count=1'));
  blockedMigration(s, 'migrations/002.sql');
  assert.ok(s.denied('dd if=/dev/zero of="migrations/001.sql"'), 'quoted of=');
  assert.ok(s.denied('cd migrations && dd if=/dev/zero of=001.sql'), 'after a cd');
});
test('dd that only reads from the fence is not denied', () => {
  const s = setup();
  assert.ok(!s.denied(`dd if=migrations/001.sql of=${path.join(os.tmpdir(), 'fl-dd-out.bin')}`), 'of= outside the repo');
  assert.ok(!s.denied('dd if=migrations/001.sql of=src/utils/copy.sql'), 'of= outside the fence');
  assert.ok(!s.denied('dd if=migrations/001.sql bs=1 count=4 | od -c'), 'no of= at all');
  assert.ok(!s.denied('dd if=/dev/zero of=notes/blank.bin count=1'), 'a warn fence is not enforced before the fact');
});
test('find -delete and find -exec rm under a block fence are denied: everything find could match is a possible target', () => {
  const s = setup();
  assert.ok(s.denied("find migrations -name '*.sql' -delete"));
  blockedMigration(s);
  assert.ok(s.denied("find . -name '*.sql' -delete"), 'the whole repo includes the fence');
  blockedMigration(s);
  assert.ok(s.denied("find -name '*.sql' -delete"), 'no DIR means .');
  assert.ok(s.denied('find migrations -type f -exec rm {} \;'));
  blockedMigration(s);
  assert.ok(s.denied('find migrations -type f -exec rm -f {} +'));
  assert.ok(s.denied('find ./migrations -mindepth 1 -delete'));
  assert.ok(s.denied('find src migrations -name "*.sql" -delete'), 'several DIRs');
});
test('find that writes nothing, or writes outside the block fence, is not denied', () => {
  const s = setup();
  assert.ok(!s.denied("find migrations -name '*.sql'"));
  assert.ok(!s.denied('find migrations -type f -exec cat {} \;'));
  assert.ok(!s.denied('find migrations -type f | wc -l'));
  assert.ok(!s.denied("find src -name '*.js' -delete"), 'src is not fenced');
  assert.ok(!s.denied("find src -name '*.js' -exec rm {} \;"), 'src is not fenced');
  assert.ok(!s.denied("find notes -name '*.txt' -delete"), 'a warn fence is not enforced before the fact');
  assert.ok(!s.denied('grep -rn delete migrations'), 'the word delete in another command');
});
