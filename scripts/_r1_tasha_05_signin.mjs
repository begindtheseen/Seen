import { launch, shot, go, text, overflow } from './_r1_tasha_lib.mjs'
const PW = process.env.TP; const EMAIL = 'tasha.signup.r1@seenjobs.io'
const { ctx, page, logs } = await launch()
await go(page, '/login', 3000)
await page.fill('input[type=email]', EMAIL)
await page.fill('input[type=password]', PW)
const t0 = Date.now()
await page.getByRole('button', { name: /^Sign in/ }).click()
for (let i = 0; i < 20; i++) { await page.waitForTimeout(500); if (!/\/login/.test(page.url())) break }
await page.waitForTimeout(4000)
console.log('after sign in →', page.url(), (Date.now()-t0)+'ms')
await shot(page, '05-dashboard-first-view')
console.log((await text(page, 'main')).slice(0, 3500))
console.log(await overflow(page))
const h = await page.evaluate(() => document.documentElement.scrollHeight); console.log('h', h)
for (let y = 780, i = 1; y < h && i < 6; y += 780, i++) { await page.evaluate(yy => window.scrollTo(0, yy), y); await page.waitForTimeout(700); await shot(page, `05-dashboard-scroll-${i}`) }
console.log(logs.filter(l=>!/preload|vercel.live/.test(l)).join('\n'))
await ctx.close()
