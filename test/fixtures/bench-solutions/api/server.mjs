// Notes API: a small JSON API, stored in the file named by DATA_FILE (default data.json).
import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || 'data.json';
const MAX_TITLE = 200;
const MAX_BODY_BYTES = 1_000_000;

let notes = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, 'utf8')) : [];
function persist() {
  const tmp = `${DATA_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(notes, null, 2));
  renameSync(tmp, DATA_FILE);
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function send(res, status, data) {
  if (data === undefined) { res.writeHead(status); return res.end(); }
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY_BYTES) { reject(new HttpError(413, 'request body is too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return reject(new HttpError(400, 'request body must be a JSON object'));
      let v; try { v = JSON.parse(text); } catch { return reject(new HttpError(400, 'request body is not valid JSON')); }
      if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(new HttpError(400, 'request body must be a JSON object'));
      resolve(v);
    });
    req.on('error', reject);
  });
}

function checkTitle(title) {
  if (typeof title !== 'string' || !title.trim()) throw new HttpError(400, 'title is required and must be a non-empty string');
  if (title.length > MAX_TITLE) throw new HttpError(400, `title must be at most ${MAX_TITLE} characters`);
  return title;
}
function checkBody(body) {
  if (body === undefined || body === null) return '';
  if (typeof body !== 'string') throw new HttpError(400, 'body must be a string');
  return body;
}

const find = (id) => { const n = notes.find((x) => x.id === id); if (!n) throw new HttpError(404, `no note with id "${id}"`); return n; };

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'notes' || parts.length > 2) throw new HttpError(404, `no route for ${req.method} ${url.pathname}`);
  const id = parts[1] && decodeURIComponent(parts[1]);

  if (!id) {
    if (req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const list = notes.filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
      return send(res, 200, [...list].reverse()); // stored oldest first, so newest first
    }
    if (req.method === 'POST') {
      const input = await readJson(req);
      const note = { id: randomUUID(), title: checkTitle(input.title), body: checkBody(input.body), createdAt: new Date().toISOString() };
      notes.push(note); persist();
      return send(res, 201, note);
    }
    res.setHeader('allow', 'GET, POST');
    throw new HttpError(405, `${req.method} is not allowed on /notes`);
  }

  if (req.method === 'GET') return send(res, 200, find(id));
  if (req.method === 'PUT') {
    const note = find(id);
    const input = await readJson(req);
    const next = { ...note };
    if ('title' in input) next.title = checkTitle(input.title);
    if ('body' in input) next.body = checkBody(input.body);
    Object.assign(note, next); persist();
    return send(res, 200, note);
  }
  if (req.method === 'DELETE') {
    find(id);
    notes = notes.filter((n) => n.id !== id); persist();
    return send(res, 204);
  }
  res.setHeader('allow', 'GET, PUT, DELETE');
  throw new HttpError(405, `${req.method} is not allowed on /notes/:id`);
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'internal server error' });
  });
}).listen(PORT, () => console.log(`notes API on http://localhost:${PORT} (data in ${DATA_FILE})`));
