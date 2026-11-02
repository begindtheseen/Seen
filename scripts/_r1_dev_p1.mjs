import { boot, go, shot, text, overflow, note, dump, BASE } from './_r1_dev_lib.mjs';
const { browser, page, errors, failed } = await boot();
// Homepage
let ms = await go(page, '/');
note('home-load-ms', ms); note('home-title', await page.title());
await shot(page, '01-home-top'); await shot(page, '01-home-full', true);
note('home-h1', await text(page, 'h1'));
note('home-buttons', JSON.stringify((await page.locator('main a, main button').allInnerTexts()).map(t => t.trim()).filter(Boolean).slice(0, 60)));
note('home-overflow', JSON.stringify(await overflow(page)));
// Tab through homepage: record focus order + visible focus ring
const order = [];
for (let i = 0; i < 25; i++) {
  await page.keyboard.press('Tab');
  const f = await page.evaluate(() => { const e = document.activeElement; if (!e) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()}[${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}] outline=${cs.outlineStyle}/${cs.outlineWidth} shadow=${cs.boxShadow !== 'none'} vis=${r.width > 0 && r.height > 0}`; });
  order.push(f);
}
note('home-tab-order', '\n' + order.join('\n'));
await shot(page, '02-home-tab-focus');
// Home search: type "Stripe" and try
await page.goto(BASE + '/'); await page.waitForTimeout(1200);
const hs = page.locator('input').first();
note('home-search-placeholder', await hs.getAttribute('placeholder'));
await hs.fill('Stripe'); await page.waitForTimeout(800); await shot(page, '03-home-search-typed');
await hs.press('Enter'); await page.waitForTimeout(3500);
note('home-search-enter-url', page.url()); await shot(page, '03-home-search-result');
// "try one" chips
await page.goto(BASE + '/'); await page.waitForTimeout(1200);
const chips = page.locator('main button, main a').filter({ hasText: /^(Amazon|Walmart|Target|Google|Tesla|Starbucks|Stripe|Meta|Apple|Microsoft)$/ });
note('home-chips', await chips.count());
if (await chips.count()) { await chips.first().click(); await page.waitForTimeout(3500); note('chip-url', page.url()); await shot(page, '04-home-chip-click'); }
await dump('home', errors, failed);
// Company page Stripe
ms = await go(page, '/company/stripe'); note('company-stripe-ms', ms); note('company-stripe-title', await page.title());
await shot(page, '05-company-stripe'); await shot(page, '05-company-stripe-full', true);
note('company-stripe-text', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 1800));
await dump('company-stripe', errors, failed);
ms = await go(page, '/company/databricks'); note('company-databricks-ms', ms); await shot(page, '06-company-databricks', true);
note('company-databricks-text', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 1200));
// non-existent company
ms = await go(page, '/company/zzqx-not-a-company-9871'); note('company-missing-ms', ms); note('company-missing-title', await page.title());
await shot(page, '07-company-missing', true);
note('company-missing-text', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 900));
await dump('company-missing', errors, failed);
// 404
ms = await go(page, '/this-page-does-not-exist'); note('404-title', await page.title()); await shot(page, '08-404', true);
note('404-text', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 600));
// companies leaderboard
ms = await go(page, '/companies'); note('companies-ms', ms); await shot(page, '09-companies'); await shot(page, '09-companies-full', true);
note('companies-text', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 1500));
await dump('companies', errors, failed);
// compare
ms = await go(page, '/compare'); note('compare-ms', ms); await shot(page, '10-compare-empty', true);
note('compare-text', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 800));
ms = await go(page, '/compare/stripe-vs-databricks'); note('compare-svd-ms', ms); note('compare-svd-title', await page.title()); await shot(page, '10-compare-stripe-databricks', true);
note('compare-svd-text', (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 2000));
await dump('compare', errors, failed);
await browser.close();
