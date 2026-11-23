// The benchmark waypoint improve measures itself on (bench/). One run builds one brief from scratch with a given copy of
// waypoint, then scores the result with that brief's hidden acceptance checks, which are kept outside the built repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, cpSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const WP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BENCH = join(WP_ROOT, 'bench');
export const RESULTS = join(BENCH, 'results'); // ignored by git
export const loadSuite = (bench = BENCH) => JSON.parse(readFileSync(join(bench, 'suite.json'), 'utf8'));
const tools = () => join(process.env.WAYPOINT_TOOLS || join(homedir(), '.waypoint', 'tools'), 'node_modules');

// --- metrics -----------------------------------------------------------------------------------------------------------

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const jsonl = (p) => { try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

// Tokens and turns from Claude Code stream-json logs: the "result" events carry usage and turn counts.
export function streamTotals(files) {
  const t = { tokens: 0, turns: 0, costUsd: 0 };
  for (const f of files) for (const e of jsonl(f)) if (e.type === 'result') {
    const u = e.usage || {};
    t.tokens += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    t.turns += e.num_turns || 0; t.costUsd += e.total_cost_usd || 0;
  }
  return t;
}

// Problems a tester reported: list items under a heading about what is broken or missing.
export function testerIssues(markdown) {
  let n = 0, inside = false;
  for (const line of String(markdown || '').split('\n')) {
    if (/^#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*:?\s*$/.test(line)) { inside = /broken|missing|bug|fail|problem|issue|annoy/i.test(line); continue; }
    if (inside && /^\s*([-*]|\d+\.)\s+\S/.test(line)) n++;
  }
  return n;
}

// What one run did, from the files waypoint leaves in the built repo's .git.
export function runMetrics(repo) {
  const git = join(repo, '.git');
  const m = { engine: null, costUsd: null, tokens: null, turns: null, sessions: null, tasks: null, firstTime: null, escalations: null, sentBack: null, testerIssues: null, end: null };
  const b = readJson(join(git, 'waypoint-build', 'state.json'));
  if (b) {
    const dir = join(git, 'waypoint-build');
    const s = streamTotals(readdirSync(dir).filter((f) => f.endsWith('.jsonl') && f !== 'ledger.jsonl').map((f) => join(dir, f)));
    Object.assign(m, { engine: 'build', costUsd: b.spentUsd ?? s.costUsd, tokens: s.tokens, turns: s.turns, sessions: b.sessions?.length ?? 0, end: b.end });
  }
  const a = readJson(join(git, 'autopilot', 'state.json'));
  if (a) {
    const tasks = (a.milestones || []).flatMap((x) => x.tasks || []).filter((t) => t.history?.length);
    const dir = join(git, 'autopilot');
    const reports = existsSync(dir) ? readdirSync(dir).filter((f) => /^tester-\d+\.md$/.test(f)) : [];
    Object.assign(m, { engine: 'autopilot', costUsd: a.spentUsd ?? null, end: a.finished || null, tasks: tasks.length,
      firstTime: tasks.filter((t) => t.history[0].outcome === 'done').length,
      escalations: tasks.reduce((n, t) => n + new Set(t.history.map((h) => h.model)).size - 1, 0),
      sentBack: tasks.filter((t) => t.status === 'stuck').length,
      testerIssues: reports.reduce((n, f) => n + testerIssues(readFileSync(join(dir, f), 'utf8')), 0) });
  }
  return m;
}

// The acceptance checks' JSON line (the last line that parses).
export function parseAccept(stdout) {
  for (const l of String(stdout || '').trim().split('\n').reverse()) {
    try { const j = JSON.parse(l); if (Array.isArray(j.checks)) return j; } catch { /* not it */ }
  }
  return null;
}

export function accept(id, repo, { bench = BENCH } = {}) {
  const env = { ...process.env, NODE_PATH: [tools(), process.env.NODE_PATH].filter(Boolean).join(delimiter) };
  const r = spawnSync(process.execPath, [join(bench, id, 'accept.mjs'), repo], { cwd: join(bench, id), env, encoding: 'utf8', timeout: 10 * 60e3 });
  const j = parseAccept(r.stdout);
  if (!j) return { passed: 0, total: 1, checks: [{ name: 'acceptance checks ran', ok: false, detail: (r.stderr || r.stdout || `exit ${r.status}`).slice(-300) }] };
  return { passed: j.checks.filter((c) => c.ok).length, total: j.checks.length, checks: j.checks };
}

// --- one run -----------------------------------------------------------------------------------------------------------

// A fresh repo holding the brief (and the seed, for briefs about an existing project).
export function prepareRepo(id, dir, { bench = BENCH } = {}) {
  mkdirSync(dir, { recursive: true });
  if (existsSync(join(bench, id, 'seed'))) cpSync(join(bench, id, 'seed'), dir, { recursive: true });
  copyFileSync(join(bench, id, 'BRIEF.md'), join(dir, 'BRIEF.md'));
  const g = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('add', '-A');
  g('-c', 'user.name=bench', '-c', 'user.email=bench@localhost', 'commit', '-q', '-m', 'Brief');
  return dir;
}

function runWaypoint(waypointDir, repo, { engine, budgetUsd, minutes, claude, logFile }) {
  const args = engine === 'autopilot'
    ? [join(waypointDir, 'bin', 'waypoint.mjs'), 'autopilot', 'start', '--brief-file', 'BRIEF.md', '--yes', '--hours', String(minutes / 60), '--budget-usd', String(budgetUsd)]
    : [join(waypointDir, 'bin', 'waypoint.mjs'), 'build', '--brief-file', 'BRIEF.md', '--yes', '--budget-usd', String(budgetUsd)];
  const env = { ...process.env, NODE_PATH: [tools(), process.env.NODE_PATH].filter(Boolean).join(delimiter), ...(claude ? { WAYPOINT_CLAUDE: claude } : {}) };
  for (const k of Object.keys(env)) if (/^CLAUDE/.test(k) && k !== 'CLAUDE_CONFIG_DIR') delete env[k];
  return new Promise((done) => {
    const out = [];
    const c = spawn(process.execPath, args, { cwd: repo, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    c.stdout.on('data', (d) => out.push(d)); c.stderr.on('data', (d) => out.push(d));
    // The wall clock: a run that is still going is stopped and scored as it stands. Usage-limit pauses do not count:
    // waypoint waits them out and the clock is extended while the log says it is pausing.
    let deadline = Date.now() + minutes * 60e3, timedOut = false;
    const timer = setInterval(() => {
      const text = Buffer.concat(out).toString();
      const pause = [...text.matchAll(/pausing until (\S+?Z)/g)].pop();
      if (pause && Date.parse(pause[1]) > Date.now()) deadline = Math.max(deadline, Date.parse(pause[1]) + 10 * 60e3);
      if (Date.now() > deadline) { timedOut = true; try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ } setTimeout(() => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } }, 10e3); }
    }, 5000);
    c.on('exit', (code) => { clearInterval(timer); const text = Buffer.concat(out).toString(); if (logFile) writeFileSync(logFile, text); done({ code, timedOut, log: text }); });
  });
}

// Build one brief with the given waypoint, score it, and describe the run.
export async function runOne({ id, waypointDir, outDir, rep = 1, engine = 'build', budgetUsd = 5, minutes = 25, claude, bench = BENCH, heldOut = false }) {
  const repo = prepareRepo(id, join(outDir, 'repos', `${id}-r${rep}`), { bench });
  const t0 = Date.now();
  const w = await runWaypoint(waypointDir, repo, { engine, budgetUsd, minutes, claude, logFile: join(outDir, 'repos', `${id}-r${rep}.log`) });
  const minutesTaken = (Date.now() - t0) / 60e3;
  const a = accept(id, repo, { bench });
  const result = { id, rep, heldOut, engine, score: a.total ? a.passed / a.total : 0, passed: a.passed, total: a.total,
    failures: a.checks.filter((c) => !c.ok).map((c) => ({ name: c.name, detail: c.detail || '' })),
    minutes: +minutesTaken.toFixed(1), timedOut: w.timedOut, exit: w.code, repo, ...runMetrics(repo) };
  writeFileSync(join(outDir, `${id}-r${rep}.json`), JSON.stringify(result, null, 2));
  return result;
}

// --- a suite -----------------------------------------------------------------------------------------------------------

// Every brief, `reps` times, one at a time (runs in parallel would compete for the same plan usage). `before` is called
// before each run (usage pacing, the budget) and may return false to stop. Returns [{ rep, results: [...] }].
export async function runSuite({ waypointDir, outDir, reps = 3, only = null, engine = 'build', claude, bench = BENCH, before = async () => true, after = () => {}, log = () => {} }) {
  const suite = loadSuite(bench);
  const briefs = suite.briefs.filter((b) => !only || only.includes(b.id));
  mkdirSync(outDir, { recursive: true });
  const runs = [];
  for (let rep = 1; rep <= reps; rep++) {
    const results = [];
    for (const b of briefs) {
      if (!(await before(b, rep))) return { runs, stopped: true };
      log(`${b.id} (run ${rep} of ${reps})`);
      const r = await runOne({ id: b.id, waypointDir, outDir, rep, engine, budgetUsd: suite.perBriefBudgetUsd ?? 5, minutes: suite.perBriefMinutes ?? 25, claude, bench, heldOut: !!b.heldOut });
      log(`${b.id}: ${r.passed}/${r.total} checks, $${(r.costUsd ?? 0).toFixed(2)}, ${r.minutes} min`);
      results.push(r); after(r);
    }
    runs.push({ rep, results });
  }
  return { runs, stopped: false };
}

// --- comparing ---------------------------------------------------------------------------------------------------------

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };

// One number per run of the suite (the mean acceptance score over its briefs), split into training and held-out briefs.
export function summarise(runs) {
  const per = runs.map((r) => {
    const train = r.results.filter((x) => !x.heldOut), held = r.results.filter((x) => x.heldOut);
    return { train: mean(train.map((x) => x.score)), held: held.length ? mean(held.map((x) => x.score)) : null,
      cost: r.results.reduce((a, x) => a + (x.costUsd || 0), 0), minutes: r.results.reduce((a, x) => a + (x.minutes || 0), 0) };
  });
  const ids = [...new Set(runs.flatMap((r) => r.results.map((x) => x.id)))];
  const byId = Object.fromEntries(ids.map((id) => {
    const rs = runs.flatMap((r) => r.results.filter((x) => x.id === id));
    return [id, { score: mean(rs.map((x) => x.score)), heldOut: !!rs[0]?.heldOut, cost: mean(rs.map((x) => x.costUsd || 0)), minutes: mean(rs.map((x) => x.minutes || 0)),
      firstTime: rs.some((x) => x.firstTime != null) ? mean(rs.map((x) => (x.tasks ? x.firstTime / x.tasks : 0))) : null,
      escalations: rs.some((x) => x.escalations != null) ? mean(rs.map((x) => x.escalations || 0)) : null,
      tokens: mean(rs.map((x) => x.tokens || 0)), failures: [...new Set(rs.flatMap((x) => x.failures.map((f) => f.name)))] }];
  }));
  const held = per.map((p) => p.held).filter((x) => x != null);
  return { runs: per.length, train: mean(per.map((p) => p.train)), trainSd: sd(per.map((p) => p.train)),
    held: held.length ? mean(held) : null, heldSd: sd(held), cost: mean(per.map((p) => p.cost)), minutes: mean(per.map((p) => p.minutes)), byId };
}

// Keep a change only if it is better beyond the noise (or as good and clearly cheaper), the held-out briefs did not get
// worse, and no single training brief fell sharply. base and cand are summarise() results.
export function gate(base, cand, { minGain = 0.03, noiseFloor = 0.02, heldSlack = 0.05, briefDrop = 0.25, cheaper = 0.15 } = {}) {
  const noise = Math.max(base.trainSd, cand.trainSd, noiseFloor);
  const gain = cand.train - base.train;
  const reasons = [];
  const heldOk = base.held == null || cand.held == null || cand.held >= base.held - Math.max(heldSlack, 2 * Math.max(base.heldSd, cand.heldSd));
  if (!heldOk) reasons.push(`held-out briefs got worse (${pct(base.held)} -> ${pct(cand.held)})`);
  const drops = Object.entries(cand.byId).filter(([id, c]) => !c.heldOut && base.byId[id] && base.byId[id].score - c.score > Math.max(briefDrop, 2 * noise));
  if (drops.length) reasons.push(`a brief fell sharply: ${drops.map(([id, c]) => `${id} ${pct(base.byId[id].score)} -> ${pct(c.score)}`).join(', ')}`);
  const better = gain > Math.max(minGain, 2 * noise);
  const cheaperSame = Math.abs(gain) <= noise && base.cost > 0 && cand.cost <= base.cost * (1 - cheaper);
  if (!better && !cheaperSame) reasons.push(gain > 0 ? `better by ${pct(gain)}, within the noise (needs more than ${pct(Math.max(minGain, 2 * noise))})` : `not better (${pct(base.train)} -> ${pct(cand.train)})`);
  const keep = !reasons.length;
  return { keep, gain, noise, reason: keep ? (better ? `better by ${pct(gain)} (noise ${pct(noise)})` : `as good and ${pct(1 - cand.cost / base.cost)} cheaper`) : reasons.join('; ') };
}
const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(1)}%`);

export function table(base, cand) {
  const rows = [['brief', 'before', 'after', 'cost before', 'cost after']];
  for (const id of Object.keys(base.byId)) {
    const b = base.byId[id], c = cand?.byId[id];
    rows.push([`${id}${b.heldOut ? ' (held out)' : ''}`, pct(b.score), c ? pct(c.score) : '-', `$${b.cost.toFixed(2)}`, c ? `$${c.cost.toFixed(2)}` : '-']);
  }
  rows.push(['**training mean**', `${pct(base.train)} ± ${pct(base.trainSd)}`, cand ? `${pct(cand.train)} ± ${pct(cand.trainSd)}` : '-', `$${base.cost.toFixed(2)}`, cand ? `$${cand.cost.toFixed(2)}` : '-']);
  if (base.held != null) rows.push(['**held-out mean**', pct(base.held), cand ? pct(cand.held) : '-', '', '']);
  return rows.map((r, i) => `| ${r.join(' | ')} |${i === 0 ? `\n|${r.map(() => '---').join('|')}|` : ''}`).join('\n');
}
