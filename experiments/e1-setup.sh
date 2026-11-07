#!/usr/bin/env bash
# E1: build a throwaway repo with a queue of three small tasks, each with a check. Spends nothing.
# Usage: experiments/e1-setup.sh <empty dir>
# Then, from that dir (this is the paid part; it prints the worst case and needs --yes):
#   node <waypoint>/bin/waypoint.mjs run --queue queue.json --max-budget-usd 0.05 --wall-clock 600 \
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
# verify: aos-orch must be on PATH (npm link from aos-orchestrator). Set E1_VERIFY=null to run without it.
verify=${E1_VERIFY:-'"aos-orch verify --base {base}"'}
cat > queue.json <<Q
{
  "verify": $verify,
  "tasks": [
    { "id": "slugify", "goal": "In src/text.mjs, export slugify(s): lower-case, trim, replace runs of non-alphanumerics with a single '-', no leading or trailing '-'.",
      "checks": ["T_SLUG=1 node --test test/"] },
    { "id": "titleCase", "goal": "In src/text.mjs, export titleCase(s): upper-case the first letter of each space-separated word.",
      "checks": ["T_TITLE=1 node --test test/"] },
    { "id": "wordCount", "goal": "In src/text.mjs, export wordCount(s): the number of whitespace-separated words.",
      "checks": ["T_COUNT=1 node --test test/"] }
  ]
}
Q
git add queue.json && git commit -qm 'E1 queue'
echo "E1 repo ready in $dir"
