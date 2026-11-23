import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run, ok, webRoot, serveStatic, withBrowser } from '../lib/harness.mjs';

const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));

run(async (repo, check) => {
  const root = webRoot(repo);
  // The truth, from the CSV the build is served with.
  const rows = readFileSync(join(root, 'data', 'sales.csv'), 'utf8').trim().split('\n').slice(1).map((l) => { const [date, region, product, units, price] = l.split(','); return { month: date.slice(0, 7), region, rev: Number(units) * Number(price) }; });
  const sum = (rs) => Math.round(rs.reduce((a, r) => a + r.rev, 0) * 100) / 100;
  const byRegion = (rs) => { const m = {}; for (const r of rs) m[r.region] = (m[r.region] || 0) + r.rev; return Object.entries(m).map(([k, v]) => [k, Math.round(v * 100) / 100]).sort((a, b) => b[1] - a[1]); };
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const srv = await serveStatic(root);
  try {
    await withBrowser(async (page) => {
      const open = async () => { const p = await page(srv.url); await p.waitForSelector('[data-testid=total-revenue]', { timeout: 5000 }); await p.waitForTimeout(500); return p; };
      await check('loads without errors', async () => { const p = await open(); ok(!p.errors.length, p.errors.join('; ')); });
      await check('total revenue is right and formatted as money', async () => { const p = await open(); const t = (await p.innerText('[data-testid=total-revenue]')).trim();
        ok(t.includes(money(sum(rows))), `shows "${t}", expected ${money(sum(rows))}`); });
      await check('a row per region, largest first, with the right revenue', async () => { const p = await open(); const want = byRegion(rows);
        const got = await p.$$eval('[data-testid=region-row]', (els) => els.map((e) => [e.getAttribute('data-region'), e.querySelector('[data-testid=region-revenue]')?.textContent || '']));
        ok(got.length === want.length, `${got.length} rows, expected ${want.length}`);
        got.forEach(([r, v], i) => { ok(r === want[i][0], `row ${i + 1} is ${r}, expected ${want[i][0]}`); ok(Math.abs(num(v) - want[i][1]) < 0.01, `${r}: ${v}, expected ${money(want[i][1])}`); }); });
      await check('each region shows its share', async () => { const p = await open(); const want = byRegion(rows); const total = sum(rows);
        const texts = await p.$$eval('[data-testid=region-row]', (els) => els.map((e) => e.textContent));
        texts.forEach((t, i) => { const pct = Math.round(want[i][1] / total * 100); ok(new RegExp(`\\b(${pct}|${pct - 1}|${pct + 1})(\\.\\d+)?\\s?%`).test(t), `"${t.trim().slice(0, 80)}" has no share near ${pct}%`); }); });
      await check('month filter lists every month and updates the total and table', async () => { const p = await open();
        const opts = await p.$$eval('[data-testid=month-filter] option', (o) => o.map((x) => x.value));
        ok(opts.includes('all') && months.every((m) => opts.includes(m)), `options ${opts.join(',')}`);
        const m = months[2]; await p.selectOption('[data-testid=month-filter]', m); await p.waitForTimeout(300);
        const mrows = rows.filter((r) => r.month === m); const t = await p.innerText('[data-testid=total-revenue]');
        ok(t.includes(money(sum(mrows))), `for ${m} shows "${t}", expected ${money(sum(mrows))}`);
        const n = await p.locator('[data-testid=region-row]').count(); ok(n === byRegion(mrows).length, `${n} region rows for ${m}`);
        await p.selectOption('[data-testid=month-filter]', 'all'); await p.waitForTimeout(300); ok((await p.innerText('[data-testid=total-revenue]')).includes(money(sum(rows))), 'all did not restore the total'); });
      await check('a chart is drawn', async () => { const p = await open(); const c = p.locator('[data-testid=chart]'); ok(await c.count() >= 1, 'no chart');
        const box = await c.first().boundingBox(); ok(box && box.width > 100 && box.height > 60, `chart is ${JSON.stringify(box)}`);
        const drawn = await c.first().evaluate((el) => el.tagName.toLowerCase() === 'svg' ? el.querySelectorAll('rect,path,line,circle,polyline').length : 1); ok(drawn > 0, 'the svg is empty'); });
      await check('fits a phone screen without sideways scrolling', async () => { const p = await open(); await p.setViewportSize({ width: 375, height: 800 }); await p.waitForTimeout(200);
        const w = await p.evaluate(() => document.documentElement.scrollWidth); ok(w <= 380, `page is ${w}px wide on a 375px screen`); });
    });
  } finally { srv.close(); }
});
