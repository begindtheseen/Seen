import { launch, shot, go } from './_r1_tasha_lib.mjs'
const { ctx, page, logs } = await launch()
await go(page, '/', 3000)
const h = await page.evaluate(() => document.documentElement.scrollHeight)
console.log('height', h)
let i = 0
for (let y = 700; y < h && i < 14; y += 780, i++) {
  await page.evaluate(yy => window.scrollTo(0, yy), y); await page.waitForTimeout(900)
  await shot(page, `02-home-scroll-${String(i).padStart(2,'0')}-y${y}`)
}
console.log(logs.filter(l=>!/preload|vercel.live/.test(l)).join('\n'))
await ctx.close()
