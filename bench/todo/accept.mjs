import { run, ok, webRoot, serveStatic, withBrowser } from '../lib/harness.mjs';

run(async (repo, check) => {
  const srv = await serveStatic(webRoot(repo));
  try {
    await withBrowser(async (page) => {
      const add = async (p, ...texts) => { for (const t of texts) { await p.fill('[data-testid=new-todo]', t); await p.press('[data-testid=new-todo]', 'Enter'); } };
      const items = (p) => p.locator('[data-testid=todo-item]');
      await check('loads without errors', async () => { const p = await page(srv.url); await p.waitForTimeout(500);
        ok(await p.locator('[data-testid=new-todo]').count() === 1, 'no new-todo input'); ok(!p.errors.length, `errors: ${p.errors.join('; ')}`); });
      await check('Enter adds a to-do and clears the box', async () => { const p = await page(srv.url); await add(p, 'buy milk', 'call Sam');
        ok(await items(p).count() === 2, `expected 2 items, got ${await items(p).count()}`);
        ok((await items(p).first().innerText()).includes('buy milk'), 'first item text');
        ok(await p.inputValue('[data-testid=new-todo]') === '', 'input not cleared'); });
      await check('blank entries are ignored', async () => { const p = await page(srv.url); await add(p, '   ', '');
        ok(await items(p).count() === 0, 'a blank to-do was added'); });
      await check('count of items left, singular and plural', async () => { const p = await page(srv.url); await add(p, 'a', 'b', 'c');
        ok(/\b3 items left\b/i.test(await p.innerText('[data-testid=todo-count]')), `count says "${await p.innerText('[data-testid=todo-count]')}"`);
        await items(p).nth(0).locator('[data-testid=todo-toggle]').click(); await items(p).nth(1).locator('[data-testid=todo-toggle]').click();
        ok(/\b1 item left\b/i.test(await p.innerText('[data-testid=todo-count]')), `count says "${await p.innerText('[data-testid=todo-count]')}"`); });
      await check('toggle marks done and back', async () => { const p = await page(srv.url); await add(p, 'a');
        const t = items(p).first().locator('[data-testid=todo-toggle]'); await t.click(); ok(await t.isChecked(), 'not checked after click');
        await t.click(); ok(!(await t.isChecked()), 'still checked after second click'); });
      await check('delete removes one to-do', async () => { const p = await page(srv.url); await add(p, 'a', 'b');
        await items(p).first().hover(); await items(p).first().locator('[data-testid=todo-delete]').click({ force: true });
        ok(await items(p).count() === 1, 'not deleted'); ok((await items(p).first().innerText()).includes('b'), 'wrong one deleted'); });
      await check('filters: all, active, completed', async () => { const p = await page(srv.url); await add(p, 'a', 'b', 'c');
        await items(p).nth(1).locator('[data-testid=todo-toggle]').click();
        await p.click('[data-testid=filter-active]'); const act = await items(p).count();
        await p.click('[data-testid=filter-completed]'); const done = await items(p).count();
        await p.click('[data-testid=filter-all]'); const all = await items(p).count();
        ok(act === 2 && done === 1 && all === 3, `active ${act}, completed ${done}, all ${all}`); });
      await check('clear completed', async () => { const p = await page(srv.url); await add(p, 'a', 'b', 'c');
        await items(p).nth(0).locator('[data-testid=todo-toggle]').click(); await items(p).nth(2).locator('[data-testid=todo-toggle]').click();
        await p.click('[data-testid=clear-completed]'); ok(await items(p).count() === 1, `left ${await items(p).count()}`); });
      await check('kept after reload, done state too', async () => { const p = await page(srv.url); await add(p, 'keep me', 'and me');
        await items(p).nth(1).locator('[data-testid=todo-toggle]').click(); await p.reload(); await p.waitForTimeout(300);
        ok(await items(p).count() === 2, `after reload ${await items(p).count()} items`);
        ok(await items(p).nth(1).locator('[data-testid=todo-toggle]').isChecked(), 'done state lost'); });
    });
  } finally { srv.close(); }
});
