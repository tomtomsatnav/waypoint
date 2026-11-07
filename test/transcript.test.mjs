import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { contextSize, driftMetrics, readTranscript, transcriptPath } from '../lib/transcript.mjs';
import { ROOT } from './helpers.mjs';

const fixture = readTranscript(join(ROOT, 'test', 'fixtures', 'compacted-session.jsonl'));

test('drift metrics count re-reads and re-edits after each compaction', () => {
  const m = driftMetrics(fixture);
  assert.equal(m.compactions.length, 1);
  const c = m.compactions[0];
  assert.equal(c.trigger, 'auto');
  assert.equal(c.preTokens, 81234);
  assert.equal(c.reReads, 3);                         // a.js twice and b.js once, all read before the compaction
  assert.deepEqual(c.reReadFiles, ['/r/a.js', '/r/b.js']);
  assert.equal(c.reEdits, 1);                         // a.js was already edited
  assert.equal(c.toolCallsAfter, 6);                  // the sidechain tool call is not counted
  assert.equal(m.toolCalls, 10);
});

test('context size uses the latest main-chain assistant record, ignoring sidechains', () => {
  assert.equal(contextSize(fixture), 1200 + 300 + 30000);
});

test('transcript path follows Claude Code\'s project directory naming', () => {
  assert.equal(transcriptPath('/c', '/home/user/my.repo', 's1'), '/c/projects/-home-user-my-repo/s1.jsonl');
});
