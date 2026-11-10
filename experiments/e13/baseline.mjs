#!/usr/bin/env node
// E13 baselines: Claude Code "on its own" on the Emberfall brief.
//   mode single: one headless session with the brief; it runs until it stops by itself.
//   mode researched: first the autopilot's research step (Sonnet with web search writes EXPECTATIONS.md: what players of
//                the genre expect that the brief does not say, each with a check), then exactly the single arm, with one
//                sentence added to its prompt pointing at that file. Tests whether the research alone is the value.
//   mode loop:   the same, but whenever the session stops, resume it with "continue until everything in the brief works",
//                until the budget or the deadline.
// Both pause for plan usage limits exactly as the autopilot does, and both survive a restart: run it again with the same
// arguments and it carries on from <repo>/../<arm>.baseline.json. A session cut off by a usage limit or a restart is resumed
// with INTERRUPTED; that is not counted as stopping by itself.
// Usage: baseline.mjs <repo> <mode single|loop> <model> <budgetUsd> <deadline ISO>
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { decide, parseUsage, probeUsage } = await import(join(here, '..', '..', 'lib', 'usage.mjs'));
const { researchPrompt } = await import(join(here, '..', '..', 'lib', 'autopilot.mjs'));

const [repoArg, mode, model, budgetArg, deadlineArg] = process.argv.slice(2);
const repo = resolve(repoArg), arm = basename(repo), out = dirname(repo);
const budget = Number(budgetArg);
const log = (m) => appendFileSync(join(out, `${arm}.baseline.log`), `${new Date().toISOString()} ${m}\n`);
const statePath = join(out, `${arm}.baseline.json`);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8'))
  : { mode, model, startedAt: new Date().toISOString(), deadline: deadlineArg, spentUsd: 0, sessions: [], pauses: [], restarts: [] };
if (state.sessions.length || state.inSession) state.restarts.push(new Date().toISOString());
const diedMidSession = !!state.inSession; delete state.end; delete state.endedAt;
const deadline = Date.parse(state.deadline);
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const env = { ...process.env }; for (const k of Object.keys(env)) if (/^CLAUDE/.test(k) || k === 'WAYPOINT_DIR') delete env[k];
const sources = process.env.WAYPOINT_SETTING_SOURCES ? ['--setting-sources', process.env.WAYPOINT_SETTING_SOURCES] : [];

const FIRST = `Build the game described in BRIEF.md (the reference images it mentions are in references/). Build it to completion: everything in the brief working in the browser. Commit your work with git as you go.`
  + (mode === 'researched' ? ` EXPECTATIONS.md lists what players of this kind of game expect that the brief does not say; treat it as part of the brief.` : '');
const INTERRUPTED = `You were interrupted (usage limit or restart). Carry on where you left off.`;
const AGAIN = `Continue. The game is not finished until everything in BRIEF.md works in the browser. Check what is done (git log, the code, running it) and do the next most valuable thing. Commit as you go.`;

function session(prompt, resume, maxUsd, wallMs, tools = 'Bash,Edit,Write,Read,Glob,Grep') {
  return new Promise((done) => {
    const sid = resume || randomUUID();
    const args = ['-p', prompt, '--model', model, '--max-budget-usd', String(maxUsd.toFixed(2)), '--strict-mcp-config',
      '--tools', tools, '--allowedTools', tools, '--permission-mode', 'acceptEdits',
      '--output-format', 'stream-json', '--verbose', '--autocompact', '200000', ...sources, ...(resume ? ['--resume', resume] : ['--session-id', sid])];
    const c = spawn('claude', args, { cwd: repo, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const t1 = createWriteStream(join(out, `${arm}.${tools.includes('WebSearch') ? 'research' : `s${state.sessions.length + 1}`}.jsonl`), { flags: 'a' });
    let buf = '', result = null, rl = null;
    c.stdout.on('data', (d) => { t1.write(d); buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const r = JSON.parse(l); if (r.type === 'result') result = r; if (r.type === 'rate_limit_event') rl = r.rate_limit_info; } catch { /* not JSON */ } } });
    const t = setTimeout(() => { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } }, wallMs);
    c.on('exit', () => { clearTimeout(t); t1.end(); done({ sid, result, rl }); });
  });
}

let sid = state.sid || null, paceFrom = null, usage = null;
if (mode === 'researched' && !state.researched) { // the research step, once, before the first session
  const r = await session(researchPrompt({ brief: readFileSync(join(repo, 'BRIEF.md'), 'utf8') }), null, 2, 1800000,
    'Read,Glob,Grep,Bash,Write,Edit,WebSearch,WebFetch');
  const cost = r.result?.total_cost_usd ?? 2; // killed before reporting: count the cap
  state.spentUsd = +(state.spentUsd + cost).toFixed(4);
  state.researched = { at: new Date().toISOString(), costUsd: cost, wrote: existsSync(join(repo, 'EXPECTATIONS.md')) };
  if (state.researched.wrote) spawnSync('bash', ['-c', 'git add EXPECTATIONS.md && git commit -qm "Research: EXPECTATIONS.md"'], { cwd: repo });
  save(); log(`research: $${cost.toFixed(2)}, EXPECTATIONS.md ${state.researched.wrote ? 'written' : 'missing'}`);
}
const cutOff = (x) => !x || x.terminal === 'api_error' || /hit your .*limit/i.test(x.said || '') || x.subtype == null;
for (let n = state.sessions.length; ; n++) {
  const interrupted = n > 0 && (cutOff(state.sessions[n - 1]) || (n === state.sessions.length && diedMidSession));
  if (Date.now() >= deadline) { state.end = 'deadline'; break; }
  if (state.spentUsd >= budget - 0.05) { state.end = 'budget'; break; }
  if ((mode === 'single' || mode === 'researched') && n > 0 && !interrupted) { state.end = 'stopped by itself'; break; }
  for (;;) { // the same usage gate the autopilot uses
    if (!usage || interrupted) usage = probeUsage({});
    if (usage && !paceFrom) paceFrom = { at: Date.now(), util: usage.sevenDay?.util ?? 0 };
    const d = decide(usage, { weeklyCeiling: 0.85, fiveHourCeiling: 0.9, maxWorkers: 1, paceFrom });
    if (d.action === 'run') break;
    const until = Math.min(d.untilMs, deadline); state.pauses.push({ at: new Date().toISOString(), until: new Date(until).toISOString(), reason: d.reason }); save(); log(`pause: ${d.reason}`);
    while (Date.now() < until) await new Promise((r) => setTimeout(r, Math.min(600000, until - Date.now())));
    usage = null; if (Date.now() >= deadline) break;
  }
  if (Date.now() >= deadline) { state.end = 'deadline'; break; }
  state.inSession = true; save();
  const t0 = Date.now();
  const r = await session(n === 0 ? FIRST : interrupted ? INTERRUPTED : AGAIN, sid, budget - state.spentUsd, deadline - Date.now());
  sid = r.sid; state.sid = sid; state.inSession = false;
  const cost = r.result?.total_cost_usd || 0; state.spentUsd = +(state.spentUsd + cost).toFixed(4);
  if (r.rl) usage = parseUsage(r.rl);
  state.sessions.push({ n: n + 1, at: new Date().toISOString(), prompt: n === 0 ? 'first' : interrupted ? 'interrupted' : 'again', costUsd: cost,
    subtype: r.result?.subtype ?? null, terminal: r.result?.terminal_reason ?? null, turns: r.result?.num_turns ?? null, said: String(r.result?.result || '').slice(0, 400) });
  if (Date.now() - t0 < 30000) await new Promise((w) => setTimeout(w, 60000)); // a session that ends at once (an outage): do not spin
  save(); log(`session ${n + 1}: $${cost.toFixed(2)} (total $${state.spentUsd.toFixed(2)}) ${r.result?.subtype ?? 'no result'}`);
}
state.endedAt = new Date().toISOString(); save(); log(`ended: ${state.end}`);
