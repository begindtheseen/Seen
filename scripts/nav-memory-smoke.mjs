// Real-browser check of the "remembers where you came from" navigation (owner 2026-11-01: "be more
// like Indeed"). Runs against a local `next start` (default http://localhost:3100); every /api call is
// stubbed with fixtures, so nothing reaches production.
//
//   npm run build && npx next start -p 3100 &  node scripts/nav-memory-smoke.mjs
//
// Flows:
//   1. /jobs search → open a listing (URL gets ?job=) → Back closes it, list + scroll kept.
//   2. Listing → its own page → Back reopens the listing over the SAME list (no new search request)
//      → Back again closes it, list still there at the same scroll.
//   3. A full page load away (another URL) and Back → same as 2 (results come from this tab's memory).
//   4. A popup (company preview) closes on Back without leaving the page.
//   5. Signed out, /tracker?app=<uuid> (the check-in email) → sign-in with a return to that card.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3100';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const JOBS = Array.from({ length: 40 }, (_, i) => ({
  id: `fx-${i + 1}`,
  title: `Cashier ${i + 1}`,
  company: `Shop ${String.fromCharCode(65 + (i % 26))}${i}`,
  location: 'Phoenix, AZ',
  description: 'Ring up customers. '.repeat(20),
  apply_url: `https://example.com/apply/${i + 1}`,
  relevance: 1 - i / 100,
  related: true,
  in_radius: true,
  posted_at: new Date().toISOString(),
  score: 70,
}));

let searchCalls = 0;
const browser = await chromium.launch(process.env.PW_CHROME || existsSync('/opt/pw-browsers/chromium') ? { executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium' } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('pageerror:', e.message));

await ctx.route('**/api/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  let body = {};
  try { body = req.postDataJSON() || {}; } catch { /* not json */ }
  if (url.pathname === '/api/jobs' && req.method() === 'POST' && body.query) {
    searchCalls++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobs: JOBS, has_more: false }) });
  }
  if (url.pathname === '/api/jobs') {
    const id = url.searchParams.get('id') || body.id;
    const job = JOBS.find(j => j.id === id) || JOBS[0];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job, jobs: [job] }) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});
// Nothing outside the local server (Supabase, fonts, analytics).
await ctx.route(u => !u.href.startsWith(BASE), route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

const jobParam = () => new URL(page.url()).searchParams.get('job');
const drawerOpen = () => page.locator('[role="dialog"][aria-modal="true"]').filter({ hasText: 'Cashier' }).count();
const cards = () => page.locator('article [role="button"][aria-label*="open details"]').count();
const wait = (ms) => page.waitForTimeout(ms);

// ── 1 ──
await page.goto(`${BASE}/jobs?q=cashier&loc=Phoenix%2C+AZ`, { waitUntil: 'networkidle' });
await page.locator('article [role="button"]').first().waitFor();
check('search renders results', (await cards()) >= 30, `${await cards()} cards, ${searchCalls} search call(s)`);
const card = page.locator('article [role="button"]').nth(24);
await card.scrollIntoViewIfNeeded();
await wait(400);
const y0 = await page.evaluate(() => window.scrollY);
await card.click();
await wait(500);
check('opening a listing puts it in the URL', jobParam() === 'fx-25', page.url());
check('drawer is open', (await drawerOpen()) > 0);
await page.goBack();
await wait(600);
check('Back closes the listing', !jobParam() && (await drawerOpen()) === 0, page.url());
check('list is still there after Back', (await cards()) >= 30);
const y1 = await page.evaluate(() => window.scrollY);
check('scroll kept after closing', Math.abs(y1 - y0) < 80, `before ${y0}, after ${y1}`);

// ── 2 ──
const callsBefore = searchCalls;
await page.locator('article [role="button"]').nth(24).click();
await wait(500);
await page.locator('a[aria-label="Open the listing\'s own page"]').click();
await page.waitForURL(/\/jobs\/fx-25/);
await wait(800);
check('listing page opened', /\/jobs\/fx-25$/.test(new URL(page.url()).pathname));
const backBtn = page.getByRole('button', { name: /^Back to/ }).first();
const backLabel = (await backBtn.count()) ? (await backBtn.textContent())?.trim() : '(none)';
check('listing page Back button names where you came from', /Back to (results|the listing)/.test(backLabel || ''), backLabel);
await page.goBack();
await page.waitForURL(/\/jobs\?/);
await wait(1200);
check('Back from the listing page reopens the listing', jobParam() === 'fx-25' && (await drawerOpen()) > 0, page.url());
check('list behind it is the same, with no new search', (await cards()) >= 30 && searchCalls === callsBefore, `${searchCalls - callsBefore} new search call(s)`);
await page.goBack();
await wait(800);
check('Back again closes it — list still there', !jobParam() && (await drawerOpen()) === 0 && (await cards()) >= 30, page.url());
const y2 = await page.evaluate(() => window.scrollY);
check('scroll restored on the list', Math.abs(y2 - y0) < 120, `expected ~${y0}, got ${y2}`);

// ── 3 ── a full page load away (like the employer's site, or a plain link) and Back
await page.locator('article [role="button"]').nth(24).click();
await wait(500);
const calls3 = searchCalls;
await page.goto(`${BASE}/faq`, { waitUntil: 'load' });
await wait(400);
await page.goBack({ waitUntil: 'load' });
await wait(1500);
check('after a full page load, Back reopens the listing', jobParam() === 'fx-25' && (await drawerOpen()) > 0, page.url());
check('…over the same results from this tab\'s memory', (await cards()) >= 30 && searchCalls === calls3, `${searchCalls - calls3} new search call(s)`);
await page.goBack();
await wait(800);
check('…and Back again closes it', !jobParam() && (await cards()) >= 30, page.url());

// ── 4 ── popup closes on Back
const urlBefore = page.url();
await page.locator('article button', { hasText: /check|grade|company/i }).first().click().catch(() => {});
await wait(600);
const dialogs = await page.locator('.ui-dialog').count();
if (dialogs) {
  await page.goBack();
  await wait(700);
  check('Back closes a popup without leaving the page', (await page.locator('.ui-dialog').count()) === 0 && page.url() === urlBefore, page.url());
} else {
  check('company preview popup opened', false, 'no .ui-dialog after clicking the card\'s company check');
}

// ── 4b ── a popup closed with ✕, then ONE Back leaves the page (no wasted press)
await page.goto(`${BASE}/faq`, { waitUntil: 'load' });
await page.goto(`${BASE}/jobs?q=cashier&loc=Phoenix%2C+AZ`, { waitUntil: 'load' });
await page.locator('article [role="button"]').first().waitFor();
await page.locator('article button', { hasText: /check|grade|company/i }).first().click().catch(() => {});
await wait(600);
await page.locator('.ui-dialog__close').click().catch(() => {});
await wait(500);
check('✕ closes the popup', (await page.locator('.ui-dialog').count()) === 0);
await page.goBack();
await wait(1500);
check('then one Back leaves the page', new URL(page.url()).pathname === '/faq', page.url());
await page.goForward();
await wait(1500);
await page.locator('article [role="button"]').first().waitFor();

// ── 4c ── listing → open the company preview from it → Back closes the preview, not the page
await page.locator('article [role="button"]').nth(3).click();
await wait(500);
const coBtn = page.locator('[role="dialog"] button', { hasText: /check|grade|how .* treats|company/i }).first();
if (await coBtn.count()) {
  await coBtn.click();
  await wait(900);
  const popup = (await page.locator('.ui-dialog').count()) > 0;
  check('drawer hands off to the company preview', popup && !jobParam(), page.url());
  await page.goBack();
  await wait(900);
  check('Back closes the preview and stays on the results', (await page.locator('.ui-dialog').count()) === 0 && /\/jobs\?/.test(page.url()) && (await cards()) >= 30, page.url());
} else {
  console.log('SKIP drawer → company preview (no such button in the drawer)');
}

// ── 6 ── after a search (phone), the location can be changed: the row opens and stays open
await page.goto(`${BASE}/jobs?q=cashier&loc=Phoenix%2C+AZ`, { waitUntil: 'networkidle' });
await page.locator('article [role="button"]').first().waitFor();
const loc = page.locator('input[aria-label="City or state"]');
check('after a search the location row is tucked into a "where" line', !(await loc.isVisible()) && (await page.getByRole('button', { name: /Change location/ }).isVisible()));
await page.getByRole('button', { name: /Change location/ }).tap();
await wait(300);
check('tapping it opens the location field', await loc.isVisible());
await page.locator('input[aria-label="Job title, role or company"]').tap();
await wait(200);
await loc.tap();
await wait(300);
check('moving between the title and city boxes keeps it open', await loc.isVisible());
await page.locator('select[aria-label="Distance"]').focus();
await wait(200);
check('…and so does the distance control', await loc.isVisible());
const callsLoc = searchCalls;
await loc.fill('Tucson, AZ');
await loc.press('Enter');
await wait(1200);
check('a new area searches', searchCalls > callsLoc && new URL(page.url()).searchParams.get('loc') === 'Tucson, AZ', page.url());
check('…and the row tucks away again', !(await loc.isVisible()));

// ── 5 ── signed-out check-in email link
const uuid = '9f1c2d3e-0000-4000-8000-000000000001';
await page.goto(`${BASE}/tracker?app=${uuid}`, { waitUntil: 'networkidle' });
await wait(1500);
const u5 = new URL(page.url());
check('signed-out email link goes to sign-in', u5.pathname === '/login', page.url());
check('…with a return to that application', u5.searchParams.get('return') === `/tracker?app=${uuid}`, u5.searchParams.get('return') || '');

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
