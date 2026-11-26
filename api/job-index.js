// GET /api/job-index?shard=K&v=FORMAT&k=TOKEN — one shard of the in-memory job index (lib/server/jobIndex).
//
// Served through Vercel's CDN (s-maxage + stale-while-revalidate): every search instance in a region loads the same
// cached copy, so the database is read for the index about once per shard every few minutes, however many
// instances start or how many people search. Read from the database by id range in primary-key order (cheap reads
// that never touch the text indexes the slow searches used).
//
// The token keeps the whole corpus from being one public URL (it is derived from the service key; only this
// deployment's own search functions know it). The response holds only what search results already show.

import { timingSafeEqual } from 'crypto';
import { FORMAT, SHARD_COUNT, encodeShard, readShardRows } from '../lib/server/jobIndex/shard.js';
import { indexToken } from '../lib/server/jobIndex/index.js';

// One build per shard per instance at a time, kept 2 minutes: several search instances starting together (a deploy
// empties the CDN) ask for the same shards at once, and one instance answering them builds each shard once.
const BUILT_MS = 120_000;
const _built = new Map(); // shard → { at, p: Promise<{ body, rows, reads }> }

const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end('Method not allowed');
  const U = process.env.SUPABASE_URL, K = process.env.SUPABASE_SERVICE_KEY;
  if (!U || !K) return res.status(503).json({ error: 'DB unavailable' });
  const q = req.query || {};
  const k = Number(q.shard);
  if (!same(q.k, indexToken(K))) return res.status(403).json({ error: 'forbidden' });
  if (String(q.v) !== String(FORMAT)) { res.setHeader('Cache-Control', 'no-store'); return res.status(409).json({ error: 'format', want: FORMAT }); }
  if (!Number.isInteger(k) || k < 0 || k >= SHARD_COUNT) return res.status(400).json({ error: 'shard' });

  const headers = { apikey: K, Authorization: `Bearer ${K}` };
  const get = (path) => fetch(`${U}/rest/v1/${path}`, { headers, signal: AbortSignal.timeout(12_000) });
  const t0 = Date.now();
  try {
    let e = _built.get(k);
    if (!e || Date.now() - e.at > BUILT_MS) {
      e = { at: Date.now(), p: readShardRows(get, k).then(({ rows, missing, reads }) => ({ body: encodeShard(k, rows, { missing }), rows, reads })) };
      e.p.catch(() => { if (_built.get(k) === e) _built.delete(k); });
      _built.set(k, e);
    }
    const { body, rows, reads } = await e.p;
    // Fresh for 4 minutes at the edge; after that the edge keeps answering with this copy while it fetches the
    // next one in the background (a loading instance never waits on the database).
    res.setHeader('Cache-Control', 'public, s-maxage=240, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'noindex');
    console.log(`[job-index] shard ${k}: ${rows.length} rows, ${reads} reads, ${Date.now() - t0} ms`);
    return res.status(200).json(body);
  } catch (e) {
    console.warn(`[job-index] shard ${k} failed after ${Date.now() - t0} ms: ${e.message}`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'shard read failed' });
  }
}
