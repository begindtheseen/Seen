import { chromium } from 'playwright';
import fs from 'node:fs';
export const BASE = 'https://seen-histkhurz-begindtheseens-projects.vercel.app';
export const SHARE = BASE + '/?_vercel_share=5nNCK1xkcaTVJfOINDPsRGMGkWKpSRQp';
export const OUT = '/tmp/claude-0/-home-user-Seen/a2979419-ae98-5338-8957-9abbb501877e/scratchpad/round1/shots-maria';
export const STATE = '/tmp/claude-0/-home-user-Seen/a2979419-ae98-5338-8957-9abbb501877e/scratchpad/round1/maria-state.json';
export async function boot({ fresh = false } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const opts = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
  if (!fresh && fs.existsSync(STATE)) opts.storageState = STATE;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = []; const failed = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('_vercel')) failed.push(r.status() + ' ' + r.url().slice(0, 140)); });
  await page.goto(SHARE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const t0 = Date.now();
  const shot = async (name, full = false) => { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); console.log(`[shot] ${name} @${page.url()}`); };
  const save = async () => ctx.storageState({ path: STATE });
  const done = async () => { await save(); console.log('console errors:', JSON.stringify([...new Set(errors)].slice(0, 15), null, 1)); console.log('failed responses:', JSON.stringify([...new Set(failed)].slice(0, 15), null, 1)); await browser.close(); };
  const overflow = async () => page.evaluate(() => { const w = document.documentElement.clientWidth; const bad = []; for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.position === 'fixed' || cs.display === 'none') continue; const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > w + 1) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`); if (bad.length > 8) break; } return bad; });
  const tiny = async () => page.evaluate(() => { const out = []; for (const el of document.querySelectorAll('body *')) { if (!el.childNodes.length) continue; const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(''); if (!txt) continue; const fs = parseFloat(getComputedStyle(el).fontSize); const r = el.getBoundingClientRect(); if (fs < 11.5 && r.width > 0 && r.height > 0) out.push(`${fs}px "${txt.slice(0, 30)}"`); } return [...new Set(out)].slice(0, 10); });
  const text = async (sel = 'body', n = 3000) => (await page.locator(sel).first().innerText()).replace(/\n{2,}/g, '\n').slice(0, n);
  return { browser, ctx, page, shot, save, done, overflow, tiny, text, errors, failed };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
