// The small runner: one headless session at a time, with hard limits outside the model.
// It starts the session with waypoint's hooks, enforces the wall clock and context cap by killing the process
// group, and on a cap takes the emergency exit (a handoff note, optionally one fresh session).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { head } from './git.mjs';
import { activeTask, initState, loadQueue, loadState, saveState, stateDir, writeJsonAtomic } from './state.mjs';
import { goalBlock } from './stop.mjs';
import { usageTokens } from './transcript.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'waypoint.mjs');
export const DEFAULT_TOOLS = 'Bash,Edit,Write,Read,Glob,Grep';

export function buildSettings(queue, { anchor = true } = {}) {
  const hook = (sub) => `${JSON.stringify(process.execPath)} ${JSON.stringify(BIN)} hook ${sub}`;
  const maxChecks = Math.max(...queue.tasks.map((_, i) => queue.tasks.slice(0, i + 1).reduce((a, t) => a + t.checks.length, 0)));
  // The Stop hook runs every check plus verify, so its timeout must cover them all.
  const stopTimeout = Math.min(3600, (maxChecks + 1) * queue.checkTimeoutSec + 30);
  return {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: hook('stop'), timeout: stopTimeout }] }],
      ...(anchor ? { SessionStart: [{ hooks: [{ type: 'command', command: hook('anchor'), timeout: 30 }] }] } : {}),
    },
  };
}

// Claude Code ends the turn anyway after 8 consecutive Stop blocks (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, read from the
// 2.1.319 binary). Handing over the next task is a block too, so a queue needs more than 8. Our own caps
// (maxBlocks per task, the stall rule) must bind first; this is set just above what they allow.
export function blockCapFor(queue) {
  return queue.tasks.length * (queue.maxBlocks + 1) + 2;
}

export function firstPrompt(queue) {
  return [
    'You are working through a queue of tasks in this repository, one at a time. Here is the first.',
    '',
    goalBlock(queue.tasks[0], 0, queue.tasks.length),
    '',
    'Commit your work with git as you go. When you believe the task is finished, stop: an external finish line',
    `checks it, and if it passes you will be given the next task.${queue.guardText === false ? '' : ' Do not edit tests or checks to make them pass.'}`,
  ].join('\n');
}

export function buildArgs({ prompt, model, budgetUsd, sessionId, settingsPath, tools = DEFAULT_TOOLS, autocompact, resume, maxTurns }) {
  if (!(budgetUsd > 0)) throw new Error('every run needs a positive --max-budget-usd');
  const a = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    '--model', model, '--max-budget-usd', String(budgetUsd),
    '--strict-mcp-config', '--tools', tools, '--allowedTools', tools, '--permission-mode', 'acceptEdits'];
  if (resume) a.push('--resume', resume); else a.push('--session-id', sessionId);
  if (settingsPath) a.push('--settings', settingsPath);
  if (autocompact) a.push('--autocompact', String(autocompact));
  if (maxTurns) a.push('--max-turns', String(maxTurns));
  return a;
}

export function buildEnv({ dir, blockCap, autocompactPct, configDir, extra = {} }) {
  const env = { ...process.env, WAYPOINT_DIR: dir, CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: String(blockCap), ...extra };
  // Cloud containers set this to 92 by default: set or unset it deliberately, never inherit it by accident.
  if (autocompactPct == null) delete env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  else env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = String(autocompactPct);
  if (configDir) env.CLAUDE_CONFIG_DIR = resolve(configDir);
  delete env.WAYPOINT_DISABLE;
  return env;
}

// Spawn one session in its own process group and watch it. Resolves only after the process has exited,
// so nothing else ever touches the session while it may still be writing.
export function runSession({ bin, args, env, cwd, logPath, wallClockSec, maxContextTokens }) {
  return new Promise((resolveP, rejectP) => {
    mkdirSync(dirname(logPath), { recursive: true });
    const log = createWriteStream(logPath);
    const child = spawn(bin, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = { exitCode: null, signal: null, killed: null, sessionId: null, result: null, maxContext: 0, costUsd: null, stderr: '' };
    let buf = '';
    let timer = null;

    const kill = (why) => {
      if (out.killed) return;
      out.killed = why;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    };

    child.on('error', (e) => { clearTimeout(timer); rejectP(e); });
    child.stdout.on('data', (d) => {
      log.write(d);
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let r; try { r = JSON.parse(line); } catch { continue; }
        if (r.session_id && !out.sessionId) out.sessionId = r.session_id;
        if (r.type === 'assistant' && !r.parent_tool_use_id && r.message?.usage) {
          out.maxContext = Math.max(out.maxContext, usageTokens(r.message.usage));
          if (maxContextTokens && out.maxContext >= maxContextTokens) kill('context');
        }
        if (r.type === 'result') { out.result = r; out.costUsd = r.total_cost_usd ?? null; }
      }
    });
    child.stderr.on('data', (d) => { out.stderr = (out.stderr + d).slice(-8000); });
    if (wallClockSec) timer = setTimeout(() => kill('wall-clock'), wallClockSec * 1000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      out.exitCode = code; out.signal = signal;
      log.end(() => resolveP(out));
    });
  });
}

function hitCap(s) {
  if (s.killed) return s.killed;
  if (s.result?.subtype === 'error_max_budget_usd') return 'budget';
  return null;
}

export function handoffInstruction(notePath) {
  return [
    'This session has reached a hard limit and is being stopped. Do not continue the task.',
    `Use the Write tool once to write a handoff note to ${notePath} for a fresh session that will continue from here.`,
    'Include: what is finished and committed, what is in progress, what you were about to do next, and anything that',
    'surprised you. Be factual and short. Then stop.',
  ].join(' ');
}

export function relayPrompt(spec, index, total, note) {
  return [
    'You are continuing a task that an earlier session could not finish within its limits.',
    '',
    goalBlock(spec, index, total),
    '',
    'The earlier session left the note below. It is that session\'s own account and may be wrong: check it against git.',
    '<handoff-note>',
    note.replaceAll('</handoff-note', '<\\/handoff-note'),
    '</handoff-note>',
    '',
    'When you believe the task is finished, stop: an external finish line checks it.',
  ].join('\n');
}

// opts: { cwd, queuePath, model, budgetUsd, wallClockSec, maxContextTokens, autocompact, autocompactPct, configDir,
//         claudeBin, relay, handoffBudgetUsd, fresh, anchor, log }
export async function run(opts) {
  const cwd = resolve(opts.cwd || process.cwd());
  const say = opts.log || (() => {});
  const queue = loadQueue(opts.queuePath);
  const dir = stateDir(cwd);
  const prev = loadState(dir);
  if (prev && !prev.finished && !opts.fresh) throw new Error(`a run is already in progress in ${dir} (pass --fresh to start over)`);
  const start = head(cwd);
  if (!start) throw new Error(`${cwd} is not a git repository with at least one commit`);

  const state = initState({ queue, queuePath: opts.queuePath, base: start, head: start });
  saveState(dir, state);
  const settingsPath = join(dir, 'settings.json');
  writeJsonAtomic(settingsPath, buildSettings(queue, { anchor: opts.anchor !== false }));

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(dir, 'runs', runId);
  const bin = opts.claudeBin || process.env.WAYPOINT_CLAUDE || 'claude';
  const env = buildEnv({ dir, blockCap: opts.blockCap ?? blockCapFor(queue), autocompactPct: opts.autocompactPct, configDir: opts.configDir });
  const started = Date.now();
  const sessions = [];

  const one = async (label, prompt) => {
    const sessionId = randomUUID();
    const args = buildArgs({ prompt, model: opts.model, budgetUsd: opts.budgetUsd, sessionId, settingsPath, autocompact: opts.autocompact });
    const remaining = opts.wallClockSec ? Math.max(1, opts.wallClockSec - (Date.now() - started) / 1000) : null;
    say(`[waypoint] ${label}: starting session ${sessionId}`);
    const s = await runSession({ bin, args, env, cwd, logPath: join(runDir, `${label}.jsonl`), wallClockSec: remaining, maxContextTokens: opts.maxContextTokens });
    s.sessionId ||= sessionId;
    s.label = label;
    s.cap = hitCap(s);
    sessions.push(s);
    say(`[waypoint] ${label}: exited (code ${s.exitCode}${s.signal ? `, ${s.signal}` : ''}${s.cap ? `, cap: ${s.cap}` : ''}${s.costUsd != null ? `, $${s.costUsd}` : ''})`);
    return s;
  };

  let s = await one('session-1', firstPrompt(queue));

  // Emergency exit: only when a cap ended the session with a task still open.
  let relays = 0;
  while (s.cap && activeTask(loadState(dir)) && (opts.handoff !== false)) {
    const act = activeTask(loadState(dir));
    const notePath = join(dir, `handoff-${act.spec.id}-${sessions.length}.md`);
    const hargs = buildArgs({ prompt: handoffInstruction(notePath), model: opts.model, budgetUsd: opts.handoffBudgetUsd ?? 0.05, resume: s.sessionId, tools: 'Write', maxTurns: 3 });
    const henv = { ...env, WAYPOINT_DISABLE: '1' }; // the note-writing turn must not run the finish line
    say(`[waypoint] writing handoff note for ${act.spec.id}`);
    const h = await runSession({ bin, args: hargs, env: henv, cwd, logPath: join(runDir, `handoff-${sessions.length}.jsonl`), wallClockSec: 180 });
    h.label = `handoff-${sessions.length}`;
    h.cap = hitCap(h);
    h.notePath = existsSync(notePath) ? notePath : null;
    sessions.push(h);
    if (!h.notePath || relays >= (opts.relay ?? 0)) break;
    relays++;
    const note = readFileSync(notePath, 'utf8');
    s = await one(`relay-${relays}`, relayPrompt(act.spec, act.index, queue.tasks.length, note));
  }

  const final = loadState(dir);
  const last = sessions.filter((x) => !x.label.startsWith('handoff')).at(-1);
  const outcome = final.finished || (last.cap ? `cap:${last.cap}` : 'stopped-early');
  if (!final.finished) {
    final.finished = outcome;
    final.events.push({ at: new Date().toISOString(), type: 'run-ended', outcome });
    saveState(dir, final);
  }
  const report = {
    runId, outcome,
    // Everything that varies between experiment arms, so a report describes itself.
    config: {
      model: opts.model, budgetUsd: opts.budgetUsd, wallClockSec: opts.wallClockSec ?? null, maxContextTokens: opts.maxContextTokens ?? null,
      anchor: opts.anchor !== false, autocompact: opts.autocompact ?? null, autocompactPct: opts.autocompactPct ?? null,
      blockCap: Number(env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP), relay: opts.relay ?? 0, verify: queue.verify, guardText: queue.guardText,
      maxBlocks: queue.maxBlocks, stallLimit: queue.stallLimit, cumulativeChecks: queue.cumulativeChecks, claudeBin: bin,
    },
    wallClockSec: Math.round((Date.now() - started) / 100) / 10,
    costUsd: sessions.reduce((a, x) => a + (x.costUsd || 0), 0),
    tasks: final.tasks.map((t) => ({ id: t.id, status: t.status, blocks: t.blocks, stalls: t.stalls, lastCheck: t.lastCheck })),
    sessions: sessions.map((x) => ({ label: x.label, sessionId: x.sessionId, exitCode: x.exitCode, signal: x.signal, cap: x.cap, costUsd: x.costUsd, maxContext: x.maxContext, resultSubtype: x.result?.subtype ?? null, notePath: x.notePath })),
    stopAttempts: final.events.filter((e) => e.type === 'stop-attempt').length,
    events: final.events,
  };
  writeJsonAtomic(join(runDir, 'report.json'), report);
  return report;
}

// What a run could cost at worst, from the caps alone (they are hard limits, so this is an upper bound).
export function worstCaseUsd({ budgetUsd, relay = 0, handoffBudgetUsd = 0.05 }) {
  return budgetUsd * (1 + relay) + handoffBudgetUsd * (1 + relay);
}
