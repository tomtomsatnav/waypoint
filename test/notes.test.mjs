import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
