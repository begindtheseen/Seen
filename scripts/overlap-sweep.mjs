// Phone sweep for floating/fixed controls that sit on top of text (owner 2026-11-01: "this button
// overlaps everything"). For each page at phone widths it scrolls top → bottom and, at each stop,
// reports any visible fixed/sticky element that intersects a text element it does not contain —
// excluding the top nav at the very top and full-screen overlays. Every /api call is stubbed.
//
//   npx next start -p 3100 &  node scripts/overlap-sweep.mjs
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3100';
const PAGES = (process.env.PAGES || '/,/jobs?q=cashier&loc=Phoenix%2C+AZ,/companies,/company/walmart,/tracker,/pricing,/resume,/feed,/saved,/faq,/agencies,/login,/employers,/demand,/methods').split(',');
const WIDTHS = [360, 390];
const JOBS = Array.from({ length: 12 }, (_, i) => ({ id: `fx-${i}`, title: `Cashier ${i}`, company: `Shop ${i}`, location: 'Phoenix, AZ', description: 'x', apply_url: 'https://example.com', relevance: 1, related: true, in_radius: true }));

const browser = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
let total = 0;
for (const width of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true });
  await ctx.route('**/api/**', (route) => {
    const req = route.request();
    let body = {}; try { body = req.postDataJSON() || {}; } catch { /* */ }
    if (new URL(req.url()).pathname === '/api/jobs' && body.query) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: JOBS }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route((u) => !u.href.startsWith(BASE), (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(800);
    const hits = await page.evaluate(async () => {
      const out = new Map();
      const vh = window.innerHeight, vw = window.innerWidth;
      const H = document.documentElement.scrollHeight;
      const stops = [];
      for (let y = 0; y <= H; y += Math.round(vh * 0.6)) stops.push(y);
      stops.push(H);
      const textEls = () => [...document.querySelectorAll('body *')].filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (!own) return false;
        const cs = getComputedStyle(el);
        return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.1;
      });
      const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
      for (const y of stops) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
        const floats = [...document.querySelectorAll('body *')].filter((el) => {
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
          if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1 || cs.pointerEvents === 'none') return false;
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) return false;
          if (r.width >= vw * 0.98 && r.height >= vh * 0.9) return false; // overlay
          if (el.closest('[aria-hidden="true"]')) return false;
          return r.bottom > 0 && r.top < vh;
        });
        // Only the topmost float of a nested pair counts.
        const tops = floats.filter((f) => !floats.some((g) => g !== f && g.contains(f)));
        const texts = textEls();
        for (const f of tops) {
          const fr = f.getBoundingClientRect();
          for (const t of texts) {
            if (f.contains(t) || t.contains(f)) continue;
            // Things that are themselves inside a float at the same layer (the nav's own text) are not overlap.
            if (t.closest('nav, header') && f.closest('nav, header')) continue;
            const tr = t.getBoundingClientRect();
            const ix = Math.min(fr.right, tr.right) - Math.max(fr.left, tr.left);
            const iy = Math.min(fr.bottom, tr.bottom) - Math.max(fr.top, tr.top);
            if (ix <= 4 || iy <= 4) continue;
            // Is the text actually covered (the float is what's painted at the overlap's centre)?
            const cx = Math.max(fr.left, tr.left) + ix / 2, cy = Math.max(fr.top, tr.top) + iy / 2;
            const topEl = document.elementFromPoint(cx, cy);
            if (!topEl || !f.contains(topEl)) continue;
            // At the end of the page, a bar or button in the lower part of the screen covers text that
            // can no longer scroll out from under it. (The top nav over scrolled content is normal.)
            const stuckAtEnd = window.scrollY >= document.documentElement.scrollHeight - vh - 2 && fr.top > vh * 0.4;
            const key = `${label(f)} ⟂ ${label(t)}`;
            if (!out.has(key)) out.set(key, { float: label(f), text: t.textContent.trim().slice(0, 50), y, stuckAtEnd, rect: [Math.round(fr.left), Math.round(fr.top), Math.round(fr.width), Math.round(fr.height)] });
          }
        }
      }
      return [...out.values()].filter((h) => h.stuckAtEnd);
    });
    for (const h of hits) { total++; console.log(`${width}px ${path}  ${h.float} [${h.rect}] covers “${h.text}”`); }
  }
  await ctx.close();
}
await browser.close();
console.log(total ? `\n${total} overlap(s)` : 'no overlaps');
