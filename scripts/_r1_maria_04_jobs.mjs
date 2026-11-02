import { boot, BASE, sleep } from './_r1_maria_lib.mjs';
const { page, shot, done, overflow, tiny, text } = await boot();
const api = []; page.on('request', r => { if (r.url().includes('/api/jobs')) api.push(r.method() + ' ' + r.url().replace(BASE, '').slice(0, 160)); });
await page.goto(BASE + '/jobs', { waitUntil: 'networkidle' }); await sleep(1200);
await shot('04-jobs-empty');
console.log('JOBS EMPTY:\n', await text('main', 1500));
// find inputs
const inputs = await page.locator('main input, main select').evaluateAll(els => els.map(e => `${e.tagName}#${e.id}.${e.className} name=${e.name} ph=${e.placeholder} type=${e.type} val=${e.value}`));
console.log('inputs', inputs);
const title = page.locator('main input').first();
await title.fill('team lead');
const cityInp = page.locator('main input').nth(1);
await cityInp.fill('Phoenix');
await sleep(500); await shot('04-jobs-typed');
const t0 = Date.now();
await page.keyboard.press('Enter');
await page.waitForLoadState('networkidle'); await sleep(2000);
console.log('search ms', Date.now() - t0, 'url', page.url());
await shot('04-jobs-results-phoenix');
console.log('RESULTS:\n', await text('main', 3500));
console.log('overflow', await overflow(), 'tiny', await tiny());
// scroll to see cards
await page.evaluate(() => window.scrollTo(0, 700)); await sleep(600); await shot('04-jobs-results-cards');
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
// change area to Mesa
await cityInp.fill('Mesa'); await page.keyboard.press('Enter'); await page.waitForLoadState('networkidle'); await sleep(2000);
console.log('MESA url', page.url()); await shot('04-jobs-results-mesa');
console.log('MESA:\n', await text('main', 1500));
// radius
const sel = page.locator('main select');
console.log('selects', await sel.evaluateAll(els => els.map(e => e.name + ':' + [...e.options].map(o => o.value + '=' + o.text).join('|'))));
const radius = page.locator('main select').filter({ hasText: /mi/ }).first();
if (await radius.count()) {
  await radius.selectOption({ label: /10/ }).catch(e => console.log('10mi select fail', e.message));
  await page.waitForLoadState('networkidle'); await sleep(2000); console.log('10mi url', page.url()); await shot('04-jobs-10mi'); console.log('10MI:\n', await text('main', 900));
  await radius.selectOption({ label: /50/ }).catch(e => console.log('50mi select fail', e.message));
  await page.waitForLoadState('networkidle'); await sleep(2000); console.log('50mi url', page.url()); await shot('04-jobs-50mi'); console.log('50MI:\n', await text('main', 900));
  await radius.selectOption({ label: /Remote/ }).catch(e => console.log('remote select fail', e.message));
  await page.waitForLoadState('networkidle'); await sleep(2000); console.log('remote url', page.url()); await shot('04-jobs-remote'); console.log('REMOTE:\n', await text('main', 900));
}
console.log('API calls:\n' + api.join('\n'));
await done();
