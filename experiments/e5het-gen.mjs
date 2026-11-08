#!/usr/bin/env node
// Generate an E5-het repo's files in the current directory. Usage: e5het-gen.mjs <accept dir> <repo dir> [N] [seed]
import fs from 'node:fs';
import { CHAIN_INPUT, KINDS, NAMES, bodySrc, correctFn, paramsFor, rng, ruleProse, testInputs } from './e5het-lib.mjs';

const [accept, repoDir, nArg, seedArg] = process.argv.slice(2);
const N = Number(nArg || 40), rnd = rng(Number(seedArg || 1));
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
fs.mkdirSync('src'); fs.mkdirSync('test'); fs.mkdirSync(accept, { recursive: true });
fs.writeFileSync('CHANGELOG.md', '# Changelog\n\n');

// About 6 decoys (correct code under a "suspected bug" comment), never m01.
const decoys = new Set();
while (decoys.size < Math.round(N * 0.15)) decoys.add(int(2, N));
const words = 'ledger route parcel depot tariff manifest carrier zone weight volume surcharge invoice'.split(' ');
const spec = [];
let K = 97, prev = null;
for (let n = 1; n <= N; n++) {
  const id = String(n).padStart(2, '0');
  const kind = KINDS[int(0, KINDS.length - 1)], p = paramsFor(kind, rnd), name = `${NAMES[int(0, NAMES.length - 1)]}${id}`;
  const decoy = decoys.has(n), v = int(0, 2);
  const kProse = n === 1 ? 'The region constant is 97.'
    : `The region constant is the value that ${prev.name}() in src/m${prev.id}.mjs returns for input ${CHAIN_INPUT}, once that function is correct.`;
  const header = [`// Module m${id}: pricing rules for region ${id}.`, `// ${name}(x): ${ruleProse(kind, p, v)}`,
    `// Then add the region constant. ${kProse}`, '// The rule above is authoritative; the code may not follow it.\n'];
  const target = `// BUG? A reviewer suspects ${name}() does not follow the rule at the top of this file. Check it.\nexport function ${name}(x) {\n  const regionConstant = ${decoy ? K : 0};\n  ${bodySrc(kind, p, !decoy)}\n}\n`;
  const at = int(8, 50), parts = [...header];
  for (let k = 0; k < 56; k++) {
    if (k === at) parts.push(target);
    const w = words[(n + k) % words.length], w2 = words[(n * 3 + k) % words.length];
    parts.push(`/**\n * ${w}${k}: normalises a ${w} figure against the ${w2} baseline for region ${id}.\n * Kept for compatibility with the old ${w2} export; callers should prefer ${name}().\n * @param {number} x the raw ${w} figure\n * @returns {number} the adjusted figure\n */`);
    parts.push(`export function ${w}${k}(x) {\n  const base = ${(k * 13) % 97} + ${n};\n  return Math.round((x + base) * ${(k % 5) + 1}) / ${(k % 3) + 1};\n}\n`);
  }
  fs.writeFileSync(`src/m${id}.mjs`, parts.join('\n'));
  spec.push({ id, name, kind, p, decoy, K });
  prev = { id, name };
  K = correctFn(kind, p, K)(CHAIN_INPUT);
}
fs.writeFileSync(`${accept}/spec.json`, JSON.stringify({ N, spec }, null, 1));
const tests = spec.map(({ id, name, kind, p, K: k }) => {
  const f = correctFn(kind, p, k);
  return `test('m${id}', async () => { const m = await import('${repoDir}/src/m${id}.mjs'); ${testInputs(kind, p).map((x) => `assert.equal(m.${name}(${x}), ${f(x)}, '${name}(${x})');`).join(' ')} });`;
});
fs.writeFileSync(`${accept}/acceptance.test.mjs`, `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n${tests.join('\n')}\n`);
fs.writeFileSync('test/helpers.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport * as m from '../src/m01.mjs';\ntest('helpers are numbers', () => assert.equal(typeof Object.values(m)[1](1), 'number'));\n");
console.log(JSON.stringify({ N, decoys: [...decoys].sort((a, b) => a - b), kinds: spec.map((s) => s.kind) }));
