import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { run, buildArgs, buildEnv } from '../lib/runner.mjs';
import { makeRepo, writeQueue, writeScript, addFn, sh, FAKE, BIN, TASKS } from './helpers.mjs';

// Dead means no such process, or a zombie waiting for a reaper that this container may not have.
function isGone(pid) {
  try { process.kill(pid, 0); } catch { return true; }
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] === 'Z'; } catch { return true; }
}

function readLog(p) { return readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); }

async function runFake(dir, steps, opts = {}) {
  const logPath = join(dir, '..', `${dir.split('/').pop()}-fake.log`); // outside the repo, so commits never pick it up
  process.env.FAKE_CLAUDE_SCRIPT = writeScript(join(dir, '..', `${dir.split('/').pop()}-scripts`), steps);
  process.env.FAKE_CLAUDE_LOG = logPath;
  try {
    const report = await run({ cwd: dir, queuePath: join(dir, 'queue.json'), model: 'haiku', budgetUsd: 0.1, claudeBin: FAKE, wallClockSec: 30, ...opts });
    return { report, log: existsSync(logPath) ? readLog(logPath) : [] };
  } finally {
    delete process.env.FAKE_CLAUDE_SCRIPT; delete process.env.FAKE_CLAUDE_LOG;
  }
}

test('E1 shape: a queue of three tasks finishes in one session with no human prompt', async () => {
  const dir = makeRepo();
  writeQueue(dir, TASKS);
  process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '92'; // as cloud containers set it
  const { report, log } = await runFake(dir, [
    { shell: addFn('add', 'return a + b;') }, { stop: true },
    { shell: addFn('sub', 'return a - b;') }, { stop: true },
    { shell: addFn('mul', 'return a * b;') }, { stop: true },
  ]);
  delete process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  assert.equal(report.outcome, 'done');
  assert.deepEqual(report.tasks.map((t) => t.status), ['done', 'done', 'done']);
  assert.equal(report.sessions.length, 1);
  assert.equal(report.stopAttempts, 3);
  assert.equal(report.config.anchor, true);
  assert.equal(report.config.blockCap, 23);
  assert.equal(report.config.guardText, true);

  const start = log.find((e) => e.event === 'start');
  assert.match(start.argv[1], /Do not edit tests/);
  assert.equal(start.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, null, 'inherited autocompact override must be unset');
  assert.equal(start.env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, String(3 * 7 + 2));
  for (const f of ['--max-budget-usd', '--strict-mcp-config', '--tools', '--settings', '--session-id']) assert.ok(start.argv.includes(f), f);

  const ss = log.find((e) => e.event === 'SessionStart').outputs[0];
  const ctx = JSON.parse(ss.stdout).hookSpecificOutput;
  assert.equal(ctx.hookEventName, 'SessionStart');
  assert.match(ctx.additionalContext, /Add an exported function add/);

  const stops = log.filter((e) => e.event === 'Stop').map((e) => e.outputs[0].stdout);
  assert.match(JSON.parse(stops[0]).reason, /<goal task="sub"/);
  assert.equal(stops[2], '', 'the last stop is allowed with no output');
  assert.equal(sh(dir, 'git status --short'), '', 'state dir must not show up in git status');
});

test('E2 shape: an impossible task ends through the stall rule, not by looping', async () => {
  const dir = makeRepo();
  writeQueue(dir, [{ id: 'impossible', goal: 'Make add(2, 3) return 6.', checks: ['node check.mjs add 2 3 6'] }]);
  const { report, log } = await runFake(dir, [{ shell: addFn('add', 'return a + b;') }]); // then keeps trying to stop
  assert.equal(report.outcome, 'blocked');
  assert.equal(report.tasks[0].status, 'blocked');
  assert.ok(report.stopAttempts <= 3, `stopAttempts ${report.stopAttempts}`);
  assert.ok(!log.some((e) => e.event === 'block-cap-override'), 'our stall rule must fire before Claude Code\'s cap');
});

test('the wall clock kills the whole process group, then the handoff note is written and one relay runs', async () => {
  const dir = makeRepo();
  writeQueue(dir, TASKS.slice(0, 1));
  const pidFile = join(dir, '..', `${dir.split('/').pop()}-grandchild.pid`);
  const { report, log } = await runFake(dir, [{ grandchild: pidFile }, { sleep: 20000 }], { wallClockSec: 1, relay: 1 });
  assert.equal(report.sessions[0].cap, 'wall-clock');
  const gpid = Number(readFileSync(pidFile, 'utf8'));
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(isGone(gpid), 'grandchild must be dead');

  const handoff = log.filter((e) => e.event === 'start')[1];
  assert.ok(handoff.argv.includes('--resume'));
  assert.deepEqual(handoff.argv.slice(handoff.argv.indexOf('--tools'), handoff.argv.indexOf('--tools') + 2), ['--tools', 'Write']);
  assert.equal(handoff.argv[handoff.argv.indexOf('--max-turns') + 1], '3');
  assert.equal(handoff.env.WAYPOINT_DISABLE, '1');
  assert.ok(report.sessions[1].notePath);
  assert.equal(report.sessions[2].label, 'relay-1');
  const relayPrompt = log.filter((e) => e.event === 'start')[2].argv[1];
  assert.match(relayPrompt, /<handoff-note>\n# Handoff/);
  assert.match(relayPrompt, /<goal task="add"/);
});

test('a context cap kills the session; a budget end is recognised as a cap', async () => {
  let dir = makeRepo();
  writeQueue(dir, TASKS.slice(0, 1));
  let { report } = await runFake(dir, [{ usage: 50000 }, { usage: 150000 }, { sleep: 5000 }], { maxContextTokens: 100000, handoff: false });
  assert.equal(report.outcome, 'cap:context');
  assert.equal(report.sessions[0].maxContext, 150000);

  dir = makeRepo();
  writeQueue(dir, TASKS.slice(0, 1));
  ({ report } = await runFake(dir, [{ budget: true }]));
  assert.equal(report.sessions[0].cap, 'budget');
  assert.equal(report.sessions[1].label, 'handoff-1');
  assert.equal(report.outcome, 'cap:budget');
});

test('if Claude Code\'s own block cap ends the turn first, the run is reported as stopped early, not done', async () => {
  const dir = makeRepo();
  writeQueue(dir, TASKS.slice(0, 1));
  const junk = (i) => ({ shell: `echo ${i} >> notes.txt && git add -A && git commit -qm j${i}` });
  const { report, log } = await runFake(dir, [junk(1), { stop: true }, junk(2), { stop: true }, junk(3), { stop: true }], { blockCap: 1 });
  assert.ok(log.some((e) => e.event === 'block-cap-override'));
  assert.equal(report.outcome, 'stopped-early');
  assert.equal(report.tasks[0].status, 'active');
});

test('every session needs a budget; the autocompact override is set only when asked', () => {
  assert.throws(() => buildArgs({ prompt: 'x', model: 'haiku', sessionId: 's' }), /max-budget-usd/);
  assert.equal(buildEnv({ dir: '/d', blockCap: 5, autocompactPct: 50 }).CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '50');
  process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'parent';
  try {
    const env = buildEnv({ dir: '/d', blockCap: 5 });
    assert.equal(env.CLAUDE_CODE_REMOTE_SESSION_ID, undefined, 'the parent session\'s context must not leak into the child');
    assert.equal(env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP, '5');
    assert.equal(buildEnv({ dir: '/d', blockCap: 5, inheritClaudeEnv: true }).CLAUDE_CODE_REMOTE_SESSION_ID, 'parent');
  } finally { delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID; }
});

test('the CLI prints the plan and worst-case spend and does not start without --yes', () => {
  const dir = makeRepo();
  writeQueue(dir, TASKS);
  const r = spawnSync(process.execPath, [BIN, 'run', '--queue', 'queue.json', '--max-budget-usd', '0.1', '--relay', '1', '--claude', '/bin/false'], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /worst-case spend: \$0\.30/);
  assert.match(r.stderr, /not started/);
  assert.ok(!existsSync(join(dir, '.git', 'waypoint')));
  assert.match(r.stderr, /WARNING: the queue file is inside the repo/);
  assert.match(r.stderr, /state: .*\/\.git\/waypoint/);
  const noBudget = spawnSync(process.execPath, [BIN, 'run', '--queue', 'queue.json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(noBudget.status, 2);
  assert.match(noBudget.stderr, /spend cap/);
});

test('a crashing hook exits 1 (non-blocking), never 2 (which Claude Code reads as block)', () => {
  const r = spawnSync(process.execPath, [BIN, 'hook', 'stop'], { input: '{not json', encoding: 'utf8' });
  assert.equal(r.status, 1);
  const none = execFileSync(process.execPath, [BIN, 'hook', 'stop'], { input: JSON.stringify({ cwd: '/tmp/nowhere-waypoint' }), encoding: 'utf8' });
  assert.equal(none, '');
});
