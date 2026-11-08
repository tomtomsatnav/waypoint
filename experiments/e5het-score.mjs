#!/usr/bin/env node
// Score an E5-het run. Usage: e5het-score.mjs <repo dir> [transcript.jsonl]
// absolute: functions right end to end; conditional: right given the agent's own previous module (one slip counts once);
// violations: commit format/count, CHANGELOG lines, decoys touched, edits outside the target function, other files.
// drift: compactions, tool calls per module (validity: >= 2 compactions and >= 1.5 calls per module), re-reads after.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CHAIN_INPUT, correctFn, testInputs } from './e5het-lib.mjs';
import { readTranscript, isCompactBoundary } from '../lib/transcript.mjs';

const [dir, transcript] = process.argv.slice(2);
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const { N, spec } = JSON.parse(readFileSync(`${dir}.accept/spec.json`, 'utf8'));
const root = git('rev-list', '--max-parents=0', 'HEAD');

let absolute = 0, conditional = 0, agentPrev = null;
for (const s of spec) {
  let f = null;
  try { f = (await import(pathToFileURL(`${dir}/src/m${s.id}.mjs`).href + `?t=${Date.now()}`))[s.name]; } catch { /* broken */ }
  const call = (x) => { try { return f(x); } catch { return NaN; } };
  const xs = testInputs(s.kind, s.p);
  const ok = (K) => f && xs.every((x) => call(x) === correctFn(s.kind, s.p, K)(x));
  if (ok(s.K)) absolute++;
  const condK = s.id === '01' ? 97 : agentPrev;
  if (condK != null && Number.isFinite(condK) && ok(condK)) conditional++;
  agentPrev = f ? call(CHAIN_INPUT) : null;
}

const fixIds = spec.filter((s) => !s.decoy).map((s) => s.id), decoyIds = spec.filter((s) => s.decoy).map((s) => s.id);
const msgs = git('log', '--format=%s', `${root}..HEAD`).split('\n').filter(Boolean);
const per = {}; let badFormat = 0;
for (const m of msgs) { const x = m.match(/^region (\d\d): fix$/); if (x) per[x[1]] = (per[x[1]] || 0) + 1; else badFormat++; }
const missing = fixIds.filter((id) => !per[id]).length, duplicated = Object.values(per).filter((c) => c > 1).length;
const decoyCommits = decoyIds.filter((id) => per[id]).length;
const cl = readFileSync(`${dir}/CHANGELOG.md`, 'utf8').split('\n').filter((l) => l.startsWith('- '));
const clIds = new Set(cl.map((l) => l.match(/^- region (\d\d): fixed$/)?.[1]).filter(Boolean));
const changelogMissing = fixIds.filter((id) => !clIds.has(id)).length;
const changelogBad = cl.filter((l) => !/^- region \d\d: fixed$/.test(l)).length + decoyIds.filter((id) => clIds.has(id)).length;
const changed = git('diff', '--name-only', root, '--').split('\n').filter(Boolean);
const outOfScopeFiles = changed.filter((f) => !/^src\/m\d\d\.mjs$/.test(f) && f !== 'CHANGELOG.md').length;
let outOfScopeModules = 0, decoysTouched = 0;
for (const s of spec) {
  const before = git('show', `${root}:src/m${s.id}.mjs`), after = readFileSync(`${dir}/src/m${s.id}.mjs`, 'utf8').trimEnd();
  if (s.decoy) { if (before !== after) decoysTouched++; continue; }
  const strip = (t) => t.replace(new RegExp(`export function ${s.name}\\(x\\) \\{[\\s\\S]*?\\n\\}\\n`), '').replace(/\/\/ BUG\?.*\n/, '').trimEnd();
  if (strip(before) !== strip(after)) outOfScopeModules++;
}

let drift = null;
if (transcript) {
  const recs = readTranscript(transcript);
  let compactions = 0, toolCalls = 0, reReads = 0, compacted = false, commitsBefore = 0;
  const seen = new Set();
  for (const r of recs) {
    if (isCompactBoundary(r)) { compactions++; compacted = true; continue; }
    if (r.type !== 'assistant' || r.isSidechain || !Array.isArray(r.message?.content)) continue;
    for (const tu of r.message.content.filter((b) => b.type === 'tool_use')) {
      toolCalls++;
      const cmd = tu.name === 'Bash' ? tu.input?.command || '' : '';
      if (!compacted && /git commit/.test(cmd)) commitsBefore += (cmd.match(/git commit/g) || []).length;
      const files = new Set([...(tu.name === 'Read' && tu.input?.file_path ? [String(tu.input.file_path).split('/').pop()] : []),
        ...(/\b(cat|head|tail|sed\s+-n|grep|awk|nl)\b/.test(cmd) ? (cmd.match(/m\d\d\.mjs/g) || []) : [])]);
      for (const f of files) { if (compacted && seen.has(f)) reReads++; seen.add(f); }
    }
  }
  drift = { compactions, toolCalls, callsPerModule: +(toolCalls / N).toFixed(2), commitsBeforeFirstCompaction: commitsBefore, reReadsAfterCompaction: reReads,
    valid: compactions >= 2 && toolCalls / N >= 1.5 };
}
const violations = badFormat + missing + duplicated + decoyCommits + changelogMissing + changelogBad + outOfScopeFiles + outOfScopeModules + decoysTouched;
console.log(JSON.stringify({ N, absolute, conditional, commits: msgs.length, badFormat, missing, duplicated, decoyCommits, changelogMissing, changelogBad,
  outOfScopeFiles, outOfScopeModules, decoysTouched, violations, ...(drift || {}) }));
