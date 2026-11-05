import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { isPublicIp, checkUrl, guardedLookup, createPinnedTransport, safeFetch, setSafeFetchTransport } from './safeFetch.js';

test('isPublicIp: private, loopback, link-local, metadata and IPv4-in-IPv6 are refused', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fe80::1%eth0', 'fd12::1', 'fec0::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::127.0.0.1', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::1', '[::ffff:10.0.0.1]', 'not-an-ip', '']) {
    assert.equal(isPublicIp(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '104.18.0.1', '2606:4700::1111', '::ffff:8.8.8.8', '2002:808:808::1']) assert.equal(isPublicIp(ip), true, ip);
});

test('checkUrl: only http(s) on normal ports, no credentials, no private literals or local names', () => {
  for (const u of ['file:///etc/passwd', 'gopher://x.com', 'ftp://x.com/a', 'http://user:pw@x.com', 'http://x.com:22/', 'http://localhost/',
    'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://intranet/', 'http://db.internal/', 'http://2130706433/', 'http://0x7f.1/', 'nonsense']) {
    assert.equal(checkUrl(u).ok, false, u);
  }
  for (const u of ['https://boards.greenhouse.io/acme/jobs/1', 'http://example.com:8080/x', 'https://8.8.8.8/']) assert.equal(checkUrl(u).ok, true, u);
});

test('guardedLookup: refuses when any address is private, passes public answers through', async () => {
  const resolveTo = (addrs) => (h, o, cb) => cb(null, addrs);
  const run = (addrs, opts = {}) => new Promise((res) => guardedLookup(resolveTo(addrs))('x.example', opts, (err, a, f) => res({ err, a, f })));
  assert.equal((await run([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }])).err.code, 'ESSRFBLOCKED');
  assert.equal((await run([])).err.code, 'ESSRFBLOCKED');
  const ok = await run([{ address: '93.184.216.34', family: 4 }]);
  assert.deepEqual([ok.err, ok.a, ok.f], [null, '93.184.216.34', 4]);
  const all = await run([{ address: '2606:4700::1111', family: 6 }], { all: true });
  assert.deepEqual(all.a, [{ address: '2606:4700::1111', family: 6 }]);
});

test('safeFetch: every redirect hop is re-checked; too many redirects stop', async (t) => {
  const seen = [];
  setSafeFetchTransport(async (url) => {
    seen.push(url);
    if (url.startsWith('https://jobs.example/start')) return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    if (url.startsWith('https://jobs.example/file')) return new Response(null, { status: 301, headers: { location: 'file:///etc/passwd' } });
    if (url.startsWith('https://jobs.example/loop')) return new Response(null, { status: 302, headers: { location: '/loop' } });
    return new Response('ok', { status: 200 });
  });
  t.after(() => setSafeFetchTransport(null));
  await assert.rejects(safeFetch('https://jobs.example/start'), /blocked_url:private_address/);
  assert.ok(!seen.some((u) => u.includes('169.254')), 'the metadata address was never requested');
  await assert.rejects(safeFetch('https://jobs.example/file'), /blocked_url:scheme/);
  await assert.rejects(safeFetch('https://jobs.example/loop', { maxRedirects: 3 }), /too_many_redirects/);
  const manual = await safeFetch('https://jobs.example/start', { redirect: 'manual' });
  assert.equal(manual.status, 302);
});

test('safeFetch: body is capped and the whole call times out', async (t) => {
  setSafeFetchTransport(async (url, { signal }) => {
    if (url.endsWith('/big')) return new Response('x'.repeat(5000), { status: 200 });
    return new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  });
  t.after(() => setSafeFetchTransport(null));
  const big = await safeFetch('https://jobs.example/big', { maxBytes: 1000 });
  assert.equal((await big.text()).length, 1000);
  assert.equal(big.truncated, true);
  await assert.rejects(safeFetch('https://jobs.example/hang', { timeoutMs: 50 }), /timeout/);
  // A body that never finishes is cut by the same clock.
  setSafeFetchTransport(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('partial')); } }), { status: 200 }));
  await assert.rejects(safeFetch('https://jobs.example/drip', { timeoutMs: 50 }), /timeout/);
});

test('pinned transport: connects only to the address the guard approved; gzip is decoded', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
    res.end(zlib.gzipSync('<h1>hello</h1>'));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { port } = server.address();
  const resolve = (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
  // The real guard: a public-looking name that resolves to loopback is refused at connect time.
  const strict = createPinnedTransport({ resolve });
  await assert.rejects(strict(`http://rebind.example:${port}/`, {}), (e) => e.code === 'ESSRFBLOCKED');
  // With loopback allowed (test only), the same transport talks to the server and decodes gzip.
  const open = createPinnedTransport({ resolve, isAllowed: () => true });
  const res = await open(`http://rebind.example:${port}/`, {});
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<h1>hello</h1>');
});
