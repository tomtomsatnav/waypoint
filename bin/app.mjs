#!/usr/bin/env node
// waypoint's launcher: a page in your browser to start and look after autopilot projects without the command line.
// Write a brief (or have Claude draft one from a few lines), drop in reference images, pick a folder and options, press
// Start; it sets up the git repository, starts the autopilot (bin/autopilot.sh) and opens the project's dashboard. The
// builds keep running when this page or the launcher is closed.
// Usage: node app.mjs [--port 3100] [--open]        node app.mjs --register <folder>   (adds a folder to the list)
import http from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, openSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { addNote } from '../lib/autopilot.mjs';
import { setWebhook } from '../lib/discord.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.WAYPOINT_HOME || join(homedir(), '.waypoint');
const LIST = join(HOME, 'projects.json');
const AUTOPILOT = process.env.WAYPOINT_AUTOPILOT_SH || join(HERE, 'autopilot.sh');
const expand = (p) => resolve(String(p || '').trim().replace(/^~(?=$|\/)/, homedir()));
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const projects = () => readJson(LIST, []).filter((p) => p && p.path);
const saveProjects = (l) => { mkdirSync(HOME, { recursive: true }); writeFileSync(LIST, JSON.stringify(l, null, 2) + '\n'); };

export function register(path, name) {
  const l = projects(); const p = expand(path);
  if (!l.some((x) => x.path === p)) {
    const used = new Set(l.map((x) => x.port));
    let port = 3101; while (used.has(port)) port++;
    l.push({ path: p, name: name || basename(p), port, added: new Date().toISOString() }); saveProjects(l);
  }
  return projects().find((x) => x.path === p);
}

if (process.argv[2] === '--register') { register(process.argv[3] || process.cwd()); process.exit(0); }

// Where the autopilot's files are: a project (bin/autopilot.sh) keeps them in its own .git; a comparison folder keeps
// the autopilot's repo in autopilot/.
function apRoot(p) {
  if (existsSync(join(p, '.git', 'autopilot'))) return { root: p, managed: true };
  if (existsSync(join(p, 'autopilot', '.git', 'autopilot'))) return { root: join(p, 'autopilot'), managed: false };
  return { root: p, managed: true };
}
const cwdOf = (pid) => { const r = spawnSync('lsof', ['-a', '-d', 'cwd', '-p', pid, '-Fn'], { encoding: 'utf8' }); const m = (r.stdout || '').match(/^n(.+)$/m);
  if (m) return m[1]; try { return spawnSync('readlink', [`/proc/${pid}/cwd`], { encoding: 'utf8' }).stdout.trim(); } catch { return ''; } };
const pids = (pattern) => (spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean);
const tailOf = (f, n) => { try { return readFileSync(f, 'utf8').trimEnd().split('\n').slice(-n); } catch { return []; } };

function info(p) {
  const { root, managed } = apRoot(p.path);
  const ap = join(root, '.git', 'autopilot');
  const st = readJson(join(ap, 'state.json'), null);
  const running = pids('waypoint.mjs autopilot (start|resume)').some((pid) => cwdOf(pid) === root);
  const supervisor = pids(`autopilot.sh _supervise ${p.path}$`).length > 0;
  const log = tailOf(join(ap, 'autopilot.log'), 1)[0] || '';
  const last = log.replace(/^\[[^\]]+\]\s*/, '');
  const ms = st?.milestones?.at(-1);
  const status = !existsSync(p.path) ? 'missing' : st?.finished && !['plan-failed', 'review-failed'].includes(st.finished) ? 'finished'
    : running ? (/pausing until/.test(last) ? 'paused' : 'running') : st ? 'stopped' : launching.has(p.path) ? 'starting' : 'not started';
  return { ...p, managed, status, supervisor, milestone: ms ? `milestone ${ms.n}: ${ms.title}` : null, now: running ? last.slice(0, 200) : null,
    finished: st?.finished || null, origin: existsSync(p.path) ? (git(p.path, 'remote', 'get-url', 'origin').stdout || '').trim().replace(/\.git$/, '') || null : null, launch: tailOf(join(HOME, 'logs', `${basename(p.path)}-launch.log`), 6) };
}

// --- actions -------------------------------------------------------------------------------------------------------
const launching = new Set();
function git(cwd, ...a) { return spawnSync('git', a, { cwd, encoding: 'utf8' }); }
function commit(cwd, msg) {
  git(cwd, 'add', '-A');
  if (git(cwd, 'commit', '-q', '-m', msg).status !== 0) git(cwd, '-c', 'user.name=waypoint', '-c', 'user.email=waypoint@localhost', 'commit', '-q', '--allow-empty', '-m', msg);
}

function startProject(path, args = []) {
  mkdirSync(join(HOME, 'logs'), { recursive: true });
  const out = openSync(join(HOME, 'logs', `${basename(path)}-launch.log`), 'a');
  launching.add(path);
  const c = spawn(AUTOPILOT, ['start', ...args], { cwd: path, env: { ...process.env, WAYPOINT_PROJECT: path }, stdio: ['ignore', out, out], detached: true });
  c.on('exit', () => launching.delete(path)); c.unref();
}

export function createProject(o) {
  const path = expand(o.folder || join(homedir(), 'waypoint-projects', slug(o.name || 'project')));
  const existing = existsSync(join(path, '.git')) && git(path, 'rev-parse', 'HEAD').status === 0;
  const brief = String(o.brief || '').trim();
  if (!brief && !existsSync(join(path, '.git', 'autopilot', 'state.json'))) throw new Error('write a brief first (what it should become)');
  mkdirSync(path, { recursive: true });
  if (!existsSync(join(path, '.git'))) git(path, 'init', '-q');
  const refs = [];
  for (const r of o.references || []) {
    const name = basename(String(r.name || 'image.png')).replace(/[^\w.-]+/g, '-');
    if (!/\.(png|jpe?g|gif|webp)$/i.test(name)) continue;
    mkdirSync(join(path, 'references'), { recursive: true });
    writeFileSync(join(path, 'references', name), Buffer.from(String(r.data).replace(/^data:[^,]*,/, ''), 'base64'));
    refs.push({ path: `references/${name}`, caption: String(r.caption || '').trim() });
  }
  let briefFile = null;
  if (brief) {
    briefFile = existing && existsSync(join(path, 'BRIEF.md')) ? 'WAYPOINT-BRIEF.md' : 'BRIEF.md';
    const refText = refs.length ? `\n\n## Reference images\n\n${refs.map((r) => `- \`${r.path}\`${r.caption ? `: ${r.caption}` : ''}`).join('\n')}\n` : '\n';
    writeFileSync(join(path, briefFile), brief.replace(/\s*$/, '') + refText);
  }
  commit(path, existing ? 'waypoint: brief for the autopilot' : 'Brief');
  const gh = String(o.github || '').trim();
  let github = null;
  if (gh && git(path, 'remote', 'get-url', 'origin').status !== 0) git(path, 'remote', 'add', 'origin', gh);
  else if (o.createGithub && git(path, 'remote', 'get-url', 'origin').status !== 0) github = makeGithubRepo(path, o.name || basename(path));
  const hook = String(o.discord || '').trim();
  if (hook) { mkdirSync(join(path, '.git', 'autopilot'), { recursive: true }); setWebhook(join(path, '.git', 'autopilot'), hook); }
  const args = [];
  if (briefFile) args.push('--brief-file', briefFile);
  if (refs.length) args.push('--references', refs.map((r) => r.path).join(','));
  if (o.weekly) args.push('--weekly', String(Math.min(1, Math.max(0.1, Number(o.weekly)))));
  if (o.workers && Number(o.workers) > 1) args.push('--max-workers', String(Math.min(6, Math.floor(Number(o.workers)))));
  if (o.hours && Number(o.hours) > 0) args.push('--hours', String(Number(o.hours)));
  const p = register(path, o.name);
  startProject(path, args);
  return { ...p, github };
}

// GitHub, through the GitHub CLI (gh) the user is logged in to: is it there, and make a private repository for a project.
let ghCache = null;
export function ghStatus() {
  if (ghCache && Date.now() - ghCache.at < 60e3) return ghCache.s;
  const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  const s = r.error ? { installed: false, loggedIn: false } : { installed: true, loggedIn: r.status === 0,
    user: ((r.stdout || '') + (r.stderr || '')).match(/account (\S+)/)?.[1] || null };
  ghCache = { at: Date.now(), s }; return s;
}
export function makeGithubRepo(path, name) {
  const s = ghStatus();
  if (!s.installed) return { error: 'the GitHub CLI is not installed (brew install gh, then gh auth login)' };
  if (!s.loggedIn) return { error: 'the GitHub CLI is not logged in (run gh auth login in Terminal once)' };
  if (git(path, 'remote', 'get-url', 'origin').status === 0) return { url: git(path, 'remote', 'get-url', 'origin').stdout.trim() };
  const base = slug(name); let last = '';
  for (let i = 1; i <= 9; i++) {
    const n = i === 1 ? base : `${base}-${i}`;
    const r = spawnSync('gh', ['repo', 'create', n, '--private', '--source', path, '--remote', 'origin', '--push'], { cwd: path, encoding: 'utf8' });
    if (r.status === 0) return { url: git(path, 'remote', 'get-url', 'origin').stdout.trim().replace(/\.git$/, ''), name: n };
    last = (r.stderr || r.stdout || '').trim();
    if (!/already exists/i.test(last)) break;
  }
  return { error: `could not make the repository: ${last.slice(-300)}` };
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

const BRIEF_GUIDE = `Write a brief for an autonomous builder that will work on this for days without asking questions. Markdown, starting with "# <name>".
It says what to build and why, not how (no libraries unless asked). It names what is easy to forget for this kind of product (for a game: camera,
controls, feel, difficulty, saving, settings, sound; for an app: accounts, empty states, errors, mobile layout). It describes the look in words
and says what each reference image is for. For an original product it says so: its own names, characters and art, nothing copied from an
existing one. It ends with a "## Done means" section: what a person can do with it when it is finished. Keep the owner's own words and wishes;
add, do not replace. 300 to 900 words. Reply with the brief only, no preamble.`;

function draftBrief({ idea, current, feedback, references = [] }) {
  const parts = [BRIEF_GUIDE, `\nWhat the owner wants:\n${String(idea || '').trim() || '(see the current draft)'}`];
  if (references.length) parts.push(`\nReference images they attached (they will be listed at the end of the brief, do not list them again):\n${references.map((r) => `- ${r.name}${r.caption ? `: ${r.caption}` : ''}`).join('\n')}`);
  if (String(current || '').trim()) parts.push(`\nThe current draft:\n${current}`);
  if (String(feedback || '').trim()) parts.push(`\nWhat the owner wants changed in it:\n${feedback}`);
  const tryModel = (model) => new Promise((res) => {
    const c = spawn('claude', ['-p', '--model', model, '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; const t = setTimeout(() => c.kill('SIGKILL'), 10 * 60e3);
    c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => { clearTimeout(t); res({ ok: false, err: e.code === 'ENOENT' ? 'Claude Code is not installed (claude was not found)' : String(e) }); });
    c.on('close', (code) => { clearTimeout(t); res(code === 0 && out.trim() ? { ok: true, brief: out.trim().replace(/^```\w*\n|\n```$/g, '') } : { ok: false, err: (err || out).trim().slice(-500) || `claude exited ${code}` }); });
    c.stdin.end(parts.join('\n'));
  });
  const models = [process.env.WAYPOINT_BRIEF_MODEL || 'claude-fable-5-1', 'opus'];
  return tryModel(models[0]).then((r) => (r.ok ? r : tryModel(models[1])));
}

async function dashboard(p) {
  const { root, managed } = apRoot(p.path);
  const keyFile = managed ? join(root, '.git', 'autopilot', 'dashboard-key') : join(p.path, '.dashboard-key');
  const up = await fetch(`http://127.0.0.1:${p.port}/api`).then((r) => r.ok).catch(() => false);
  if (!up) {
    mkdirSync(join(HOME, 'logs'), { recursive: true });
    const out = openSync(join(HOME, 'logs', `${basename(p.path)}-dashboard.log`), 'w');
    spawn(process.execPath, [join(HERE, 'dashboard.mjs'), p.path, '--port', String(p.port), '--lan'], { stdio: ['ignore', out, out], detached: true }).unref();
    for (let i = 0; i < 40 && !(await fetch(`http://127.0.0.1:${p.port}/api`).then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 250));
  }
  let key = ''; try { key = readFileSync(keyFile, 'utf8').trim(); } catch { /* none yet */ }
  const lines = tailOf(join(HOME, 'logs', `${basename(p.path)}-dashboard.log`), 6);
  const phone = (lines.join('\n').match(/http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/\?key=\S+/) || [])[0] || null;
  return { url: `http://localhost:${p.port}/?key=${key}`, phone };
}

// waypoint improve's history: the baselines measured and each round's proposal, verdict and pull request.
function benchHistory() {
  const dir = join(HERE, '..', 'bench', 'results');
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const rounds = files.filter((d) => existsSync(join(dir, d, 'round.json'))).sort().reverse().slice(0, 30).map((d) => {
    const r = readJson(join(dir, d, 'round.json'), {});
    return { id: r.id, at: r.at, title: r.title, verdict: r.verdict, reason: r.reason, before: r.baseline?.train ?? null, after: r.candidate?.train ?? null,
      heldBefore: r.baseline?.held ?? null, heldAfter: r.candidate?.held ?? null, url: r.published?.url || null, note: r.published?.note || null };
  });
  const baselines = files.filter((f) => /^baseline-.*\.json$/.test(f)).map((f) => { const b = readJson(join(dir, f), {}); return { commit: (b.commit || '').slice(0, 7), at: b.at, runs: b.runs?.length || 0,
    train: b.runs?.length ? b.runs.map((r) => { const t = r.results.filter((x) => !x.heldOut); return t.reduce((a, x) => a + x.score, 0) / (t.length || 1); }).reduce((a, x) => a + x, 0) / b.runs.length : null }; })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { running: pids('waypoint.mjs improve').length > 0, log: tailOf(join(HOME, 'improve.log'), 4), rounds, baselines };
}

// --- server --------------------------------------------------------------------------------------------------------
const KEY = (() => { const f = join(HOME, 'app-key'); try { const k = readFileSync(f, 'utf8').trim(); if (k) return k; } catch { /* first start */ }
  const k = randomBytes(12).toString('base64url'); mkdirSync(HOME, { recursive: true }); writeFileSync(f, k + '\n', { mode: 0o600 }); return k; })();
const PAGE = readFileSync(join(HERE, 'app.html'), 'utf8');
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

function suggestFolders() {
  const out = [];
  for (const base of [homedir(), join(homedir(), 'waypoint-projects')]) {
    let names = []; try { names = readdirSync(base); } catch { continue; }
    for (const n of names) { const d = join(base, n);
      try { if (statSync(d).isDirectory() && (existsSync(join(d, '.git', 'autopilot')) || existsSync(join(d, 'autopilot', '.git', 'autopilot')))) out.push(d); } catch { /* skip */ } }
  }
  const known = new Set(projects().map((p) => p.path));
  return out.filter((d) => !known.has(d));
}

const routes = {
  'GET /api/projects': () => ({ projects: projects().map(info), found: suggestFolders(), home: homedir(), gh: ghStatus() }),
  'POST /api/github': (b) => { const p = projects().find((x) => x.path === b.path); if (!p) throw new Error('unknown project');
    const r = makeGithubRepo(p.path, p.name); if (r.error) throw new Error(r.error); return { ok: true, ...r }; },
  'POST /api/draft': (b) => draftBrief(b),
  'POST /api/create': (b) => ({ ok: true, project: createProject(b) }),
  'POST /api/add': (b) => { const p = expand(b.folder); if (!existsSync(p)) throw new Error(`${p} does not exist`); return { ok: true, project: register(p) }; },
  'POST /api/remove': (b) => { saveProjects(projects().filter((p) => p.path !== b.path)); return { ok: true }; },
  'POST /api/start': (b) => { const p = projects().find((x) => x.path === b.path); if (!p) throw new Error('unknown project');
    if (!apRoot(p.path).managed) throw new Error('this folder is run by its own script, not by waypoint\'s launcher'); startProject(p.path); return { ok: true }; },
  'POST /api/stop': (b) => { const p = projects().find((x) => x.path === b.path); if (!p) throw new Error('unknown project');
    if (!apRoot(p.path).managed) throw new Error('this folder is run by its own script, not by waypoint\'s launcher');
    const r = spawnSync(AUTOPILOT, ['stop'], { cwd: p.path, env: { ...process.env, WAYPOINT_PROJECT: p.path }, encoding: 'utf8' }); return { ok: r.status === 0 }; },
  'POST /api/note': (b) => { const p = projects().find((x) => x.path === b.path); if (!p) throw new Error('unknown project');
    addNote(apRoot(p.path).root, String(b.text || ''), { urgent: !!b.urgent }); return { ok: true }; },
  'GET /api/bench': () => benchHistory(),
  'POST /api/improve': (b) => {
    if (pids('waypoint.mjs improve').length) throw new Error('a round is already running');
    const args = ['improve', '--rounds', String(Math.max(1, Math.min(10, Number(b.rounds) || 1))), '--yes'];
    if (Number(b.budget) > 0) args.push('--budget-usd', String(Number(b.budget)));
    spawn(AUTOPILOT, args, { cwd: join(HERE, '..'), stdio: 'ignore', detached: true }).unref();
    return { ok: true };
  },
  'POST /api/dashboard': (b) => { const p = projects().find((x) => x.path === b.path); if (!p) throw new Error('unknown project'); return dashboard(p); },
};

export function serve(port, host = '127.0.0.1') {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const route = routes[`${req.method} ${u.pathname}`];
    if (!route) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    // Everything but the page needs the key: it is in the link printed at start, so other web pages cannot use this.
    if (req.headers['x-key'] !== KEY) return send(res, 403, { error: 'open the launcher from the link it printed (with ?key=)' });
    let body = ''; req.on('data', (d) => { body += d; if (body.length > 300e6) req.destroy(); });
    req.on('end', async () => {
      try { send(res, 200, await route(body ? JSON.parse(body) : {})); } catch (e) { send(res, 400, { error: String(e.message || e) }); }
    });
  }).listen(port, host);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const pi = a.indexOf('--port'); const port = pi >= 0 ? Number(a[pi + 1]) : 3100;
  const url = `http://localhost:${port}/?key=${KEY}`;
  const s = serve(port);
  s.on('listening', () => {
    console.log(`waypoint launcher: ${url}\n(closing this window stops the launcher only; builds keep running)`);
    if (a.includes('--open')) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  });
  s.on('error', (e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    console.log(`the launcher is already running: ${url}`);
    if (a.includes('--open')) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    process.exit(0);
  });
}
