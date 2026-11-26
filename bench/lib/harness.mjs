// Helpers for the benchmark's acceptance checks. Each bench/<id>/accept.mjs is run as
//   node accept.mjs <built repo>
// outside the repo it checks (the builder never sees it), and prints one line of JSON: { "checks": [ { name, ok, detail } ] }.
// Every check is independent, so a build that does half the job gets half the marks.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname, resolve, delimiter } from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';

export function ok(cond, msg) { if (!cond) throw new Error(msg); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// total: how many checks the brief has, so a build that fails before the checks start scores 0 of them, not 0 of 1.
export async function run(body, total = 0) {
  const repo = resolve(process.argv[2] || '.');
  const results = [];
  const check = async (name, f, timeoutMs = 60000) => {
    let timer;
    try {
      await Promise.race([f(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${timeoutMs / 1000}s`)), timeoutMs); })]);
      results.push({ name, ok: true });
    } catch (e) { results.push({ name, ok: false, detail: String(e?.message || e).slice(0, 300) }); }
    finally { clearTimeout(timer); }
  };
  try { await body(repo, check); } catch (e) { results.push({ name: 'harness', ok: false, detail: String(e?.message || e).slice(0, 300) }); }
  for (let i = results.filter((r) => r.name !== 'harness').length; i < total; i++) if (results.length < total) results.push({ name: `check ${i + 1} (not reached)`, ok: false, detail: 'the build could not be checked' });
  process.stdout.write(JSON.stringify({ checks: results }) + '\n');
  process.exit(0);
}

// Playwright: from here, NODE_PATH, or the copy waypoint installs into ~/.waypoint/tools.
export function playwright() {
  const places = [import.meta.url, ...(process.env.NODE_PATH || '').split(delimiter).filter(Boolean).map((p) => join(p, 'x.js')),
    join(process.env.WAYPOINT_TOOLS || join(homedir(), '.waypoint', 'tools'), 'node_modules', 'x.js')];
  for (const p of places) { try { return createRequire(p)('playwright'); } catch { /* next */ } }
  throw new Error('Playwright is not installed (it comes with the autopilot\'s tools: ~/.waypoint/tools)');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.csv': 'text/csv', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
// A static server for a web build: the directory with index.html (the repo root, or dist/ or build/ if that is where it is).
export function webRoot(repo) {
  for (const d of ['', 'dist', 'build', 'public']) if (existsSync(join(repo, d, 'index.html'))) return join(repo, d);
  throw new Error('no index.html at the repo root (or in dist/, build/ or public/)');
}
export function serveStatic(root) {
  return new Promise((done) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = join(root, p);
      if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f));
    }).listen(0, '127.0.0.1', () => done({ url: `http://127.0.0.1:${s.address().port}/`, close: () => s.close() }));
  });
}

// A browser page per check (fresh storage), with console and page errors collected.
export async function withBrowser(fn) {
  const { chromium } = playwright();
  const browser = await chromium.launch();
  try {
    const page = async (url) => {
      const ctx = await browser.newContext(); const p = await ctx.newPage(); p.errors = [];
      p.on('pageerror', (e) => p.errors.push(String(e.message || e)));
      p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) p.errors.push(m.text()); });
      if (url) await p.goto(url, { waitUntil: 'load' });
      return p;
    };
    return await fn(page);
  } finally { await browser.close(); }
}

export const freePort = () => new Promise((done) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => done(p)); }); });

// Start a server the build provides; resolves once it answers on the port.
export async function startServer(cmd, args, { cwd, env = {}, port, path = '/' }) {
  const c = spawn(cmd, args, { cwd, env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 60; i++) {
    if (c.exitCode != null) throw new Error(`the server exited: ${out.slice(-300)}`);
    try { await fetch(`http://127.0.0.1:${port}${path}`); return { stop: () => { c.kill(); return new Promise((r) => (c.exitCode != null ? r() : c.on('exit', r))); }, output: () => out }; }
    catch { await sleep(250); }
  }
  c.kill(); throw new Error(`the server did not answer on port ${port}: ${out.slice(-300)}`);
}

export function cli(cwd, args, { input, env = {} } = {}) {
  const r = spawnSync('node', args, { cwd, input, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
