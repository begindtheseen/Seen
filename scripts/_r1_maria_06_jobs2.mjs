import { boot, BASE, sleep } from './_r1_maria_lib.mjs';
const { page, shot, done, overflow, text } = await boot();
const api = []; page.on('request', r => { if (r.url().includes('/api/jobs')) api.push(r.method() + ' ' + r.url().replace(BASE, '').slice(0, 200)); });
const count = async () => (await page.locator('main').innerText()).match(/\d+ matches?[^\n]*/)?.[0] || (await page.locator('main').innerText()).match(/\d+\+? results?[^\n]*/)?.[0] || '(no count line)';
await page.goto(BASE + '/jobs?q=team+lead&loc=Phoenix', { waitUntil: 'networkidle' }); await sleep(2000);
console.log('phoenix:', await count());
// Change area
await page.getByText('Change', { exact: true }).first().tap(); await sleep(600); await shot('06-change-open');
const loc = page.locator('input[name="seen-job-location"]');
console.log('loc visible', await loc.isVisible());
await loc.fill('Mesa'); await sleep(300);
await page.keyboard.press('Enter'); await page.waitForLoadState('networkidle'); await sleep(2200);
console.log('MESA url', page.url(), '|', await count()); await shot('06-mesa');
// radius select
const radius = page.locator('select.JobSearchBar_radius__BaupT, main select').first();
if (!(await radius.isVisible())) { await page.getByText('Change', { exact: true }).first().tap(); await sleep(500); }
console.log('radius options', await radius.evaluate(e => [...e.options].map(o => o.value + '=' + o.text).join('|')));
await radius.selectOption('10'); await sleep(400);
if (await loc.isVisible()) { await loc.focus(); await page.keyboard.press('Enter'); }
await page.waitForLoadState('networkidle'); await sleep(2200);
console.log('10mi url', page.url(), '|', await count()); await shot('06-10mi');
if (!(await radius.isVisible())) { await page.getByText('Change', { exact: true }).first().tap(); await sleep(500); }
await radius.selectOption('50'); await sleep(400);
if (await loc.isVisible()) { await loc.focus(); await page.keyboard.press('Enter'); }
await page.waitForLoadState('networkidle'); await sleep(2200);
console.log('50mi url', page.url(), '|', await count()); await shot('06-50mi');
// remote
if (!(await radius.isVisible())) { await page.getByText('Change', { exact: true }).first().tap(); await sleep(500); }
const opts = await radius.evaluate(e => [...e.options].map(o => o.value));
const rem = opts.find(v => v === '0' || /remote/i.test(v));
if (rem !== undefined) { await radius.selectOption(rem); await sleep(400); if (await loc.isVisible()) { await loc.focus(); await page.keyboard.press('Enter'); } await page.waitForLoadState('networkidle'); await sleep(2200); console.log('remote url', page.url(), '|', await count()); await shot('06-remote'); console.log('REMOTE first cards:\n', (await text('main', 1400)).slice(300)); }
// back to Phoenix 25 for the rest
await page.goto(BASE + '/jobs?q=retail+supervisor&loc=Phoenix', { waitUntil: 'networkidle' }); await sleep(2200);
console.log('retail supervisor phoenix:', await count()); await shot('06-retail-supervisor');
console.log('RS cards:\n', (await text('main', 1800)).slice(250));
// Filters
await page.getByRole('button', { name: /Filters/ }).first().tap(); await sleep(700); await shot('06-filters-open');
console.log('FILTER PANEL:\n', await text('main', 1200));
const selects = page.locator('main select');
console.log('selects', await selects.evaluateAll(els => els.map(e => (e.getAttribute('aria-label') || e.name || e.id) + ':' + [...e.options].map(o => o.value + '=' + o.text).join('|'))));
await done();
console.log('API:\n' + api.join('\n'));
