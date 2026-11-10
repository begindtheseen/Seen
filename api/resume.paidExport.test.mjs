// Director's decision (round 3): a tailored version bought with a credit exports WITHOUT the "Optimized with Seen ·
// seenjobs.io" footer; a free export keeps it. Driven through the real handler: tool:optimize (charged) → its
// tailored.export_token → action:export with that token → X-Seen-Branded: 0. No token, another user's token, or a forged
// one → branded.
// Run: node --test api/resume.paidExport.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_JWT_SECRET = 'test-secret';
delete process.env.SEENFIT_ENGINE_ENABLED;

globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname !== 'db.example') return json({ error: 'unexpected host' }, 500);
  if (u.pathname === '/rest/v1/feature_flags') return json([{ status: 'fully_on' }]);
  if (u.pathname === '/rest/v1/rpc/consume_credit') return json([{ status: 'ok', balance: 4, pro: false }]);
  if (u.pathname === '/rest/v1/optimizer_runs' && (opts.method || 'GET') === 'POST') return new Response(null, { status: 201 });
  return json([]);
};
const { default: handler } = await import('./resume.js');

const FX = JSON.parse(readFileSync(new URL('../lib/optimizer/fixtures/expert-postings.json', import.meta.url), 'utf8'));
// strict charge (director 2026-11-10): a credit only when more of the posting's displayed lines reach a recruiter's first
// read — so the money fixture buries its cash-drawer proof under line 3 with no "Cash handling" skill, and the tailor's
// summary brings it up front
const RESUME = FX.resume.replace(/Customer-focused retail[^\n]*(\n[^\n]+)?/, 'Hard working and dependable team player looking for a sales role.')
  .replace('Cash handling · ', '')
  .replace(/(• Trained 4[^\n]*\n)/, '$1• Restocked the retail shelf and folded towels between classes\n• Balanced the cash drawer at close every shift with zero variances over 18 months\n');
const A = FX.postings.A;
const token = (sub) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', 'test-secret').update(`${h}.${p}`).digest('base64url')}`;
};
let ip = 70;
const call = async (body, uid) => {
  const res = { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
  await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io', ...(uid ? { authorization: `Bearer ${token(uid)}` } : {}) }, socket: { remoteAddress: `10.0.3.${ip++}` }, body, query: {} }, res);
  return res;
};
const U1 = '55555555-5555-4555-8555-555555555555', U2 = '66666666-6666-4666-8666-666666666666';

test('a paid tailored version exports without the footer; free exports keep it', async () => {
  const paid = await call({ tool: 'optimize', job: A.title, company: A.company, resume: RESUME, jobDescription: A.jd, jobId: 'job-export', fresh: true }, U1);
  assert.equal(paid.code, 200, JSON.stringify(paid.body).slice(0, 300));
  assert.equal(paid.body.charged, true, paid.body.note);
  const tok = paid.body.tailored.export_token;
  assert.ok(tok, 'the paid result carries an export token');
  const doc = paid.body.tailored.doc;
  const key = paid.body.tailored.export_key;
  assert.ok(key, 'the paid result names what the token is for');
  const ex = await call({ action: 'export', doc, format: 'pdf', exportToken: tok, exportKey: key }, U1);
  assert.equal(ex.code, 200);
  assert.equal(ex.headers['X-Seen-Branded'], '0', 'the paid version is unbranded');
  const free = await call({ action: 'export', doc, format: 'pdf' }, U1);
  assert.equal(free.headers['X-Seen-Branded'], '1', 'no token → the free rule');
  const other = await call({ action: 'export', doc, format: 'pdf', exportToken: tok, exportKey: key }, U2);
  assert.equal(other.headers['X-Seen-Branded'], '1', "another user's token does not unbrand");
  const forged = await call({ action: 'export', doc, format: 'docx', exportToken: `${tok.split('.')[0]}.AAAA`, exportKey: key }, U1);
  const noKey = await call({ action: 'export', doc, format: 'pdf', exportToken: tok }, U1);
  assert.equal(noKey.headers['X-Seen-Branded'], '1', 'a token without the result it was issued for is a normal export');
  const otherPosting = await call({ action: 'export', doc, format: 'pdf', exportToken: tok, exportKey: 'some-other-posting-key' }, U1);
  assert.equal(otherPosting.headers['X-Seen-Branded'], '1', 'a token for posting A does not unbrand posting B');
  assert.equal(forged.headers['X-Seen-Branded'], '1', 'a forged token does not unbrand');
  const docx = await call({ action: 'export', doc, format: 'docx', exportToken: tok, exportKey: key }, U1);
  assert.equal(docx.headers['X-Seen-Branded'], '0');
  assert.ok(!/Optimized with Seen/.test(paid.body.tailored.text), 'the copied text never carries the footer');
});

test('the export token: bound to the user, the result and the expiry; tampering fails', async () => {
  const { paidExportToken, verifyPaidExport } = await import('../lib/server/paidExport.js');
  const now = Date.now();
  const t = paidExportToken(U1, 'posting-A', now);
  assert.equal(verifyPaidExport(U1, t, 'posting-A', now), true);
  assert.equal(verifyPaidExport(U1, t, 'posting-B', now), false, 'another posting');
  assert.equal(verifyPaidExport(U2, t, 'posting-A', now), false, 'another user');
  assert.equal(verifyPaidExport(U1, t, 'posting-A', now + 8 * 24 * 3600 * 1000), false, 'expired');
  const [b64, mac] = t.split('.');
  const payload = Buffer.from(b64, 'base64url').toString('utf8').replace(/\.\d+$/, `.${now + 365 * 24 * 3600 * 1000}`);
  assert.equal(verifyPaidExport(U1, `${Buffer.from(payload).toString('base64url')}.${mac}`, 'posting-A', now), false, 'tampered expiry');
});

test('Studio: a credit-bought tailor issues an export token for THAT result; the export of it is unbranded', async () => {
  const s = await call({ action: 'structure', text: RESUME }, U1);
  const t = await call({ action: 'tailor', doc: s.body.doc, jobTitle: A.title, company: A.company, jobDescription: A.jd }, U1);
  assert.equal(t.code, 200, JSON.stringify(t.body).slice(0, 300));
  assert.equal(t.body.charged, true, `the thin-summary résumé is a paid tailor: ${t.body.note}`);
  const tok = t.body.tailored.export_token, key = t.body.tailored.export_key;
  assert.ok(tok && /^studio:/.test(key));
  const ex = await call({ action: 'export', doc: t.body.variant, format: 'pdf', exportToken: tok, exportKey: key }, U1);
  assert.equal(ex.headers['X-Seen-Branded'], '0');
  const base = await call({ action: 'export', doc: s.body.doc, format: 'pdf' }, U1);
  assert.equal(base.headers['X-Seen-Branded'], '1', 'the base résumé keeps the free rule');
});
