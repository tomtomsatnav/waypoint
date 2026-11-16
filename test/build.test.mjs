import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { build, buildPrompt, RESUME_PROMPT } from '../lib/build.mjs';
import { makeRepo, sh, ROOT } from './helpers.mjs';

const FAKE = join(ROOT, 'test', 'fake-autopilot.mjs');
const calls = (log) => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);

function briefRepo() {
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  writeFileSync(join(repo, 'BRIEF.md'), '# A small game\nMake it.\n');
  sh(repo, 'git add -A && git commit -qm brief');
  return repo;
}

test('build: research writes EXPECTATIONS.md, then one plain session builds with it, and stops when the session stops', async () => {
  const repo = briefRepo();
  const log = join(repo, '..', `${repo.split('/').pop()}-b.log`);
  process.env.FAKE_AP_LOG = log;
  const st = await build({ repo, briefFile: 'BRIEF.md', claude: FAKE, log: () => {} });
  assert.equal(st.end, 'stopped by itself');
  assert.equal(st.sessions.length, 1);
  assert.equal(st.research.wrote, true);
  assert.match(sh(repo, 'git log --oneline -1'), /Research: EXPECTATIONS\.md/, 'the research is committed before the build');
  const c = calls(log);
  assert.deepEqual(c.map((x) => x.role), ['research', 'work']);
  assert.equal(c[1].prompt, buildPrompt('BRIEF.md', true));
  assert.match(c[1].prompt, /EXPECTATIONS\.md lists what users/);
  assert.equal(c[1].model, 'sonnet');
  const again = await build({ repo, briefFile: 'BRIEF.md', claude: FAKE, log: () => {} });
  assert.equal(again.sessions.length, 1, 'running it again after it finished does nothing');
});

test('build: a session cut off by a usage limit is resumed (same session), not counted as stopping', async () => {
  const repo = briefRepo();
  const log = join(repo, '..', `${repo.split('/').pop()}-b.log`);
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_LIMIT_ONCE: join(repo, '..', `${repo.split('/').pop()}-limit`) });
  try {
    const st = await build({ repo, briefFile: 'BRIEF.md', research: false, claude: FAKE, log: () => {} });
    assert.equal(st.end, 'stopped by itself');
    assert.equal(st.sessions.length, 2);
    const work = calls(log).filter((x) => x.role === 'work');
    assert.equal(work.length, 2);
    assert.equal(work[0].prompt, buildPrompt('BRIEF.md', false), 'without research the prompt does not mention EXPECTATIONS.md');
    assert.equal(work[1].prompt, RESUME_PROMPT);
    assert.equal(work[1].resume, st.sid, 'the same session is resumed');
  } finally { delete process.env.FAKE_AP_LIMIT_ONCE; }
});

test('build: the budget ends it', async () => {
  const repo = briefRepo();
  process.env.FAKE_AP_LOG = join(repo, '..', `${repo.split('/').pop()}-b.log`);
  process.env.FAKE_AP_LIMIT_ONCE = join(repo, '..', `${repo.split('/').pop()}-limit`);
  try {
    const st = await build({ repo, briefFile: 'BRIEF.md', research: false, budgetUsd: 0.12, claude: FAKE, log: () => {} });
    assert.equal(st.end, 'budget', 'the cut-off session spent $0.10 of $0.12; nothing left to resume with');
  } finally { delete process.env.FAKE_AP_LIMIT_ONCE; }
});
