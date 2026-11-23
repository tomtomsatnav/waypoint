import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, ok, freePort, startServer, sleep } from '../lib/harness.mjs';

run(async (repo, check) => {
  ok(existsSync(join(repo, 'server.mjs')), 'no server.mjs at the repo root');
  const data = join(mkdtempSync(join(tmpdir(), 'notes-')), 'data.json');
  const port = await freePort();
  let srv = await startServer('node', ['server.mjs'], { cwd: repo, port, env: { DATA_FILE: data }, path: '/notes' });
  const api = async (method, path, body) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* not json */ } return { status: r.status, json, text }; };
  try {
    let a, b;
    await check('starts empty', async () => { const r = await api('GET', '/notes'); ok(r.status === 200 && Array.isArray(r.json) && r.json.length === 0, `${r.status} ${r.text.slice(0, 100)}`); });
    await check('create returns 201 and the note', async () => { const r = await api('POST', '/notes', { title: 'Lanterns', body: 'Buy more oil' });
      ok(r.status === 201, `status ${r.status}`); a = r.json; ok(a && a.id != null && a.title === 'Lanterns' && a.body === 'Buy more oil' && a.createdAt, JSON.stringify(a));
      await sleep(20); b = (await api('POST', '/notes', { title: 'Wicks', body: 'Trim them' })).json; });
    await check('list is newest first', async () => { const r = await api('GET', '/notes'); ok(r.json?.length === 2 && r.json[0].title === 'Wicks', JSON.stringify(r.json)); });
    await check('read one; 404 with an error for a missing one', async () => { const r = await api('GET', `/notes/${a.id}`); ok(r.status === 200 && r.json.title === 'Lanterns', `${r.status}`);
      const m = await api('GET', '/notes/does-not-exist-999'); ok(m.status === 404 && typeof m.json?.error === 'string', `${m.status} ${m.text}`); });
    await check('validation: title required, at most 200 characters', async () => { for (const body of [{ body: 'x' }, { title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }]) {
      const r = await api('POST', '/notes', body); ok(r.status === 400 && typeof r.json?.error === 'string', `${JSON.stringify(body).slice(0, 40)} -> ${r.status}`); }
      const bad = await fetch(`http://127.0.0.1:${port}/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' }); ok(bad.status === 400, `bad JSON -> ${bad.status}`); });
    await check('search title and body, case-insensitive', async () => { const r = await api('GET', '/notes?q=OIL'); ok(r.json?.length === 1 && r.json[0].title === 'Lanterns', JSON.stringify(r.json));
      const t = await api('GET', '/notes?q=wick'); ok(t.json?.length === 1, 'title search'); });
    await check('update and delete', async () => { const u = await api('PUT', `/notes/${a.id}`, { body: 'Buy lots of oil' }); ok(u.status === 200 && u.json.body === 'Buy lots of oil' && u.json.title === 'Lanterns', `${u.status} ${u.text}`);
      const bad = await api('PUT', `/notes/${a.id}`, { title: '' }); ok(bad.status === 400, `empty title update -> ${bad.status}`);
      const d = await api('DELETE', `/notes/${b.id}`); ok(d.status === 204, `delete -> ${d.status}`); ok((await api('GET', `/notes/${b.id}`)).status === 404, 'still there'); });
    await check('survives a restart', async () => { await srv.stop(); srv = await startServer('node', ['server.mjs'], { cwd: repo, port, env: { DATA_FILE: data }, path: '/notes' });
      const r = await api('GET', '/notes'); ok(r.json?.length === 1 && r.json[0].body === 'Buy lots of oil', JSON.stringify(r.json)); });
  } finally { await srv.stop(); }
});
