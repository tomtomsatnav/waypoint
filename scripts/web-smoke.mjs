#!/usr/bin/env node
// Load a web app in a real browser and report what a person would see: console and page errors, whether the page (or its
// canvas) actually renders, and screenshots before and after some input. Used as a check (exit 1 on errors or a blank page)
// and to give the review step something to look at.
//
// Usage: web-smoke.mjs --root <dir to serve statically> [--path /] [--wait 3000] [--keys "w,a,s,d,Space"] [--click]
//                      [--out <dir for screenshots and report.json>] [--allow-errors]
// Needs Playwright (preinstalled here: require('playwright')).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const root = path.resolve(opt('root', '.'));
const out = path.resolve(opt('out', path.join(root, '.smoke')));
const wait = Number(opt('wait', 3000));
const keys = (opt('keys', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
fs.mkdirSync(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const report = { url: `http://127.0.0.1:${port}${opt('path', '/')}`, consoleErrors: [], pageErrors: [], failedRequests: [], shots: [] };
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => report.pageErrors.push(String(e.message || e).slice(0, 300)));
    page.on('requestfailed', (r) => report.failedRequests.push(r.url().slice(0, 200)));
    page.on('response', (r) => { if (r.status() >= 400) report.failedRequests.push(`${r.status()} ${r.url().slice(0, 200)}`); });
    await page.goto(report.url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(wait);
    const shot = async (name) => { const f = path.join(out, `${name}.png`); await page.screenshot({ path: f }); report.shots.push(f); };
    await shot('loaded');
    if (flag('click')) { await page.mouse.click(640, 360); await page.waitForTimeout(500); }
    if (keys.length) {
      for (const k of keys) { await page.keyboard.down(k); await page.waitForTimeout(400); await page.keyboard.up(k); }
      await page.waitForTimeout(1000);
      await shot('after-input');
    }
    // Does anything render? Sample the screenshot's pixels (via the page's own canvas if there is one, else the screenshot).
    const buf = fs.readFileSync(report.shots.at(-1));
    report.render = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.drawImage(img, 0, 0, 64, 36);
      const d = x.getImageData(0, 0, 64, 36).data; const seen = new Set(); let sum = 0, sum2 = 0;
      for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += v; sum2 += v * v; seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`); }
      const n = d.length / 4; const mean = sum / n;
      return { colours: seen.size, stddev: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), canvases: document.querySelectorAll('canvas').length };
    }, buf.toString('base64'));
  } catch (e) { report.pageErrors.push(`smoke: ${String(e.message || e).slice(0, 300)}`); }
  await browser.close(); server.close();
  report.blank = !report.render || report.render.colours < 4 || report.render.stddev < 2;
  report.ok = report.pageErrors.length === 0 && (flag('allow-errors') || report.consoleErrors.length === 0) && !report.blank;
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify({ ok: report.ok, blank: report.blank, render: report.render, consoleErrors: report.consoleErrors.slice(0, 5), pageErrors: report.pageErrors.slice(0, 5), failedRequests: report.failedRequests.slice(0, 5), shots: report.shots }, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
});
