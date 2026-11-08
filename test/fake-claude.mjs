#!/usr/bin/env node
// A scripted stand-in for `claude -p` so the runner and hooks can be tested without API calls.
// It honours the parts of the CLI waypoint relies on: --session-id/--resume, --settings hooks (SessionStart and Stop),
// stream-json output, CLAUDE_CODE_STOP_HOOK_BLOCK_CAP and a budget result.
//
// FAKE_CLAUDE_SCRIPT: JSON file { "steps": [...] }. Steps run in order; each is one of
//   { "shell": "<bash>" }          do some "work" in the repo
//   { "stop": true }               end the turn: run the Stop hook; blocked -> carry on, allowed -> exit
//   { "usage": <tokens> }          emit an assistant record with this context size
//   { "sleep": <ms> }
//   { "grandchild": "<pidfile>" }  start a long-lived child process and write its pid (tests process-group kill)
//   { "budget": true }             end as the CLI does when --max-budget-usd is reached
//   { "thrash": true }             end as the CLI does when autocompact thrashes (rapid_refill_breaker, no Stop hook)
// When the steps run out, the fake stops (running the Stop hook) and exits whatever it says.
// FAKE_CLAUDE_LOG: file to append one JSON line per event (argv, hook outputs) for assertions.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const logFile = process.env.FAKE_CLAUDE_LOG;
const log = (o) => { if (logFile) appendFileSync(logFile, JSON.stringify(o) + '\n'); };
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');

const resume = flag('--resume');
const sessionId = resume || flag('--session-id') || 'fake-session';
const prompt = flag('-p') || '';
const settings = flag('--settings') ? JSON.parse(readFileSync(flag('--settings'), 'utf8')) : {};
log({ event: 'start', argv, sessionId, env: {
  CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: process.env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? null,
  CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ?? null,
  WAYPOINT_DISABLE: process.env.WAYPOINT_DISABLE ?? null,
  WAYPOINT_DIR: process.env.WAYPOINT_DIR ?? null,
} });

function runHooks(event, payload) {
  const outs = [];
  for (const group of settings.hooks?.[event] || []) {
    for (const h of group.hooks || []) {
      const r = spawnSync('bash', ['-c', h.command], { input: JSON.stringify(payload), encoding: 'utf8', cwd: process.cwd(), env: process.env });
      outs.push({ exitCode: r.status, stdout: r.stdout, stderr: r.stderr });
    }
  }
  return outs;
}

const base = { session_id: sessionId, transcript_path: '/dev/null', cwd: process.cwd() };
emit({ type: 'system', subtype: 'init', session_id: sessionId, tools: (flag('--tools') || '').split(',') });
const ss = runHooks('SessionStart', { ...base, hook_event_name: 'SessionStart', source: resume ? 'resume' : 'startup' });
log({ event: 'SessionStart', outputs: ss });

// The handoff turn: --tools Write and a prompt naming the note path.
if (resume && flag('--tools') === 'Write') {
  const m = prompt.match(/handoff note to (\S+) for/);
  if (m) writeFileSync(m[1], `# Handoff\nFake note for ${sessionId}.\n`);
  emit({ type: 'result', subtype: 'success', session_id: sessionId, total_cost_usd: 0.001 });
  process.exit(0);
}

const script = process.env.FAKE_CLAUDE_SCRIPT ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE_SCRIPT, 'utf8')) : { steps: [] };
const cap = Number(process.env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP ?? 8);
let consecutiveBlocks = 0;
let lastMessage = 'Done.';

function tryStop() {
  const outs = runHooks('Stop', { ...base, hook_event_name: 'Stop', stop_hook_active: consecutiveBlocks > 0, last_assistant_message: lastMessage });
  log({ event: 'Stop', outputs: outs });
  for (const o of outs) {
    let d = null; try { d = JSON.parse(o.stdout); } catch { /* no decision */ }
    if (o.exitCode === 2 || d?.decision === 'block') {
      consecutiveBlocks++;
      if (cap > 0 && consecutiveBlocks > cap) { log({ event: 'block-cap-override', consecutiveBlocks }); return false; }
      lastMessage = `(read feedback: ${(d?.reason || o.stderr).slice(0, 40)})`;
      return true; // blocked: the turn continues
    }
  }
  return false;
}

function finish(subtype = 'success') {
  emit({ type: 'result', subtype, session_id: sessionId, total_cost_usd: 0.01, is_error: subtype !== 'success' });
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const step of script.steps) {
  if (step.shell) spawnSync('bash', ['-c', step.shell], { stdio: 'ignore', cwd: process.cwd() });
  else if (step.usage) emit({ type: 'assistant', session_id: sessionId, parent_tool_use_id: null, message: { usage: { input_tokens: step.usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  else if (step.sleep) await sleep(step.sleep);
  else if (step.grandchild) {
    const c = spawn('sleep', ['300'], { stdio: 'ignore' });
    writeFileSync(step.grandchild, String(c.pid));
  } else if (step.budget) finish('error_max_budget_usd');
  else if (step.thrash) {
    // As 2.1.319 ends a session whose autocompact thrashes: a success subtype, is_error, exit 1, no Stop hook.
    emit({ type: 'result', subtype: 'success', is_error: true, terminal_reason: 'rapid_refill_breaker', session_id: sessionId, total_cost_usd: 0.01, result: 'Autocompact is thrashing' });
    process.exit(1);
  }
  else if (step.stop) { if (!tryStop()) finish(); }
}
while (tryStop()) { /* out of script: keep "stopping" until allowed or capped */ }
finish();
