// The search's answer deadline (api/jobs.js guardAnswer) on a REAL http response with Vercel-style helpers: Vercel's
// res.json sets headers and calls res.end itself, so the guard must let those inner calls through (the first version
// dropped them and no answer was ever sent on Vercel — caught on the preview deployment, 2026-11-26).
// Run: node --test api/jobs.guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.SUPABASE_URL = '';
const { guardAnswer } = await import('./jobs.js');

// Vercel's helpers (@vercel/node): status() sets the code; json() sets content-type + content-length, then end().
function vercelHelpers(res) {
  res.status = function (c) { this.statusCode = c; return this; };
  res.json = function (b) {
    const body = JSON.stringify(b);
    if (!this.getHeader('content-type')) this.setHeader('content-type', 'application/json; charset=utf-8');
    this.setHeader('content-length', Buffer.byteLength(body));
    this.end(body);
    return this;
  };
}

async function serve(handler) {
  const srv = http.createServer((req, res) => { vercelHelpers(res); handler(req, res); });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const t0 = Date.now();
  const r = await fetch(url);
  const body = await r.json();
  srv.close();
  return { status: r.status, body, ms: Date.now() - t0, type: r.headers.get('content-type'), cache: r.headers.get('cache-control') };
}

test('a normal answer goes out whole (headers, status, body) and the deadline never fires after it', async () => {
  const got = await serve((req, res) => {
    guardAnswer(res, 300, { error: 'busy' });
    res.setHeader('Cache-Control', 'public, s-maxage=1');
    setTimeout(() => res.status(200).json({ ok: true, jobs: [1, 2] }), 50);
  });
  assert.equal(got.status, 200);
  assert.deepEqual(got.body, { ok: true, jobs: [1, 2] });
  assert.match(got.type, /application\/json/);
  assert.equal(got.cache, 'public, s-maxage=1');
  await new Promise((r) => setTimeout(r, 400)); // the timer would have fired by now
});

test('past the deadline the person gets a 503 at once; the late answer is dropped without an error', async () => {
  let lateErr = null;
  const got = await serve((req, res) => {
    guardAnswer(res, 100, { error: 'Search is busy — trying again.', retry: true, jobs: [] });
    setTimeout(() => { try { res.setHeader('X-Late', '1'); res.status(200).json({ ok: true }); } catch (e) { lateErr = e; } }, 300);
  });
  assert.equal(got.status, 503);
  assert.equal(got.body.retry, true);
  assert.ok(got.ms < 300, `answered in ${got.ms} ms`);
  assert.equal(got.cache, 'no-store');
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(lateErr, null);
});
