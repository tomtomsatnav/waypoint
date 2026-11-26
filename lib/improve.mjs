// waypoint improve: waypoint learns from its own runs. Each round, a strong model proposes one focused change to waypoint's
// instructions (prompts/, config/routing.json, skills/), the benchmark (bench/) is run with and without it, and a change
// that is better beyond the noise, without the held-out briefs getting worse, is opened as a pull request for the owner.
// Nothing is merged automatically, and a round that touches anything else is thrown away.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { WP_ROOT, BENCH, RESULTS, loadSuite, runSuite, summarise, gate, table } from './bench.mjs';
import { collect, feedbackText } from './feedback.mjs';
import { fill } from './prompts.mjs';
import { decide, probeUsage } from './usage.mjs';

// What a proposal may change. Everything else (the benchmark, its checks, the metrics, this loop) is protected.
export const EDITABLE = [/^prompts\/[^/]+\.md$/, /^config\/routing\.json$/, /^skills\/[^/]+\/SKILL\.md$/];
export const isEditable = (path) => EDITABLE.some((re) => re.test(path));

const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${(r.stderr || '').trim()}`); return r.stdout.trim(); };
const gitTry = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// Every path that differs from base in the working tree, committed or not, including new files.
export function changedPaths(dir, base) {
  gitTry(dir, 'add', '-A');
  return git(dir, 'diff', '--cached', '--name-only', base).split('\n').filter(Boolean);
}
export function protectedChanges(dir, base) { return changedPaths(dir, base).filter((p) => !isEditable(p)); }

function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }

// A summary of the training briefs' results for the proposer (held-out briefs are left out on purpose).
export function resultsText(s) {
  const lines = [`Mean acceptance over training briefs: ${(s.train * 100).toFixed(1)}% (spread ${(s.trainSd * 100).toFixed(1)}% over ${s.runs} runs), mean cost $${s.cost.toFixed(2)} per run of the suite.`];
  for (const [id, b] of Object.entries(s.byId)) if (!b.heldOut)
    lines.push(`- brief ${Object.keys(s.byId).filter((k) => !s.byId[k].heldOut).indexOf(id) + 1}: ${(b.score * 100).toFixed(0)}% of checks, $${b.cost.toFixed(2)}, ${b.minutes.toFixed(0)} min; failing checks: ${b.failures.join('; ') || 'none'}`);
  return lines.join('\n');
}

export function history(results = RESULTS) {
  if (!existsSync(results)) return [];
  return readdirSync(results).filter((d) => existsSync(join(results, d, 'round.json'))).sort()
    .map((d) => JSON.parse(readFileSync(join(results, d, 'round.json'), 'utf8')));
}

// The proposer: a strong model with file tools only, in a copy of waypoint on its own branch.
function propose(dir, prompt, { model = 'claude-fable-5-1', claude = process.env.WAYPOINT_CLAUDE || 'claude', minutes = 30, logFile } = {}) {
  const tools = 'Read,Glob,Grep,Edit,Write';
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/^CLAUDE/.test(k) && k !== 'CLAUDE_CONFIG_DIR') delete env[k];
  return new Promise((done) => {
    const c = spawn(claude, ['-p', prompt, '--model', model, '--tools', tools, '--allowedTools', tools, '--permission-mode', 'acceptEdits',
      '--strict-mcp-config', '--output-format', 'stream-json', '--verbose'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', result = null;
    const t = setTimeout(() => c.kill('SIGKILL'), minutes * 60e3);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
    c.on('error', (e) => { clearTimeout(t); done({ text: '', error: String(e.message || e) }); });
    c.on('close', () => { clearTimeout(t); if (logFile) writeFileSync(logFile, out);
      for (const l of out.split('\n')) { try { const e = JSON.parse(l); if (e.type === 'result') result = e; } catch { /* not JSON */ } }
      done({ text: String(result?.result || '').trim(), costUsd: result?.total_cost_usd || 0, error: result ? null : 'the proposer gave no result' }); });
  });
}

// Push the branch and open a draft pull request (GitHub CLI); otherwise say how.
function publish(dir, branch, { title, body, base }) {
  const push = gitTry(dir, 'push', '-u', 'origin', branch);
  if (push.status !== 0) return { pushed: false, note: `not pushed: ${(push.stderr || '').trim().slice(0, 200)}; the branch ${branch} is in your waypoint repository` };
  const pr = spawnSync('gh', ['pr', 'create', '--draft', '--base', base, '--head', branch, '--title', title, '--body', body], { cwd: dir, encoding: 'utf8' });
  if (pr.status !== 0) return { pushed: true, note: `pushed ${branch}; open a pull request for it on GitHub (gh: ${(pr.stderr || pr.error?.message || '').trim().slice(0, 200)})` };
  return { pushed: true, url: pr.stdout.trim() };
}

// opts: { rounds, budgetUsd, reps, engine, only, model, weeklyCeiling, log, wp, results, and for tests: runSuiteFn, proposeFn,
// usageFn, publishFn, testsFn, feedback }
export async function improve(opts = {}) {
  const wp = opts.wp || WP_ROOT, results = opts.results || RESULTS, bench = opts.bench || BENCH;
  const log = opts.log || ((m) => process.stderr.write(`[improve ${new Date().toISOString().slice(11, 19)}] ${m}\n`));
  const reps = opts.reps ?? 3, engine = opts.engine || 'build', rounds = opts.rounds ?? 1;
  const runSuiteFn = opts.runSuiteFn || runSuite, proposeFn = opts.proposeFn || propose, publishFn = opts.publishFn || publish;
  const usageFn = opts.usageFn || (() => probeUsage({}));
  const testsFn = opts.testsFn || ((dir) => spawnSync(process.execPath, ['--test', '--test-timeout=300000', ...readdirSync(join(dir, 'test')).filter((f) => f.endsWith('.test.mjs')).map((f) => join('test', f))], { cwd: dir, encoding: 'utf8', timeout: 20 * 60e3 }));
  const base = git(wp, 'rev-parse', 'HEAD');
  const baseBranch = gitTry(wp, 'symbolic-ref', '--short', 'HEAD').stdout.trim() || 'main';
  const work = opts.workDir || join(process.env.WAYPOINT_HOME || join(homedir(), '.waypoint'), 'improve');
  mkdirSync(work, { recursive: true }); mkdirSync(results, { recursive: true });
  let spent = 0;
  const budget = opts.budgetUsd ?? Infinity;
  // Before each benchmark run: stay inside the budget and the plan's limits (wait for a reset rather than run into it).
  const before = async () => {
    if (spent >= budget) { log(`budget reached ($${spent.toFixed(2)} of $${budget})`); return false; }
    for (;;) {
      const u = await usageFn(); if (!u) return true;
      const d = decide(u, { weeklyCeiling: opts.weeklyCeiling ?? 0.85, fiveHourCeiling: 0.9, maxWorkers: 1 });
      if (d.action === 'run') return true;
      log(`pausing until ${new Date(d.untilMs).toISOString()}: ${d.reason}`);
      await new Promise((r) => setTimeout(r, Math.max(1000, Math.min(30 * 60e3, d.untilMs - Date.now()))));
    }
  };
  const after = (r) => { spent += r.costUsd || 0; };
  const suiteOpts = { reps, engine, only: opts.only || null, claude: opts.claude, bench, before, after, log };

  // A copy of waypoint at a commit, outside the repository, for building the benchmark with.
  const worktree = (name, commit, branch) => {
    const dir = join(work, name);
    if (existsSync(dir)) { gitTry(wp, 'worktree', 'remove', '--force', dir); rmSync(dir, { recursive: true, force: true }); }
    gitTry(wp, 'worktree', 'prune');
    if (branch) git(wp, 'worktree', 'add', '-q', '-b', branch, dir, commit); else git(wp, 'worktree', 'add', '-q', '--detach', dir, commit);
    return dir;
  };

  // 1. The baseline, measured once per commit (and settings) and kept.
  const key = `baseline-${base.slice(0, 12)}-${engine}-${reps}${opts.only ? `-${opts.only.join('+')}` : ''}.json`;
  let baseRuns = existsSync(join(results, key)) ? JSON.parse(readFileSync(join(results, key), 'utf8')).runs : null;
  if (baseRuns) log(`baseline for ${base.slice(0, 7)} already measured`);
  else {
    log(`measuring the baseline (${base.slice(0, 7)}): ${reps} runs of the suite`);
    const dir = worktree('base', base);
    const out = await runSuiteFn({ ...suiteOpts, waypointDir: dir, outDir: join(results, `base-${base.slice(0, 12)}`) });
    if (out.stopped) { log('stopped before the baseline was complete'); return { stopped: true, spent }; }
    baseRuns = out.runs; writeFileSync(join(results, key), JSON.stringify({ commit: base, engine, reps, at: new Date().toISOString(), runs: baseRuns }, null, 2));
  }
  const baseSum = summarise(baseRuns);
  log(`baseline: training ${(baseSum.train * 100).toFixed(1)}% ± ${(baseSum.trainSd * 100).toFixed(1)}%, held out ${baseSum.held == null ? '-' : (baseSum.held * 100).toFixed(1) + '%'}`);

  const feedback = opts.feedback ?? feedbackText(collect({}));
  const done = [];
  for (let round = 1; round <= rounds; round++) {
    if (spent >= budget) { log('budget reached; no more rounds'); break; }
    const id = stamp(), branch = `improve/${id}`, outDir = join(results, id);
    mkdirSync(outDir, { recursive: true });
    const record = { id, at: new Date().toISOString(), base, engine, reps, branch, baseline: baseSum };
    const save = () => writeFileSync(join(outDir, 'round.json'), JSON.stringify(record, null, 2));
    log(`round ${round}: asking for a proposal`);
    const dir = worktree('candidate', base, branch);
    const past = history(results).filter((h) => h.id !== id).slice(-10).map((h) => `- ${h.title || '(no title)'}: ${h.verdict}${h.reason ? ` (${h.reason})` : ''}`).join('\n') || '(none yet)';
    const prompt = fill(readFileSync(join(bench, 'proposer.md'), 'utf8'), { results: resultsText(baseSum), feedback: feedback || '(no projects yet)', history: past });
    const p = await proposeFn(dir, prompt, { model: opts.model, claude: opts.claude, logFile: join(outDir, 'proposer.log') });
    spent += p.costUsd || 0;
    record.title = (p.text.split('\n')[0] || '').replace(/^#+\s*/, '').slice(0, 90) || 'untitled proposal';
    record.rationale = p.text.split('\n').slice(1).join('\n').trim();
    const changed = changedPaths(dir, base);
    const bad = changed.filter((f) => !isEditable(f));
    const finish = (verdict, reason) => { record.verdict = verdict; record.reason = reason; save(); done.push(record); log(`round ${round}: ${verdict}${reason ? `: ${reason}` : ''}`);
      gitTry(wp, 'worktree', 'remove', '--force', dir); if (verdict !== 'kept') gitTry(wp, 'branch', '-D', branch); };
    if (p.error && !changed.length) { finish('no proposal', p.error); continue; }
    if (!changed.length) { finish('no proposal', 'the proposer changed nothing'); continue; }
    writeFileSync(join(outDir, 'proposal.diff'), git(dir, 'diff', '--cached', base));
    if (bad.length) { finish('rejected', `it changed protected files: ${bad.join(', ')}`); continue; }
    record.files = changed;
    git(dir, '-c', 'user.name=waypoint improve', '-c', 'user.email=waypoint@localhost', 'commit', '-q', '-m', `improve: ${record.title}\n\n${record.rationale}`);
    // The prompts changed on purpose: refresh the snapshot that guards against accidental changes, then run the tests.
    const snap = spawnSync(process.execPath, ['-e', "import('./test/prompt-cases.mjs').then((m) => require('fs').writeFileSync('test/fixtures/prompt-snapshot.json', JSON.stringify(m.promptCases(), null, 1)))"], { cwd: dir, encoding: 'utf8' });
    if (snap.status !== 0) { finish('rejected', `the changed prompts do not load: ${(snap.stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 300)}`); continue; }
    gitTry(dir, 'add', 'test/fixtures/prompt-snapshot.json');
    gitTry(dir, '-c', 'user.name=waypoint improve', '-c', 'user.email=waypoint@localhost', 'commit', '-q', '-m', 'improve: refresh the prompt snapshot');
    const tests = testsFn(dir);
    if (tests.status !== 0) { finish('rejected', `waypoint's own tests fail with it: ${((tests.stdout || '') + (tests.stderr || '')).split('\n').filter((l) => /^not ok/.test(l)).slice(0, 3).join('; ').slice(0, 300)}`); continue; }
    log(`round ${round}: "${record.title}"; running the suite with it`);
    const out = await runSuiteFn({ ...suiteOpts, waypointDir: dir, outDir });
    if (out.stopped || !out.runs.length) { finish('unfinished', 'stopped (budget or usage) before the suite finished'); continue; }
    const candSum = summarise(out.runs);
    const g = gate(baseSum, candSum);
    record.candidate = candSum; record.gate = g; record.table = table(baseSum, candSum);
    writeFileSync(join(outDir, 'report.md'), `# ${record.title}\n\n${record.rationale}\n\n${record.table}\n\nVerdict: ${g.keep ? 'kept' : 'not kept'}, ${g.reason}.\n`);
    if (!g.keep) { finish('not kept', g.reason); continue; }
    const body = `${record.rationale}\n\n## Benchmark (${reps} runs each, ${engine})\n\n${record.table}\n\n${g.reason}. Changed: ${changed.join(', ')}.\n\nMade by \`waypoint improve\`: review before merging; nothing merges automatically.`;
    record.published = opts.pr === false ? { pushed: false, note: `branch ${branch} kept locally` } : publishFn(wp, branch, { title: `improve: ${record.title}`, body, base: baseBranch });
    finish('kept', g.reason);
  }
  return { rounds: done, spent, baseline: baseSum };
}
