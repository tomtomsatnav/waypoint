import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';
import { promptCases } from './prompt-cases.mjs';

test('every prompt is word for word what it was before the prompts moved into prompts/', () => {
  const want = JSON.parse(readFileSync(join(ROOT, 'test', 'fixtures', 'prompt-snapshot.json'), 'utf8'));
  const got = promptCases();
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
  for (const k of Object.keys(want)) assert.equal(got[k], want[k], `prompt ${k} changed`);
});

test('prompt templates: values, sections, includes; inserted text is never read as a template', async () => {
  const { fill } = await import('../lib/prompts.mjs');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'wp-prompts-'));
  writeFileSync(join(dir, 'part.md'), 'part {{x}}\n');
  assert.equal(fill('a {{x}} {{#on}}yes {{x}}{{/on}}{{^on}}no{{/on}} [{{>part}}]', { x: '{{y}}', on: false }, dir), 'a {{y}} no [part {{y}}]');
  assert.equal(fill('{{#a}}A{{#b}}B{{/b}}{{/a}}', { a: 1, b: 0 }), 'A');
  assert.throws(() => fill('{{missing}}', {}), /missing/);
  assert.throws(() => fill('{{#open}}x', { open: 1 }), /not closed/);
});
