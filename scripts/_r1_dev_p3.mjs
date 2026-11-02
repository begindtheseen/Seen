import { boot, go, shot, text, overflow, note, dump, saveState, password, BASE } from './_r1_dev_lib.mjs';
const { browser, ctx, page, errors, failed } = await boot();
const main = async (n = 2000) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).replace(/\s+/g, ' ').slice(0, n);
// Sign in
await go(page, '/login'); await shot(page, '20-login');
if (!(await page.locator('#si-email').isVisible().catch(() => false))) { await page.getByRole('button', { name: /sign in/i }).first().click(); await page.waitForTimeout(600); }
await page.fill('#si-email', 'dev.patel.r1@seenjobs.io'); await page.fill('#si-pw', password());
const t0 = Date.now();
await page.locator('main button', { hasText: /^Sign in/ }).first().click();
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => note('login', 'did not leave /login'));
await page.waitForTimeout(2500);
note('login-ms', Date.now() - t0); note('login-landed', page.url());
await saveState(ctx);
await shot(page, '21-after-login'); await shot(page, '21-after-login-full', true);
note('after-login-text', await main(2500));
await dump('login', errors, failed);
// Dashboard (explicit)
const ms = await go(page, '/dashboard'); note('dashboard-ms', ms); await shot(page, '22-dashboard'); await shot(page, '22-dashboard-full', true);
note('dashboard-text', await main(3000)); note('dashboard-overflow', JSON.stringify((await overflow(page)).out));
await dump('dashboard', errors, failed);
// g then t signed in
await page.keyboard.press('g'); await page.keyboard.press('t'); await page.waitForTimeout(2500); note('g-t-url', page.url());
// Ctrl+K signed in
await go(page, '/dashboard'); await page.keyboard.press('Control+k'); await page.waitForTimeout(900); await shot(page, '23-palette-signed-in');
note('palette-dom', await page.evaluate(() => { const d = document.querySelector('[role="dialog"]') || document.querySelector('[class*="alette"]'); return d ? d.innerText.replace(/\s+/g, ' ').slice(0, 600) : 'NO DIALOG FOUND; body has ' + document.querySelectorAll('[class*="alette"]').length; }));
await page.keyboard.type('backend'); await page.waitForTimeout(900); await shot(page, '23-palette-typed');
note('palette-typed', await page.evaluate(() => { const d = document.querySelector('[role="dialog"]') || document.querySelector('[class*="alette"]'); return d ? d.innerText.replace(/\s+/g, ' ').slice(0, 600) : 'NONE'; }));
await page.keyboard.press('Enter'); await page.waitForTimeout(3000); note('palette-enter-url', page.url()); await shot(page, '23-palette-enter');
await dump('palette', errors, failed);
await browser.close();
