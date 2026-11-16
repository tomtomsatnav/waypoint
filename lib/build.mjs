// waypoint build: the recipe that won E13c. A short research pass writes EXPECTATIONS.md (what users of this kind of product
// take for granted that the brief does not say, each with a check); then one plain Claude Code session builds the brief with
// that file as part of it, and runs until it stops by itself. Across E13, E13b and E13c this beat both a bare session and the
// full autopilot (owner's verdict; $6.95 and 80 minutes against $36 and 49 hours).
//
// Around the session, only what a person would otherwise do by hand: wait out plan usage limits and resume the same session
// after the reset, and carry on after a restart. State lives in <repo>/.git/waypoint-build/state.json.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { decide, parseUsage, probeUsage } from './usage.mjs';
import { researchPrompt } from './autopilot.mjs';

const RESEARCH_TOOLS = 'Read,Glob,Grep,Bash,Write,Edit,WebSearch,WebFetch';
const BUILD_TOOLS = 'Bash,Edit,Write,Read,Glob,Grep';

export const buildPrompt = (briefFile, expectations) => `Build what ${briefFile} describes, to completion: everything in it working as a user would use it. If the repository already holds work towards it, find out where it stands first (read it, run it) and continue from there rather than starting over. Commit your work with git as you go.${expectations ? ' EXPECTATIONS.md lists what users of this kind of product expect that the brief does not say; treat it as part of the brief.' : ''}`;
export const RESUME_PROMPT = 'You were interrupted (usage limit or restart). Carry on where you left off.';

const dirOf = (repo) => join(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repo, encoding: 'utf8' }).trim(), 'waypoint-build');

function cleanEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if ((/^CLAUDE/.test(k) && k !== 'CLAUDE_CONFIG_DIR') || k === 'WAYPOINT_DIR') delete e[k];
  return e;
}

function session({ claude, repo, prompt, model, budget, tools, resume, logPath }) {
  return new Promise((done) => {
    const sid = resume || randomUUID();
    const args = ['-p', prompt, '--model', model, '--max-budget-usd', String(+budget.toFixed(2)), '--strict-mcp-config',
      '--tools', tools, '--allowedTools', tools, '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose',
      ...(process.env.WAYPOINT_SETTING_SOURCES ? ['--setting-sources', process.env.WAYPOINT_SETTING_SOURCES] : []),
      ...(resume ? ['--resume', resume] : ['--session-id', sid])];
    const c = spawn(claude, args, { cwd: repo, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const log = createWriteStream(logPath, { flags: 'a' });
    let buf = '', result = null, rl = null;
    c.stdout.on('data', (d) => { log.write(d); buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const r = JSON.parse(l); if (r.type === 'result') result = r; if (r.type === 'rate_limit_event') rl = r.rate_limit_info; } catch { /* not JSON */ } } });
    c.on('exit', () => { log.end(); done({ sid, result, rl }); });
  });
}

// opts: { repo, briefFile, model ('sonnet'), researchModel ('sonnet'), budgetUsd (30), research (true), claude, log }
export async function build(opts) {
  const repo = opts.repo, claude = opts.claude || process.env.WAYPOINT_CLAUDE || 'claude';
  const say = opts.log || ((m) => process.stderr.write(`[build ${new Date().toISOString().slice(11, 19)}] ${m}\n`));
  const dir = dirOf(repo); mkdirSync(dir, { recursive: true });
  const statePath = join(dir, 'state.json');
  const st = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8'))
    : { briefFile: opts.briefFile, model: opts.model || 'sonnet', budgetUsd: opts.budgetUsd ?? 30, spentUsd: 0, sid: null, sessions: [], research: null, end: null };
  if (opts.budgetUsd && opts.budgetUsd !== st.budgetUsd) { st.budgetUsd = opts.budgetUsd; if (st.end === 'budget') st.end = null; }
  const save = () => writeFileSync(statePath, JSON.stringify(st, null, 2));
  const ledger = (e) => appendFileSync(join(dir, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n');
  if (st.end) { say(`already finished: ${st.end}`); return st; }
  if (!existsSync(join(repo, st.briefFile))) throw new Error(`no brief at ${st.briefFile}`);

  // 1. Research, once.
  if (opts.research !== false && !st.research) {
    say('researching what users of this kind of product expect');
    const r = await session({ claude, repo, prompt: researchPrompt({ brief: readFileSync(join(repo, st.briefFile), 'utf8') }), model: opts.researchModel || 'sonnet',
      budget: 2, tools: RESEARCH_TOOLS, logPath: join(dir, 'research.jsonl') });
    const cost = r.result?.total_cost_usd ?? 2; // killed before reporting: count the cap
    st.spentUsd = +(st.spentUsd + cost).toFixed(4);
    st.research = { costUsd: cost, wrote: existsSync(join(repo, 'EXPECTATIONS.md')) };
    if (st.research.wrote) {
      spawnSync('git', ['add', 'EXPECTATIONS.md'], { cwd: repo });
      spawnSync('git', ['-c', 'user.name=waypoint', '-c', 'user.email=waypoint@localhost', 'commit', '-q', '-m', 'Research: EXPECTATIONS.md'], { cwd: repo });
    }
    ledger({ kind: 'research', costUsd: cost, wrote: st.research.wrote }); save();
    say(`research: $${cost.toFixed(2)}, EXPECTATIONS.md ${st.research.wrote ? 'written' : 'not written'}`);
  }

  // 2. One plain session until it stops by itself; resumed only when a usage limit or a restart cut it off.
  let usage = null;
  for (;;) {
    const last = st.sessions.at(-1);
    const cutOff = last && (last.subtype == null || last.terminal === 'api_error' || /hit your .*limit/i.test(last.said || ''));
    const diedMid = st.inSession;
    if (last && !cutOff && !diedMid) { st.end = 'stopped by itself'; break; }
    if (st.spentUsd >= st.budgetUsd - 0.05) { st.end = 'budget'; break; }
    for (;;) { // wait out plan limits
      usage = usage || probeUsage({ claude });
      const d = decide(usage, { maxWorkers: 1 });
      if (d.action === 'run') break;
      say(`pausing until ${new Date(d.untilMs).toISOString()}: ${d.reason}`); ledger({ kind: 'pause', until: new Date(d.untilMs).toISOString(), reason: d.reason });
      while (Date.now() < d.untilMs) await new Promise((r) => setTimeout(r, Math.min(600000, d.untilMs - Date.now())));
      usage = null;
    }
    const first = !st.sessions.length && !diedMid;
    say(first ? `building with ${st.model}` : 'resuming the session after an interruption');
    st.inSession = true; save();
    const r = await session({ claude, repo, prompt: first ? buildPrompt(st.briefFile, st.research?.wrote) : RESUME_PROMPT, model: st.model,
      budget: st.budgetUsd - st.spentUsd, tools: BUILD_TOOLS, resume: st.sid, logPath: join(dir, `session-${st.sessions.length + 1}.jsonl`) });
    st.sid = r.sid; st.inSession = false;
    const cost = r.result?.total_cost_usd ?? 0;
    st.spentUsd = +(st.spentUsd + cost).toFixed(4);
    if (r.rl) usage = parseUsage(r.rl); else usage = null;
    st.sessions.push({ at: new Date().toISOString(), costUsd: cost, subtype: r.result?.subtype ?? null, terminal: r.result?.terminal_reason ?? null, said: String(r.result?.result || '').slice(0, 300) });
    ledger({ kind: 'session', costUsd: cost, subtype: r.result?.subtype ?? null }); save();
    say(`session ${st.sessions.length}: $${cost.toFixed(2)} (total $${st.spentUsd.toFixed(2)})`);
  }
  save(); say(`finished: ${st.end}; spent $${st.spentUsd.toFixed(2)}`);
  return st;
}
