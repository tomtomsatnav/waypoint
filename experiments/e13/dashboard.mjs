#!/usr/bin/env node
// A local dashboard for a run started with run-e13.sh: is everything running, how far has each arm got, what is it doing
// now, and anything that looks wrong. It reads the run's files and refreshes itself; it never shows the blind port mapping.
// Usage: node dashboard.mjs [<work dir>, default ~/emberfall-e13] [--port 3099]
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const pi = args.indexOf('--port');
const PORT = pi >= 0 ? Number(args[pi + 1]) : 3099;
// --lan: also serve on this machine's Wi-Fi address, so a phone on the same network can open it (read-only, no secrets;
// it does show logs and commit messages to anyone on that network).
const LAN = args.includes('--lan');
const WORK = resolve((args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') || join(homedir(), 'emberfall-e13')).replace(/^~/, homedir()));

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const tail = (p, n) => (read(p) || '').trimEnd().split('\n').slice(-n).filter(Boolean);
const alive = (pattern) => spawnSync('pgrep', ['-f', pattern], { encoding: 'utf8' }).status === 0;
// Scoped to this run's folder: the autopilot by its working directory, the supervisor by the folder on its command line.
const cwdOf = (pid) => { const r = spawnSync('lsof', ['-a', '-d', 'cwd', '-p', pid, '-Fn'], { encoding: 'utf8' }); const m = (r.stdout || '').match(/^n(.+)$/m);
  if (m) return m[1]; try { return spawnSync('readlink', [`/proc/${pid}/cwd`], { encoding: 'utf8' }).stdout.trim(); } catch { return ''; } };
const autopilotAlive = () => (spawnSync('pgrep', ['-f', 'waypoint.mjs autopilot (start|resume)'], { encoding: 'utf8' }).stdout || '').split('\n').filter(Boolean).some((pid) => cwdOf(pid) === join(WORK, 'autopilot'));
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return null; } };
function commits(repo, n = 6) {
  if (!existsSync(join(repo, '.git'))) return [];
  const r = spawnSync('git', ['-C', repo, 'log', `-${n}`, '--format=%ct%x09%s'], { encoding: 'utf8' });
  return (r.stdout || '').trim().split('\n').filter(Boolean).map((l) => { const [t, ...s] = l.split('\t'); return { at: Number(t) * 1000, subject: s.join('\t') }; });
}
const commitCount = (repo) => Number(spawnSync('git', ['-C', repo, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).stdout || 0);

function autopilotArm() {
  const repo = join(WORK, 'autopilot');
  const st = json(join(repo, '.git', 'autopilot', 'state.json'));
  const log = tail(join(WORK, 'autopilot.err'), 14);
  const running = autopilotAlive();
  const a = { name: 'autopilot', kind: 'autopilot', running, ended: !!st?.finished, end: st?.finished ?? null, log, commits: commits(repo), commitCount: commitCount(repo) };
  if (!st) return { ...a, state: 'not started' };
  a.spent = st.spentUsd; a.budget = st.policy?.budgetUsd; a.overhead = st.overheadUsd ?? null;
  a.usage = st.usage ? { five: st.usage.fiveHour?.util, week: st.usage.sevenDay?.util } : null;
  a.gate = st.lastGate?.reason ?? null; a.pressure = st.pressure?.level ?? null;
  a.milestones = (st.milestones || []).map((m) => ({ n: m.n, title: m.title, status: m.status, verdict: m.review?.verdict ?? null,
    tasks: m.tasks.map((t) => ({ id: t.id, type: t.type, status: t.status, tries: t.history.map((h) => `${h.model}:${h.outcome}`) })) }));
  // The current attempt: the last "work ..." line in the log, if nothing has been logged since.
  // What it is doing now: the last log line (planning, researching, a task, a review), and since when. Lines are UTC.
  const lastLine = [...log].reverse().find((l) => /^\[autopilot \d\d:\d\d:\d\d\]/.test(l)) || '';
  if (running && lastLine) {
    const m = lastLine.match(/^\[autopilot (\d\d):(\d\d):(\d\d)\]/);
    const d = new Date(); d.setUTCHours(+m[1], +m[2], +m[3], 0); if (d > Date.now() + 60000) d.setUTCDate(d.getUTCDate() - 1);
    const line = lastLine.replace(/^\[autopilot [^\]]+\]\s*/, '');
    a.current = { line, since: d.getTime(), work: /^(work |\d+ workers )/.test(line) };
  }
  const pausing = [...log].reverse().find((l) => /pausing until/.test(l));
  if (pausing && pausing === lastLine) a.pausedUntil = (pausing.match(/pausing until (\S+?):/) || [])[1] ?? null;
  a.state = a.ended ? `ended: ${a.end}` : running ? (a.pausedUntil ? 'paused for usage' : 'running') : 'down';
  return a;
}

function baselineArm(name) {
  const repo = join(WORK, name);
  const st = json(join(WORK, `${name}.baseline.json`));
  const running = alive(`baseline.mjs ${WORK}/${name} `);
  const a = { name, kind: 'session', running, log: tail(join(WORK, `${name}.baseline.log`), 10), commits: commits(repo), commitCount: commitCount(repo) };
  if (!st) return { ...a, state: running ? 'starting' : 'not started' };
  a.spent = st.spentUsd; a.budget = null; a.end = st.end ?? null; a.ended = ['stopped by itself', 'budget', 'deadline'].includes(st.end);
  a.sessions = st.sessions?.length ?? 0; a.research = st.researched || null;
  const lastPause = st.pauses?.at(-1);
  a.pausedUntil = running && lastPause && Date.parse(lastPause.until) > Date.now() && (!st.sessions?.length || Date.parse(st.sessions.at(-1).at) < Date.parse(lastPause.at)) ? lastPause.until : null;
  a.inSession = !!st.inSession;
  // The transcript of the session in progress grows while it works.
  const live = join(WORK, `${name}.s${(st.sessions?.length ?? 0) + 1}.jsonl`);
  a.lastActivity = mtime(live) ?? mtime(join(WORK, `${name}.research.jsonl`));
  a.state = a.ended ? `ended: ${st.end}` : running ? (a.pausedUntil ? 'paused for usage' : 'running') : 'down';
  return a;
}

// The prompt each kind of arm is given, read from the scripts themselves so it can never drift from what ran.
const HERE = new URL('.', import.meta.url).pathname;
function sessionPrompts(mode) {
  const src = read(join(HERE, 'baseline.mjs')) || '';
  const first = (src.match(/const FIRST = `([^`]*)`/) || [])[1] || '';
  const extra = (src.match(/mode === 'researched' \? ` ([^`]*)`/) || [])[1] || '';
  const again = (src.match(/const AGAIN = `([^`]*)`/) || [])[1] || '';
  const out = [{ label: mode === 'researched' ? 'After the research step, the session is given' : 'The session is given', text: first + (mode === 'researched' && extra ? ` ${extra}` : '') }];
  if (mode === 'loop') out.push({ label: 'Each time it stops', text: again });
  return out;
}
function autopilotPrompts(work) {
  const refs = (() => { try { return spawnSync('bash', ['-c', 'ls references/*.png references/art/*.jpg 2>/dev/null | wc -l'], { cwd: work, encoding: 'utf8' }).stdout.trim(); } catch { return '?'; } })();
  return [{ label: 'Started as', text: `waypoint autopilot start --brief-file BRIEF.md --references (${refs} images) --budget-usd ${json(join(work, '.git', 'autopilot', 'state.json'))?.policy?.budgetUsd ?? '?'}` },
    { label: 'Then', text: 'Fable researches what users expect (EXPECTATIONS.md) and how the hardest parts are best built (APPROACH.md), then plans from the brief, the images and those files (SPEC.md, FEATURES.json, milestones with checks). Haiku codes and Sonnet does UI, one checked task at a time, each with one step up (Haiku to Sonnet, Sonnet to Opus). After each milestone a Haiku tester plays the build and reports with screenshots, and Fable decides what comes next.' }];
}

function snapshot() {
  const arms = (read(join(WORK, '.arms-run')) || read(join(WORK, '.arms')) || '').trim().split(/\s+/).filter((x) => x && !x.startsWith('compared'));
  const deadline = (read(join(WORK, 'deadline')) || '').trim() || null;
  const s = {
    work: WORK, now: Date.now(), deadline, finished: existsSync(join(WORK, 'FINISHED')),
    supervisor: alive(`run-e13.sh _supervise ${WORK}$`),
    compared: (read(join(WORK, 'compared.from')) || '').trim().split('\n').filter(Boolean).length,
    arms: arms.map((a) => ({ ...(a === 'autopilot' ? autopilotArm() : baselineArm(a)), prompts: a === 'autopilot' ? autopilotPrompts(join(WORK, a)) : sessionPrompts(a) })),
    brief: arms.length ? read(join(WORK, arms[0], 'BRIEF.md')) : null,
    supervise: tail(join(WORK, 'supervise.log'), 6),
  };
  const w = [];
  if (!existsSync(WORK)) w.push(['bad', `No run at ${WORK}. Pass the run's folder: node dashboard.mjs ~/gloamreach-e14`]);
  if (!s.finished && !s.supervisor && s.arms.length) w.push(['bad', 'The supervisor is not running: nothing will relaunch an arm that dies. Run the start command again; it carries on.']);
  if (s.finished) w.push(['good', 'Finished: the games are being served blind from http://localhost:3101. Give your verdict before revealing.']);
  for (const a of s.arms) {
    if (a.state === 'down') w.push(['bad', `${a.name} is down (not running, not finished). The supervisor relaunches it within 5 minutes; if it stays down, look at its log.`]);
    if (a.current?.work) { const min = (Date.now() - a.current.since) / 60000;
      if (min > 80) w.push(['warn', `${a.name}: the current attempt has run ${Math.round(min)} min (${a.current.line}). Routine tasks get 45 min, hard ones 90; past that it is probably waiting on something that hangs.`]); }
    const caps = a.log.filter((l) => /cap:wall-clock/.test(l));
    if (caps.length >= 2) w.push(['warn', `${a.name}: ${caps.length} attempts in the recent log ran out of time (cap:wall-clock): a task may be stuck on a hanging test.`]);
    const last = a.commits[0]?.at;
    const busySince = a.current?.since ?? 0; // a step that started recently (say after a resume) is not a stall
    if (!a.ended && !a.pausedUntil && a.state !== 'not started' && last && Date.now() - last > 90 * 60000 && Date.now() - busySince > 90 * 60000)
      w.push(['warn', `${a.name}: no commit for ${Math.round((Date.now() - last) / 60000)} min and not paused for usage.`]);
    if (a.pausedUntil) w.push(['info', `${a.name} is paused for plan usage until ${new Date(a.pausedUntil).toLocaleTimeString()}; it resumes by itself.`]);
    if (a.research && a.research.wrote === false) w.push(['warn', `${a.name}: the research step did not write EXPECTATIONS.md; the session runs without it.`]);
  }
  s.warnings = w;
  return s;
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Run dashboard</title><style>
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--text:#e6e8ee;--dim:#8b93a7;--good:#3fb950;--warn:#d29922;--bad:#f85149;--info:#58a6ff;--accent:#c9a227}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:baseline;padding:18px 24px;border-bottom:1px solid var(--line)}
h1{font-size:18px;margin:0}h2{font-size:15px;margin:0 0 10px}.dim{color:var(--dim)}.mono{font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:12px}
main{padding:18px 24px;display:grid;gap:16px}.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(420px,1fr))}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px}
.pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600}
.s-running{background:#12351c;color:var(--good)}.s-paused{background:#11283f;color:var(--info)}.s-ended{background:#2a2f3a;color:var(--text)}.s-down{background:#3d1414;color:var(--bad)}.s-other{background:#2a2f3a;color:var(--dim)}
.warn{padding:9px 12px;border-radius:8px;margin:6px 0;border-left:4px solid}.w-bad{background:#2a1414;border-color:var(--bad)}.w-warn{background:#2a2210;border-color:var(--warn)}.w-info{background:#10213a;border-color:var(--info)}.w-good{background:#10291a;border-color:var(--good)}
.kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:10px 0}.bar{height:8px;background:#232833;border-radius:4px;overflow:hidden;margin-top:4px}.bar>i{display:block;height:100%;background:var(--accent)}
.log{background:#0b0d11;border:1px solid var(--line);border-radius:8px;padding:8px 10px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.brief{white-space:pre-wrap;max-height:480px;overflow:auto;background:#0b0d11;border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-top:8px}
.prompt{background:#0b0d11;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:4px 0 8px;white-space:pre-wrap}
.task{display:flex;gap:8px;align-items:baseline;padding:2px 0}.t-done{color:var(--good)}.t-stuck{color:var(--bad)}.t-retry{color:var(--warn)}.t-pending{color:var(--dim)}
details summary{cursor:pointer;color:var(--dim);margin-top:8px}ul{margin:4px 0;padding-left:18px}
@media (max-width:600px){header,main{padding:12px 14px}.grid{grid-template-columns:1fr}}
</style></head><body><header><h1>Run dashboard</h1><span class="dim mono" id="work"></span><span class="dim" id="updated"></span></header>
<main><section class="panel" id="brief"></section><section class="panel" id="top"></section><section id="warnings"></section><section class="grid" id="arms"></section>
<section class="panel"><h2>Supervisor log</h2><div class="log mono" id="sup"></div></section></main>
<script>
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ago=(t)=>{if(!t)return'never';const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<90?m+' min ago':(m/60).toFixed(1)+' h ago'};
const left=(iso)=>{if(!iso)return'-';const ms=Date.parse(iso)-Date.now();if(ms<=0)return'passed';const h=Math.floor(ms/3600000);return h+' h '+Math.round(ms%3600000/60000)+' min'};
const pct=(x)=>x==null?'-':Math.round(x*100)+'%';
const pill=(s)=>{const c=/^running/.test(s)?'running':/paused/.test(s)?'paused':/^ended/.test(s)?'ended':/down/.test(s)?'down':'other';return '<span class="pill s-'+c+'">'+esc(s)+'</span>'};
function arm(a){let h='<div class="panel"><h2>'+esc(a.name)+' '+pill(a.state)+'</h2><div class="kv">';
 h+='<span class="dim">Spent</span><span>$'+(a.spent??0).toFixed(2)+(a.budget?' of $'+a.budget:'')+(a.overhead!=null?' <span class="dim">(research, planning, reviews $'+a.overhead.toFixed(2)+')</span>':'')+(a.budget?'<div class="bar"><i style="width:'+Math.min(100,100*(a.spent||0)/a.budget)+'%"></i></div>':'')+'</span>';
 h+='<span class="dim">Commits</span><span>'+a.commitCount+' <span class="dim">· last '+ago(a.commits[0]?.at)+'</span></span>';
 if(a.kind==='session'){h+='<span class="dim">Sessions</span><span>'+(a.sessions??0)+(a.inSession?' <span class="dim">(one in progress, transcript updated '+ago(a.lastActivity)+')</span>':'')+'</span>';
  if(a.research)h+='<span class="dim">Research</span><span>$'+a.research.costUsd.toFixed(2)+', EXPECTATIONS.md '+(a.research.wrote?'written':'missing')+'</span>';}
 if(a.kind==='autopilot'){if(a.usage)h+='<span class="dim">Plan usage</span><span>5-hour '+pct(a.usage.five)+', weekly '+pct(a.usage.week)+(a.pressure?' <span class="dim">· '+esc(a.pressure)+'</span>':'')+'</span>';
  if(a.current)h+='<span class="dim">Now</span><span>'+esc(a.current.line)+' <span class="dim">· for '+Math.round((Date.now()-a.current.since)/60000)+' min</span></span>';
  if(a.gate)h+='<span class="dim">Last gate</span><span class="dim">'+esc(a.gate)+'</span>';}
 h+='</div>';
 if(a.prompts?.length)h+='<details><summary>Prompt</summary>'+a.prompts.map(p=>'<div class="dim" style="margin-top:6px">'+esc(p.label)+'</div><div class="prompt mono">'+esc(p.text)+'</div>').join('')+'</details>';
 if(a.milestones?.length){const m=a.milestones.at(-1);h+='<div><b>Milestone '+m.n+'</b> <span class="dim">'+esc(m.title)+' · '+esc(m.status)+'</span></div>';
  for(const t of m.tasks){const st=a.current&&a.current.line.includes(t.id)&&t.status!=='done'?'running':t.status;h+='<div class="task mono"><span class="t-'+(st==='running'?'retry':t.status)+'">●</span><span>'+esc(t.id)+'</span><span class="dim">'+esc(st)+(t.tries.length?' · '+esc(t.tries.join(' ')):'')+'</span></div>';}
  if(a.milestones.length>1)h+='<details><summary>Earlier milestones ('+(a.milestones.length-1)+')</summary><ul>'+a.milestones.slice(0,-1).map(x=>'<li>'+x.n+'. '+esc(x.title)+' <span class="dim">'+esc(x.status)+(x.verdict?' → '+esc(x.verdict):'')+'</span></li>').join('')+'</ul></details>';}
 h+='<details open><summary>Latest commits</summary><ul>'+a.commits.map(c=>'<li><span class="dim">'+ago(c.at)+'</span> '+esc(c.subject)+'</li>').join('')+'</ul></details>';
 h+='<details><summary>Log</summary><div class="log mono">'+a.log.map(esc).join('\\n')+'</div></details></div>';return h}
let briefShown=null;
async function tick(){try{const s=await (await fetch('/api')).json();
 if(s.brief&&s.brief!==briefShown){briefShown=s.brief;const t=(s.brief.match(/^#\\s*(.+)$/m)||[])[1]||'Brief';const lead=(s.brief.split('\\n').find(l=>l.trim()&&!l.startsWith('#'))||'');
  document.getElementById('brief').innerHTML='<h2>'+esc(t)+'</h2><div>'+esc(lead.split('**').join(''))+'</div><details><summary>The full brief (BRIEF.md, as every arm received it)</summary><div class="brief mono">'+esc(s.brief)+'</div></details>';}
 if(!s.brief)document.getElementById('brief').style.display='none';
 document.getElementById('work').textContent=s.work;document.getElementById('updated').textContent='updated '+new Date().toLocaleTimeString();
 document.getElementById('top').innerHTML='<div class="kv"><span class="dim">Supervisor</span><span>'+(s.finished?pill('finished'):s.supervisor?pill('running'):pill('down'))+'</span><span class="dim">Deadline</span><span>'+(s.deadline?new Date(s.deadline).toLocaleString()+' <span class="dim">('+(left(s.deadline)==='passed'?'passed':left(s.deadline)+' left')+')</span>':'-')+'</span>'+(s.compared?'<span class="dim">Compared with</span><span>'+s.compared+' earlier game'+(s.compared>1?'s':'')+' (blind: the port mapping stays hidden)</span>':'')+'</div>';
 document.getElementById('warnings').innerHTML=s.warnings.length?s.warnings.map(([k,m])=>'<div class="warn w-'+k+'">'+esc(m)+'</div>').join(''):'<div class="warn w-good">Everything looks fine.</div>';
 document.getElementById('arms').innerHTML=s.arms.map(arm).join('');document.getElementById('sup').textContent=s.supervise.join('\\n');
}catch(e){document.getElementById('updated').textContent='cannot reach the dashboard server'}}
tick();setInterval(tick,30000);
</script></body></html>`;

http.createServer((req, res) => {
  if (req.url === '/api') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(snapshot())); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE);
}).listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', async () => {
  process.stdout.write(`dashboard for ${WORK}: http://localhost:${PORT}\n`);
  if (LAN) { const { networkInterfaces } = await import('node:os');
    for (const list of Object.values(networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal)
      process.stdout.write(`  on your phone (same Wi-Fi): http://${n.address}:${PORT}\n`); }
});
