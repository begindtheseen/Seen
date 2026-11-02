// Runtime taste audit (DESIGN.md §7) against a local `next start` (default http://localhost:3100). Every
// /api call is stubbed, so nothing reaches production.
//
//   npm run build && npx next start -p 3100 &  node scripts/design-audit.mjs
//
// Per page, at phone (390) and desktop (1280) width:
//   h1       exactly one <h1> on the screen (DESIGN.md §3)
//   fonts    at most two font families in computed styles — Syne + Instrument Sans (§3)
//   cta      at most one filled primary button (--cta fill) in the first viewport (§5)
//   60/30/10 pixel share of the first viewport: dark field ≥ 55%, colour ≤ 15% (§2) — reported, failed when far off
//   purple   no computed colour in the retired indigo/violet family (belt and braces over designRules.test.mjs)
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const BASE = process.env.BASE || 'http://localhost:3100';
const PAGES = [
  '/', '/jobs?q=cashier&loc=Phoenix%2C+AZ', '/jobs/fx-1', '/tracker', '/pricing', '/companies', '/company/amazon',
  '/login', '/resume', '/dashboard', '/faq', '/agencies', '/report', '/employers',
];
const WIDTHS = [[390, 844, true], [1280, 800, false]];
const CTA_FILL = 'rgb(37, 99, 235)';
const fails = [];
const rows = [];

const JOBS = Array.from({ length: 12 }, (_, i) => ({
  id: `fx-${i + 1}`, title: `Cashier ${i + 1}`, company: `Shop ${i}`, location: 'Phoenix, AZ',
  description: 'Ring up customers. '.repeat(20), apply_url: `https://example.com/a/${i}`, relevance: 1 - i / 100,
  related: true, in_radius: true, posted_at: new Date().toISOString(), score: 70, salary_min: 36000, salary_max: 42000,
}));

const browser = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
for (const [w, h, mobile] of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  await ctx.route('**/api/**', async (route) => {
    const req = route.request(); const u = new URL(req.url()); let b = {};
    try { b = req.postDataJSON() || {}; } catch { /* not json */ }
    if (u.pathname === '/api/jobs' && req.method() === 'POST' && b.query) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: JOBS, has_more: false }) });
    if (u.pathname === '/api/jobs') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: JOBS[0], jobs: [JOBS[0]] }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route((u) => !u.href.startsWith(BASE), (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(900);
    const m = await page.evaluate(({ CTA_FILL }) => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const inFold = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
      const h1 = [...document.querySelectorAll('h1')].filter(vis).length;
      const fam = (s) => s.split(',')[0].replace(/['"]/g, '').replace(/^__/, '').replace(/_[A-Za-z0-9]+$/, '').replace(/ Fallback$/, '').trim();
      const fonts = new Set(); const purple = [];
      const isPurple = (s) => { const c = s && s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (!c) return false; const [r, g, b] = [+c[1], +c[2], +c[3]]; return b > 150 && r > g + 30 && b > g + 40 && r > 90; };
      for (const el of document.querySelectorAll('body *')) {
        if (!vis(el)) continue;
        const cs = getComputedStyle(el);
        if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) fonts.add(fam(cs.fontFamily));
        for (const p of ['color', 'backgroundColor', 'borderTopColor']) if (isPurple(cs[p])) purple.push(`${el.tagName}.${String(el.className).slice(0, 24)} ${p}=${cs[p]}`);
      }
      const ctas = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"]')].filter((el) => vis(el) && inFold(el) && getComputedStyle(el).backgroundColor === CTA_FILL).map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30));
      return { h1, fonts: [...fonts].filter((f) => !/^(serif|sans-serif|monospace|system-ui|inherit)$/.test(f)), ctas, purple: purple.slice(0, 5) };
    }, { CTA_FILL });
    // 60/30/10 — first viewport pixels: dark field / neutral ink / colour
    const png = await page.screenshot({ fullPage: false });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    let dark = 0, neutral = 0, colour = 0; const n = info.width * info.height;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 48) dark++; else if (mx - mn <= 28) neutral++; else colour++;
    }
    const share = { dark: Math.round(100 * dark / n), neutral: Math.round(100 * neutral / n), colour: Math.round(100 * colour / n) };
    const row = { page: path, w, h1: m.h1, fonts: m.fonts.join(' + '), ctas: m.ctas.length, share: `${share.dark}/${share.neutral}/${share.colour}` };
    rows.push(row);
    const bad = [];
    if (m.h1 !== 1) bad.push(`h1 count ${m.h1}`);
    if (m.fonts.length > 2) bad.push(`fonts: ${m.fonts.join(', ')}`);
    if (m.ctas.length > 1) bad.push(`${m.ctas.length} filled CTAs in the first viewport: ${m.ctas.join(' | ')}`);
    if (share.colour > 15 || share.dark < 55) bad.push(`60/30/10 off: dark ${share.dark}% colour ${share.colour}%`);
    if (m.purple.length) bad.push(`purple: ${m.purple.join('; ')}`);
    if (bad.length) fails.push(`${path} @${w}: ${bad.join(' · ')}`);
  }
  await ctx.close();
}
await browser.close();
console.table(rows);
if (fails.length) { console.log(`\nFAIL ${fails.length}\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`\nPASS — ${rows.length} page/width checks: one h1, ≤2 fonts, ≤1 filled CTA per viewport, 60/30/10 within range, no purple`);
