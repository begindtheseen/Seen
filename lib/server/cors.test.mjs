// CORS origin policy (lib/server/cors.js). Run: node --test lib/server/cors.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowOrigin, isLocalDevOrigin, isProductionRuntime } from './cors.js';

const PROD = { VERCEL_ENV: 'production', NODE_ENV: 'production' };
const NEXT_START = { NODE_ENV: 'production' };
const DEV = { NODE_ENV: 'development' };

test('production origins are always echoed back', () => {
  for (const env of [PROD, DEV]) {
    assert.equal(allowOrigin('https://seenjobs.io', env), 'https://seenjobs.io');
    assert.equal(allowOrigin('https://www.seenjobs.io', env), 'https://www.seenjobs.io');
  }
});

test('no Origin header keeps the old "*" answer (no credentials are ever allowed)', () => {
  assert.equal(allowOrigin('', PROD), '*');
  assert.equal(allowOrigin(undefined, PROD), '*');
});

test('localhost is NOT reflected by a production build', () => {
  assert.equal(isProductionRuntime(PROD), true);
  assert.equal(isProductionRuntime(NEXT_START), true);
  assert.equal(allowOrigin('http://localhost:3000', PROD), 'https://seenjobs.io');
  assert.equal(allowOrigin('http://127.0.0.1:3000', NEXT_START), 'https://seenjobs.io');
});

test('localhost IS allowed in local development', () => {
  assert.equal(allowOrigin('http://localhost:3000', DEV), 'http://localhost:3000');
  assert.equal(allowOrigin('http://127.0.0.1:8080', DEV), 'http://127.0.0.1:8080');
  assert.equal(allowOrigin('http://[::1]:3000', {}), 'http://[::1]:3000');
});

test('look-alike hosts containing "localhost" are never treated as dev origins', () => {
  for (const o of ['https://localhost.evil.example', 'https://evil.example/localhost', 'https://notlocalhost.com', 'https://127.0.0.1.evil.example']) {
    assert.equal(isLocalDevOrigin(o, DEV), false, o);
    assert.equal(allowOrigin(o, DEV), 'https://seenjobs.io', o);
  }
});

test('unknown origins get the canonical site, never their own value', () => {
  assert.equal(allowOrigin('https://attacker.example', PROD), 'https://seenjobs.io');
  assert.equal(allowOrigin('null', DEV), 'https://seenjobs.io');
});
