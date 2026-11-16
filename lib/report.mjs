// `waypoint report`: a short readable summary of a run report (report.json, as written by the runner).
import { readFileSync } from 'node:fs';

export function readReport(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { throw new Error(`report: cannot read ${path} (${e.code ?? 'unreadable'})`); }
  try { return JSON.parse(text); } catch { throw new Error(`report: ${path} is not valid JSON`); }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formatReport(r) {
  const lines = [
    `outcome: ${r.outcome}`,
    `model: ${r.config?.model ?? 'unknown'}`,
    `cost: $${(r.costUsd ?? 0).toFixed(2)}`,
    `wall clock: ${((r.wallClockSec ?? 0) / 60).toFixed(1)} min`,
    `stop attempts: ${r.stopAttempts ?? 0}`,
  ];
  for (const t of r.tasks ?? []) lines.push(`task ${t.id}: ${t.status} (${plural(t.blocks ?? 0, 'block')})`);
  for (const s of r.sessions ?? []) {
    lines.push(`session ${s.label}: $${(s.costUsd ?? 0).toFixed(2)}, peak context ${Math.round((s.maxContext ?? 0) / 1000)}k`);
  }
  return lines.join('\n') + '\n';
}
