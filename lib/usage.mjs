// Plan usage, read from Claude Code's own rate_limit_event records (stream-json), and the pacing decisions built on it.
// Each event carries unifiedWindows: { five_hour: {utilization, resetsAt, status}, seven_day: {...} } plus an overall status
// (allowed | allowed_warning | rejected). Seen on every session in this project's runs (2.1.319, a subscription account).

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Normalise one rate_limit_info object.
export function parseUsage(info, at = Date.now()) {
  if (!info) return null;
  const w = info.unifiedWindows || {};
  const win = (x) => (x ? { util: Number(x.utilization ?? 0), resetsAt: Number(x.resetsAt ?? 0) * 1000, status: x.status || 'allowed' } : null);
  return { at, status: info.status || 'allowed', fiveHour: win(w.five_hour), sevenDay: win(w.seven_day), overage: info.overageStatus ?? null };
}

// The latest usage seen in any of these stream-json logs (by record order within the newest file).
export function usageFromLogs(paths) {
  let best = null;
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limit_event"')) continue;
      try { const r = JSON.parse(lines[i]); const u = parseUsage(r.rate_limit_info); if (u) { u.source = p; if (!best || u.fiveHour?.resetsAt >= (best.fiveHour?.resetsAt ?? 0)) best = u; } } catch { /* partial line */ }
      break;
    }
  }
  return best;
}

// Ask Claude Code for the current usage with the cheapest possible call (one Haiku word; ~$0.0003).
export function probeUsage({ claude = 'claude', env = process.env, configDir } = {}) {
  const e = { ...env }; for (const k of Object.keys(e)) if (/^CLAUDE/.test(k) && k !== 'CLAUDE_CONFIG_DIR') delete e[k];
  if (configDir) e.CLAUDE_CONFIG_DIR = configDir;
  const r = spawnSync(claude, ['-p', 'Reply with the single word ok.', '--model', 'haiku', '--max-budget-usd', '0.02', '--strict-mcp-config', '--tools', '',
    '--output-format', 'stream-json', '--verbose', '--no-session-persistence'], { encoding: 'utf8', env: e, input: '', timeout: 120000 });
  for (const l of String(r.stdout || '').split('\n')) { try { const x = JSON.parse(l); if (x.type === 'rate_limit_event') return parseUsage(x.rate_limit_info); } catch { /* not JSON */ } }
  return null;
}

// What to do now, given the latest usage and a policy:
//   { weeklyCeiling: 0.85, fiveHourCeiling: 0.9, maxWorkers: 3, paceFrom: {at, util} (the 7-day utilisation when the run started) }
// Returns { action: 'run' | 'wait', untilMs?, reason, workers }.
// - any window rejected, or a window over its ceiling: wait for that window's reset (plus a minute).
// - weekly pacing: spread what is left of the weekly ceiling evenly until the weekly reset; ahead of that line, run one worker.
// - workers: more headroom in the 5-hour window allows more parallel workers.
export function decide(usage, policy = {}, now = Date.now()) {
  const p = { weeklyCeiling: 0.85, fiveHourCeiling: 0.9, maxWorkers: 3, ...policy };
  if (!usage) return { action: 'run', workers: 1, reason: 'no usage data yet: one worker until the first report' };
  const wait = (w, why) => ({ action: 'wait', untilMs: Math.max(now + 60000, (w?.resetsAt || now + 3600000) + 60000), reason: why, workers: 0 });
  if (usage.status === 'rejected' || usage.fiveHour?.status === 'rejected') return wait(usage.fiveHour, 'usage limit reached: waiting for the 5-hour reset');
  if (usage.sevenDay?.status === 'rejected') return wait(usage.sevenDay, 'weekly limit reached: waiting for the weekly reset');
  if ((usage.sevenDay?.util ?? 0) >= p.weeklyCeiling) return wait(usage.sevenDay, `weekly usage ${(usage.sevenDay.util * 100).toFixed(0)}% is at the ceiling (${p.weeklyCeiling * 100}%)`);
  if ((usage.fiveHour?.util ?? 0) >= p.fiveHourCeiling) return wait(usage.fiveHour, `5-hour usage ${(usage.fiveHour.util * 100).toFixed(0)}% is at the ceiling`);
  const head5 = p.fiveHourCeiling - (usage.fiveHour?.util ?? 0);
  let workers = Math.max(1, Math.min(p.maxWorkers, head5 > 0.6 ? 3 : head5 > 0.3 ? 2 : 1));
  let reason = `5-hour ${(100 * (usage.fiveHour?.util ?? 0)).toFixed(0)}%, weekly ${(100 * (usage.sevenDay?.util ?? 0)).toFixed(0)}%`;
  if (p.paceFrom && usage.sevenDay?.resetsAt > p.paceFrom.at) {
    const span = usage.sevenDay.resetsAt - p.paceFrom.at;
    const target = p.paceFrom.util + (p.weeklyCeiling - p.paceFrom.util) * Math.min(1, (now - p.paceFrom.at) / span);
    if (usage.sevenDay.util > target + 0.03) { workers = 1; reason += `; ahead of the weekly pace (${(100 * target).toFixed(0)}% planned by now): one worker`; }
  }
  return { action: 'run', workers, reason };
}
