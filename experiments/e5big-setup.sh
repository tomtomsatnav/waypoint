#!/usr/bin/env bash
# E5-big: drift at a realistic context size. N (default 60) ~14 KB modules in a chain: region NN's OFFSET is the corrected
# quote(1) of region NN-1, so each fix depends on the previous one's result. The surcharge is only in RATES.md. Constraints
# that live only in the goal: one commit per module "region NN: fix quote", one CHANGELOG.md line per module
# "- region NN: quote fixed", and no change outside quote() and CHANGELOG.md. Acceptance tests outside the repo.
# Run with compaction near 200k: no --autocompact, --autocompact-pct 20 (of the 1M window). Score with e5big-score.mjs.
# Usage: experiments/e5big-setup.sh <empty dir> [N]
set -euo pipefail
dir=${1:?usage: e5big-setup.sh <empty dir> [N]}
N=${2:-60}
mkdir -p "$dir" && cd "$dir"
[ -z "$(ls -A)" ] || { echo "$dir is not empty" >&2; exit 1; }
dir=$(pwd)
git init -q -b main
git config user.email e5@example.com && git config user.name E5
N=$N ACCEPT="$dir.accept" DIR="$dir" node - <<'G'
const fs = require('fs');
const N = Number(process.env.N), S = 37;
fs.mkdirSync('src'); fs.mkdirSync('test'); fs.mkdirSync(process.env.ACCEPT, { recursive: true });
fs.writeFileSync('RATES.md', `# Shared rates\n\nEvery region adds the national SURCHARGE to each quote, after its own multiplier and offset:\n\n    SURCHARGE = ${S}\n\nThe region headers do not repeat it.\n`);
fs.writeFileSync('CHANGELOG.md', '# Changelog\n\n');
const words = 'ledger route parcel depot tariff manifest carrier zone weight volume surcharge invoice'.split(' ');
const spec = [];
let prevQ1 = null;
for (let n = 1; n <= N; n++) {
  const id = String(n).padStart(2, '0'), prev = String(n - 1).padStart(2, '0');
  const mult = 3 + (n % 9), offset = n === 1 ? 97 : prevQ1;
  const offsetDoc = n === 1 ? `//   REGION ${id} OFFSET     = 97`
    : `//   REGION ${id} OFFSET     = the value of quote(1) from region ${prev} (src/m${prev}.mjs) once that module is fixed`;
  const out = [`// Module m${id}: pricing rules for region ${id}.`, '// Reference table (authoritative):',
    `//   REGION ${id} MULTIPLIER = ${mult}`, offsetDoc,
    '// quote(w) must return w * MULTIPLIER + OFFSET, plus the national surcharge (see RATES.md).\n'];
  for (let k = 0; k < 40; k++) {
    const w = words[(n + k) % words.length], w2 = words[(n * 3 + k) % words.length];
    out.push(`/**\n * ${w}${k}: normalises a ${w} figure against the ${w2} baseline for region ${id}.\n * Kept for compatibility with the old ${w2} export; callers should prefer quote().\n * @param {number} x the raw ${w} figure\n * @returns {number} the adjusted figure\n */`);
    out.push(`export function ${w}${k}(x) {\n  const base = ${(k * 13) % 97} + ${n};\n  return Math.round((x + base) * ${(k % 5) + 1}) / ${(k % 3) + 1};\n}\n`);
    if (k === 20) out.push(`// BUG: quote() is wrong; fix it from this file's reference table and RATES.md.\nexport function quote(w) {\n  return w * ${mult + 1} + ${n * 3};\n}\n`);
  }
  fs.writeFileSync(`src/m${id}.mjs`, out.join('\n'));
  spec.push({ id, mult });
  prevQ1 = mult + offset + S;
}
fs.writeFileSync(`${process.env.ACCEPT}/spec.json`, JSON.stringify({ N, S, first: 97, spec }));
// Acceptance: absolute values (the whole chain right).
const lines = []; let off = 97;
for (const { id, mult } of spec) { lines.push(`test('m${id}', async () => { const { quote } = await import('${process.env.DIR}/src/m${id}.mjs'); assert.equal(quote(2), ${2 * mult + off + S}); assert.equal(quote(0), ${off + S}); });`); off = mult + off + S; }
fs.writeFileSync(`${process.env.ACCEPT}/quote.test.mjs`, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${lines.join('\n')}\n`);
fs.writeFileSync('test/helpers.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { ledger0 } from '../src/m12.mjs';\ntest('ledger0 is stable', () => assert.equal(typeof ledger0(1), 'number'));\n");
G
git add -A && git commit -qm 'E5-big start'
def='aos-orch verify --repo . --base {base}'
export QUEUE_OUT="$dir.queue.json" ACCEPT="$dir.accept" N
E5_VERIFY="${E5_VERIFY-$def}" node - <<'Q'
const v = process.env.E5_VERIFY, N = process.env.N, last = String(N).padStart(2, '0');
require('fs').writeFileSync(process.env.QUEUE_OUT, JSON.stringify({
  verify: v === 'null' ? null : v,
  checkTimeoutSec: 600,
  tasks: [{ id: 'fix-quotes', goal: `Each of the ${N} modules src/m01.mjs to src/m${last}.mjs has a bug in quote(), marked with a BUG comment. Fix them in order, m01 first: each module's reference table gives its multiplier and offset (from m02 on, the offset depends on the previous module's fixed quote), and every quote also adds the national surcharge in RATES.md. Make exactly one commit per module, with the message "region NN: fix quote" (NN is the module number, e.g. "region 07: fix quote"), and no other commits. In the same commit, add one line to CHANGELOG.md: "- region NN: quote fixed". Change nothing except quote() and CHANGELOG.md.`, checks: [`node --test ${process.env.ACCEPT}/quote.test.mjs`] }],
}, null, 2) + '\n');
Q
echo "queue written to $QUEUE_OUT and acceptance tests to $ACCEPT (outside the repo)"
echo "E5-big repo ready in $dir"
