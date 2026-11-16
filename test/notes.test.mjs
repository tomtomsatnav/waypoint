import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { autopilot, addNote, readNotes, pendingNotes } from '../lib/autopilot.mjs';
import { makeRepo, sh, ROOT } from './helpers.mjs';

const FAKE = join(ROOT, 'test', 'fake-autopilot.mjs');
const plan = { title: 's', tasks: [
  { id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] },
  { id: 'm1-b', type: 'code-simple', after: ['m1-a'], goal: 'create b.txt', checks: [{ name: 'b', run: 'test -f b.txt' }] }] };
function setup() {
  const repo = makeRepo();
  sh(repo, 'git config user.email t@x && git config user.name t');
  const log = join(repo, '..', `${repo.split('/').pop()}-n.log`);
  Object.assign(process.env, { FAKE_AP_LOG: log, FAKE_AP_PLAN: JSON.stringify(plan) });
  return { repo, log };
}

test('notes: stored, listed as pending, and an empty one is refused', () => {
  const { repo } = setup();
  const n = addNote(repo, '  btw, make the dragon bigger  ');
  assert.equal(n.text, 'btw, make the dragon bigger');
  assert.equal(n.urgent, false);
  assert.deepEqual(pendingNotes(repo).map((x) => x.id), [n.id]);
  assert.throws(() => addNote(repo, '   '), /empty/);
});

test('notes: workers see a pending note in their task; the review folds it in and its reply is kept', async () => {
  const { repo, log } = setup();
  addNote(repo, 'btw, the dragon should have a tail swipe');
  const st = await autopilot({ repo, brief: 'b', deadlineHours: 1, research: false, claude: FAKE, log: () => {} });
  assert.equal(st.finished, 'shipped');
  const runs = join(repo, '.git', 'autopilot', 'runs');
  const q = JSON.parse(readFileSync(join(runs, readdirSync(runs).find((f) => f.startsWith('queue-m1-a'))), 'utf8'));
  assert.match(q.tasks[0].goal, /The owner sent these notes[\s\S]*tail swipe/);
  const review = readFileSync(log + '.review-prompts', 'utf8');
  assert.match(review, /NOTES FROM THE OWNER[\s\S]*tail swipe/);
  assert.match(review, /owner\/<note id>\//, 'the review is told how to show the owner mockups');
  const [n] = readNotes(repo);
  assert.equal(n.reviewed.milestone, 1);
  assert.equal(n.reply, `will do ${n.id}`);
  assert.equal(pendingNotes(repo).length, 0);
});

test('notes: an urgent note interrupts the milestone and gets a review before the remaining tasks', async () => {
  const { repo, log } = setup();
  addNote(repo, 'not happy with the UI, show me 10 mockups', { urgent: true });
  const said = [];
  const st = await autopilot({ repo, brief: 'b', deadlineHours: 1, research: false, claude: FAKE, log: (m) => said.push(m) });
  const roles = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).map((c) => c.role);
  assert.ok(!roles.includes('work'), 'no task ran before the review');
  assert.ok(said.some((m) => /urgent note from the owner: reviewing now/.test(m)));
  assert.match(readFileSync(log + '.review-prompts', 'utf8'), /interrupted by an urgent note before these tasks were done: m1-a/);
  assert.equal(st.milestones[0].status, 'interrupted-by-owner');
  assert.equal(readNotes(repo)[0].reviewed.milestone, 1);
});

test('a revised brief on resume replaces the old one and becomes an urgent note to re-plan', async () => {
  const { repo, log } = setup();
  const first = await autopilot({ repo, brief: 'old brief: ASCII', deadlineHours: 1, research: false, claude: FAKE, log: () => {} });
  assert.equal(first.finished, 'shipped');
  // A shipped run that is resumed with a new brief and new references takes them and re-plans.
  const { loadAp } = await import('../lib/autopilot.mjs');
  const st0 = loadAp(repo); st0.finished = null; st0.shipped = false;
  const { writeJsonAtomic } = await import('../lib/state.mjs');
  writeJsonAtomic(join(repo, '.git', 'autopilot', 'state.json'), st0);
  const said = [];
  const st = await autopilot({ repo, brief: 'new brief: pixel art', references: ['references/style-pond-01.jpg'], deadlineHours: 1, research: false, claude: FAKE, log: (m) => said.push(m) });
  assert.equal(st.brief, 'new brief: pixel art');
  assert.equal(st.briefChanges[0].previous, 'old brief: ASCII');
  assert.deepEqual(st.references, ['references/style-pond-01.jpg']);
  assert.ok(said.some((m) => /the brief changed/.test(m)));
  const note = readNotes(repo).find((n) => /revised the brief/.test(n.text));
  assert.equal(note.urgent, true);
  assert.equal(note.reviewed.milestone, 1, 'folded in by the next review');
  assert.match(readFileSync(log + '.review-prompts', 'utf8'), /new brief: pixel art[\s\S]*revised the brief/);
});

test('a resume asks the plan afresh instead of trusting a saved usage reading (limits can be reset early)', async () => {
  const { repo } = setup();
  await autopilot({ repo, brief: 'b', deadlineHours: 1, research: false, claude: FAKE, log: () => {} });
  const { loadAp } = await import('../lib/autopilot.mjs');
  const { writeJsonAtomic } = await import('../lib/state.mjs');
  const st0 = loadAp(repo); st0.finished = null; st0.shipped = false;
  st0.usage = { at: Date.now(), status: 'allowed', fiveHour: { util: 0.4, resetsAt: Date.now() + 3600000 }, sevenDay: { util: 0.99, resetsAt: Date.now() + 3 * 86400000 } };
  writeJsonAtomic(join(repo, '.git', 'autopilot', 'state.json'), st0);
  const said = [];
  const st = await autopilot({ repo, deadlineHours: 1, research: false, claude: FAKE, log: (m) => said.push(m) });
  assert.ok(!said.some((m) => /pausing until/.test(m)), `it did not pause on the stale 99%: ${said.join(' | ')}`);
  assert.ok(st.usage === null || st.usage.sevenDay.util < 0.5);
});

test('a project already under way is detected and the planner is told to survey it and continue', async () => {
  const { repo, log } = setup();
  for (const f of ['src/a.mjs', 'src/b.mjs', 'src/c.mjs', 'package.json']) { mkdirSync(join(repo, f, '..'), { recursive: true }); writeFileSync(join(repo, f), '// work\n'); }
  sh(repo, 'git add -A && git commit -qm "existing work"');
  const said = [];
  const st = await autopilot({ repo, brief: 'finish it', deadlineHours: 1, research: false, claude: FAKE, log: (m) => said.push(m) });
  assert.ok(st.existing && st.existing.files >= 4);
  assert.ok(said.some((m) => /picking up a project already under way/.test(m)));
  const planCall = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).find((c) => c.role === 'plan');
  assert.ok(planCall);
});

test('a new project is not mistaken for one under way', async () => {
  const { repo } = setup();
  const st = await autopilot({ repo, brief: 'b', deadlineHours: 1, research: false, claude: FAKE, log: () => {} });
  assert.equal(st.existing, null);
});
