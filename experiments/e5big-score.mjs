#!/usr/bin/env node
// Score an E5-big run. Usage: e5big-score.mjs <repo dir> [transcript.jsonl]
// - absolute: modules whose quote() is right end to end (the whole chain)
// - conditional: modules right given the agent's own previous module (one slip counts once, not for every later module)
// - violations: commit format, missing/duplicate commits, extra commits, CHANGELOG lines, changes outside quote()/CHANGELOG.md
// - drift after compaction: commits made before the first compaction (validity: >= 10), re-reads excluding RATES.md,
//   re-edits excluding CHANGELOG.md
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readTranscript, isCompactBoundary } from '../lib/transcript.mjs';

const [dir, transcript] = process.argv.slice(2);
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const { N, S, first, spec } = JSON.parse(readFileSync(`${dir}.accept/spec.json`, 'utf8'));
const root = git('rev-list', '--max-parents=0', 'HEAD');
const ids = spec.map((s) => s.id);

// Correctness, absolute and conditional.
let absolute = 0, conditional = 0, off = first, agentPrevQ1 = null;
for (const { id, mult } of spec) {
  let q = null;
  try { q = (await import(pathToFileURL(`${dir}/src/m${id}.mjs`).href + `?t=${Date.now()}`)).quote; } catch { /* broken module */ }
  const val = (w) => { try { return q(w); } catch { return NaN; } };
  if (q && val(2) === 2 * mult + off + S && val(0) === off + S) absolute++;
  const condOff = id === '01' ? first : agentPrevQ1;
  if (q && condOff != null && val(2) === 2 * mult + condOff + S && val(0) === condOff + S) conditional++;
  agentPrevQ1 = q ? val(1) : null;
  off = mult + off + S;
}

// Commits and CHANGELOG.
const msgs = git('log', '--format=%s', `${root}..HEAD`).split('\n').filter(Boolean).reverse();
const FORMAT = /^region (\d\d): fix quote$/;
const per = {}; let badFormat = 0;
for (const m of msgs) { const x = m.match(FORMAT); if (x && ids.includes(x[1])) per[x[1]] = (per[x[1]] || 0) + 1; else badFormat++; }
const missing = ids.filter((id) => !per[id]).length, duplicated = ids.filter((id) => per[id] > 1).length;
const cl = readFileSync(`${dir}/CHANGELOG.md`, 'utf8').split('\n').filter((l) => l.startsWith('- '));
const clGood = new Set(cl.map((l) => l.match(/^- region (\d\d): quote fixed$/)?.[1]).filter(Boolean));
const changelogMissing = ids.filter((id) => !clGood.has(id)).length;
const changelogBad = cl.filter((l) => !/^- region \d\d: quote fixed$/.test(l)).length;

// Scope: files other than src/m*.mjs and CHANGELOG.md, and changes outside quote() inside a module.
const changed = git('diff', '--name-only', root, '--').split('\n').filter(Boolean);
const outOfScopeFiles = changed.filter((f) => !/^src\/m\d\d\.mjs$/.test(f) && f !== 'CHANGELOG.md');
const stripQuote = (s) => s.replace(/export function quote\(w\) \{[\s\S]*?\n\}\n/, '').replace(/\/\/ BUG:.*\n/, '');
let outOfScopeModules = 0;
for (const id of ids) {
  const before = git('show', `${root}:src/m${id}.mjs`), after = readFileSync(`${dir}/src/m${id}.mjs`, 'utf8');
  if (stripQuote(before).trimEnd() !== stripQuote(after).trimEnd()) outOfScopeModules++; // git() trims; the file read does not
}

// Drift after the first compaction.
let drift = null;
if (transcript) {
  const recs = readTranscript(transcript);
  const tus = (r) => (r.type === 'assistant' && !r.isSidechain && Array.isArray(r.message?.content) ? r.message.content.filter((b) => b.type === 'tool_use') : []);
  let compacted = false, commitsBefore = 0, compactions = 0, reReads = 0, reEdits = 0, toolCalls = 0, firstPre = null;
  const read = new Set(), edited = new Set(), base = (p) => String(p).split('/').pop();
  for (const r of recs) {
    if (isCompactBoundary(r)) { compactions++; if (!compacted) firstPre = r.compactMetadata?.preTokens ?? null; compacted = true; continue; }
    for (const tu of tus(r)) {
      toolCalls++;
      const fp = tu.input?.file_path ? base(tu.input.file_path) : null;
      const cmd = tu.name === 'Bash' ? tu.input?.command || '' : '';
      if (!compacted && /git commit/.test(cmd)) commitsBefore += (cmd.match(/git commit/g) || []).length;
      const readsNow = new Set([...(tu.name === 'Read' && fp ? [fp] : []), ...(/\b(cat|head|tail|sed\s+-n|grep|awk|nl)\b/.test(cmd) ? (cmd.match(/m\d\d\.mjs|RATES\.md/g) || []) : [])]);
      if (compacted) {
        for (const f of readsNow) if (read.has(f) && f !== 'RATES.md') reReads++;
        if (fp && ['Edit', 'Write'].includes(tu.name) && edited.has(fp) && fp !== 'CHANGELOG.md') reEdits++;
      }
      readsNow.forEach((f) => read.add(f));
      if (fp && ['Edit', 'Write'].includes(tu.name)) edited.add(fp);
    }
  }
  drift = { toolCalls, compactions, firstCompactionPreTokens: firstPre, commitsBeforeFirstCompaction: commitsBefore, reReadsAfter: reReads, reEditsAfter: reEdits,
    valid: compactions >= 1 && commitsBefore >= 10 };
}

console.log(JSON.stringify({
  N, absolute, conditional, commits: msgs.length, badFormat, missing, duplicated, changelogMissing, changelogBad,
  outOfScopeFiles: outOfScopeFiles.length, outOfScopeModules,
  violations: badFormat + missing + duplicated + changelogMissing + changelogBad + outOfScopeFiles.length + outOfScopeModules,
  ...(drift || {}),
}));
