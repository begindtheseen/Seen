import { boot, BASE, sleep } from './_r1_maria_lib.mjs';
const { page, shot, done, text } = await boot();
for (const c of ['walmart', "fry's-food-stores", 'frys', "fry's", 'target']) {
  await page.goto(BASE + '/company/' + encodeURIComponent(c), { waitUntil: 'networkidle' }); await sleep(1500);
  await shot(`03-co-${c.replace(/[^a-z]/g, '')}`);
  console.log(`== ${c} == title=${await page.title()}\n`, (await text('main', 1500)));
}
// companies leaderboard
await page.goto(BASE + '/companies', { waitUntil: 'networkidle' }); await sleep(1500);
await shot('03-companies-top');
await page.evaluate(() => window.scrollTo(0, 900)); await sleep(600); await shot('03-companies-scroll');
console.log('== /companies ==\n', await text('main', 3000));
// search Fry's in companies page
const inp = page.locator('input').first();
if (await inp.count()) { await inp.fill("Fry's"); await sleep(1500); await shot('03-companies-search-frys'); console.log('== frys search ==\n', await text('main', 1500)); }
await done();
