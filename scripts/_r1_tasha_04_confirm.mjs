import { launch, shot, go, text } from './_r1_tasha_lib.mjs'
const LINK = process.env.LINK
const { ctx, page, logs } = await launch()
await go(page, '/login', 3000)
console.log('login page after reload shows:', (await text(page, 'main')).slice(0, 400).replace(/\n/g,' | '))
await shot(page, '04-login-tab-before-confirm')
const p2 = await ctx.newPage()
const hops = []
p2.on('response', r => { if ([301,302,303,307,308].includes(r.status())) hops.push(`${r.status()} ${r.url().slice(0,120)} -> ${r.headers()['location']?.slice(0,160)}`) })
const t0 = Date.now()
await p2.goto(LINK, { waitUntil: 'domcontentloaded' }).catch(e => console.log('nav err', e.message))
await p2.waitForTimeout(5000)
console.log('LINK landed on:', p2.url(), (Date.now()-t0)+'ms')
console.log(hops.join('\n'))
await p2.screenshot({ path: process.env.SHOTS_DIR + '/04-confirm-link-landing.png' })
console.log('landing text:', (await p2.locator('body').innerText()).slice(0, 600).replace(/\n+/g,' | '))
// watch the first tab
for (let i = 0; i < 6; i++) { await page.waitForTimeout(5000); console.log('tab1 after', (i+1)*5, 's →', page.url()); if (!/login/.test(page.url())) break }
await shot(page, '04-login-tab-after-confirm')
console.log((await text(page, 'main')).slice(0, 600).replace(/\n/g,' | '))
console.log(logs.filter(l=>!/preload|vercel.live/.test(l)).join('\n'))
await ctx.close()
