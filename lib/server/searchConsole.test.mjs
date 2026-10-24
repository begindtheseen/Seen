// Google Search Console ingestion: JWT signing (throwaway RSA key), token exchange, Pacific date window, paging,
// row parsing, and the no-credentials skip. No real Google call. Run: node --test lib/server/searchConsole.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  parseServiceAccount, signServiceAccountJwt, fetchAccessToken, gscDateWindow, fetchSearchAnalytics, gscRowsToRecords,
  pullSearchConsole, searchAnalyticsUrl, GSC_SCOPE, GOOGLE_TOKEN_URL,
} from './searchConsole.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const SA_JSON = JSON.stringify({ type: 'service_account', client_email: 'seen-gsc@proj.iam.gserviceaccount.com', private_key: PEM, private_key_id: 'kid123' });
const decode = (part) => JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

test('JWT: RS256 header, Google claim set, signature verifies with the public key', () => {
  const nowMs = Date.UTC(2026, 9, 24, 13, 20);
  const jwt = signServiceAccountJwt({ clientEmail: 'a@b.iam.gserviceaccount.com', privateKey: PEM, keyId: 'kid123', nowMs });
  const [h, c, sig] = jwt.split('.');
  assert.ok(!/[=+/]/.test(jwt), 'base64url, no padding');
  assert.deepEqual(decode(h), { alg: 'RS256', typ: 'JWT', kid: 'kid123' });
  const claims = decode(c);
  assert.equal(claims.iss, 'a@b.iam.gserviceaccount.com');
  assert.equal(claims.scope, GSC_SCOPE);
  assert.equal(claims.aud, GOOGLE_TOKEN_URL);
  assert.equal(claims.iat, Math.floor(nowMs / 1000));
  assert.equal(claims.exp - claims.iat, 3600, 'at most one hour');
  const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).end().verify(publicKey, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  assert.equal(ok, true);
});

test('service account: JSON, escaped newlines, base64; junk → null', () => {
  assert.equal(parseServiceAccount(SA_JSON).client_email, 'seen-gsc@proj.iam.gserviceaccount.com');
  const escaped = JSON.stringify({ client_email: 'x@y', private_key: PEM.replace(/\n/g, '\\n') });
  assert.match(parseServiceAccount(escaped).private_key, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.equal(parseServiceAccount(Buffer.from(SA_JSON).toString('base64')).private_key_id, 'kid123');
  for (const bad of [undefined, '', 'nope', '{}', JSON.stringify({ client_email: 'x', private_key: 'not a key' })]) assert.equal(parseServiceAccount(bad), null);
});

test('token exchange: form-encoded jwt-bearer grant; error answers carry the status', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.x', expires_in: 3600 }) }; };
  const t = await fetchAccessToken(parseServiceAccount(SA_JSON), { fetchImpl });
  assert.deepEqual(t, { ok: true, token: 'ya29.x' });
  assert.equal(seen.url, GOOGLE_TOKEN_URL);
  assert.equal(seen.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(seen.init.body);
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(body.get('assertion').split('.').length, 3);
  const bad = await fetchAccessToken(parseServiceAccount(SA_JSON), { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /400 invalid_grant/);
});

test('date window: the last 3 finished PACIFIC days (2-day lag), across the UTC midnight', () => {
  // 2026-10-24 05:00 UTC is still Oct 23 in California.
  assert.deepEqual(gscDateWindow(new Date('2026-10-24T05:00:00Z')), { startDate: '2026-10-19', endDate: '2026-10-21' });
  assert.deepEqual(gscDateWindow(new Date('2026-10-24T13:20:00Z')), { startDate: '2026-10-20', endDate: '2026-10-22' });
  assert.deepEqual(gscDateWindow(new Date('2026-10-24T13:20:00Z'), { days: 30 }).startDate, '2026-09-23');
});

test('Search Analytics: query+page+date dimensions, startRow paging until a short page', async () => {
  const total = 7, bodies = [];
  const all = Array.from({ length: total }, (_, i) => ({ keys: [`q${i}`, `https://seenjobs.io/company/c${i}`, '2026-10-22'], clicks: 1, impressions: 10, ctr: 0.1, position: 9.4 }));
  const fetchImpl = async (url, init) => {
    assert.equal(url, searchAnalyticsUrl('sc-domain:seenjobs.io'));
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const b = JSON.parse(init.body); bodies.push(b);
    return { ok: true, status: 200, json: async () => ({ rows: all.slice(b.startRow, b.startRow + b.rowLimit) }) };
  };
  const r = await fetchSearchAnalytics({ token: 'tok', siteUrl: 'sc-domain:seenjobs.io', startDate: '2026-10-20', endDate: '2026-10-22', fetchImpl, rowLimit: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, total);
  assert.deepEqual(bodies.map((b) => b.startRow), [0, 3, 6]);
  assert.deepEqual(bodies[0].dimensions, ['query', 'page', 'date']);
  assert.equal(bodies[0].type, 'web');
  assert.match(searchAnalyticsUrl('sc-domain:seenjobs.io'), /sites\/sc-domain%3Aseenjobs\.io\/searchAnalytics\/query$/);
  // An exact multiple of rowLimit ends with one empty page (the API answers 200 with no rows past the end).
  const r2 = await fetchSearchAnalytics({ token: 'tok', siteUrl: 'sc-domain:seenjobs.io', startDate: 'a', endDate: 'b', rowLimit: 7,
    fetchImpl: async (u, init) => { const b = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ rows: all.slice(b.startRow, b.startRow + 7) }) }; } });
  assert.equal(r2.rows.length, 7);
  assert.equal(r2.requests, 2);
  const fail = await fetchSearchAnalytics({ token: 'tok', siteUrl: 's', startDate: 'a', endDate: 'b', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'User does not have sufficient permission' } }) }) });
  assert.equal(fail.ok, false);
  assert.match(fail.error, /403 User does not have/);
});

test('rows → records: keys in dimension order, clicks ≤ impressions, ctr recomputed, bad rows dropped', () => {
  const recs = gscRowsToRecords([
    { keys: ['target application status', 'https://seenjobs.io/company/target', '2026-10-22'], clicks: 3, impressions: 120, ctr: 0.025, position: 11.237 },
    { keys: ['no date', 'https://seenjobs.io/'], clicks: 1, impressions: 2 },
    { keys: ['zero', 'https://seenjobs.io/', '2026-10-22'], clicks: 0, impressions: 0 },
  ]);
  assert.deepEqual(recs, [{ date: '2026-10-22', source: 'google', query: 'target application status', page: 'https://seenjobs.io/company/target', clicks: 3, impressions: 120, ctr: 0.025, position: 11.24 }]);
});

test('no credentials → skipped, and not a single request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('must not fetch'); };
  assert.deepEqual(await pullSearchConsole({ env: {}, fetchImpl }), { ok: true, skipped: 'no_credentials' });
  assert.deepEqual(await pullSearchConsole({ env: { GSC_SERVICE_ACCOUNT_JSON: SA_JSON }, fetchImpl }), { ok: true, skipped: 'no_credentials' }, 'site url missing');
  assert.equal(calls, 0);
});

test('full pull with a stubbed Google: token, then rows → records', async () => {
  const fetchImpl = async (url) => {
    if (url === GOOGLE_TOKEN_URL) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
    return { ok: true, status: 200, json: async () => ({ rows: [{ keys: ['does amazon ghost', 'https://seenjobs.io/company/amazon', '2026-10-21'], clicks: 2, impressions: 40, position: 7.5 }] }) };
  };
  const r = await pullSearchConsole({ env: { GSC_SERVICE_ACCOUNT_JSON: SA_JSON, GSC_SITE_URL: 'sc-domain:seenjobs.io' }, now: new Date('2026-10-24T13:20:00Z'), fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(r.window, { startDate: '2026-10-20', endDate: '2026-10-22' });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].source, 'google');
});
