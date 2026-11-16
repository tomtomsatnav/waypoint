#!/usr/bin/env bash
# E3: re-anchor vs plain compaction. One task over ten ~12 KB modules, each with one bug whose fix needs a constant
# documented in that file's header, so the agent has to read every file. Run with compaction forced early
# (--autocompact 100000 --autocompact-pct 30), arm A with --no-anchor, arm B without; compare `waypoint drift`.
# Usage: experiments/e3-setup.sh <empty dir>
set -euo pipefail
dir=${1:?usage: e3-setup.sh <empty dir>}
mkdir -p "$dir" && cd "$dir"
[ -z "$(ls -A)" ] || { echo "$dir is not empty" >&2; exit 1; }
git init -q -b main
git config user.email e3@example.com && git config user.name E3
node - <<'G'
const fs = require('fs');
fs.mkdirSync('src'); fs.mkdirSync('test');
const words = 'ledger route parcel depot tariff manifest carrier zone weight volume surcharge invoice'.split(' ');
const tests = [];
for (let n = 1; n <= 10; n++) {
  const id = String(n).padStart(2, '0');
  const mult = 7 + n * 3, offset = 100 + n * 11;
  const out = [];
  out.push(`// Module m${id}: pricing rules for region ${id}.`);
  out.push(`// Reference table (authoritative):`);
  out.push(`//   REGION ${id} MULTIPLIER = ${mult}`);
  out.push(`//   REGION ${id} OFFSET     = ${offset}`);
  out.push(`// quote(w) must return w * MULTIPLIER + OFFSET for this region.\n`);
  for (let k = 0; k < 40; k++) {
    const w = words[(n + k) % words.length], w2 = words[(n * 3 + k) % words.length];
    out.push(`/**\n * ${w}${k}: normalises a ${w} figure against the ${w2} baseline for region ${id}.\n * Kept for compatibility with the old ${w2} export; callers should prefer quote().\n * @param {number} x the raw ${w} figure\n * @returns {number} the adjusted figure\n */`);
    out.push(`export function ${w}${k}(x) {\n  const base = ${(k * 13) % 97} + ${n};\n  return Math.round((x + base) * ${(k % 5) + 1}) / ${(k % 3) + 1};\n}\n`);
    if (k === 20) out.push(`// BUG: quote() uses the wrong multiplier and offset; fix it using this file's reference table.\nexport function quote(w) {\n  return w * ${mult + 1} + ${offset - 5};\n}\n`);
  }
  fs.writeFileSync(`src/m${id}.mjs`, out.join('\n'));
  tests.push(`test('m${id}', async () => { const { quote } = await import('../src/m${id}.mjs'); assert.equal(quote(2), ${2 * mult + offset}); assert.equal(quote(0), ${offset}); });`);
}
fs.writeFileSync('test/quote.test.mjs', `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${tests.join('\n')}\n`);
G
git add -A && git commit -qm 'E3 start'
def='aos-orch verify --repo . --base {base}'
export QUEUE_OUT="$(cd .. && pwd)/$(basename "$PWD").queue.json"
E3_VERIFY="${E3_VERIFY-$def}" node - <<'Q'
const v = process.env.E3_VERIFY;
require('fs').writeFileSync(process.env.QUEUE_OUT, JSON.stringify({
  verify: v === 'null' ? null : v,
  tasks: [{ id: 'fix-quotes', goal: 'Each of the ten modules src/m01.mjs to src/m10.mjs has a bug in quote(), marked with a BUG comment. Fix each one using the reference table at the top of that file. Read each file before changing it, and commit after fixing each module (one commit per module).', checks: ['node --test test/*.test.mjs'] }],
}, null, 2) + '\n');
Q
echo "queue written to $QUEUE_OUT (outside the repo, so the agent cannot read the checks)"
echo "E3 repo ready in $dir"
