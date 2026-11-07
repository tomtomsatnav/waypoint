#!/usr/bin/env bash
# E1: build a throwaway repo with a queue of three small tasks, each with a check. Spends nothing.
# Usage: experiments/e1-setup.sh <empty dir>
# Then, from that dir (this is the paid part; it prints the worst case and needs --yes):
#   node <waypoint>/bin/waypoint.mjs run --queue ../<dir>.queue.json --max-budget-usd 0.05 --wall-clock 600 \
#     --config-dir <sandbox config dir> --yes
set -euo pipefail
dir=${1:?usage: e1-setup.sh <empty dir>}
mkdir -p "$dir" && cd "$dir"
[ -z "$(ls -A)" ] || { echo "$dir is not empty" >&2; exit 1; }
git init -q -b main
git config user.email e1@example.com && git config user.name E1
mkdir -p src test
echo 'export const placeholder = true;' > src/text.mjs
cat > test/text.test.mjs <<'T'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../src/text.mjs';
test('slugify', { skip: !process.env.T_SLUG }, () => assert.equal(t.slugify('  Hello, World! '), 'hello-world'));
test('titleCase', { skip: !process.env.T_TITLE }, () => assert.equal(t.titleCase('the quick fox'), 'The Quick Fox'));
test('wordCount', { skip: !process.env.T_COUNT }, () => assert.equal(t.wordCount('  one two\tthree\nfour '), 4));
T
git add -A && git commit -qm 'E1 start'
# verify: aos-orch by default (needs `npm link` from aos-orchestrator). E1_VERIFY replaces the command; E1_VERIFY=null turns it off.
def='aos-orch verify --base {base}'
export QUEUE_OUT="$(cd .. && pwd)/$(basename "$PWD").queue.json"
E1_VERIFY="${E1_VERIFY-$def}" node - <<'Q'
const v = process.env.E1_VERIFY;
const task = (id, env, goal) => ({ id, goal: `In src/text.mjs, export ${goal}`, checks: [`${env}=1 node --test test/*.test.mjs`] });
require('fs').writeFileSync(process.env.QUEUE_OUT, JSON.stringify({
  verify: v === 'null' ? null : v,
  tasks: [
    task('slugify', 'T_SLUG', "slugify(s): lower-case, trim, replace runs of non-alphanumerics with a single '-', no leading or trailing '-'."),
    task('titleCase', 'T_TITLE', 'titleCase(s): upper-case the first letter of each space-separated word.'),
    task('wordCount', 'T_COUNT', 'wordCount(s): the number of whitespace-separated words.'),
  ],
}, null, 2) + '\n');
Q
echo "queue written to $QUEUE_OUT (outside the repo, so the agent cannot read the checks)"
echo "E1 repo ready in $dir"
