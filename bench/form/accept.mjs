import { run, ok, webRoot, serveStatic, withBrowser } from '../lib/harness.mjs';

run(async (repo, check) => {
  const srv = await serveStatic(webRoot(repo));
  try {
    await withBrowser(async (page) => {
      const errText = async (p, id) => { const el = p.locator(`#${id}-error`); if (!(await el.count()) || !(await el.isVisible())) return ''; return (await el.innerText()).trim(); };
      const fillAll = async (p, v = {}) => { const d = { email: 'sam@example.com', password: 'lantern42', confirm: 'lantern42', age: '30', ...v };
        for (const k of ['email', 'password', 'confirm', 'age']) { await p.fill(`#${k}`, d[k]); await p.locator(`#${k}`).blur(); }
        if (v.terms !== false) await p.check('#terms'); };
      await check('loads with every field and no errors shown', async () => { const p = await page(srv.url);
        for (const id of ['email', 'password', 'confirm', 'age', 'terms', 'submit']) ok(await p.locator(`#${id}`).count() === 1, `#${id} missing`);
        for (const id of ['email', 'password', 'confirm', 'age', 'terms']) ok(!(await errText(p, id)), `${id} error shown before typing`);
        ok(!p.errors.length, p.errors.join('; ')); });
      await check('no error while typing, error after leaving the field', async () => { const p = await page(srv.url);
        await p.click('#email'); await p.keyboard.type('sam@'); ok(!(await errText(p, 'email')), 'error shown while typing');
        await p.locator('#email').blur(); ok(await errText(p, 'email'), 'no error after leaving'); ok(await p.getAttribute('#email', 'aria-invalid') === 'true', 'aria-invalid not set'); });
      await check('error clears as soon as it is fixed', async () => { const p = await page(srv.url);
        await p.fill('#email', 'nope'); await p.locator('#email').blur(); ok(await errText(p, 'email'), 'no error');
        await p.click('#email'); await p.keyboard.type('@example.com'); ok(!(await errText(p, 'email')), 'error still shown'); });
      await check('password rules', async () => { const p = await page(srv.url);
        for (const bad of ['short1', 'longenough', '123456789']) { await p.fill('#password', bad); await p.locator('#password').blur(); ok(await errText(p, 'password'), `"${bad}" accepted`); }
        await p.fill('#password', 'lantern42'); await p.locator('#password').blur(); ok(!(await errText(p, 'password')), 'good password rejected'); });
      await check('confirm must match', async () => { const p = await page(srv.url); await fillAll(p, { confirm: 'lantern43' }); ok(await errText(p, 'confirm'), 'mismatch accepted'); });
      await check('age is a whole number from 13 to 120', async () => { const p = await page(srv.url);
        for (const bad of ['12', '121', '20.5', 'abc']) { await p.fill('#age', bad); await p.locator('#age').blur(); ok(await errText(p, 'age'), `age "${bad}" accepted`); }
        for (const good of ['13', '120']) { await p.fill('#age', good); await p.locator('#age').blur(); ok(!(await errText(p, 'age')), `age "${good}" rejected`); } });
      await check('submit disabled until everything is valid, terms included', async () => { const p = await page(srv.url);
        ok(await p.isDisabled('#submit'), 'enabled on an empty form'); await fillAll(p, { terms: false }); ok(await p.isDisabled('#submit'), 'enabled without terms');
        await p.check('#terms'); ok(!(await p.isDisabled('#submit')), 'still disabled when valid'); });
      await check('submitting shows the thank-you with the email', async () => { const p = await page(srv.url); await fillAll(p); await p.click('#submit');
        await p.waitForSelector('#success', { state: 'visible', timeout: 3000 }); ok((await p.innerText('#success')).includes('sam@example.com'), 'email not in the message'); });
      await check('labels on every field', async () => { const p = await page(srv.url);
        for (const id of ['email', 'password', 'confirm', 'age', 'terms']) { const n = await p.evaluate((id) => { const el = document.getElementById(id); return (el.labels?.length || 0) + (el.getAttribute('aria-label') ? 1 : 0) + (el.getAttribute('aria-labelledby') ? 1 : 0); }, id); ok(n > 0, `#${id} has no label`); } });
    });
  } finally { srv.close(); }
});
