import { launch, shot, go, text } from './_r1_tasha_lib.mjs'
import fs from 'node:fs'
const NEWPW = process.env.TP2; const EMAIL = 'tasha.signup.r1@seenjobs.io'
const CODEFILE = '/tmp/claude-0/-home-user-Seen/a2979419-ae98-5338-8957-9abbb501877e/scratchpad/round1/tasha-code.txt'
const { ctx, page, logs } = await launch()
// sign out first via settings? Simpler: clear session by visiting /login — if signed in it may bounce. Use the account menu sign out.
await go(page, '/profile', 3000)
await shot(page, '06-profile-settings-top')
console.log('PROFILE:', (await text(page, 'main')).slice(0, 2500))
const so = page.getByRole('button', { name: /^Sign out$/ }).first()
if (await so.count()) { await so.click(); await page.waitForTimeout(3000); console.log('signed out →', page.url()) } else console.log('no sign out button on /profile')
await go(page, '/login', 3000)
await page.getByText('Forgot password?').first().click(); await page.waitForTimeout(2500)
console.log('forgot →', page.url())
await shot(page, '06-reset-step1')
console.log((await text(page, 'main')).slice(0, 800))
await page.fill('input[type=email]', EMAIL)
const t0 = Date.now()
await page.getByRole('button', { name: /send/i }).first().click(); await page.waitForTimeout(3000)
console.log('after send', (Date.now()-t0)+'ms'); await shot(page, '06-reset-step2-waiting')
console.log((await text(page, 'main')).slice(0, 800))
console.log('WAITING FOR CODE FILE'); let code = ''
for (let i = 0; i < 90 && !code; i++) { await page.waitForTimeout(2000); if (fs.existsSync(CODEFILE)) code = fs.readFileSync(CODEFILE, 'utf8').trim() }
console.log('code read', code ? 'yes' : 'TIMEOUT')
await page.fill('input[inputmode=numeric]', code)
await page.fill('#rs-new', NEWPW); await page.fill('#rs-confirm', NEWPW)
await shot(page, '06-reset-step2-filled')
const t1 = Date.now()
await page.locator('button').filter({ hasText: /update|reset|set|verify|continue/i }).first().click()
for (let i = 0; i < 24; i++) { await page.waitForTimeout(500); if (!/\/reset/.test(page.url())) break }
await page.waitForTimeout(3000)
console.log('after verify →', page.url(), (Date.now()-t1)+'ms')
await shot(page, '06-reset-done')
console.log((await text(page, 'main')).slice(0, 400))
console.log(logs.filter(l=>!/preload|vercel.live/.test(l)).join('\n'))
await ctx.close()
