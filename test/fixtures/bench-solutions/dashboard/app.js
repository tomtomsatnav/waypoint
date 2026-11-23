// Reads data/sales.csv and renders the total, the region table and the monthly chart.
const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => fmt.format(n);
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim());
  return lines.filter((l) => l.trim()).map((l) => {
    const v = l.split(','); const r = Object.fromEntries(cols.map((c, i) => [c, (v[i] || '').trim()]));
    return { month: r.date.slice(0, 7), region: r.region, revenue: Number(r.units) * Number(r.unit_price) };
  });
}

const sum = (rows) => rows.reduce((a, r) => a + r.revenue, 0);

function renderTable(rows) {
  const total = sum(rows);
  const by = new Map();
  for (const r of rows) by.set(r.region, (by.get(r.region) || 0) + r.revenue);
  const sorted = [...by].sort((a, b) => b[1] - a[1]);
  const body = $('regions');
  body.textContent = '';
  for (const [region, rev] of sorted) {
    const tr = document.createElement('tr');
    tr.dataset.testid = 'region-row'; tr.dataset.region = region;
    const cell = (text, cls, testid) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; if (testid) td.dataset.testid = testid; tr.append(td); };
    cell(region);
    cell(money(rev), 'num', 'region-revenue');
    cell(`${total ? ((rev / total) * 100).toFixed(1) : '0.0'}%`, 'num');
    body.append(tr);
  }
}

function renderChart(allRows, months, selected) {
  const svg = $('chart');
  svg.textContent = '';
  const W = 600, H = 300, padL = 64, padB = 32, padT = 12, padR = 8;
  const totals = months.map((m) => sum(allRows.filter((r) => r.month === m)));
  const max = Math.max(1, ...totals);
  const el = (name, attrs, text) => { const e = document.createElementNS(SVG, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; svg.append(e); return e; };
  for (let i = 0; i <= 4; i++) {
    const y = padT + (H - padT - padB) * (1 - i / 4);
    el('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: '#e3e6ec' });
    el('text', { x: padL - 6, y: y + 4, 'text-anchor': 'end' }, '$' + Math.round((max * i) / 4).toLocaleString('en-US'));
  }
  const slot = (W - padL - padR) / Math.max(1, months.length);
  months.forEach((m, i) => {
    const h = ((H - padT - padB) * totals[i]) / max;
    const x = padL + i * slot + slot * 0.15;
    const bar = el('rect', { x, y: H - padB - h, width: slot * 0.7, height: h, class: 'bar' + (m === selected ? ' sel' : ''), rx: 3 });
    const title = document.createElementNS(SVG, 'title'); title.textContent = `${monthName(m)}: ${money(totals[i])}`; bar.append(title);
    el('text', { x: x + slot * 0.35, y: H - padB + 18, 'text-anchor': 'middle' }, monthName(m).split(' ')[0]);
  });
}

async function main() {
  let rows;
  try {
    const res = await fetch('data/sales.csv', { cache: 'no-store' });
    if (!res.ok) throw new Error(`could not load data/sales.csv (${res.status})`);
    rows = parseCsv(await res.text());
  } catch (e) { $('error').textContent = String(e.message || e); $('error').hidden = false; return; }
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const select = $('month');
  for (const m of months) { const o = document.createElement('option'); o.value = m; o.textContent = monthName(m); select.append(o); }
  const render = () => {
    const sel = select.value;
    const shown = sel === 'all' ? rows : rows.filter((r) => r.month === sel);
    $('total').textContent = money(sum(shown));
    $('sub').textContent = `${sel === 'all' ? `${monthName(months[0])} – ${monthName(months[months.length - 1])}` : monthName(sel)} · ${shown.length} sales`;
    renderTable(shown);
    renderChart(rows, months, sel);
  };
  select.addEventListener('change', render);
  render();
}
main();
