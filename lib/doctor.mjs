// `waypoint doctor`: checks the tools waypoint needs. Only looks executables up on PATH; never runs them,
// so it cannot start a session or spend anything.
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// First executable called `name` on PATH (or at `name` itself if it contains a slash), else null.
export function findExecutable(name, env = process.env) {
  const candidates = name.includes('/') ? [name] : (env.PATH || '').split(delimiter).filter(Boolean).map((d) => join(d, name));
  for (const p of candidates) {
    try {
      if (statSync(p).isFile()) { accessSync(p, constants.X_OK); return p; }
    } catch { /* not here */ }
  }
  return null;
}

// Returns { lines, ok }: one line per tool, ok when every tool is present.
export function doctor(env = process.env) {
  const checks = [
    { name: 'node', found: () => process.execPath, detail: () => `${process.version}`,
      missing: 'install Node 18 or later (https://nodejs.org)' },
    { name: 'git', found: () => findExecutable('git', env),
      missing: 'install git (apt-get install git, or https://git-scm.com)' },
    { name: 'claude', found: () => findExecutable(env.WAYPOINT_CLAUDE || 'claude', env),
      missing: 'install Claude Code (https://claude.com/claude-code), or point WAYPOINT_CLAUDE at the binary' },
    { name: 'aos-orch', found: () => findExecutable('aos-orch', env),
      missing: 'run scripts/install-aos-orch.sh (installs the pinned aos-orch, the finish line\'s verify guard)' },
    { name: 'bwrap', found: () => findExecutable('bwrap', env),
      missing: 'install bubblewrap (apt-get install bubblewrap): aos-orch verify fails closed without it on Linux' },
  ];
  const lines = [];
  let ok = true;
  for (const c of checks) {
    const where = c.found();
    if (where) lines.push(`ok ${c.name} ${c.detail ? c.detail() : where}`);
    else { ok = false; lines.push(`missing ${c.name} ${c.missing}`); }
  }
  return { lines, ok };
}
