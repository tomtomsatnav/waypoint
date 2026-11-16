#!/usr/bin/env node
// A scripted stand-in for `claude -p` that plays every autopilot role, so the whole loop can be tested without API calls.
//   usage probe       answers and reports low plan usage (so the loop may run several workers)
//   researcher        writes EXPECTATIONS.md
//   planner           writes the milestone from FAKE_AP_PLAN (JSON) and a trivial ship.json
//   worker            a goal saying "create <file>" makes that file and commits it, through fake-claude.mjs so the Stop hook
//                     and the finish line run for real
//   reviewer/confirm  write a ship verdict
// FAKE_AP_LOG: one JSON line per call: { role, model, effort, cwd, start, end }.
import { appendFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const p = flag('-p') || '';
const start = Date.now();
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const usage = () => out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: {
  five_hour: { utilization: Number(process.env.FAKE_AP_UTIL ?? 0.1), resetsAt: Date.now() / 1000 + 4 * 3600, status: 'allowed' },
  seven_day: { utilization: 0.1, resetsAt: Date.now() / 1000 + 6 * 86400, status: 'allowed' } } } });
const done = (role) => {
  appendFileSync(process.env.FAKE_AP_LOG, JSON.stringify({ role, model: flag('--model'), effort: flag('--effort') ?? null, resume: flag('--resume') ?? null, capped: argv.includes('--max-budget-usd'), prompt: p.slice(0, 300), cwd: process.cwd(), start, end: Date.now() }) + '\n');
};
const result = () => out({ type: 'result', subtype: 'success', total_cost_usd: 0.05, num_turns: 1, result: 'ok' });
const m = (re) => (p.match(re) || [])[1];

if (/^Reply with the single word ok/.test(p)) { usage(); result(); process.exit(0); }
if (/^You are the researcher for a project/.test(p)) { writeFileSync('EXPECTATIONS.md', '- camera orbits. Check: drag\n'); done('research'); usage(); result(); process.exit(0); }
if (/^You are the technical researcher/.test(p)) { writeFileSync('APPROACH.md', '# Approach\n- Hard problems: rendering a dense character grid fast\n'); done('research-approach'); usage(); result(); process.exit(0); }
if (/^You are the researcher for an autonomous build/.test(p)) { writeFileSync(m(/notes to (\S+):/), 'notes\n'); done('research-stuck'); usage(); result(); process.exit(0); }
if (/^You are the planner/.test(p)) {
  if (process.env.FAKE_AP_PLAN_FAIL_ONCE && !existsSync(process.env.FAKE_AP_PLAN_FAIL_ONCE)) { writeFileSync(process.env.FAKE_AP_PLAN_FAIL_ONCE, '1'); writeFileSync('SPEC.md', '# spec (cut short)\n'); done('plan'); usage(); out({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 5, result: '' }); process.exit(1); }
  writeFileSync(m(/Write the milestone as JSON to (\S+):/), process.env.FAKE_AP_PLAN);
  writeFileSync(join(dirname(m(/Write the milestone as JSON to (\S+):/)), 'ship.json'), JSON.stringify({ checks: [{ name: 'ok', run: 'true' }] }));
  if (process.env.FAKE_AP_ACCEPT) { mkdirSync('tests', { recursive: true }); writeFileSync('tests/accept.test.mjs', '// acceptance\n'); }
  done('plan'); usage(); result(); process.exit(0);
}
if (/^You are the tester/.test(p)) { writeFileSync(m(/3\. Write (\S+) in Markdown/), '# Tester report\n- works: everything tried (shot: a.png)\n');
  const sd = m(/Save screenshots of what you see into (\S+) \(PNG/); if (sd) { mkdirSync(sd, { recursive: true }); writeFileSync(join(sd, '01-title.png'), Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')); } done('tester'); usage(); result(); process.exit(0); }
if (/reviewer/.test(p) && process.env.FAKE_AP_REVIEW_LIMIT_ONCE && !existsSync(process.env.FAKE_AP_REVIEW_LIMIT_ONCE)) {
  writeFileSync(process.env.FAKE_AP_REVIEW_LIMIT_ONCE, '1'); done('review-limited');
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', unifiedWindows: { five_hour: { utilization: 1, resetsAt: Date.now() / 1000 + 1, status: 'rejected' }, seven_day: { utilization: 0.3, resetsAt: Date.now() / 1000 + 86400, status: 'allowed' } } } });
  out({ type: 'result', subtype: 'success', is_error: true, total_cost_usd: 0, result: "You've hit your 5-hour limit" }); process.exit(1);
}
if (/reviewer/.test(p)) { if (process.env.FAKE_AP_LOG) appendFileSync(process.env.FAKE_AP_LOG + '.review-prompts', p + '\n----\n'); const rf = m(/Then write (\S+) as JSON/);
  const mode = process.env.FAKE_AP_REVIEW_MODE; const mark = process.env.FAKE_AP_LOG + '.review-once';
  if (mode === 'comments') writeFileSync(rf, '{\n  "verdict": "ship", // or continue\n  "assessment": "fine, see http://x//y",\n}\n');
  else if (mode === 'nomilestone-once' && !existsSync(mark)) { writeFileSync(mark, '1'); writeFileSync(rf, JSON.stringify({ verdict: 'continue', assessment: 'more to do' })); }
  else writeFileSync(rf, JSON.stringify({ verdict: 'ship', assessment: 'fine', replies: [...p.matchAll(/^- \[(n\d+-[a-z0-9]+)\]/gm)].map((x) => ({ note: x[1], text: `will do ${x[1]}` })) })); done(/final reviewer/.test(p) ? 'confirm' : 'review'); usage(); result(); process.exit(0); }

// FAKE_AP_LIMIT_ONCE=<marker file>: the first worker call ends as the CLI does when the 5-hour limit is hit.
if (process.env.FAKE_AP_LIMIT_ONCE && !existsSync(process.env.FAKE_AP_LIMIT_ONCE)) {
  writeFileSync(process.env.FAKE_AP_LIMIT_ONCE, '1'); usage(); done('work');
  out({ type: 'result', subtype: 'success', is_error: true, terminal_reason: 'api_error', total_cost_usd: 0.1, result: "You've hit your 5-hour limit" }); process.exit(1);
}
// A worker: hand over to fake-claude.mjs with a script that does the task, so hooks and the finish line are real.
const file = m(/create (\S+)/);
const dir = mkdtempSync(join(tmpdir(), 'fake-ap-'));
const script = join(dir, 'script.json');
writeFileSync(script, JSON.stringify({ steps: [{ sleep: process.env.FAKE_AP_HANG ? 60000 : 400 }, ...(file ? [{ shell: `echo ${file} > ${file} && git add -A && git commit -qm ${file}` }] : []), { stop: true }] }));
usage();
const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs'), ...argv], { encoding: 'utf8', env: { ...process.env, FAKE_CLAUDE_SCRIPT: script } });
process.stdout.write(r.stdout);
done('work');
process.exit(r.status ?? 0);
