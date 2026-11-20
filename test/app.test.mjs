import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT } from './helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function launcher() {
  const dir = mkdtempSync(join(tmpdir(), 'waypoint-app-'));
  const home = join(dir, 'home'); const bin = join(dir, 'bin'); mkdirSync(bin);
  // A stand-in autopilot.sh that records how it was called, and a stand-in claude that drafts a brief.
  writeFileSync(join(bin, 'autopilot.sh'), `#!/bin/bash\necho "$PWD|$*" >> "${dir}/calls"\n`); chmodSync(join(bin, 'autopilot.sh'), 0o755);
  writeFileSync(join(bin, 'claude'), '#!/bin/bash\ncat > /dev/null\nprintf "# Lantern Farm\\n\\nA farming game.\\n\\n## Done means\\nYou can farm.\\n"\n'); chmodSync(join(bin, 'claude'), 0o755);
  const port = 3900 + Math.floor(Math.random() * 500);
  const p = spawn(process.execPath, [join(ROOT, 'bin', 'app.mjs'), '--port', String(port)], {
    env: { ...process.env, WAYPOINT_HOME: home, WAYPOINT_AUTOPILOT_SH: join(bin, 'autopilot.sh'), PATH: `${bin}:${process.env.PATH}`,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 50 && !out.includes('key='); i++) await sleep(100);
  const key = out.match(/key=(\S+)/)[1];
  const call = (path, body, k = key) => fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { 'x-key': k, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  return { dir, home, port, key, call, stop: () => p.kill() };
}

test('launcher: needs its key, drafts a brief, creates and starts a project', async () => {
  const L = await launcher();
  try {
    const page = await fetch(`http://127.0.0.1:${L.port}/`).then((r) => r.text());
    assert.match(page, /New project/);
    assert.equal((await L.call('/api/projects', null, 'wrong')).status, 403);
    assert.deepEqual((await L.call('/api/projects')).body.projects, []);

    const d = await L.call('/api/draft', { idea: 'a farming game' });
    assert.equal(d.body.ok, true); assert.match(d.body.brief, /^# Lantern Farm/);

    const folder = join(L.dir, 'farm');
    const c = await L.call('/api/create', { name: 'farm', folder, brief: d.body.brief, weekly: 0.9, workers: 2,
      references: [{ name: 'look.png', data: PNG, caption: 'the palette' }, { name: 'evil.sh', data: 'eA==' }] });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.ok(existsSync(join(folder, 'references', 'look.png')));
    assert.ok(!existsSync(join(folder, 'references', 'evil.sh')));
    const brief = readFileSync(join(folder, 'BRIEF.md'), 'utf8');
    assert.match(brief, /references\/look\.png`: the palette/);
    assert.equal(execFileSync('git', ['-C', folder, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
    for (let i = 0; i < 30 && !existsSync(join(L.dir, 'calls')); i++) await sleep(100);
    const calls = readFileSync(join(L.dir, 'calls'), 'utf8');
    assert.match(calls, /start --brief-file BRIEF\.md --references references\/look\.png --weekly 0\.9 --max-workers 2/);
    assert.ok(calls.startsWith(folder + '|'));

    const list = (await L.call('/api/projects')).body.projects;
    assert.equal(list.length, 1); assert.equal(list[0].path, folder); assert.equal(list[0].port, 3101);

    assert.equal((await L.call('/api/create', { folder: join(L.dir, 'x') })).status, 400);   // no brief
    await L.call('/api/remove', { path: folder });
    assert.equal((await L.call('/api/projects')).body.projects.length, 0);
    assert.ok(existsSync(folder), 'removing from the list keeps the folder');
  } finally { L.stop(); }
});

test('launcher: an existing project keeps its own BRIEF.md and history', async () => {
  const L = await launcher();
  try {
    const folder = join(L.dir, 'shop'); mkdirSync(folder);
    execFileSync('bash', ['-c', 'git init -q && echo "# old brief" > BRIEF.md && echo x > app.js && git add -A && git -c user.name=t -c user.email=t@e commit -qm first'], { cwd: folder });
    const c = await L.call('/api/create', { name: 'shop', folder, brief: 'finish the checkout flow and add tests' });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(readFileSync(join(folder, 'BRIEF.md'), 'utf8'), '# old brief\n');
    assert.match(readFileSync(join(folder, 'WAYPOINT-BRIEF.md'), 'utf8'), /checkout flow/);
    assert.equal(execFileSync('git', ['-C', folder, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim(), '2');
  } finally { L.stop(); }
});
