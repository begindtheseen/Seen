import { launch, shot, go, overflow, text } from './_r1_tasha_lib.mjs'
const { ctx, page, logs } = await launch()
await go(page, '/', 4000)
await shot(page, '01-home-first-screen')
await shot(page, '01-home-full', true)
console.log(await overflow(page))
console.log((await text(page)).slice(0, 3000))
// tap first "try one" chip if any
const chips = await page.locator('button, a').filter({ hasText: /^(Amazon|Target|Walmart|Starbucks|Google)$/ }).all()
console.log('chips', chips.length)
console.log(logs.join('\n'))
await ctx.close()
