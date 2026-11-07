// Reads Claude Code session transcripts (<config dir>/projects/<cwd with non-alphanumerics as '-'>/<session>.jsonl).
// Two uses: context size (for caps) and drift metrics after compaction (problem 1, experiment E3).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function transcriptPath(configDir, cwd, sessionId) {
  return join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
}

export function parseJsonl(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a partly written last line is normal while a session runs */ }
  }
  return out;
}

export function readTranscript(path) { return parseJsonl(readFileSync(path, 'utf8')); }

export function usageTokens(u) {
  if (!u) return 0;
  return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
}

// Context size = input + cache creation + cache read tokens on the latest main-chain assistant record.
export function contextSize(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.type === 'assistant' && !r.isSidechain && r.message?.usage) return usageTokens(r.message.usage);
  }
  return 0;
}

export function isCompactBoundary(r) { return r.type === 'system' && r.subtype === 'compact_boundary'; }

const READ_TOOLS = new Set(['Read']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function toolUses(r) {
  if (r.type !== 'assistant' || r.isSidechain) return [];
  const c = r.message?.content;
  return Array.isArray(c) ? c.filter((b) => b.type === 'tool_use') : [];
}

function filePathOf(input) { return input?.file_path || input?.notebook_path || null; }

// After each compaction, how much of the earlier work did the agent repeat?
// reReads: Read calls on files already read before that compaction. reEdits: edits to files already edited before it.
// A re-edit is not always wrong (a later fix), so treat both as proxies and compare arms, not absolute values.
export function driftMetrics(records) {
  const read = new Set();
  const edited = new Set();
  const segments = [];
  let seg = null;
  let toolCalls = 0;
  for (const r of records) {
    if (isCompactBoundary(r)) {
      seg = {
        trigger: r.compactMetadata?.trigger ?? null,
        preTokens: r.compactMetadata?.preTokens ?? null,
        postTokens: r.compactMetadata?.postTokens ?? null,
        readBefore: new Set(read), editedBefore: new Set(edited),
        toolCalls: 0, reReads: 0, reEdits: 0, reReadFiles: new Set(), reEditFiles: new Set(),
      };
      segments.push(seg);
      continue;
    }
    for (const tu of toolUses(r)) {
      toolCalls++;
      const fp = filePathOf(tu.input);
      if (seg) {
        seg.toolCalls++;
        if (fp && READ_TOOLS.has(tu.name) && seg.readBefore.has(fp)) { seg.reReads++; seg.reReadFiles.add(fp); }
        if (fp && EDIT_TOOLS.has(tu.name) && seg.editedBefore.has(fp)) { seg.reEdits++; seg.reEditFiles.add(fp); }
      }
      if (fp && READ_TOOLS.has(tu.name)) read.add(fp);
      if (fp && EDIT_TOOLS.has(tu.name)) edited.add(fp);
    }
  }
  const compactions = segments.map((s) => ({
    trigger: s.trigger, preTokens: s.preTokens, postTokens: s.postTokens,
    toolCallsAfter: s.toolCalls, reReads: s.reReads, reEdits: s.reEdits,
    reReadFiles: [...s.reReadFiles].sort(), reEditFiles: [...s.reEditFiles].sort(),
  }));
  return {
    toolCalls,
    compactions,
    reReads: compactions.reduce((a, c) => a + c.reReads, 0),
    reEdits: compactions.reduce((a, c) => a + c.reEdits, 0),
  };
}
