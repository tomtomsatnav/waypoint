#!/usr/bin/env node
// A stand-in for `claude -p` in the benchmark's end-to-end test: the research call writes EXPECTATIONS.md, the build call
// copies a reference solution ($FAKE_SOLUTION) into the repo and commits it, and each reports a result event the way
// Claude Code's stream-json does. The usage probe gets no rate-limit event (usage unknown, so it just runs).
import { cpSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] || '';
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
say({ type: 'system', subtype: 'init' });
if (/EXPECTATIONS\.md in the repo root/.test(prompt)) writeFileSync('EXPECTATIONS.md', '# Expectations\n- It works. Check: use it.\n');
else if (/^Build what /.test(prompt)) {
  cpSync(process.env.FAKE_SOLUTION, '.', { recursive: true });
  spawnSync('git', ['add', '-A']); spawnSync('git', ['-c', 'user.name=fake', '-c', 'user.email=f@e', 'commit', '-q', '-m', 'build it']);
}
say({ type: 'result', subtype: 'success', result: 'done', num_turns: 4, total_cost_usd: 0.25, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 } });
