// Résumé Studio end-to-end smoke test against the PRODUCTION build — no deploy, no credits, no prod
// data. It (1) wraps the Vercel serverless handler api/resume.js in a local HTTP server, (2) expects
// `next start -p 3000` to be running (run `npm run build && npx next start -p 3000` first), and
// (3) drives /resume/studio in headless Chromium: paste → structure → health → fix-all → live edit →
// Export (ATS check, PDF + DOCX downloads) → Tailor (signed-out → login redirect) → phone layout.
//
//   node scripts/resume-studio-smoke.mjs            # prints each step; exits 1 on any failure
//
// Chromium: uses $PLAYWRIGHT_CHROMIUM or the newest binary under /opt/pw-browsers (the cloud image).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.STUDIO_BASE_URL || 'http://127.0.0.1:3000';
const API_PORT = Number(process.env.STUDIO_API_PORT || 3001);
const OUT = process.env.STUDIO_SHOTS || path.join(os.tmpdir(), 'seen-studio-smoke');
fs.mkdirSync(OUT, { recursive: true });

// ── local API wrapper (fake Supabase so the rate limiter + gates run their no-DB paths) ──
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'service-key';
const realFetch = globalThis.fetch;
const isFakeDb = (url) => { try { return new URL(String(url)).host === 'db.example'; } catch { return false; } };
globalThis.fetch = async (url, opts) => (isFakeDb(url) ? new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }) : realFetch(url, opts));
const { default: handler } = await import('../api/resume.js');
const api = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const r = { _s: 200, _h: {}, setHeader(k, v) { this._h[k] = v; }, status(c) { this._s = c; return this; }, json(o) { this._h['Content-Type'] = 'application/json'; res.writeHead(this._s, this._h); res.end(JSON.stringify(o)); return this; }, send(b) { res.writeHead(this._s, this._h); res.end(b); return this; }, end(b) { res.writeHead(this._s, this._h); res.end(b || ''); return this; } };
    try { await handler({ method: req.method, headers: req.headers, socket: req.socket, body }, r); } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e && e.message) })); }
  });
});
await new Promise((resolve) => api.listen(API_PORT, resolve));

const failures = [];
const check = (label, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) failures.push(label); };

const RESUME = fs.readFileSync(new URL('../lib/resume/fixtures/text/john_doe_legacy.txt', import.meta.url), 'utf8');
const bin = process.env.PLAYWRIGHT_CHROMIUM || (() => { try { return execSync('find /opt/pw-browsers -maxdepth 4 \\( -name chrome -o -name chrome-headless-shell \\) -type f | sort | tail -1').toString().trim(); } catch { return ''; } })();
const browser = await chromium.launch(bin ? { executablePath: bin } : {});
const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const apiLog = [];
await page.route('**/api/resume', async (route) => {
  const req = route.request();
  const r = await realFetch(`http://127.0.0.1:${API_PORT}/api/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: req.postData() || '{}' });
  const buf = Buffer.from(await r.arrayBuffer());
  const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  let action = ''; try { action = JSON.parse(req.postData() || '{}').action; } catch { /* ignore */ }
  apiLog.push({ action, status: r.status, type: headers['content-type'], bytes: buf.length });
  await route.fulfill({ status: r.status, headers, body: buf });
});
await page.route('**/api/user-sync', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
await page.route('**/api/reports**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

try {
  await page.goto(`${BASE}/resume`, { waitUntil: 'networkidle' });
  check('/resume links to the Studio', (await page.locator('a[href="/resume/studio"]').count()) >= 1);

  await page.goto(`${BASE}/resume/studio`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Paste text/ }).first().click();
  await page.locator('textarea').first().fill(RESUME);
  await page.getByRole('button', { name: /Structure it/ }).click();
  await page.waitForSelector('text=Résumé health', { timeout: 15000 });
  const score = Number(await page.locator('[class*="ringNum"]').first().innerText());
  check('pasted résumé structured and scored', score > 0 && score <= 100, `score ${score}`);
  await page.screenshot({ path: path.join(OUT, 'studio-health.png') });
  const fixBtn = page.getByRole('button', { name: /Fix \d+ bullet/ });
  if (await fixBtn.count()) { await fixBtn.click(); await page.waitForTimeout(400); const after = Number(await page.locator('[class*="ringNum"]').first().innerText()); check('fix-all raises the score', after >= score, `${score} → ${after}`); }
  await page.waitForTimeout(1600);
  check('autosave indicator', (await page.locator('text=saved').count()) > 0);
  const firstBullet = page.locator('textarea[class*="bulletArea"]').first();
  const before = await firstBullet.inputValue();
  const s0 = Number(await page.locator('[class*="ringNum"]').first().innerText());
  await firstBullet.fill(`${before} Cut costs 12% in 2023.`);
  await page.waitForTimeout(300);
  const s1 = Number(await page.locator('[class*="ringNum"]').first().innerText());
  check('live edit re-scores (a metric helps)', s1 > s0, `${s0} → ${s1}`);

  await page.getByRole('button', { name: /Export/ }).first().click();
  await page.waitForSelector('text=Template');
  await page.getByRole('button', { name: /Engineering/ }).click();
  await page.getByRole('button', { name: /Check what a parser reads/ }).click();
  await page.waitForSelector('text=Parser read-back', { timeout: 20000 });
  check('ATS round-trip check renders', true, (await page.locator('text=Parser read-back').first().innerText()).trim());
  await page.screenshot({ path: path.join(OUT, 'studio-export.png') });
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Download PDF/ }).click();
  const pdfPath = await (await dl).path();
  check('PDF download is a PDF', fs.readFileSync(pdfPath).slice(0, 5).toString() === '%PDF-', `${fs.statSync(pdfPath).size} bytes`);
  await page.getByRole('button', { name: /^Word$/ }).click();
  const dl2 = page.waitForEvent('download', { timeout: 20000 });
  await page.getByRole('button', { name: /Download Word/ }).click();
  const docxPath = await (await dl2).path();
  check('DOCX download is a zip container', fs.readFileSync(docxPath)[0] === 0x50, `${fs.statSync(docxPath).size} bytes`);

  await page.getByRole('button', { name: /Tailor/ }).first().click();
  await page.getByPlaceholder('Sales Associate').fill('Store Manager');
  await page.getByPlaceholder(/Paste the posting/).fill('Retail store manager. Scheduling, inventory, POS, customer service, team leadership.');
  await page.getByRole('button', { name: /Optimize for this job/ }).click();
  await page.waitForTimeout(800);
  check('signed-out tailoring routes to sign-in', page.url().includes('/login'), page.url());

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/resume/studio`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].some((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(el).position !== 'fixed'));
  check('phone layout has no horizontal overflow', !overflow);
  await page.screenshot({ path: path.join(OUT, 'studio-mobile.png') });

  check('no page errors', errors.length === 0, errors.join(' | '));
  check('every API call succeeded', apiLog.every((c) => c.status === 200), JSON.stringify(apiLog));
} catch (e) {
  check('smoke run completed', false, String(e && e.message));
} finally {
  await browser.close();
  api.close();
}
console.log(`screenshots in ${OUT}`);
if (failures.length) { console.error(`FAILED: ${failures.join(', ')}`); process.exit(1); }
