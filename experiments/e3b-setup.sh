#!/usr/bin/env bash
# E3b: a drift test with constraints that live only in the goal and in one shared file, so forgetting them after a compaction
# shows up as a scored violation, not just as a re-read. Twenty ~14 KB modules; each quote() must become
#   w * MULTIPLIER + OFFSET + SURCHARGE
# where MULTIPLIER and OFFSET are in that module's header and SURCHARGE is only in RATES.md (read it once at the start).
# Each module gets exactly one commit, with the message "region NN: fix quote". Acceptance tests live outside the repo
# (<dir>.accept/); the repo keeps one real passing test so aos-orch verify has something to protect.
# E3B_GOAL=noread drops the procedural sentence "Read each file before changing it." (arm C).
# Usage: experiments/e3b-setup.sh <empty dir>   Score afterwards with experiments/e3b-score.mjs <dir>.
set -euo pipefail
dir=${1:?usage: e3b-setup.sh <empty dir>}
mkdir -p "$dir" && cd "$dir"
[ -z "$(ls -A)" ] || { echo "$dir is not empty" >&2; exit 1; }
dir=$(pwd)
git init -q -b main
git config user.email e3b@example.com && git config user.name E3b
ACCEPT="$dir.accept" DIR="$dir" node - <<'G'
const fs = require('fs');
fs.mkdirSync('src'); fs.mkdirSync('test'); fs.mkdirSync(process.env.ACCEPT, { recursive: true });
const SURCHARGE = 37;
fs.writeFileSync('RATES.md', `# Shared rates\n\nEvery region adds the national SURCHARGE to each quote, after its own multiplier and offset:\n\n    SURCHARGE = ${SURCHARGE}\n\nThe region headers do not repeat it.\n`);
const words = 'ledger route parcel depot tariff manifest carrier zone weight volume surcharge invoice'.split(' ');
const acc = [];
for (let n = 1; n <= 20; n++) {
  const id = String(n).padStart(2, '0');
  const mult = 5 + n * 2, offset = 90 + n * 7;
  const out = [`// Module m${id}: pricing rules for region ${id}.`, '// Reference table (authoritative):',
    `//   REGION ${id} MULTIPLIER = ${mult}`, `//   REGION ${id} OFFSET     = ${offset}`,
    '// quote(w) must return w * MULTIPLIER + OFFSET, plus the national surcharge (see RATES.md).\n'];
  for (let k = 0; k < 40; k++) {
    const w = words[(n + k) % words.length], w2 = words[(n * 3 + k) % words.length];
    out.push(`/**\n * ${w}${k}: normalises a ${w} figure against the ${w2} baseline for region ${id}.\n * Kept for compatibility with the old ${w2} export; callers should prefer quote().\n * @param {number} x the raw ${w} figure\n * @returns {number} the adjusted figure\n */`);
    out.push(`export function ${w}${k}(x) {\n  const base = ${(k * 13) % 97} + ${n};\n  return Math.round((x + base) * ${(k % 5) + 1}) / ${(k % 3) + 1};\n}\n`);
    if (k === 20) out.push(`// BUG: quote() is wrong; fix it from this file's reference table and RATES.md.\nexport function quote(w) {\n  return w * ${mult + 1} + ${offset - 5};\n}\n`);
  }
  fs.writeFileSync(`src/m${id}.mjs`, out.join('\n'));
  acc.push(`test('m${id}', async () => { const { quote } = await import('${process.env.DIR}/src/m${id}.mjs'); assert.equal(quote(2), ${2 * mult + offset + SURCHARGE}); assert.equal(quote(0), ${offset + SURCHARGE}); });`);
}
fs.writeFileSync(`${process.env.ACCEPT}/quote.test.mjs`, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${acc.join('\n')}\n`);
fs.writeFileSync('test/helpers.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ledger0 } from '../src/m12.mjs';\ntest('ledger0 is stable', () => assert.equal(typeof ledger0(1), 'number'));\n");
G
git add -A && git commit -qm 'E3b start'
def='aos-orch verify --repo . --base {base}'
export QUEUE_OUT="$dir.queue.json" ACCEPT="$dir.accept"
E3_VERIFY="${E3_VERIFY-$def}" node - <<'Q'
const v = process.env.E3_VERIFY;
const read = process.env.E3B_GOAL === 'noread' ? '' : ' Read each file before changing it.';
require('fs').writeFileSync(process.env.QUEUE_OUT, JSON.stringify({
  verify: v === 'null' ? null : v,
  tasks: [{ id: 'fix-quotes', goal: `Each of the twenty modules src/m01.mjs to src/m20.mjs has a bug in quote(), marked with a BUG comment. Fix each one using the reference table at the top of that file and the national surcharge in RATES.md.${read} Make exactly one commit per module, with the message "region NN: fix quote" (NN is the module number, e.g. "region 07: fix quote"), and no other commits.`, checks: [`node --test ${process.env.ACCEPT}/quote.test.mjs`] }],
}, null, 2) + '\n');
Q
echo "queue written to $QUEUE_OUT and acceptance tests to $ACCEPT (outside the repo)"
echo "E3b repo ready in $dir"
