#!/usr/bin/env bash
# E6: build fenceline's core from a prompt. The agent gets fenceline's README (the product spec), its package.json and an
# interface sheet (the module paths and export signatures the tests rely on, generated from the real source), but no code.
# fenceline's own tests for the core (glob, fences, compile, hook, cli: ~60 tests) are the hidden finish line, copied
# outside the repo with their paths pointed at the agent's repo. A queue of five tasks in dependency order; earlier tasks'
# tests stay in the finish line. Real aos-orch verify. Owner's suggestion: real, varied work, at a realistic size.
# Usage: experiments/e6-fenceline-setup.sh <empty dir> <fenceline checkout>
set -euo pipefail
dir=${1:?usage: e6-fenceline-setup.sh <empty dir> <fenceline checkout>}
src=$(cd "${2:?fenceline checkout}" && pwd)
mkdir -p "$dir" && cd "$dir"
[ -z "$(ls -A)" ] || { echo "$dir is not empty" >&2; exit 1; }
dir=$(pwd)
git init -q -b main
git config user.email e6@example.com && git config user.name E6
cp "$src/README.md" README.md
SRC="$src" DIR="$dir" ACCEPT="$dir.accept" node - <<'G'
const fs = require('fs'), path = require('path');
const { SRC, DIR, ACCEPT } = process.env;
const pkg = JSON.parse(fs.readFileSync(`${SRC}/package.json`, 'utf8'));
delete pkg.scripts['test:dashboard'];
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
// Interface sheet: every export's signature line from src/, plus the two executables.
const lines = ['# Interface', '', 'Build these modules with these exports (signatures from the design; bodies are yours).',
  'Node 18+, ES modules, no dependencies. `README.md` is the product spec.', ''];
const FULL = process.env.E6_FULL === '1';
const mods = fs.readdirSync(`${SRC}/src`).filter((f) => f.endsWith('.mjs')).sort().map((f) => `src/${f}`);
if (FULL) mods.push('viewer/layout.mjs', 'viewer/server.mjs');
for (const f of mods) {
  lines.push(`## ${f}`, '', '```js');
  for (const l of fs.readFileSync(`${SRC}/${f}`, 'utf8').split('\n')) {
    const m = l.match(/^export (async function|function|const) [^=({]+(\([^)]*\))?/);
    if (m) lines.push(m[0].replace(/\s+$/, '') + (m[1] === 'const' ? ' = ...' : ' { ... }'));
  }
  lines.push('```', '');
}
lines.push('## Executables', '', '- `bin/fenceline.mjs`: the CLI described in the README.',
  '- `hooks/fenceline-hook.mjs`: the Claude Code hook. It reads one hook payload (JSON) on stdin, writes any decision as JSON on stdout,',
  '  and records the session trail under `$FENCELINE_HOME` (default `~/.fenceline`).',
  ...(FULL ? ['- `viewer/scope/template.html`, `viewer/scope/scope.css`, `viewer/scope/scope.js`: the self-contained scope map page that `fenceline scope` writes.'] : []), '');
fs.writeFileSync('INTERFACE.md', lines.join('\n'));
fs.mkdirSync('test');
fs.writeFileSync('test/smoke.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('package.json names fenceline', async () => { const fs = await import('node:fs'); assert.equal(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).name, 'fenceline'); });\n");
// Hidden tests, pointed at the agent's repo.
fs.mkdirSync(`${ACCEPT}/test`, { recursive: true });
if (FULL) fs.cpSync(`${SRC}/test/fixtures`, `${ACCEPT}/fixtures`, { recursive: true });
for (const t of ['glob', 'fences', 'compile', 'hook', 'cli', ...(FULL ? ['scope', 'viewer-layout', 'viewer-server'] : [])]) {
  let s = fs.readFileSync(`${SRC}/test/${t}.test.mjs`, 'utf8');
  s = s.replaceAll("path.join(ROOT, 'test', 'fixtures', 'scope')", JSON.stringify(`${ACCEPT}/fixtures/scope`))
    .replaceAll("'../src/", `'${DIR}/src/`).replaceAll("'../viewer/", `'${DIR}/viewer/`)
    .replaceAll("path.dirname(fileURLToPath(import.meta.url)), '..'", JSON.stringify(DIR))
    .replaceAll("path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'", `path.resolve(${JSON.stringify(DIR)}`);
  fs.writeFileSync(`${ACCEPT}/test/${t}.test.mjs`, s);
}
G
git add -A && git commit -qm 'E6 start: spec only'
def='aos-orch verify --repo . --base {base}'
export QUEUE_OUT="$dir.queue.json" ACCEPT="$dir.accept"
E6_VERIFY="${E6_VERIFY-$def}" node - <<'Q'
const v = process.env.E6_VERIFY, A = process.env.ACCEPT;
// Each repo's checks get their own TMPDIR: fenceline's hook test asserts that $TMPDIR/fl-never/... does not exist, and in
// parallel trials sharing /tmp another trial's hook created it (E6 D-4 blocked on that alone, with correct code).
const t = (id, goal, tests) => ({ id, goal, checks: tests.map((x) => ({ name: `fenceline ${x} tests`, run: `mkdir -p ${A}/tmp && TMPDIR=${A}/tmp node --test ${A}/test/${x}.test.mjs`, timeoutSec: 300 })) });
require('fs').writeFileSync(process.env.QUEUE_OUT, JSON.stringify({
  verify: v === 'null' ? null : v,
  checkTimeoutSec: 600,
  tasks: [
    t('glob', 'You are building fenceline from its spec: README.md is the product, INTERFACE.md lists the modules and exports. Start with src/glob.mjs: globToRegExp and matchGlob (and matchAny), the gitignore-style path matching that fences use. Commit when done.', ['glob']),
    t('fences', 'Next, src/fences.mjs as in INTERFACE.md: the fences file format and validation, crossings (which fences a file operation crosses), the preview, and finding the files a shell command writes (bashWriteTargets and its helpers). Use src/glob.mjs. Commit when done.', ['fences']),
    t('compile', 'Next, src/compile.mjs: turning plain-English fence sentences into fences with an LLM, as the README describes. The LLM call must be injectable (an llm option), with a default that runs one tool-less `claude -p` call. Commit when done.', ['compile']),
    t('hook', 'Next, the Claude Code hook: hooks/fenceline-hook.mjs, with src/session.mjs and src/trail.mjs as in INTERFACE.md. It warns or blocks according to each fence\'s mode, protects the fences file itself, records the session trail (events) under $FENCELINE_HOME, and notices writes made through Bash. Commit when done.', ['hook']),
    t('cli', `${process.env.E6_FULL === '1' ? 'Next' : 'Finally'}, the CLI: bin/fenceline.mjs, with the commands the README describes for proposing, reviewing and saving fences. Commit when done.`, ['cli']),
    ...(process.env.E6_FULL === '1' ? [
      t('scope', 'Next, the scope map: src/scope.mjs as in INTERFACE.md, the `fenceline scope` command, and the self-contained page under viewer/scope/ (template.html, scope.css, scope.js), as the README\'s "Scope map" section describes. Commit when done.', ['scope']),
      t('viewer', 'Finally, the live dashboard viewer: viewer/layout.mjs and viewer/server.mjs as in INTERFACE.md, serving viewer/index.html, as the README\'s dashboard section describes. Commit when done.', ['viewer-layout', 'viewer-server']),
    ] : []),
  ],
}, null, 2) + '\n');
Q
echo "queue written to $QUEUE_OUT and fenceline's tests to $dir.accept (outside the repo)"
echo "E6 repo ready in $dir"
