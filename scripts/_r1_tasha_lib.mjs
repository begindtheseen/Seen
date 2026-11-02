import { chromium } from 'playwright'
import fs from 'node:fs'
export const BASE = 'https://seen-histkhurz-begindtheseens-projects.vercel.app'
export const SHARE = BASE + '/?_vercel_share=5nNCK1xkcaTVJfOINDPsRGMGkWKpSRQp'
export const SHOTS = '/tmp/claude-0/-home-user-Seen/a2979419-ae98-5338-8957-9abbb501877e/scratchpad/round1/shots-tasha'
export const PROFILE = '/tmp/claude-0/-home-user-Seen/a2979419-ae98-5338-8957-9abbb501877e/scratchpad/round1/tasha-profile'
fs.mkdirSync(SHOTS, { recursive: true })
export async function launch(opts = {}) {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: '/opt/pw-browsers/chromium', headless: true,
    viewport: opts.viewport || { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    ...opts.extra,
  })
  const page = ctx.pages()[0] || await ctx.newPage()
  page.setDefaultTimeout(20000)
  const logs = []
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`) })
  page.on('pageerror', e => logs.push(`[pageerror] ${String(e).slice(0, 200)}`))
  page.on('response', r => { if (r.status() >= 400 && !/_vercel|favicon/.test(r.url())) logs.push(`[http ${r.status()}] ${r.url().slice(0, 140)}`) })
  if (!fs.existsSync(PROFILE + '/.shared')) {
    await page.goto(SHARE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500)
    fs.writeFileSync(PROFILE + '/.shared', '1')
  }
  return { ctx, page, logs }
}
export async function shot(page, name, full = false) {
  const p = `${SHOTS}/${name}.png`
  await page.screenshot({ path: p, fullPage: full }); console.log('shot', name)
  return p
}
export async function go(page, path, wait = 2500) {
  const t0 = Date.now()
  const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(wait)
  console.log('GOTO', path, r?.status(), (Date.now() - t0) + 'ms', '→', page.url().replace(BASE, ''))
  return r
}
export async function overflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth; const out = []
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el); if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue
      const r = el.getBoundingClientRect(); if (r.width === 0) continue
      if (r.right > w + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} r=${Math.round(r.right)} l=${Math.round(r.left)} "${(el.textContent || '').trim().slice(0, 40)}"`)
    }
    return { scrollW: document.documentElement.scrollWidth, w, items: out.slice(0, 12) }
  })
}
export async function text(page, sel = 'body') { return (await page.locator(sel).first().innerText()).replace(/\n{3,}/g, '\n\n') }
