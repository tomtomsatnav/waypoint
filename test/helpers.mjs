import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Hermetic: never touch a live run's state, whatever this process inherited (an agent running waypoint's tests under waypoint).
delete process.env.WAYPOINT_DIR;

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FAKE = join(ROOT, 'test', 'fake-claude.mjs');
export const BIN = join(ROOT, 'bin', 'waypoint.mjs');

export function sh(cwd, cmd) {
  return execFileSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' }).trim();
}

// A throwaway repo with a tiny maths module. Each task makes one function exist; its check calls it.
export function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'waypoint-test-'));
  sh(dir, 'git init -q -b main && git config user.email t@example.com && git config user.name Test');
  writeFileSync(join(dir, 'maths.mjs'), 'export const zero = 0;\n');
  writeFileSync(join(dir, 'check.mjs'), [
    "const m = await import('./maths.mjs?' + Date.now());",
    "const [fn, a, b, want] = process.argv.slice(2);",
    "if (typeof m[fn] !== 'function') { console.log(`${fn} is missing`); process.exit(1); }",
    "const got = m[fn](Number(a), Number(b));",
    "if (got !== Number(want)) { console.log(`${fn}(${a}, ${b}) = ${got}, want ${want}`); process.exit(1); }",
    "console.log('ok');",
  ].join('\n') + '\n');
  sh(dir, 'git add -A && git commit -qm start');
  return dir;
}

export function writeQueue(dir, tasks, extra = {}) {
  const p = join(dir, 'queue.json');
  writeFileSync(p, JSON.stringify({ verify: null, ...extra, tasks }, null, 2));
  return p;
}

export function addFn(name, body) {
  return `echo 'export function ${name}(a, b) { ${body} }' >> maths.mjs && git add -A && git commit -qm "${name}"`;
}

export function writeScript(dir, steps) {
  const p = join(dir, `script-${Math.random().toString(36).slice(2)}.json`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ steps }));
  return p;
}

export const TASKS = [
  { id: 'add', goal: 'Add an exported function add(a, b) to maths.mjs.', checks: ['node check.mjs add 2 3 5'] },
  { id: 'sub', goal: 'Add an exported function sub(a, b) to maths.mjs.', checks: ['node check.mjs sub 5 3 2'] },
  { id: 'mul', goal: 'Add an exported function mul(a, b) to maths.mjs.', checks: ['node check.mjs mul 4 3 12'] },
];
