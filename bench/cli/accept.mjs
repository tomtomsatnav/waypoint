import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, ok, cli } from '../lib/harness.mjs';

run(async (repo, check) => {
  ok(existsSync(join(repo, 'wf.mjs')), 'no wf.mjs at the repo root');
  const d = mkdtempSync(join(tmpdir(), 'wf-'));
  const f = join(d, 'text.txt');
  writeFileSync(f, "The cat and the hat. The CAT didn't sit; the cat sat!\nA hat, a bat, and a cat.\n");
  const wf = (...a) => cli(repo, ['wf.mjs', ...a]);
  const lines = (s) => s.trim().split('\n').filter(Boolean);
  await check('counts words, most frequent first, ties alphabetical', async () => { const r = wf(f); ok(r.code === 0, `exit ${r.code}: ${r.err}`);
    const l = lines(r.out); ok(l[0] === 'cat 3', `first line "${l[0]}"`); ok(l.includes("didn't 1"), "didn't is not one word");
    const twos = l.filter((x) => / 2$/.test(x)).map((x) => x.split(' ')[0]); ok(JSON.stringify(twos) === JSON.stringify([...twos].sort()), `ties not alphabetical: ${twos}`); });
  await check('default top 10, --top N', async () => { ok(lines(wf(f).out).length === 10, `default shows ${lines(wf(f).out).length}`); ok(lines(wf(f, '--top', '3').out).length === 3, '--top 3'); });
  await check('--ignore-case merges and lower-cases', async () => { const l = lines(wf(f, '--ignore-case').out); ok(l[0] === 'cat 4' && l[1] === 'the 4', `got ${l.slice(0, 2)}`); });
  await check('--min-length', async () => { const l = lines(wf(f, '--min-length', '4', '--top', '50').out); ok(l.length && l.every((x) => x.split(' ')[0].length >= 4), `got ${l}`); });
  await check('--json', async () => { const j = JSON.parse(wf(f, '--json', '--top', '2', '--ignore-case').out); ok(Array.isArray(j) && j.length === 2 && j[0].word === 'cat' && j[0].count === 4, JSON.stringify(j)); });
  await check('reads standard input with -', async () => { const r = cli(repo, ['wf.mjs', '-'], { input: 'b a b' }); ok(lines(r.out)[0] === 'b 2', `got "${r.out}"`); });
  await check('missing file: message on stderr, exit 2', async () => { const r = wf(join(d, 'nope.txt')); ok(r.code === 2, `exit ${r.code}`); ok(/nope\.txt/.test(r.err), `stderr "${r.err}"`); ok(!r.out.trim(), 'printed to stdout'); });
  await check('bad option: exit 2; --help works', async () => { const r = wf(f, '--top', 'lots'); ok(r.code === 2, `--top lots exit ${r.code}`);
    const h = wf('--help'); ok(h.code === 0 && /--top/.test(h.out + h.err), `--help exit ${h.code}`); });
});
