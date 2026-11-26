// What past real runs say about waypoint: the owner's notes and the replies to them, the testers' reports, the reviewers'
// assessments and the tasks that got stuck, from every project the launcher knows (~/.waypoint/projects.json). Read only.
// Themes are words and pairs of words that come up in more than one project: the same complaint across different
// projects points at waypoint, not at one brief.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const STOP = new Set(('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours make made want like also still need needs please thing things really much more less look looks feel feels btw maybe should could would every each them they its game app page work works working use used using get gets got lot bit way also one two three').split(' '));

function apRoots(path) {
  if (existsSync(join(path, '.git', 'autopilot'))) return [join(path, '.git', 'autopilot')];
  if (existsSync(join(path, 'autopilot', '.git', 'autopilot'))) return [join(path, 'autopilot', '.git', 'autopilot')];
  return [];
}

function brokenLines(md) {
  const out = []; let inside = false;
  for (const line of String(md || '').split('\n')) {
    if (/^#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*:?\s*$/.test(line)) { inside = /broken|missing|bug|fail|problem|issue|annoy/i.test(line); continue; }
    if (inside && /^\s*([-*]|\d+\.)\s+\S/.test(line)) out.push(line.replace(/^\s*([-*]|\d+\.)\s+/, '').trim().slice(0, 240));
  }
  return out;
}

export function collect({ home = process.env.WAYPOINT_HOME || join(homedir(), '.waypoint'), projects } = {}) {
  const list = projects || (readJson(join(home, 'projects.json')) || []).map((p) => p.path);
  const out = { projects: [], notes: [], tester: [], reviews: [], stuck: [] };
  for (const path of list) for (const dir of apRoots(path)) {
    const name = path.split('/').filter(Boolean).pop();
    out.projects.push(name);
    for (const n of readJson(join(dir, 'notes.json')) || []) out.notes.push({ project: name, text: String(n.text || '').slice(0, 600), reply: n.reply ? String(n.reply).slice(0, 400) : null, at: n.at });
    for (const f of readdirSync(dir).filter((f) => /^tester-\d+\.md$/.test(f)))
      for (const l of brokenLines(readFileSync(join(dir, f), 'utf8'))) out.tester.push({ project: name, milestone: Number(f.match(/\d+/)[0]), text: l });
    for (const f of readdirSync(dir).filter((f) => /^review-\d+\.json$/.test(f))) {
      const r = readJson(join(dir, f)); if (r?.assessment) out.reviews.push({ project: name, milestone: Number(f.match(/\d+/)[0]), verdict: r.verdict, text: String(r.assessment).slice(0, 800) });
    }
    const st = readJson(join(dir, 'state.json'));
    for (const m of st?.milestones || []) for (const t of m.tasks || []) if (t.status === 'stuck')
      out.stuck.push({ project: name, task: t.id, type: t.type, goal: String(t.goal || '').slice(0, 300), tries: (t.history || []).map((h) => `${h.model}:${h.outcome}`) });
  }
  out.themes = themes(out);
  return out;
}

const words = (s) => String(s).toLowerCase().match(/[a-z][a-z'-]{3,}/g)?.filter((w) => !STOP.has(w)) || [];

// Terms (single words and adjacent pairs) used in at least two projects' notes, tester problems or stuck tasks.
export function themes(data, { top = 20 } = {}) {
  const items = [...data.notes.map((n) => ({ project: n.project, text: n.text, kind: 'note' })), ...data.tester.map((t) => ({ project: t.project, text: t.text, kind: 'tester' })),
    ...data.stuck.map((s) => ({ project: s.project, text: s.goal, kind: 'stuck' }))];
  const terms = new Map();
  for (const it of items) {
    const w = words(it.text); const seen = new Set([...w, ...w.slice(1).map((x, i) => `${w[i]} ${x}`)]);
    for (const t of seen) { const e = terms.get(t) || { term: t, projects: new Set(), count: 0, examples: [] }; e.projects.add(it.project); e.count++;
      if (e.examples.length < 3) e.examples.push(`[${it.project}, ${it.kind}] ${it.text.slice(0, 160)}`); terms.set(t, e); }
  }
  return [...terms.values()].filter((e) => e.projects.size >= 2)
    .sort((a, b) => b.projects.size - a.projects.size || b.count - a.count || (b.term.includes(' ') ? 1 : 0) - (a.term.includes(' ') ? 1 : 0))
    .slice(0, top).map((e) => ({ term: e.term, projects: [...e.projects], count: e.count, examples: e.examples }));
}

// A compact text for the proposer.
export function feedbackText(data, max = 12000) {
  const lines = [`Projects read: ${data.projects.length} (${data.projects.join(', ') || 'none'})`];
  if (data.themes.length) lines.push('', 'Recurring themes (across projects):', ...data.themes.map((t) => `- "${t.term}" in ${t.projects.length} projects, ${t.count} times; e.g. ${t.examples[0]}`));
  if (data.notes.length) lines.push('', 'Owner notes:', ...data.notes.slice(-60).map((n) => `- [${n.project}] ${n.text}${n.reply ? ` (reply: ${n.reply})` : ''}`));
  if (data.stuck.length) lines.push('', 'Tasks that got stuck:', ...data.stuck.slice(-40).map((s) => `- [${s.project}] ${s.task} (${s.type}; ${s.tries.join(', ')}): ${s.goal}`));
  if (data.tester.length) lines.push('', 'Problems testers found:', ...data.tester.slice(-60).map((t) => `- [${t.project}, m${t.milestone}] ${t.text}`));
  return lines.join('\n').slice(0, max);
}
