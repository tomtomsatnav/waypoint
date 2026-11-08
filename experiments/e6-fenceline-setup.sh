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
# The hidden tests and the queue live in a random folder away from the repo, and the queue tells waypoint to redact that
# path from everything the agent sees. (Before this, every Haiku run found <repo>.accept next to the repo and read the tests.)
# E6_HIDDEN_ROOT overrides where the random folder goes. Its path is printed last ("hidden: <path>") for the harness and
# written nowhere the agent can browse.
hidden=$(mktemp -d "${E6_HIDDEN_ROOT:-/tmp}/wp-hidden-XXXXXXXX")
SRC="$src" DIR="$dir" ACCEPT="$hidden/accept" node - <<'G'
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
  // E6_DOCS=1 (the default) keeps the doc comment written directly above each export: the contract as a design document
  // would state it (return shapes, op names, what null means), with no bodies. With the hidden tests really hidden, names
  // and signatures alone left every model guessing the fences contract (Haiku 34/110, Sonnet 40/110, both stuck on fences).
  const src = fs.readFileSync(`${SRC}/${f}`, 'utf8').split('\n');
  for (let i = 0; i < src.length; i++) {
    const m = src[i].match(/^export (async function|function|const) [^=({]+(\([^)]*\))?/);
    if (!m) continue;
    if (process.env.E6_DOCS !== '0') {
      let j = i - 1; const doc = [];
      if (/\*\/\s*$/.test(src[j] || '')) { while (j >= 0 && !/^\s*\/\*\*/.test(src[j])) doc.unshift(src[j--]); if (j >= 0) doc.unshift(src[j]); }
      else while (j >= 0 && /^\s*\/\/ /.test(src[j])) doc.unshift(src[j--]);
      if (doc.length) lines.push(...doc);
    }
    lines.push(m[0].replace(/\s+$/, '') + (m[1] === 'const' ? ' = ...' : ' { ... }'));
  }
  lines.push('```', '');
}
lines.push('## Executables', '', '- `bin/fenceline.mjs`: the CLI described in the README.',
  '- `hooks/fenceline-hook.mjs`: the Claude Code hook. It reads one hook payload (JSON) on stdin, writes any decision as JSON on stdout,',
  '  and records the session trail under `$FENCELINE_HOME` (default `~/.fenceline`).',
  ...(FULL ? ['- `viewer/scope/template.html`, `viewer/scope/scope.css`, `viewer/scope/scope.js`: the self-contained scope map page that `fenceline scope` writes.'] : []), '');
fs.writeFileSync('INTERFACE.md', lines.join('\n'));
// Data assets the full build's tests need and no agent could invent: the fonts the scope page embeds and the demo
// recording the viewer lists. Given in the starting repo (the earlier E7 runs copied them from fenceline's tests instead).
if (FULL) {
  fs.mkdirSync('dashboard/ui/fonts', { recursive: true });
  for (const f of fs.readdirSync(`${SRC}/dashboard/ui/fonts`)) fs.copyFileSync(`${SRC}/dashboard/ui/fonts/${f}`, `dashboard/ui/fonts/${f}`);
  fs.cpSync(`${SRC}/recordings`, 'recordings', { recursive: true });
  fs.appendFileSync('INTERFACE.md', '\n## Assets provided\n\n- `dashboard/ui/fonts/*.woff2`: the fonts the scope page embeds (base64, from this folder).\n- `recordings/`: a demo session recording the viewer lists.\n');
}
fs.mkdirSync('test');
fs.writeFileSync('test/smoke.test.mjs', "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('package.json names fenceline', async () => { const fs = await import('node:fs'); assert.equal(JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).name, 'fenceline'); });\n");
// E6_TESTS=staged: fenceline's original tests (unchanged) wait in <hidden>/staged and each task's prepare copies its tests into
// the repo's test/ and commits them as waypoint, so the agent works against tests it can read and verify protects them.
// This is the realistic case (a ticket arrives with its tests); with tests fully hidden, fenceline's tests encode details
// its spec does not state (e.g. a whitespace-only glob must throw), and every model ended up guessing.
if (process.env.E6_TESTS === 'staged') {
  fs.mkdirSync(`${ACCEPT}/../staged/test`, { recursive: true });
  for (const t of ['glob', 'fences', 'compile', 'hook', 'cli', ...(FULL ? ['scope', 'viewer-layout', 'viewer-server'] : [])])
    fs.copyFileSync(`${SRC}/test/${t}.test.mjs`, `${ACCEPT}/../staged/test/${t}.test.mjs`);
  if (FULL) fs.cpSync(`${SRC}/test/fixtures`, `${ACCEPT}/../staged/test/fixtures`, { recursive: true });
}
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
export QUEUE_OUT="$hidden/queue.json" ACCEPT="$hidden/accept" HIDDEN="$hidden"
E6_VERIFY="${E6_VERIFY-$def}" node - <<'Q'
const v = process.env.E6_VERIFY, A = process.env.ACCEPT;
// Each repo's checks get their own TMPDIR: fenceline's hook test asserts that $TMPDIR/fl-never/... does not exist, and in
// parallel trials sharing /tmp another trial's hook created it (E6 D-4 blocked on that alone, with correct code).
const STAGED = process.env.E6_TESTS === 'staged', SG = `${process.env.HIDDEN}/staged/test`;
const t = (id, goal, tests) => STAGED
  ? { id, goal: `${goal} This task's tests are in test/ (${tests.map((x) => `${x}.test.mjs`).join(', ')}); make them pass without changing them.`,
      prepare: `mkdir -p test && ${tests.map((x) => `cp ${SG}/${x}.test.mjs test/`).join(' && ')}${tests.includes('scope') ? ` && cp -r ${SG}/fixtures test/` : ''}`,
      checks: tests.map((x) => ({ name: `fenceline ${x} tests`, run: `mkdir -p ${A}/tmp && TMPDIR=${A}/tmp node --test test/${x}.test.mjs`, timeoutSec: 300 })) }
  : { id, goal, checks: tests.map((x) => ({ name: `fenceline ${x} tests`, run: `mkdir -p ${A}/tmp && TMPDIR=${A}/tmp node --test ${A}/test/${x}.test.mjs`, timeoutSec: 300 })) };
require('fs').writeFileSync(process.env.QUEUE_OUT, JSON.stringify({
  verify: v === 'null' ? null : v,
  checkTimeoutSec: 600,
  redact: [process.env.HIDDEN],
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
echo "queue written to $QUEUE_OUT and fenceline's tests to $hidden/accept (random folder, redacted from check output)"
echo "E6 repo ready in $dir"
echo "hidden: $hidden"
