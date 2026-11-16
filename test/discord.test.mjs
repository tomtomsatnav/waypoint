import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { autopilot, addNote } from '../lib/autopilot.mjs';
import { setWebhook } from '../lib/discord.mjs';
import { makeRepo, sh, ROOT } from './helpers.mjs';

const FAKE = join(ROOT, 'test', 'fake-autopilot.mjs');
const plan = { title: 'first slice', tasks: [{ id: 'm1-a', type: 'code-simple', after: [], goal: 'create a.txt', checks: [{ name: 'a', run: 'test -f a.txt' }] }] };

// A stand-in for Discord's webhook endpoint: records each message's embed and attachment names.
function fakeDiscord(status = 204) {
  const got = [];
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const pj = body.match(/name="payload_json"\r\n\r\n([\s\S]*?)\r\n--/);
      const payload = pj ? JSON.parse(pj[1]) : null;
      got.push({ title: payload?.embeds?.[0]?.title, fields: payload?.embeds?.[0]?.fields || [], files: [...body.matchAll(/name="files\[\d+\]"; filename="([^"]+)"/g)].map((m) => m[1]) });
      res.writeHead(status); res.end();
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ got, url: `http://127.0.0.1:${server.address().port}/api/webhooks/1/x`, close: () => server.close() })));
}

test('discord: setWebhook refuses anything that is not a Discord webhook URL', () => {
  const repo = makeRepo(); const dir = join(repo, '.git', 'autopilot'); mkdirSync(dir, { recursive: true });
  assert.throws(() => setWebhook(dir, 'https://example.com/hook'), /not a Discord webhook/);
  setWebhook(dir, 'https://discord.com/api/webhooks/123/abc-DEF_9');
});

test('discord: milestones, tester screenshots, the review with replies, images for the owner and the end are posted', async () => {
  const d = await fakeDiscord();
  const repo = makeRepo(); sh(repo, 'git config user.email t@x && git config user.name t');
  Object.assign(process.env, { FAKE_AP_LOG: join(repo, '..', `${repo.split('/').pop()}-d.log`), FAKE_AP_PLAN: JSON.stringify(plan), WAYPOINT_DISCORD_WEBHOOK: d.url });
  const note = addNote(repo, 'show me mockups');
  mkdirSync(join(repo, 'owner', note.id), { recursive: true });
  writeFileSync(join(repo, 'owner', note.id, '1.png'), 'x'); writeFileSync(join(repo, 'owner', note.id, 'README.md'), '1. ember gold\n');
  try {
    const st = await autopilot({ repo, brief: 'b', deadlineHours: 1, research: false, claude: FAKE, log: () => {} });
    assert.equal(st.finished, 'shipped');
    const titles = d.got.map((m) => m.title);
    assert.ok(titles.some((t) => /^Milestone 1: first slice/.test(t)), titles.join(' | '));
    const shots = d.got.find((m) => /as the tester played it/.test(m.title));
    assert.deepEqual(shots.files, ['01-title.png']);
    const owner = d.got.find((m) => /^For you: 1 image/.test(m.title));
    assert.deepEqual(owner.files, ['1.png']);
    const review = d.got.find((m) => /^Review of milestone 1: ship it/.test(m.title));
    assert.match(review.fields[0].name, /show me mockups/);
    assert.equal(titles.at(-1), 'Shipped');
  } finally { d.close(); delete process.env.WAYPOINT_DISCORD_WEBHOOK; delete process.env.FAKE_AP_PLAN; }
});

test('discord: a webhook that fails never stops the run', async () => {
  const d = await fakeDiscord(500);
  const repo = makeRepo(); sh(repo, 'git config user.email t@x && git config user.name t');
  Object.assign(process.env, { FAKE_AP_LOG: join(repo, '..', `${repo.split('/').pop()}-d.log`), FAKE_AP_PLAN: JSON.stringify(plan), WAYPOINT_DISCORD_WEBHOOK: d.url });
  const said = [];
  try {
    const st = await autopilot({ repo, brief: 'b', deadlineHours: 1, research: false, claude: FAKE, log: (m) => said.push(m) });
    assert.equal(st.finished, 'shipped');
    assert.ok(said.some((m) => /discord: Discord answered 500/.test(m)));
  } finally { d.close(); delete process.env.WAYPOINT_DISCORD_WEBHOOK; delete process.env.FAKE_AP_PLAN; }
});
