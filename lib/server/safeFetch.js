// One guard for every server-side fetch of a URL a person (or a stored row a person wrote) supplies
// (security audit 2026-11-01). safeFetch(url, init) is a drop-in for fetch(url, init) that:
//   • allows only http(s), the default ports (+8080/8443), no credentials in the URL;
//   • refuses private, loopback, link-local, metadata, multicast and reserved addresses — IPv4 and
//     IPv6, including IPv4 hidden in IPv6 (::ffff:a.b.c.d, NAT64, 6to4) — checked on the address the
//     socket ACTUALLY connects to (the DNS answer is pinned in the connect lookup, so a host cannot
//     resolve public for the check and private for the connection);
//   • follows at most `maxRedirects` redirects itself, re-checking every hop;
//   • caps the whole call at `timeoutMs` and the body at `maxBytes` (after decompression).
// The body comes back as a normal Response; `truncated` is set when the cap cut it.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import { Readable, pipeline } from 'node:stream';

const BLOCKED_V4 = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED_V4.addSubnet(a, p, 'ipv4');

const BLOCKED_V6 = new net.BlockList();
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) BLOCKED_V6.addSubnet(a, p, 'ipv6');

/** Expand an IPv6 string to 8 numbers, or null. */
function v6Groups(ip) {
  let s = ip.toLowerCase().split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[1].split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    s = s.slice(0, -v4[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
  const groups = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => parseInt(g, 16));
  return nums.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff) ? null : nums;
}
const v4From = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True only for a public unicast address. Anything unparseable is NOT public. */
export function isPublicIp(ip) {
  const s = String(ip || '').trim().replace(/^\[|\]$/g, '');
  const kind = net.isIP(s.split('%')[0]);
  if (kind === 4) return !BLOCKED_V4.check(s, 'ipv4');
  if (kind !== 6) return false;
  const g = v6Groups(s);
  if (!g) return false;
  // IPv4 inside IPv6: mapped ::ffff:0:0/96, NAT64 64:ff9b::/96, 6to4 2002::/16 — judge the IPv4.
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return isPublicIp(v4From(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return isPublicIp(v4From(g[6], g[7]));
  if (g[0] === 0x2002) return isPublicIp(v4From(g[1], g[2]));
  return !BLOCKED_V6.check(s.split('%')[0], 'ipv6');
}

const BLOCKED_SUFFIXES = ['.local', '.localdomain', '.internal', '.lan', '.home', '.corp', '.localhost'];
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

/** { ok:true, url } for a URL safeFetch may open (before DNS), else { ok:false, reason }. */
export function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return { ok: false, reason: 'bad_url' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'scheme' };
  if (u.username || u.password) return { ok: false, reason: 'credentials' };
  if (!ALLOWED_PORTS.has(u.port)) return { ok: false, reason: 'port' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const bare = host.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) return isPublicIp(bare) ? { ok: true, url: u } : { ok: false, reason: 'private_address' };
  if (!host || host === 'localhost' || !host.includes('.') || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'private_host' };
  }
  // A dotted all-number host ("2130706433", "0x7f.1") is parsed by some resolvers as an IPv4.
  if (/^[\d.x]+$/i.test(host)) return { ok: false, reason: 'private_address' };
  return { ok: true, url: u };
}

/** A net/http `lookup` that refuses unless EVERY address for the host passes `isAllowed`. */
export function guardedLookup(resolve = dns.lookup, isAllowed = isPublicIp) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    resolve(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
      if (err) return cb(err);
      const list = Array.isArray(addrs) ? addrs : [];
      if (!list.length || list.some((a) => !isAllowed(a.address))) {
        const e = new Error('unreachable'); e.code = 'ESSRFBLOCKED'; return cb(e);
      }
      if (options && options.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * One request, no redirects, connecting only to public addresses. Resolves a Response whose body
 * streams (decompressed); the caller caps it.
 */
export function createPinnedTransport({ resolve = dns.lookup, isAllowed = isPublicIp } = {}) {
  const lookup = guardedLookup(resolve, isAllowed);
  return (url, { method = 'GET', headers = {}, body, signal } = {}) => new Promise((resolveP, rejectP) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const hdrs = {};
    for (const [k, v] of Object.entries(headers || {})) hdrs[k.toLowerCase()] = v;
    hdrs['accept-encoding'] = 'gzip, deflate, br'; // only what we can decode
    const req = mod.request(u, { method, headers: hdrs, lookup, signal, agent: false }, (res) => {
      try {
        const status = res.statusCode || 0;
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (v == null) continue;
          for (const one of [].concat(v)) { try { h.append(k, String(one)); } catch { /* skip a malformed header */ } }
        }
        if (status < 200 || status > 599) { res.destroy(); return rejectP(new Error(`bad status ${status}`)); }
        if (NO_BODY.has(status) || method === 'HEAD' || (status >= 300 && status < 400)) {
          res.resume();
          return resolveP(new Response(null, { status, headers: h }));
        }
        const enc = String(res.headers['content-encoding'] || '').toLowerCase().trim();
        const z = enc === 'gzip' || enc === 'x-gzip' ? zlib.createGunzip()
          : enc === 'deflate' ? zlib.createInflate()
            : enc === 'br' ? zlib.createBrotliDecompress() : null;
        let stream = res;
        if (z) {
          // pipeline: a socket error or abort mid-body also errors the decoded stream (no hang).
          stream = pipeline(res, z, () => {});
          h.delete('content-encoding'); h.delete('content-length');
        }
        resolveP(new Response(Readable.toWeb(stream), { status, headers: h }));
      } catch (e) {
        res.destroy();
        rejectP(e);
      }
    });
    req.on('error', rejectP);
    if (body != null) req.write(body);
    req.end();
  });
}

let transport = createPinnedTransport();
/** Tests only: replace the network layer (the URL/redirect/size rules still run). */
export function setSafeFetchTransport(fn) { transport = fn || createPinnedTransport(); }

async function readCapped(res, maxBytes, signal) {
  if (!res.body) return { buf: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const stop = () => { reader.cancel().catch(() => {}); };
  if (signal) signal.addEventListener('abort', stop, { once: true });
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = maxBytes - total;
      if (value.byteLength > room) {
        chunks.push(Buffer.from(value.subarray(0, room)));
        truncated = true;
        try { await reader.cancel(); } catch { /* already closed */ }
        break;
      }
      chunks.push(Buffer.from(value));
      total += value.byteLength;
    }
  } finally {
    if (signal) signal.removeEventListener('abort', stop);
  }
  if (signal && signal.aborted) throw new Error('timeout');
  return { buf: Buffer.concat(chunks), truncated };
}

/**
 * fetch(url, init) for untrusted URLs. init: method, headers, body, signal, redirect ('follow' |
 * 'manual'), plus maxRedirects (5), timeoutMs (10000), maxBytes (3 MB). Rejects with
 * Error('unreachable' | 'blocked_url:<reason>' | 'too_many_redirects' | 'timeout').
 */
export async function safeFetch(url, init = {}) {
  const { redirect = 'follow', maxRedirects = 5, timeoutMs = 10000, maxBytes = 3_000_000, signal, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) { if (signal.aborted) ctrl.abort(signal.reason); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    let current = String(url);
    let method = (rest.method || 'GET').toUpperCase();
    let body = rest.body;
    for (let hop = 0; ; hop++) {
      const c = checkUrl(current);
      if (!c.ok) throw new Error(`blocked_url:${c.reason}`);
      let res;
      try {
        res = await transport(c.url.toString(), { method, headers: rest.headers, body, signal: ctrl.signal });
      } catch (e) {
        if (ctrl.signal.aborted) throw new Error('timeout');
        throw e && e.code === 'ESSRFBLOCKED' ? new Error('unreachable') : e;
      }
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc && redirect === 'follow') {
        if (hop >= maxRedirects) throw new Error('too_many_redirects');
        try { await res.body?.cancel(); } catch { /* nothing to drain */ }
        current = new URL(loc, c.url).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
        continue;
      }
      const { buf, truncated } = await readCapped(res, maxBytes, ctrl.signal);
      const out = new Response(NO_BODY.has(res.status) ? null : buf, { status: res.status, headers: res.headers });
      Object.defineProperty(out, 'url', { value: c.url.toString() });
      Object.defineProperty(out, 'truncated', { value: truncated });
      Object.defineProperty(out, 'redirected', { value: hop > 0 });
      return out;
    }
  } catch (e) {
    if (ctrl.signal.aborted && !(e && /^(blocked_url|unreachable|too_many)/.test(e.message))) throw new Error('timeout');
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
