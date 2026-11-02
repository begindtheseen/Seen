// Jules (designer review) — screenshots + computed-style metrics at 390 and 1280. Temporary; deleted after the round.
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'https://seen-histkhurz-begindtheseens-projects.vercel.app'
const SHARE = BASE + '/?_vercel_share=5nNCK1xkcaTVJfOINDPsRGMGkWKpSRQp'
const OUT = '/tmp/claude-0/-home-user-Seen/a2979419-ae98-5338-8957-9abbb501877e/scratchpad/round1/shots-jules'
const EMAIL = 'dev.patel.r1@seenjobs.io'
const PW = process.env.R1_PW || ''
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null
const WIDTHS = process.env.W ? process.env.W.split(',').map(Number) : [390, 1280]
fs.mkdirSync(OUT, { recursive: true })

const PUBLIC = [
  ['home', '/'],
  ['jobs-results', (w) => w < 600 ? '/jobs?q=team+lead&loc=Phoenix%2C+AZ&r=25' : '/jobs?q=backend+engineer&loc=Austin%2C+TX&r=25'],
  ['jobs-remote', '/jobs?q=backend+engineer&loc=Remote&r=0'],
  ['job-page', 'FROM_RESULTS'],
  ['company-amazon', '/company/amazon'],
  ['company-stripe', '/company/stripe'],
  ['companies', '/companies'],
  ['compare', '/compare/stripe-vs-databricks'],
  ['pricing', '/pricing'],
  ['login', '/login'],
  ['employers', '/employers'],
  ['faq', '/faq'],
  ['agencies', '/agencies'],
  ['demand', '/demand'],
  ['data', '/data'],
  ['methods', '/methods'],
  ['feed', '/feed'],
  ['report', '/report'],
  ['ghost-report', '/ghost-report'],
  ['404', '/no-such-page-r1-jules'],
  ['company-missing', '/company/zzz-not-a-company-r1'],
]
const SIGNED = [
  ['dashboard', '/dashboard'],
  ['tracker', '/tracker'],
  ['tracker-add', '/tracker?add=1'],
  ['resume', '/resume'],
  ['studio', '/resume/studio'],
  ['profile', '/profile'],
  ['saved', '/saved'],
]

const METRICS = () => {
  const vw = document.documentElement.clientWidth
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0' }
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(s => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const effBg = (el) => {
    let layers = []
    let n = el
    while (n && n !== document.documentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor)
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break }
      n = n.parentElement
    }
    let base = parse(getComputedStyle(document.body).backgroundColor)
    if (!base || base.a === 0) base = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 2, g: 4, b: 10, a: 1 }
    if (base.a < 1) base = blend(base, { r: 2, g: 4, b: 10, a: 1 })
    let out = base
    for (let i = layers.length - 1; i >= 0; i--) out = blend(layers[i], out)
    return out
  }
  const hueOf = ({ r, g, b }) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return null; let h; if (mx === r) h = (g - b) / (mx - mn); else if (mx === g) h = 2 + (b - r) / (mx - mn); else h = 4 + (r - g) / (mx - mn); h *= 60; if (h < 0) h += 360; return { h, s: (mx - mn) / mx } }
  const textEls = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  let node
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim(); if (t.length < 2) continue
    const el = node.parentElement; if (!el || seen.has(el) || !vis(el)) continue
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
    seen.add(el); textEls.push({ el, t })
  }
  const fonts = {}, sizes = []
  const pairs = []
  const accentLabels = []
  const purple = []
  for (const { el, t } of textEls) {
    const cs = getComputedStyle(el)
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(); fonts[fam] = (fonts[fam] || 0) + 1
    const fs = parseFloat(cs.fontSize); sizes.push({ fs, t: t.slice(0, 40), cls: (el.className && el.className.baseVal === undefined ? el.className : '').toString().slice(0, 40), tag: el.tagName })
    const fg = parse(cs.color); if (!fg) continue
    const bg = effBg(el)
    const fg2 = fg.a < 1 ? blend(fg, bg) : fg
    const r = ratio(fg2, bg)
    pairs.push({ r: +r.toFixed(2), fs, w: cs.fontWeight, t: t.slice(0, 50), fg: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50) })
    const hs = hueOf(fg2)
    if (hs && hs.s > 0.3 && hs.h >= 255 && hs.h <= 320) purple.push({ t: t.slice(0, 40), c: cs.color })
    const isLinkish = el.closest('a,button,[role=button],[role=tab]')
    if (!isLinkish && cs.color === 'rgb(96, 165, 250)' && fs <= 13) accentLabels.push({ t: t.slice(0, 40), tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40) })
  }
  pairs.sort((a, b) => a.r - b.r)
  const low = pairs.filter(p => p.r < 4.5).slice(0, 12)
  const lowAll = pairs.filter(p => p.r < 4.5).length
  const h1s = [...document.querySelectorAll('h1')].filter(vis).map(h => h.textContent.trim().slice(0, 80))
  const ctrls = [...document.querySelectorAll('button,a[href],input,select,textarea,[role=button]')].filter(vis)
  const filled = ctrls.filter(c => { const b = getComputedStyle(c).backgroundColor; return b === 'rgb(37, 99, 235)' || b === 'rgb(29, 78, 216)' }).map(c => c.textContent.trim().slice(0, 40) || c.getAttribute('aria-label') || c.tagName)
  const small = ctrls.filter(c => { const r = c.getBoundingClientRect(); return (r.height < 44 || r.width < 44) && !(c.tagName === 'A' && getComputedStyle(c).display === 'inline') }).map(c => { const r = c.getBoundingClientRect(); return { t: (c.textContent.trim() || c.getAttribute('aria-label') || c.tagName).slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) } })
  const inlineSmall = ctrls.filter(c => c.tagName === 'A' && getComputedStyle(c).display === 'inline' && c.getBoundingClientRect().height < 24).length
  const overflow = [...document.querySelectorAll('body *')].filter(el => { if (!vis(el)) return false; const cs = getComputedStyle(el); if (cs.position === 'fixed') return false; const r = el.getBoundingClientRect(); return r.right > vw + 1 && r.width > 10 }).slice(0, 8).map(el => ({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40), right: Math.round(el.getBoundingClientRect().right) }))
  const scrollW = document.documentElement.scrollWidth
  const grads = [...document.querySelectorAll('body *')].filter(el => vis(el) && /gradient/.test(getComputedStyle(el).backgroundImage)).slice(0, 6).map(el => ({ tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40), bg: getComputedStyle(el).backgroundImage.slice(0, 90) }))
  const blurs = [...document.querySelectorAll('body *')].filter(el => vis(el) && getComputedStyle(el).backdropFilter && getComputedStyle(el).backdropFilter !== 'none').length
  const emoji = textEls.filter(({ t }) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)).slice(0, 6).map(({ t }) => t.slice(0, 40))
  const imgsNoAlt = [...document.querySelectorAll('img')].filter(i => vis(i) && !i.getAttribute('alt')).length
  const iconBtnsNoName = ctrls.filter(c => c.tagName === 'BUTTON' && !c.textContent.trim() && !c.getAttribute('aria-label') && !c.getAttribute('title')).length
  // line length: longest paragraph-ish text block width / avg char width
  const paras = [...document.querySelectorAll('p,li,dd,.sub,[class*=sub],[class*=desc],[class*=lead]')].filter(el => vis(el) && el.textContent.trim().length > 90).map(el => { const r = el.getBoundingClientRect(); const fs = parseFloat(getComputedStyle(el).fontSize); return Math.round(r.width / (fs * 0.5)) })
  const maxCpl = paras.length ? Math.max(...paras) : null
  const minFs = sizes.length ? Math.min(...sizes.map(s => s.fs)) : null
  const under12 = sizes.filter(s => s.fs < 12).slice(0, 6)
  const h = document.documentElement.scrollHeight
  return { title: document.title, h1s, filled, fonts, minFs, under12, lowContrast: low, lowContrastCount: lowAll, textSamples: pairs.length, small: small.slice(0, 12), smallCount: small.length, inlineSmall, overflow, scrollW, vw, grads, blurs, emoji, imgsNoAlt, iconBtnsNoName, maxCpl, accentLabels: accentLabels.slice(0, 8), accentLabelCount: accentLabels.length, purple: purple.slice(0, 5), pageH: h }
}

async function settle(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }) } catch {}
  await page.waitForTimeout(2500)
}

async function shoot(page, name, w) {
  const fold = `${OUT}/${name}-${w}.png`, full = `${OUT}/${name}-${w}-full.png`
  await page.screenshot({ path: fold })
  try { await page.screenshot({ path: full, fullPage: true }) } catch (e) { console.log('fullpage fail', name, e.message) }
  return [fold, full]
}

async function run(w) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const phone = w < 600
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push({ url: page.url(), msg: String(e.message).slice(0, 160) }))
  page.on('console', m => { if (m.type() === 'error') errors.push({ url: page.url(), msg: ('console: ' + m.text()).slice(0, 160) }) })
  await page.goto(SHARE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await settle(page)
  const results = {}
  let jobHref = null
  const visit = async (name, path) => {
    if (ONLY && !ONLY.includes(name)) return
    try {
      if (path === 'FROM_RESULTS') { if (!jobHref) { results[name] = { skipped: 'no job href' }; return } path = jobHref }
      const t0 = Date.now()
      const resp = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 })
      const dcl = Date.now() - t0
      await settle(page)
      if (name === 'jobs-results') { await page.waitForTimeout(4000); jobHref = await page.evaluate(() => document.querySelector('a[href^="/jobs/"]')?.getAttribute('href') || null) }
      const m = await page.evaluate(METRICS)
      m.status = resp?.status(); m.dcl = dcl; m.url = page.url()
      await shoot(page, name, w)
      results[name] = m
      console.log(w, name, m.status, 'h1:', m.h1s.length, 'filled:', m.filled.length, 'minFs:', m.minFs, 'low:', m.lowContrastCount, 'small:', m.smallCount, 'ovf:', m.overflow.length, 'sw:', m.scrollW)
    } catch (e) { results[name] = { error: e.message.slice(0, 200) }; console.log(w, name, 'ERR', e.message.slice(0, 120)) }
  }
  for (const [name, p] of PUBLIC) await visit(name, typeof p === 'function' ? p(w) : p)

  // Focus walk on home and jobs (public), capture a few focused frames.
  const focusWalk = async (name, path, steps) => {
    if (ONLY && !ONLY.includes('focus')) return
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
    const log = []
    for (let i = 1; i <= steps; i++) {
      await page.keyboard.press('Tab'); await page.waitForTimeout(120)
      const info = await page.evaluate(() => {
        const a = document.activeElement; if (!a || a === document.body) return { tag: 'BODY' }
        const cs = getComputedStyle(a); const r = a.getBoundingClientRect()
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none')
        const inView = r.top >= 0 && r.bottom <= window.innerHeight
        return { tag: a.tagName, t: (a.textContent.trim() || a.getAttribute('aria-label') || a.getAttribute('placeholder') || '').slice(0, 30), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 50), ring, inView, y: Math.round(r.top) }
      })
      log.push(info)
      if (i === 3 || i === 7 || i === 12) await page.screenshot({ path: `${OUT}/focus-${name}-tab${i}-${w}.png` })
    }
    results['focus-' + name] = log
    console.log(w, 'focus', name, log.map(l => (l.ring ? '+' : '-') + l.tag).join(' '))
  }
  await focusWalk('home', '/', 14)
  await focusWalk('jobs', phone ? '/jobs?q=team+lead&loc=Phoenix%2C+AZ&r=25' : '/jobs?q=backend+engineer&loc=Austin%2C+TX&r=25', 14)

  // Signed-in screens
  if (PW && (!ONLY || SIGNED.some(([n]) => ONLY.includes(n)))) {
    try {
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 }); await settle(page)
      await page.fill('#si-email', EMAIL); await page.fill('#si-pw', PW)
      await page.getByRole('button', { name: /^Sign in/ }).click()
      await page.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 30000 })
      await settle(page)
      console.log(w, 'signed in →', page.url())
      for (const [name, p] of SIGNED) await visit(name, p)
    } catch (e) { results['signin'] = { error: e.message.slice(0, 200) }; console.log(w, 'signin ERR', e.message.slice(0, 160)); await page.screenshot({ path: `${OUT}/signin-fail-${w}.png` }) }
  }
  results._errors = errors.slice(0, 40)
  fs.writeFileSync(`${OUT}/metrics-${w}.json`, JSON.stringify(results, null, 1))
  await browser.close()
}

for (const w of WIDTHS) await run(w)
