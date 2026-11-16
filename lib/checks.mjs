// Runs the finish line: the task's checks, then the verify guard. Nothing here trusts the agent's prose.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tail(text, n) {
  if (text.length <= n) return text;
  return `[... ${text.length - n} earlier characters cut ...]\n` + text.slice(-n);
}

// The environment for anything the hook runs (checks, verify, prepare). The stop hook sets WAYPOINT_DIR in its own process
// (from --state-dir), and git's GIT_DIR and friends pin the repo a command sees; commands must find their own repo and state
// by their working directory, not by the hook's environment. Found by the agent itself while dogfooding (E9): with
// WAYPOINT_DIR inherited, an acceptance test for `waypoint status` read the live run's state instead of its own.
export function checkEnv(extra = {}) {
  const { WAYPOINT_DIR: _live, GIT_DIR: _gd, GIT_WORK_TREE: _gw, GIT_INDEX_FILE: _gi, GIT_COMMON_DIR: _gc, ...inherited } = process.env;
  return { ...inherited, ...extra, WAYPOINT_IN_CHECK: '1' };
}

function runOne(cmd, cwd, timeoutSec, env) {
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', cmd], {
    cwd, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024,
    env: checkEnv(env),
  });
  const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
  const output = `${r.stdout || ''}${r.stderr || ''}${r.error && !timedOut ? String(r.error) : ''}`;
  return {
    exitCode: r.status,
    timedOut,
    passed: r.status === 0 && !timedOut,
    output,
    ms: Date.now() - t0,
  };
}

// Returns { passed, results: [{ name, kind, hidden, passed, exitCode, timedOut, output, ms }] }.
// Every check runs even after a failure, so the agent sees the whole picture in one block.
export function runFinishLine({ checks, verify, base, runBase, cwd, timeoutSec }) {
  const results = checks.map((c) => {
    const r = { name: c.name, kind: 'check', hidden: c.hidden, ...runOne(c.run, cwd, c.timeoutSec ?? timeoutSec, {}) };
    if (!r.passed && c.explain) Object.assign(r, explainFailure(c, r, { cwd, base, timeoutSec }));
    return r;
  });
  if (verify) {
    const cmd = verify.replaceAll('{base}', base ?? '').replaceAll('{runBase}', runBase ?? '');
    results.push({ name: cmd, kind: 'verify', hidden: false, ...runOne(cmd, cwd, timeoutSec, {}) });
  }
  return { passed: results.every((r) => r.passed), results };
}

// A failing check with an `explain` command: run it and let its stdout stand in for the raw failure output in what the agent
// sees. The point (E11): keep the checks hidden from the worker but still say what is missing, e.g. a stronger model reads the
// hidden test and the failure and writes feedback about intent, without the test text or expected values. The command gets the
// failing check's name, command and full output (as a file), the task's base commit, and runs in the repo. If it fails or says
// nothing, the raw output is shown as usual.
export function explainFailure(check, result, { cwd, base, timeoutSec }) {
  const dir = mkdtempSync(join(tmpdir(), 'waypoint-explain-'));
  const outFile = join(dir, 'output.txt');
  writeFileSync(outFile, result.output);
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', check.explain], {
    cwd, encoding: 'utf8', timeout: (check.explainTimeoutSec ?? Math.min(timeoutSec, 300)) * 1000, maxBuffer: 16 * 1024 * 1024,
    env: checkEnv({ WAYPOINT_CHECK_NAME: check.name, WAYPOINT_CHECK_RUN: check.run, WAYPOINT_CHECK_OUTPUT_FILE: outFile, WAYPOINT_BASE: base ?? '' }),
  });
  const text = (r.stdout || '').trim();
  const ok = r.status === 0 && text.length > 0;
  return { explained: ok, explanation: ok ? text : null, explainMs: Date.now() - t0, explainExit: r.status };
}

// Replace each redacted string (e.g. the folder holding hidden acceptance tests) with <hidden>. In testing
// Haiku read the hidden tests in every run after finding their folder through paths in the failure output; Sonnet did not,
// and could only guess the contract. Redacting keeps the failure messages (the feedback) and drops the way in.
export function redact(s, list = []) {
  let out = String(s);
  for (const r of list) if (r) out = out.split(r).join('<hidden>');
  return out;
}

// Fence check output as data. Any closing fence inside the output is defanged so it cannot break out.
export function fence(results, tailChars, redactList = []) {
  return results.filter((r) => !r.passed).map((r) => {
    const status = r.timedOut ? 'timed out' : `exit ${r.exitCode}`;
    const name = attr(redact(r.name, redactList));
    if (r.explained) {
      const body = redact(r.explanation, redactList).replaceAll('</check-output', '<\\/check-output');
      return `<check-output name="${name}" kind="${r.kind}" status="${status}" form="explained">\n${body}\n</check-output>`;
    }
    if (r.hidden) return `<check-output name="${name}" kind="${r.kind}" status="${status}">\n(hidden check: output withheld)\n</check-output>`;
    const body = tail(redact(r.output, redactList), tailChars).replaceAll('</check-output', '<\\/check-output');
    return `<check-output name="${name}" kind="${r.kind}" status="${status}">\n${body}\n</check-output>`;
  }).join('\n');
}

function attr(s) { return String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'); }

// Short, output-free summary for the state file and the re-anchor note.
export function summarise(fl) {
  return {
    at: new Date().toISOString(),
    passed: fl.passed,
    // The head of each failing output is kept (hidden checks excepted) so a broken check can be told from a failing agent.
    results: fl.results.map((r) => ({ name: r.name, kind: r.kind, passed: r.passed, exitCode: r.exitCode, timedOut: r.timedOut, ms: r.ms,
      ...(!r.passed && !r.hidden ? { outputHead: r.output.slice(0, 400) } : {}),
      ...(r.explained ? { explanation: r.explanation.slice(0, 4000), explainMs: r.explainMs } : r.explainExit !== undefined ? { explainFailed: r.explainExit } : {}) })),
  };
}
