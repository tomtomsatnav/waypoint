import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, ok, cli } from '../lib/harness.mjs';

run(async (repo, check) => {
  const fresh = (todos) => { const f = join(mkdtempSync(join(tmpdir(), 'todo-')), 'todos.json'); if (todos) writeFileSync(f, JSON.stringify(todos)); return f; };
  const todo = (file, ...a) => cli(repo, ['todo.mjs', ...a], { env: { TODO_FILE: file } });
  const lines = (s) => s.trim().split('\n').filter(Boolean);
  await check('add and list still work, with boxes', async () => { const f = fresh(); todo(f, 'add', 'buy', 'lamp', 'oil'); todo(f, 'add', 'trim wicks');
    const l = lines(todo(f, 'list').out); ok(l[0] === '1. [ ] buy lamp oil' && l[1] === '2. [ ] trim wicks', JSON.stringify(l)); });
  await check('an old todos.json without done flags still works', async () => { const f = fresh([{ id: 1, text: 'old one' }, { id: 2, text: 'older one' }]);
    const l = lines(todo(f, 'list').out); ok(l[0] === '1. [ ] old one', JSON.stringify(l)); const d = todo(f, 'done', '2'); ok(d.code === 0, `done exit ${d.code}: ${d.err}`);
    ok(lines(todo(f, 'list').out)[1] === '2. [x] older one', 'not marked'); });
  await check('done and undo', async () => { const f = fresh(); todo(f, 'add', 'a'); todo(f, 'add', 'b'); todo(f, 'done', '2');
    ok(lines(todo(f, 'list').out)[1] === '2. [x] b', 'done'); todo(f, 'undo', '2'); ok(lines(todo(f, 'list').out)[1] === '2. [ ] b', 'undo'); });
  await check('list --pending', async () => { const f = fresh(); todo(f, 'add', 'a'); todo(f, 'add', 'b'); todo(f, 'add', 'c'); todo(f, 'done', '2');
    const l = lines(todo(f, 'list', '--pending').out); ok(l.length === 2 && l[0] === '1. [ ] a' && l[1] === '3. [ ] c', JSON.stringify(l)); });
  await check('remove keeps ids, never reuses one', async () => { const f = fresh(); todo(f, 'add', 'a'); todo(f, 'add', 'b'); todo(f, 'add', 'c');
    const r = todo(f, 'remove', '3'); ok(r.code === 0, `remove exit ${r.code}`); todo(f, 'remove', '1'); todo(f, 'add', 'd');
    const l = lines(todo(f, 'list').out); ok(l[0] === '2. [ ] b' && l[1] === '4. [ ] d', JSON.stringify(l)); });
  await check('an unknown id: message on stderr, exit 1, nothing changed', async () => { const f = fresh(); todo(f, 'add', 'a'); const before = readFileSync(f, 'utf8');
    for (const c of ['done', 'undo', 'remove']) { const r = todo(f, c, '9'); ok(r.code === 1 && /\b9\b/.test(r.err), `${c} 9 -> exit ${r.code}, stderr "${r.err}"`); }
    ok(readFileSync(f, 'utf8') === before, 'the file changed'); ok(todo(f, 'done', '1').code === 0, 'done on an existing id failed'); });
  await check('help lists the commands', async () => { const f = fresh(); const r = todo(f, 'help'); const t = r.out + r.err;
    ok(r.code === 0 && ['add', 'list', 'done', 'undo', 'remove'].every((c) => t.includes(c)), `help: ${t.slice(0, 200)}`); });
  await check('the repo has tests for the new commands, and they pass', async () => {
    const { spawnSync } = await import('node:child_process'); const r = spawnSync('node', ['--test'], { cwd: repo, encoding: 'utf8', timeout: 60000 });
    ok(r.status === 0 && /# pass [1-9]/.test(r.stdout), `node --test: ${(r.stdout + r.stderr).slice(-300)}`);
    ok(/done/.test(readFileSync(join(repo, 'README.md'), 'utf8')), 'README does not mention done'); });
}, 8);
