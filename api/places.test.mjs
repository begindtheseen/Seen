// GET /api/places — the contract LocationInput reads (components/ui/LocationInput.tsx, lib/geo/placesClient.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from './places.js';

function call(method, query) {
  const res = { statusCode: 0, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  handler({ method, query, headers: {} }, res);
  return res;
}

test('?q= answers suggestions + the resolved form, edge-cached for a day', () => {
  const r = call('GET', { q: 'pho' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.q, 'pho');
  assert.equal(r.body.suggestions[0].label, 'Phoenix, AZ');
  assert.equal(r.body.suggestions[0].kind, 'place');
  assert.ok(r.body.suggestions.length <= 8);
  assert.equal(r.body.resolved, null);
  assert.match(r.headers['cache-control'], /public/);
  assert.match(r.headers['cache-control'], /s-maxage=86400/);
  assert.match(r.headers['cache-control'], /stale-while-revalidate=604800/);
  const p = call('GET', { q: 'phoenix az' });
  assert.deepEqual(p.body.resolved, { label: 'Phoenix, AZ', kind: 'place' });
});

test('?resolve= answers the one fixed form or null', () => {
  assert.deepEqual(call('GET', { resolve: 'boise id' }).body, { resolved: { label: 'Boise, ID', kind: 'place' } });
  assert.deepEqual(call('GET', { resolve: '85004' }).body, { resolved: { label: 'Phoenix, AZ', kind: 'zip' } });
  assert.deepEqual(call('GET', { resolve: 'remote' }).body, { resolved: { label: 'Remote', kind: 'remote' } });
  assert.deepEqual(call('GET', { resolve: 'Springfield' }).body, { resolved: null });
  assert.deepEqual(call('GET', { resolve: '' }).body, { resolved: null });
});

test('bad input never errors: missing, array, huge, control characters', () => {
  assert.deepEqual(call('GET', {}).body, { q: '', suggestions: [], resolved: null });
  assert.equal(call('GET', { q: ['pho', 'x'] }).body.suggestions[0].label, 'Phoenix, AZ');
  assert.equal(call('GET', { q: 'a'.repeat(5000) }).statusCode, 200);
  assert.equal(call('GET', { q: 'pho\u0000\u0007' }).body.suggestions[0].label, 'Phoenix, AZ');
});

test('only GET / HEAD', () => {
  assert.equal(call('POST', { q: 'pho' }).statusCode, 405);
  assert.equal(call('OPTIONS', {}).statusCode, 204);
  assert.equal(call('HEAD', { q: 'pho' }).statusCode, 200);
});
