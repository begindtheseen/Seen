// Re-optimize (owner 2026-11-12: "an option to reoptimize giving a different result"). The credit rule, driven through the
// real handler: a paid build issues an export token for (user, posting key); `variant: k` with that token builds another
// honest version — never charged (no consume_credit call), distinct from the paid one, unbranded on export; without the
// token, with another user's or another posting's, or past MAX_VARIANTS it is refused; an exhausted index says so.
// Run: node --test api/resume.variant.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_JWT_SECRET = 'test-secret';
delete process.env.SEENFIT_ENGINE_ENABLED;

let credits = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.hostname !== 'db.example') return json({ error: 'unexpected host' }, 500);
  if (u.pathname === '/rest/v1/feature_flags') return json([{ status: 'fully_on' }]);
  if (u.pathname === '/rest/v1/rpc/consume_credit') { credits++; return json([{ status: 'ok', balance: 4, pro: false }]); }
  if (u.pathname === '/rest/v1/optimizer_runs' && (opts.method || 'GET') === 'POST') return new Response(null, { status: 201 });
  return json([]);
};
const { default: handler } = await import('./resume.js');
const { MAX_VARIANTS } = await import('../lib/resume/tailor/variants.js');
const { serializeToText } = await import('../lib/resume/model.js');

const FX = JSON.parse(readFileSync(new URL('../lib/optimizer/fixtures/expert-postings.json', import.meta.url), 'utf8'));
// the same money fixture the export test charges for (no summary, no skills; proof lines buried)
const RESUME = FX.resume.replace(/\nSUMMARY\n[\s\S]*?\n\nEXPERIENCE/, '\n\nEXPERIENCE').replace(/\nSKILLS[\s\S]*$/, '\n')
  .replace(/(Membership Specialist — UFC Gym[^\n]*\n)/, '$1• Opened the gym at 5 a.m. on weekdays\n• Folded towels and restocked the retail shelf between classes\n• Kept the lobby and front desk tidy\n')
  .replace(/(• Trained 4[^\n]*\n)/, '$1• Balanced the cash drawer at close every shift with zero variances over 18 months\n');
const A = FX.postings.A;
const token = (sub) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', 'test-secret').update(`${h}.${p}`).digest('base64url')}`;
};
let ip = 20;
const call = async (body, uid) => {
  const res = { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
  await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io', ...(uid ? { authorization: `Bearer ${token(uid)}` } : {}) }, socket: { remoteAddress: `10.0.7.${ip++}` }, body, query: {} }, res);
  return res;
};
const U1 = '77777777-7777-4777-8777-777777777777', U2 = '88888888-8888-4888-8888-888888888888';
const job = { tool: 'optimize', job: A.title, company: A.company, resume: RESUME, jobDescription: A.jd, jobId: 'job-variant' };

test('re-optimize: free with the paid token, distinct, unbranded; refused without it', async () => {
  const paid = await call({ ...job, fresh: true }, U1);
  assert.equal(paid.code, 200, JSON.stringify(paid.body).slice(0, 300));
  assert.equal(paid.body.charged, true, paid.body.note);
  const { export_token: tok, export_key: key } = paid.body.tailored;
  assert.ok(tok && key);
  assert.ok(Array.isArray(paid.body.tailored.roles) && paid.body.tailored.roles.length, 'the paid result says why each job is on it');

  const before = credits;
  const v1 = await call({ ...job, variant: 1, exportToken: tok, exportKey: key }, U1);
  assert.equal(v1.code, 200, JSON.stringify(v1.body).slice(0, 300));
  assert.equal(credits, before, 'a variant never reaches the credit gate');
  assert.equal(v1.body.charged, false);
  if (!v1.body.variant_exhausted) {
    assert.notEqual(serializeToText(v1.body.tailored.doc), serializeToText(paid.body.tailored.doc), 'variant 1 differs from the paid version');
    assert.equal(v1.body.tailored.variant.index, 1);
    const ex = await call({ action: 'export', doc: v1.body.tailored.doc, format: 'docx', exportToken: v1.body.tailored.export_token, exportKey: v1.body.tailored.export_key }, U1);
    assert.equal(ex.headers['X-Seen-Branded'], '0', 'the variant of a paid build exports without the footer');
  } else {
    assert.match(v1.body.sentence, /no other honest version/i);
    assert.equal(v1.body.tailored, null);
  }

  const none = await call({ ...job, variant: 1 }, U1);
  assert.equal(none.code, 403, 'no token → no variant');
  assert.equal(none.body.error, 'variant_needs_paid');
  const other = await call({ ...job, variant: 1, exportToken: tok, exportKey: key }, U2);
  assert.equal(other.code, 403, "another user's token → no variant");
  const otherPosting = await call({ ...job, jobId: 'job-other', variant: 1, exportToken: tok, exportKey: key }, U1);
  assert.equal(otherPosting.code, 403, 'a token for another posting → no variant');
  const tooMany = await call({ ...job, variant: MAX_VARIANTS + 1, exportToken: tok, exportKey: key }, U1);
  assert.equal(tooMany.code, 400, 'past the cap → refused');
  assert.equal(credits, before, 'no refusal charged anything');
});

test('every variant up to the cap is distinct from the paid one and from each other, or says it is exhausted', async () => {
  const paid = await call({ ...job, fresh: true }, U1);
  const { export_token: tok, export_key: key } = paid.body.tailored;
  const seen = [serializeToText(paid.body.tailored.doc)];
  let exhausted = false;
  for (let k = 1; k <= MAX_VARIANTS; k++) {
    const r = await call({ ...job, variant: k, exportToken: tok, exportKey: key }, U1);
    assert.equal(r.code, 200);
    if (r.body.variant_exhausted) { exhausted = true; continue; }
    assert.ok(!exhausted, 'once exhausted, a later index is exhausted too (candidates are tried in one fixed order)');
    const t = serializeToText(r.body.tailored.doc);
    assert.ok(!seen.includes(t), `variant ${k} is new`);
    seen.push(t);
  }
});
