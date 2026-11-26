import { run, ok, webRoot, serveStatic, withBrowser } from '../lib/harness.mjs';

run(async (repo, check) => {
  const srv = await serveStatic(webRoot(repo));
  try {
    await withBrowser(async (page) => {
      const st = (p) => p.evaluate(() => window.game.state());
      const start = async () => { const p = await page(srv.url); await p.waitForFunction(() => window.game && typeof window.game.state === 'function', null, { timeout: 5000 });
        await p.evaluate(() => window.game.setAutoSpawn(false)); await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {}); return p; };
      const waitFor = async (p, f, ms, what) => { const end = Date.now() + ms; while (Date.now() < end) { if (f(await st(p))) return; await p.waitForTimeout(100); } throw new Error(`${what}: ${JSON.stringify(await st(p))}`); };
      await check('loads on the title screen without errors', async () => { const p = await start(); const s = await st(p);
        ok(s.status === 'title', `status ${s.status}`); ok(s.lives === 3 && s.score === 0, JSON.stringify(s)); ok(!p.errors.length, p.errors.join('; ')); });
      await check('Space starts, Enter starts', async () => { let p = await start(); await p.keyboard.press('Space'); await waitFor(p, (s) => s.status === 'playing', 2000, 'Space');
        p = await start(); await p.keyboard.press('Enter'); await waitFor(p, (s) => s.status === 'playing', 2000, 'Enter'); });
      await check('arrows and A/D move the basket', async () => { const p = await start(); await p.keyboard.press('Space');
        const x0 = (await st(p)).playerX; await p.keyboard.down('ArrowRight'); await p.waitForTimeout(400); await p.keyboard.up('ArrowRight');
        const x1 = (await st(p)).playerX; ok(x1 > x0, `right: ${x0} -> ${x1}`);
        await p.keyboard.down('a'); await p.waitForTimeout(400); await p.keyboard.up('a'); const x2 = (await st(p)).playerX; ok(x2 < x1, `A: ${x1} -> ${x2}`); });
      await check('the basket stays on screen', async () => { const p = await start(); await p.keyboard.press('Space');
        await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(3000); await p.keyboard.up('ArrowLeft'); const s = await st(p);
        ok(s.playerX >= 0 && s.playerX < 200, `playerX ${s.playerX}`);
        await p.keyboard.down('ArrowRight'); await p.waitForTimeout(4000); await p.keyboard.up('ArrowRight'); const w = await p.evaluate(() => window.game.width);
        ok((await st(p)).playerX <= w, `playerX ${(await st(p)).playerX} > width ${w}`); });
      await check('catching a lantern scores', async () => { const p = await start(); await p.keyboard.press('Space');
        await p.evaluate(() => window.game.spawnLantern(window.game.state().playerX)); await waitFor(p, (s) => s.score >= 1, 15000, 'no score'); ok((await st(p)).lives === 3, 'lost a life'); });
      await check('a missed lantern costs a life', async () => { const p = await start(); await p.keyboard.press('Space');
        const x = await p.evaluate(() => { const s = window.game.state(); return s.playerX > window.game.width / 2 ? 5 : window.game.width - 5; });
        await p.evaluate((x) => window.game.spawnLantern(x), x); await waitFor(p, (s) => s.lives === 2, 15000, 'no life lost'); ok((await st(p)).score === 0, 'scored'); });
      await check('P pauses and resumes', async () => { const p = await start(); await p.keyboard.press('Space'); await p.keyboard.press('p');
        await waitFor(p, (s) => s.status === 'paused', 1500, 'not paused'); const x = (await st(p)).playerX;
        await p.keyboard.down('ArrowRight'); await p.waitForTimeout(400); await p.keyboard.up('ArrowRight'); ok((await st(p)).playerX === x, 'moved while paused');
        await p.keyboard.press('p'); await waitFor(p, (s) => s.status === 'playing', 1500, 'not resumed'); });
      await check('game over after three misses, R restarts, best kept', async () => { const p = await start(); await p.keyboard.press('Space');
        await p.evaluate(() => window.game.spawnLantern(window.game.state().playerX)); await waitFor(p, (s) => s.score >= 1, 15000, 'no score');
        for (let i = 0; i < 3; i++) { const x = await p.evaluate(() => { const s = window.game.state(); return s.playerX > window.game.width / 2 ? 5 : window.game.width - 5; });
          const lives = (await st(p)).lives; await p.evaluate((x) => window.game.spawnLantern(x), x); await waitFor(p, (s) => s.lives < lives || s.status === 'over', 15000, 'no life lost'); }
        await waitFor(p, (s) => s.status === 'over', 3000, 'not over'); const best = (await st(p)).best; ok(best >= 1, `best ${best}`);
        await p.keyboard.press('r'); await waitFor(p, (s) => s.status === 'playing' || s.status === 'title', 2000, 'R did nothing');
        const s = await st(p); ok(s.score === 0 && s.lives === 3, JSON.stringify(s));
        await p.reload(); await p.waitForFunction(() => window.game, null, { timeout: 5000 }); ok((await st(p)).best >= 1, 'best not kept after reload'); }, 90000);
    });
  } finally { srv.close(); }
}, 8);
