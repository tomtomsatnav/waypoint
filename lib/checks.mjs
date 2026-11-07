// Runs the finish line: the task's checks, then the verify guard. Nothing here trusts the agent's prose.

import { spawnSync } from 'node:child_process';

export function tail(text, n) {
  if (text.length <= n) return text;
  return `[... ${text.length - n} earlier characters cut ...]\n` + text.slice(-n);
}

function runOne(cmd, cwd, timeoutSec, env) {
  const t0 = Date.now();
  const r = spawnSync('bash', ['-c', cmd], {
    cwd, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env, WAYPOINT_IN_CHECK: '1' },
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
  const results = checks.map((c) => ({
    name: c.name, kind: 'check', hidden: c.hidden,
    ...runOne(c.run, cwd, c.timeoutSec ?? timeoutSec, {}),
  }));
  if (verify) {
    const cmd = verify.replaceAll('{base}', base ?? '').replaceAll('{runBase}', runBase ?? '');
    results.push({ name: cmd, kind: 'verify', hidden: false, ...runOne(cmd, cwd, timeoutSec, {}) });
  }
  return { passed: results.every((r) => r.passed), results };
}

// Fence check output as data. Any closing fence inside the output is defanged so it cannot break out.
export function fence(results, tailChars) {
  return results.filter((r) => !r.passed).map((r) => {
    const status = r.timedOut ? 'timed out' : `exit ${r.exitCode}`;
    if (r.hidden) return `<check-output name="${attr(r.name)}" kind="${r.kind}" status="${status}">\n(hidden check: output withheld)\n</check-output>`;
    const body = tail(r.output, tailChars).replaceAll('</check-output', '<\\/check-output');
    return `<check-output name="${attr(r.name)}" kind="${r.kind}" status="${status}">\n${body}\n</check-output>`;
  }).join('\n');
}

function attr(s) { return String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'); }

// Short, output-free summary for the state file and the re-anchor note.
export function summarise(fl) {
  return {
    at: new Date().toISOString(),
    passed: fl.passed,
    results: fl.results.map((r) => ({ name: r.name, kind: r.kind, passed: r.passed, exitCode: r.exitCode, timedOut: r.timedOut, ms: r.ms })),
  };
}
