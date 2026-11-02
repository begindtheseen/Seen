import { boot, BASE, sleep } from './_r1_maria_lib.mjs';
const { page, shot, done } = await boot();
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await sleep(1200);
const h = await page.evaluate(() => document.body.scrollHeight);
console.log('scrollHeight', h);
let i = 0;
for (let y = 700; y < h && i < 9; y += 760, i++) {
  await page.evaluate(yy => window.scrollTo(0, yy), y);
  await sleep(900);
  await shot(`02-home-scroll-${i}`);
}
// try one chip
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
await page.getByText('Amazon', { exact: true }).first().tap();
await page.waitForLoadState('networkidle'); await sleep(1500);
console.log('after chip url', page.url());
await shot('02-chip-amazon');
await done();
