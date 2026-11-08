#!/usr/bin/env node
// An `explain` command for waypoint checks (E11): a stronger model turns a failing hidden check into feedback about intent,
// without the test text or exact expected values, so the worker can be steered towards checks it never sees.
//
// Reads (from waypoint): WAYPOINT_CHECK_NAME, WAYPOINT_CHECK_RUN (the test file paths are taken from it, or pass --test),
// WAYPOINT_CHECK_OUTPUT_FILE (the raw failure output), WAYPOINT_BASE (the task's start commit; the worker's diff is from here).
// Prints the feedback on stdout (exit 0), or nothing (exit 1) so waypoint falls back to the raw output, e.g. when the
// feedback would leak the test (any 40-character stretch of the test file appearing in it).
// Options: --model (default claude-fable-5-1), --budget-usd (default 0.25), --config-dir, --log <jsonl>, --test <file>...
import { readFileSync, appendFileSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const tests = args.flatMap((a, i) => (args[i - 1] === '--test' ? [a] : []));
const model = opt('model', 'claude-fable-5-1');
const budget = opt('budget-usd', '0.25');
const log = opt('log', process.env.WAYPOINT_EXPLAIN_LOG);
const env = process.env;

const run = env.WAYPOINT_CHECK_RUN || '';
const testFiles = tests.length ? tests : [...new Set(run.match(/[^\s'"]+\.test\.m?js/g) || [])].filter(existsSync);
const testSrc = testFiles.map((f) => `// ${f.split('/').pop()}\n${readFileSync(f, 'utf8')}`).join('\n\n').slice(0, 30000);
const output = env.WAYPOINT_CHECK_OUTPUT_FILE ? readFileSync(env.WAYPOINT_CHECK_OUTPUT_FILE, 'utf8') : '';
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 24 }); } catch { return ''; } };
const base = env.WAYPOINT_BASE || 'HEAD';
const diff = (git('diff', '--stat', base) + '\n' + git('diff', base, '--', '.', ':(exclude)test/**')).slice(0, 12000);

const prompt = `You are giving feedback to an engineer who CANNOT see the acceptance tests below and must not be shown them.
Their code fails some of these hidden tests. Using the tests, the failure output and their diff, write feedback (at most 150
words, plain text, a short list) that says which required behaviours are missing or wrong, stated as rules about how the product
should behave (e.g. "a glob that is only whitespace must be rejected as empty", "patch targets must be read from the +++ lines,
without the a/ and b/ prefixes"). Do not quote test code. Do not reveal test names, exact test inputs, or exact expected
values unless they are part of the product's public behaviour. Do not tell them how the tests are written. If the failure is
caused by the test environment or the test itself rather than their code, say that in one line starting "CHECK-PROBLEM:".

<hidden-tests>
${testSrc}
</hidden-tests>

<failure-output>
${output.slice(-8000)}
</failure-output>

<their-diff>
${diff}
</their-diff>`;

const childEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !/^(CLAUDE|WAYPOINT_)/.test(k) || k === 'CLAUDE_CONFIG_DIR'));
const cfg = opt('config-dir', env.CLAUDE_CONFIG_DIR || mkdtempSync(join(tmpdir(), 'explain-cfg-')));
const t0 = Date.now();
const r = spawnSync('claude', ['-p', prompt, '--model', model, '--max-budget-usd', String(budget), '--strict-mcp-config', '--tools', '',
  '--output-format', 'json', '--no-session-persistence'], { encoding: 'utf8', env: { ...childEnv, CLAUDE_CONFIG_DIR: cfg }, input: '', timeout: 240000, maxBuffer: 1 << 24 });
let res = null; try { res = JSON.parse(r.stdout); } catch { /* not JSON */ }
const text = (res?.result || '').trim();

// Leak check: no 40-character stretch of the test source (whitespace-normalised) may appear in the feedback.
const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase();
const src = norm(testSrc), out = norm(text);
let leak = null;
for (let i = 0; i + 40 <= out.length; i += 5) { const w = out.slice(i, i + 40); if (src.includes(w)) { leak = w; break; } }

if (log) appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), check: env.WAYPOINT_CHECK_NAME, model, costUsd: res?.total_cost_usd ?? null,
  ms: Date.now() - t0, chars: text.length, leak, ok: !!text && !leak, text }) + '\n');
if (!text || leak) process.exit(1);
process.stdout.write(text + '\n');
