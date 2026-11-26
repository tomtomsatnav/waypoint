import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run, ok } from '../lib/harness.mjs';

run(async (repo, check) => {
  const m = await import(pathToFileURL(join(repo, 'cart.mjs')).href + `?${Date.now()}`);
  const T = (items, code) => m.cartTotal(items, code ? { code } : undefined);
  const near = (a, b) => Math.abs(a - b) < 0.001; // only the rounding check tests rounding
  await check('LANTERN10 takes 10% off', async () => { const t = T([{ name: 'Lantern', price: 30, qty: 1 }], 'LANTERN10'); ok(near(t, 31.95), `got ${t}, expected 31.95`); });
  await check('quantity 0 is not charged', async () => { const t = T([{ name: 'Lantern', price: 30, qty: 0 }, { name: 'Wick', price: 2, qty: 1 }]); ok(near(t, 6.95), `got ${t}, expected 6.95`); });
  await check('a missing quantity still means 1', async () => { const t = T([{ name: 'Wick', price: 2 }]); ok(near(t, 6.95), `got ${t}, expected 6.95`); });
  await check('free shipping from exactly $50', async () => { const t = T([{ name: 'Lantern', price: 25, qty: 2 }]); ok(near(t, 50), `got ${t}, expected 50`);
    const u = T([{ name: 'Lantern', price: 49.99, qty: 1 }]); ok(near(u, 54.94), `got ${u}, expected 54.94`); });
  await check('totals are rounded to the cent', async () => { const t = T([{ name: 'a', price: 0.1, qty: 1 }, { name: 'b', price: 0.2, qty: 1 }, { name: 'c', price: 19.65, qty: 1 }]);
    ok(t === 24.9 , `got ${t}, expected 24.9`); const v = T([{ name: 'x', price: 3.333, qty: 3 }]); ok(Number.isFinite(v) && Math.round(v * 100) / 100 === v, `got ${v}`); });
  await check('FIVEOFF unchanged: $5 off from $20', async () => { ok(near(T([{ name: 'a', price: 20, qty: 1 }], 'FIVEOFF'), 19.95), 'at $20');
    ok(near(T([{ name: 'a', price: 19, qty: 1 }], 'FIVEOFF'), 23.95), 'below $20'); });
  await check('unknown codes ignored; formatPrice unchanged', async () => { ok(near(T([{ name: 'a', price: 60, qty: 1 }], 'NOPE'), 60), 'unknown code'); ok(m.formatPrice(3.5) === '$3.50', 'formatPrice'); });
  await check('the repo\'s tests pass and cover the fixes', async () => {
    const r = spawnSync('node', ['--test'], { cwd: repo, encoding: 'utf8', timeout: 60000 }); ok(r.status === 0, `node --test failed: ${(r.stdout + r.stderr).slice(-300)}`);
    const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.name === 'node_modules' || e.name.startsWith('.') ? [] : e.isDirectory() ? files(join(d, e.name)) : /\.test\.m?js$/.test(e.name) ? [join(d, e.name)] : []);
    const n = files(repo).reduce((a, f) => a + (readFileSync(f, 'utf8').match(/\btest\s*\(|\bit\s*\(/g) || []).length, 0);
    ok(n >= 7, `${n} tests in the repo; expected the 3 existing ones plus one per reported problem`); });
}, 8);
