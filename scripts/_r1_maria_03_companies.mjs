import { boot, BASE, sleep } from './_r1_maria_lib.mjs';
const { page, shot, done, overflow, tiny, text } = await boot();
// Amazon full scroll
await page.goto(BASE + '/company/amazon', { waitUntil: 'networkidle' }); await sleep(1500);
const h = await page.evaluate(() => document.body.scrollHeight); console.log('amazon h', h);
for (let i = 1, y = 760; y < h && i <= 8; y += 760, i++) { await page.evaluate(yy => window.scrollTo(0, yy), y); await sleep(700); await shot(`03-amazon-${i}`); }
console.log('AMAZON TEXT:\n', await text('main', 7000));
console.log('overflow', await overflow(), 'tiny', await tiny());
// Target via homepage search
await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await sleep(800);
await page.getByPlaceholder('Company or job title').fill('Target');
await sleep(1200); await shot('03-home-search-target-typed');
console.log('suggest text:', await text('body', 1500));
await page.getByRole('button', { name: 'Search' }).first().tap();
await page.waitForLoadState('networkidle'); await sleep(1500);
console.log('after search url', page.url()); await shot('03-search-target-result');
console.log('TARGET TEXT:\n', await text('main', 3500));
for (const c of ['walmart', "fry's-food-stores", 'frys-food-stores', "fry's"]) {
  await page.goto(BASE + '/company/' + encodeURIComponent(c), { waitUntil: 'networkidle' }); await sleep(1500);
  await shot(`03-co-${c.replace(/[^a-z]/g, '')}`);
  console.log(`== ${c} ==\n`, await text('main', 1800));
}
await done();
