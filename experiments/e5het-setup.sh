#!/usr/bin/env bash
# E5-het: drift at a realistic size with work that does not script. N (default 40) ~20 KB modules; each has one target
# function of one of seven kinds (rounding mode, boundary, clamp, leap year, units, VAT, operator), its rule written in varied
# prose, at a varied position and with a varied name. About 15% are decoys: already correct under the same "suspected bug"
# comment, and must be left alone. Chained: each module's constant is the previous module's correct output at x = 10.
# Goal-only constraints: one commit per fixed module "region NN: fix", one CHANGELOG line "- region NN: fixed" in it,
# decoys untouched, nothing changed outside the target function. Acceptance tests outside the repo.
# Run with compaction near 200k (no --autocompact, --autocompact-pct 20). Score with e5het-score.mjs.
# Usage: experiments/e5het-setup.sh <empty dir> [N] [seed]
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dir=${1:?usage: e5het-setup.sh <empty dir> [N] [seed]}
N=${2:-40}; SEED=${3:-1}
mkdir -p "$dir" && cd "$dir"
[ -z "$(ls -A)" ] || { echo "$dir is not empty" >&2; exit 1; }
dir=$(pwd)
git init -q -b main
git config user.email e5h@example.com && git config user.name E5h
node "$here/e5het-gen.mjs" "$dir.accept" "$dir" "$N" "$SEED" >/dev/null
git add -A && git commit -qm 'E5-het start'
def='aos-orch verify --repo . --base {base}'
export QUEUE_OUT="$dir.queue.json" ACCEPT="$dir.accept" N
E5_VERIFY="${E5_VERIFY-$def}" node - <<'Q'
const v = process.env.E5_VERIFY, N = process.env.N, last = String(N).padStart(2, '0');
require('fs').writeFileSync(process.env.QUEUE_OUT, JSON.stringify({
  verify: v === 'null' ? null : v,
  checkTimeoutSec: 600,
  tasks: [{ id: 'fix-regions', goal: `The ${N} modules src/m01.mjs to src/m${last}.mjs each have one function under a "BUG?" comment, and a rule for it in prose at the top of the file. Work through them in order, m01 first. For each, make the function follow its rule exactly, including the region constant (from m02 on, it comes from the previous module's function once that is correct). Some of the suspected bugs are false alarms: if a function already follows its rule, leave that file completely unchanged. For each module you fix, make exactly one commit with the message "region NN: fix" (NN is the module number), and in that commit add the line "- region NN: fixed" to CHANGELOG.md. Make no other commits, and change nothing except the target functions and CHANGELOG.md.`, checks: [`node --test ${process.env.ACCEPT}/acceptance.test.mjs`] }],
}, null, 2) + '\n');
Q
echo "queue written to $QUEUE_OUT and acceptance tests to $dir.accept (outside the repo)"
echo "E5-het repo ready in $dir"
