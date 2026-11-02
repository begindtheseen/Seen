import { boot, go, shot, text, overflow, note, dump, BASE } from './_r1_dev_lib.mjs';
const { browser, page, errors, failed } = await boot();
const main = async (n = 2500) => (await page.locator('main').innerText().catch(() => page.locator('body').innerText())).replace(/\s+/g, ' ').slice(0, n);
// Homepage scroll walk (what a user sees, viewport by viewport)
await go(page, '/');
for (let i = 1; i <= 5; i++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(900); await shot(page, `11-home-scroll-${i}`); }
// Ctrl+K palette
await page.keyboard.press('Control+k'); await page.waitForTimeout(800); await shot(page, '12-palette-open');
note('palette-text', (await page.locator('[role="dialog"], [class*="palette"], [class*="Palette"]').first().innerText().catch(() => 'NO PALETTE')).replace(/\s+/g, ' ').slice(0, 500));
await page.keyboard.type('Stripe'); await page.waitForTimeout(900); await shot(page, '12-palette-typed');
note('palette-typed', (await page.locator('[role="dialog"], [class*="palette"], [class*="Palette"]').first().innerText().catch(() => 'NO PALETTE')).replace(/\s+/g, ' ').slice(0, 500));
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
// g then t (signed out)
await page.keyboard.press('g'); await page.keyboard.press('t'); await page.waitForTimeout(2500); note('g-t-url-signed-out', page.url()); await shot(page, '13-g-t-signed-out');
// Public pages
for (const p of ['/data', '/methods', '/lists', '/faq', '/privacy', '/employers', '/agencies', '/demand', '/feed', '/ghost-report', '/pricing', '/report', '/terms', '/contact', '/jobs']) {
  const ms = await go(page, p); const name = p.replace(/\W/g, '') || 'root';
  note(`${name}-ms`, ms); note(`${name}-title`, await page.title());
  await shot(page, `14-${name}`); await shot(page, `14-${name}-full`, true);
  note(`${name}-text`, await main(p === '/faq' || p === '/privacy' || p === '/methods' || p === '/data' ? 6000 : 1800));
  note(`${name}-overflow`, JSON.stringify((await overflow(page)).out));
  await dump(name, errors, failed);
}
// Jobs tab order (before search)
await go(page, '/jobs');
const order = [];
for (let i = 0; i < 22; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return `${e.tagName.toLowerCase()}[${(e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || '').trim().slice(0, 32)}] outline=${cs.outlineStyle} shadow=${cs.boxShadow !== 'none'}`; })); }
note('jobs-tab-order', '\n' + order.join('\n'));
await shot(page, '15-jobs-tab-focus');
await browser.close();
