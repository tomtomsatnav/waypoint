// Every prompt waypoint sends, over a range of states: test/prompts.test.mjs compares them with a snapshot taken before the
// prompts moved into prompts/*.md, so moving them (or the template loader) cannot change a word by accident.
import * as ap from '../lib/autopilot.mjs';
import { buildPrompt, RESUME_PROMPT } from '../lib/build.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function promptCases() {
  const out = {};
  const file = '/r/.git/autopilot/milestone-1.json';
  const states = [];
  for (const refs of [[], ['references/a.png', 'references/b.jpg']])
    for (const approach of [false, true]) for (const expectations of [false, true])
      for (const existing of [null, { files: 12, commits: 7 }])
        states.push({ brief: '# Lanterns\n\nA game about ${money} and `ticks`.\n', references: refs, approach, expectations, existing });
  const ms = { n: 2, title: 'Combat', tasks: [{ id: 'm2-a', status: 'done', goal: 'x' }, { id: 'm2-b', status: 'stuck', goal: 'y' }] };
  states.forEach((st, i) => {
    const k = `s${i}`;
    out[`plan.${k}`] = ap.planPrompt(st, file);
    out[`planContinue.${k}`] = ap.planContinuePrompt(st, file, 'budget');
    out[`tester.${k}`] = ap.testerPrompt(st, ms, '/r/t.md', '/r/shots');
    out[`research.${k}`] = ap.researchPrompt(st);
    out[`approach.${k}`] = ap.approachPrompt(st);
    for (const [o, opts] of Object.entries({ plain: {}, light: { light: true }, confirm: { confirm: true }, report: { report: 'R'.repeat(13000) }, lightConfirm: { light: true, confirm: true } }))
      out[`review.${o}.${k}`] = ap.reviewPrompt(st, 3, file, 'EVIDENCE', opts);
  });
  out.stuck = ap.stuckResearchPrompt({ id: 'm1-x', goal: 'do it' }, 'FAIL a', '/r/n.md');
  out.stuckNone = ap.stuckResearchPrompt({ id: 'm1-x', goal: 'do it' }, '', '/r/n.md');
  for (const parallel of [false, true]) for (const ownerNotes of ['', 'NOTE 1']) for (const failNotes of ['', 'WHY'])
    out[`worker.${parallel}.${!!ownerNotes}.${!!failNotes}`] = ap.workerGoal({ goal: 'Make it', parallel, port: 3210, ownerNotes, failNotes });
  out.ownerNotes = ap.ownerNotesForReview('- n1: darker');
  out.interrupted = ap.interruptedNote('m1-a (x)');
  out.reviewFix = ap.reviewRetryFix('/r/review-2.json', 'the file was not written');
  out['build.true'] = buildPrompt('BRIEF.md', true); out['build.false'] = buildPrompt('BRIEF.md', false); out.resume = RESUME_PROMPT;
  out.ladders = JSON.stringify(ap.CHEAP_LADDERS);
  for (const k of Object.keys(out)) out[k] = out[k].split(ROOT).join('<ROOT>');
  return out;
}
