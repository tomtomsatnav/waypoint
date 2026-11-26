import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../todo.mjs', import.meta.url));
const tempFile = (todos) => { const f = join(mkdtempSync(join(tmpdir(), 'todo-test-')), 'todos.json'); if (todos) writeFileSync(f, JSON.stringify(todos)); return f; };
const todo = (file, ...args) => { const r = spawnSync('node', [SCRIPT, ...args], { env: { ...process.env, TODO_FILE: file }, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const list = (file, ...args) => todo(file, 'list', ...args).out.trim().split('\n').filter(Boolean);

test('add and list show boxes', () => {
  const f = tempFile(); todo(f, 'add', 'buy', 'lamp', 'oil'); todo(f, 'add', 'trim wicks');
  assert.deepEqual(list(f), ['1. [ ] buy lamp oil', '2. [ ] trim wicks']);
});

test('an old todos.json without done flags still works', () => {
  const f = tempFile([{ id: 1, text: 'old one' }, { id: 2, text: 'older one' }]);
  assert.deepEqual(list(f), ['1. [ ] old one', '2. [ ] older one']);
  assert.equal(todo(f, 'done', '2').code, 0);
  assert.deepEqual(list(f), ['1. [ ] old one', '2. [x] older one']);
  todo(f, 'add', 'new one');
  assert.equal(list(f)[2], '3. [ ] new one');
});

test('done and undo', () => {
  const f = tempFile(); todo(f, 'add', 'a'); todo(f, 'add', 'b');
  todo(f, 'done', '2'); assert.equal(list(f)[1], '2. [x] b');
  todo(f, 'undo', '2'); assert.equal(list(f)[1], '2. [ ] b');
});

test('list --pending hides done to-dos', () => {
  const f = tempFile(); for (const t of ['a', 'b', 'c']) todo(f, 'add', t); todo(f, 'done', '2');
  assert.deepEqual(list(f, '--pending'), ['1. [ ] a', '3. [ ] c']);
});

test('remove keeps the other ids and never reuses one', () => {
  const f = tempFile(); for (const t of ['a', 'b', 'c']) todo(f, 'add', t);
  assert.equal(todo(f, 'remove', '3').code, 0); todo(f, 'remove', '1'); todo(f, 'add', 'd');
  assert.deepEqual(list(f), ['2. [ ] b', '4. [ ] d']);
});

test('an unknown id is an error and changes nothing', () => {
  const f = tempFile(); todo(f, 'add', 'a'); const before = readFileSync(f, 'utf8');
  for (const cmd of ['done', 'undo', 'remove']) {
    const r = todo(f, cmd, '9'); assert.equal(r.code, 1); assert.match(r.err, /9/);
  }
  assert.equal(readFileSync(f, 'utf8'), before);
});

test('help lists the commands', () => {
  const r = todo(tempFile(), 'help'); assert.equal(r.code, 0);
  for (const c of ['add', 'list', 'done', 'undo', 'remove']) assert.ok(r.out.includes(c), c);
});
