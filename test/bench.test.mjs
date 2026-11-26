import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './helpers.mjs';
import { accept, runOne, prepareRepo, loadSuite } from '../lib/bench.mjs';

const SOLUTIONS = join(ROOT, 'test', 'fixtures', 'bench-solutions');
const WEB = new Set(['todo', 'game', 'form', 'dashboard']);
let browser = true; try { createRequire(import.meta.url)('playwright'); } catch { browser = false; }

// The acceptance checks are fair: a good build (the reference solution) passes every one, and the starting point does not.
for (const { id } of loadSuite().briefs) {
  test(`bench ${id}: the reference solution passes every check; the starting repo fails most`, { skip: WEB.has(id) && !browser && 'needs Playwright', timeout: 300000 }, () => {
    assert.ok(existsSync(join(SOLUTIONS, id)), `no reference solution for ${id}`);
    const good = accept(id, join(SOLUTIONS, id));
    assert.equal(good.passed, good.total, `failing: ${good.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join(' | ')}`);
    const start = prepareRepo(id, join(mkdtempSync(join(tmpdir(), 'bench-start-')), id));
    const bad = accept(id, start);
    assert.ok(bad.passed <= bad.total / 2, `${bad.passed}/${bad.total} pass on the starting repo`);
  });
}

test('bench: one run end to end (stand-in claude): research, build, acceptance, metrics', { timeout: 120000 }, async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'bench-run-'));
  process.env.FAKE_SOLUTION = join(SOLUTIONS, 'cli');
  try {
    const r = await runOne({ id: 'cli', waypointDir: ROOT, outDir, claude: join(ROOT, 'test', 'fake-bench-claude.mjs'), budgetUsd: 2, minutes: 2 });
    assert.equal(r.score, 1, JSON.stringify(r.failures));
    assert.equal(r.engine, 'build'); assert.equal(r.end, 'stopped by itself');
    assert.equal(r.costUsd, 0.5); assert.equal(r.turns, 8); assert.equal(r.tokens, 2300);
    assert.ok(existsSync(join(r.repo, 'EXPECTATIONS.md')));
    assert.ok(readdirSync(outDir).includes('cli-r1.json'));
  } finally { delete process.env.FAKE_SOLUTION; }
});
