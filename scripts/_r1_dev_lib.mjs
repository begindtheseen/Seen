import { chromium } from 'playwright';
import fs from 'node:fs';
export const BASE = 'https://seen-histkhurz-begindtheseens-projects.vercel.app';
export const SHARE = BASE + '/?_vercel_share=5nNCK1xkcaTVJfOINDPsRGMGkWKpSRQp';
export const SCRATCH = '/tmp/claude-0/-home-user-Seen/a2979419-ae98-5338-8957-9abbb501877e/scratchpad/round1';
export const SHOTS = SCRATCH + '/shots-dev';
export const STATE = SCRATCH + '/.dev-state.json';
fs.mkdirSync(SHOTS, { recursive: true });
export const log = (...a) => console.log(...a);
export const notes = [];
export function note(k, v) { notes.push([k, v]); console.log(`[${k}] ${v}`); }
export async function boot({ state } = {}) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...(state && fs.existsSync(STATE) ? { storageState: STATE } : {}) });
  const page = await ctx.newPage();
  const errors = []; const failed = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().includes('_vercel')) failed.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 140)}`); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  if (!(state && fs.existsSync(STATE))) { await page.goto(SHARE, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); }
  return { browser, ctx, page, errors, failed };
}
export async function go(page, path, { wait = 1500, until = 'networkidle' } = {}) {
  const t0 = Date.now();
  try { await page.goto(path.startsWith('http') ? path : BASE + path, { waitUntil: until, timeout: 45000 }); } catch (e) { note('nav-timeout', path + ' ' + String(e).slice(0, 80)); }
  const ms = Date.now() - t0;
  await page.waitForTimeout(wait);
  return ms;
}
export async function shot(page, name, full = false) {
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p, fullPage: full });
  return p;
}
export async function text(page, sel) { try { return (await page.locator(sel).first().innerText({ timeout: 3000 })).trim(); } catch { return null; } }
export async function overflow(page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth; const out = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el); if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (r.width && r.right > w + 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} right=${Math.round(r.right)}`);
    }
    return { scrollW: document.documentElement.scrollWidth, w, out: out.slice(0, 5) };
  });
}
export async function saveState(ctx) { fs.writeFileSync(STATE, JSON.stringify(await ctx.storageState())); }
export function password() { return fs.readFileSync(SCRATCH + '/.password', 'utf8').trim(); }
export async function dump(tag, errors, failed) {
  const uniq = a => [...new Set(a)];
  console.log(`--- ${tag} console errors (${errors.length}):`); uniq(errors).slice(0, 15).forEach(e => console.log('  ', e));
  console.log(`--- ${tag} failed requests (${failed.length}):`); uniq(failed).slice(0, 20).forEach(e => console.log('  ', e));
  errors.length = 0; failed.length = 0;
}
