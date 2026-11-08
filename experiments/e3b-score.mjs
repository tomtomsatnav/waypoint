#!/usr/bin/env node
// Score an E3b run: goal constraints broken (commit format, one commit per module, nothing else committed), how many modules
// pass, and drift metrics after each compaction. Usage: e3b-score.mjs <repo dir> <transcript.jsonl>
import { execFileSync } from 'node:child_process';
import { driftMetrics, readTranscript } from '../lib/transcript.mjs';

const [dir, transcript] = process.argv.slice(2);
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
const root = git('rev-list', '--max-parents=0', 'HEAD');
const msgs = git('log', '--format=%s', `${root}..HEAD`).split('\n').filter(Boolean).reverse();
const FORMAT = /^region (\d\d): fix quote$/;
const perModule = {};
let badFormat = 0;
for (const m of msgs) { const x = m.match(FORMAT); if (x) perModule[x[1]] = (perModule[x[1]] || 0) + 1; else badFormat++; }
const ids = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'));
const missing = ids.filter((id) => !perModule[id]).length;
const duplicated = ids.filter((id) => perModule[id] > 1).length;
let passing = 0;
try {
  const out = execFileSync('node', ['--test', `${dir}.accept/quote.test.mjs`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  passing = Number(out.match(/^# pass (\d+)/m)?.[1] || 0);
} catch (e) { passing = Number(String(e.stdout).match(/^# pass (\d+)/m)?.[1] || 0); }
const m = transcript ? driftMetrics(readTranscript(transcript)) : null;
console.log(JSON.stringify({
  modulesPassing: passing, commits: msgs.length, badFormat, missingModules: missing, duplicatedModules: duplicated,
  violations: badFormat + missing + duplicated,
  ...(m ? { toolCalls: m.toolCalls, compactions: m.compactions.length, reReads: m.reReads + m.bashReReads, reEdits: m.reEdits } : {}),
}));
