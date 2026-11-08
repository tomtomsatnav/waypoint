#!/usr/bin/env bash
# E1: build a throwaway repo with a queue of three small tasks, each with a check. Spends nothing.
# The repo has one real, passing test; each task's acceptance test lives outside the repo (<dir>.accept/), next to the
# queue (<dir>.queue.json), so the agent cannot read the finish line. (An earlier version gated in-repo tests on env
# variables; aos-orch verify rightly rejected that as a vacuous pass, since plain `node --test` skipped them all.)
# Usage: experiments/e1-setup.sh <empty dir>
# Then, from that dir (this is the paid part; it prints the worst case and needs --yes):
#   node <waypoint>/bin/waypoint.mjs run --queue ../<dir>.queue.json --max-budget-usd 0.15 --wall-clock 600 \
#     --config-dir <sandbox config dir> --yes
set -euo pipefail
dir=${1:?usage: e1-setup.sh <empty dir>}
mkdir -p "$dir" && cd "$dir"
[ -z "$(ls -A)" ] || { echo "$dir is not empty" >&2; exit 1; }
dir=$(pwd)
git init -q -b main
git config user.email e1@example.com && git config user.name E1
mkdir -p src test
echo 'export const placeholder = true;' > src/text.mjs
cat > test/text.test.mjs <<'T'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../src/text.mjs';
test('placeholder', () => assert.equal(t.placeholder, true));
T
git add -A && git commit -qm 'E1 start'
accept="$dir.accept"
mkdir -p "$accept"
mk() { # mk <id> <assertion>
  printf "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as t from '%s/src/text.mjs';\ntest('%s', () => { %s });\n" "$dir" "$1" "$2" > "$accept/$1.test.mjs"
}
mk slugify "assert.equal(t.slugify('  Hello, World! '), 'hello-world'); assert.equal(t.slugify('--a__b--'), 'a-b');"
mk titleCase "assert.equal(t.titleCase('the quick fox'), 'The Quick Fox');"
mk wordCount "assert.equal(t.wordCount('  one two\\tthree\\nfour '), 4); assert.equal(t.wordCount(''), 0);"
# verify: aos-orch by default (needs `npm link` from aos-orchestrator). E1_VERIFY replaces the command; E1_VERIFY=null turns it off.
def='aos-orch verify --repo . --base {base}'
export QUEUE_OUT="$dir.queue.json" ACCEPT="$accept"
E1_VERIFY="${E1_VERIFY-$def}" node - <<'Q'
const v = process.env.E1_VERIFY;
const task = (id, goal) => ({ id, goal: `In src/text.mjs, export ${goal}`, checks: [`node --test ${process.env.ACCEPT}/${id}.test.mjs`] });
require('fs').writeFileSync(process.env.QUEUE_OUT, JSON.stringify({
  verify: v === 'null' ? null : v,
  tasks: [
    task('slugify', "slugify(s): lower-case, trim, replace runs of non-alphanumerics with a single '-', no leading or trailing '-'."),
    task('titleCase', 'titleCase(s): upper-case the first letter of each space-separated word.'),
    task('wordCount', 'wordCount(s): the number of whitespace-separated words (0 for an empty string).'),
  ],
}, null, 2) + '\n');
Q
echo "queue written to $QUEUE_OUT and acceptance tests to $accept (outside the repo, so the agent cannot read the checks)"
echo "E1 repo ready in $dir"
