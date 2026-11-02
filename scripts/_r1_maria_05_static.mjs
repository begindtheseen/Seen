import { boot, BASE, sleep } from './_r1_maria_lib.mjs';
const { page, shot, done, overflow, tiny, text } = await boot();
const pages = ['/pricing', '/faq', '/agencies', '/demand', '/feed', '/data', '/methods', '/lists', '/ghost-report', '/employers', '/report', '/this-page-does-not-exist', '/login', '/company/zzqx-not-a-real-company-xyz', '/contact', '/privacy'];
for (const p of pages) {
  const t0 = Date.now();
  const resp = await page.goto(BASE + p, { waitUntil: 'networkidle' }).catch(e => null);
  await sleep(1200);
  const name = p.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
  await shot(`05-${name}-top`);
  await page.evaluate(() => window.scrollTo(0, 800)); await sleep(500); await shot(`05-${name}-scroll`);
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log(`\n===== ${p} status=${resp && resp.status()} ms=${Date.now() - t0} title="${await page.title()}"`);
  console.log('overflow', await overflow(), 'tiny', await tiny());
  console.log((await text('main', 2200)));
}
await done();
