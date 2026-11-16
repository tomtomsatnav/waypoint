// Development updates to a Discord channel through a webhook: milestones planned, the tester's screenshots, review
// verdicts and replies to the owner's notes, images made for the owner (mockups, variants), pauses and the end.
// The webhook URL is a secret (anyone holding it can post to the channel): it is kept in <git dir>/autopilot/discord-webhook
// (mode 600, never committed) or WAYPOINT_DISCORD_WEBHOOK, and never logged. Posting never breaks the run: a failure is
// recorded in the ledger and the run carries on.
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const MAX_FILES = 10;                 // Discord's limit per message
const MAX_BYTES = 9 * 1024 * 1024;    // keep each message under the 10 MB attachment limit
const COLOURS = { milestone: 0xc9a227, shots: 0x58a6ff, review: 0x3fb950, ship: 0xa371f7, pause: 0x8b93a7, owner: 0xd29922, error: 0xf85149 };

export const webhookFile = (apDir) => join(apDir, 'discord-webhook');
export function webhookUrl(apDir) {
  if (process.env.WAYPOINT_DISCORD_WEBHOOK) return process.env.WAYPOINT_DISCORD_WEBHOOK.trim();
  try { return readFileSync(webhookFile(apDir), 'utf8').trim() || null; } catch { return null; }
}
export function setWebhook(apDir, url) {
  if (url && !/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/.test(url)) throw new Error('that is not a Discord webhook URL (https://discord.com/api/webhooks/...)');
  writeFileSync(webhookFile(apDir), url ? `${url}\n` : '', { mode: 0o600 });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));

// One message: an embed and up to ten images. Retries once on a rate limit.
async function postOnce(url, { title, description, colour, fields = [], files = [] }) {
  const embed = { title: clip(title, 250), description: clip(description, 3900), color: colour, timestamp: new Date().toISOString(), fields: fields.slice(0, 20).map((f) => ({ name: clip(f.name, 250), value: clip(f.value, 1000) || '-', inline: !!f.inline })) };
  if (files.length) embed.image = { url: `attachment://${files[0].name}` };
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ username: 'waypoint', embeds: [embed], attachments: files.map((f, i) => ({ id: i, filename: f.name, description: clip(f.caption, 1000) })) }));
  files.forEach((f, i) => form.append(`files[${i}]`, new Blob([readFileSync(f.path)], { type: f.type }), f.name));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    if (res.ok) return true;
    if (res.status === 429) { const j = await res.json().catch(() => ({})); await sleep(Math.min(30000, (j.retry_after ?? 2) * 1000 + 250)); continue; }
    throw new Error(`Discord answered ${res.status}`);
  }
  throw new Error('Discord kept rate-limiting');
}

// Posts a message, splitting images over as many messages as needed. Returns true if everything went; never throws.
export async function postUpdate(apDir, msg, onError = () => {}) {
  const url = webhookUrl(apDir);
  if (!url) return false;
  const images = (msg.images || []).filter((p) => existsSync(p.path || p)).map((p) => {
    const path = p.path || p; const ext = extname(path).toLowerCase();
    return { path, name: basename(path).replace(/[^\w.-]/g, '_'), caption: p.caption || '', type: ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg', size: statSync(path).size };
  }).filter((f) => f.size < MAX_BYTES);
  const batches = [];
  let cur = [], bytes = 0;
  for (const f of images) { if (cur.length === MAX_FILES || bytes + f.size > MAX_BYTES) { batches.push(cur); cur = []; bytes = 0; } cur.push(f); bytes += f.size; }
  if (cur.length) batches.push(cur);
  try {
    if (!batches.length) await postOnce(url, { ...msg, colour: COLOURS[msg.kind] ?? COLOURS.milestone });
    for (const [i, b] of batches.entries())
      await postOnce(url, { ...msg, title: batches.length > 1 ? `${msg.title} (${i + 1}/${batches.length})` : msg.title, description: i === 0 ? msg.description : '', fields: i === 0 ? msg.fields : [], files: b, colour: COLOURS[msg.kind] ?? COLOURS.milestone });
    return true;
  } catch (e) { onError(String(e.message || e)); return false; }
}

// Images the autopilot made for the owner (owner/<note id>/*) that have not been posted yet.
export function newOwnerImages(repo, apDir) {
  const seenFile = join(apDir, 'discord-posted.json');
  let seen = []; try { seen = JSON.parse(readFileSync(seenFile, 'utf8')); } catch { /* none yet */ }
  const root = join(repo, 'owner'); const found = [];
  let dirs = []; try { dirs = readdirSync(root); } catch { return { groups: [], commit: () => {} }; }
  const groups = [];
  for (const d of dirs) {
    const dir = join(root, d); let files = [];
    try { files = readdirSync(dir).filter((f) => /\.(png|jpe?g|gif)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); } catch { continue; }
    const fresh = files.filter((f) => !seen.includes(`${d}/${f}`));
    if (!fresh.length) continue;
    const captions = {}; for (const l of (existsSync(join(dir, 'README.md')) ? readFileSync(join(dir, 'README.md'), 'utf8') : '').split('\n')) { const m = l.match(/^\W*(\d+)\W+(.+)$/); if (m) captions[m[1]] = m[2].trim(); }
    groups.push({ note: d, images: fresh.map((f) => ({ path: join(dir, f), caption: captions[f.replace(/\..+$/, '')] || f })) });
    found.push(...fresh.map((f) => `${d}/${f}`));
  }
  return { groups, commit: () => writeFileSync(seenFile, JSON.stringify([...seen, ...found])) };
}
