import { execFileSync } from 'node:child_process';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

export function head(cwd) {
  try { return git(cwd, ['rev-parse', 'HEAD']); } catch { return null; }
}

export function logSince(cwd, base) {
  if (!base) return '';
  try { return git(cwd, ['log', '--oneline', '--no-decorate', `${base}..HEAD`]); } catch { return '(git log failed)'; }
}

export function statusShort(cwd) {
  try { return git(cwd, ['status', '--short']); } catch { return '(git status failed)'; }
}
