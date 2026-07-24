// Chronos brain gateway — the scoped, token-gated door to the always-on online brain for CLOUD sessions.
//
// WHY: a repo-connected (web) Claude session has git but no Supabase key — and must NEVER be given the
// service_role key, which bypasses RLS on the WHOLE product project (users, admin, billing, 23k companies)
// that the brain_* tables share. This endpoint runs on seenjobs.io where the service key already lives and
// exposes ONLY brain read/write ops, gated by BRAIN_API_TOKEN. The cloud session holds just
// BRAIN_API_URL + BRAIN_API_TOKEN; a token leak is brain-scoped and revoked by rotating one env var —
// the service key and the product DB are never exposed.
//
// CONTRACT — POST JSON `{ op, ... }` with header `Authorization: Bearer <BRAIN_API_TOKEN>`:
//   op "notes"           → { ok:true, notes:[{path,text}] }              (all vault notes; read backbone)
//   op "counts"          → { ok:true, counts:{notes,facts,episodes} }    (freshness / self-test)
//   op "record_fact"     { fact:{subject,predicate,object,confidence?,source?}, note? } → { ok:true, written, note }
//   op "append_timeline" { date?, heading, text } → { ok:true, note, heading }
// Errors: 401 missing/bad token · 405 non-POST · 400 bad op/params · 503 not configured · 500 (error).
// Server-to-server only (no CORS headers exposed): the caller is the MCP server / a script, not a browser.

import { timingSafeEqual } from 'node:crypto';
import * as store from '../lib/server/brainStore.js';
import { logError } from '../lib/server/errlog.js';

// Constant-time bearer check. Returns null when the gateway isn't configured (token unset).
function tokenOk(req) {
  const want = process.env.BRAIN_API_TOKEN;
  if (!want) return null;
  const hdr = req.headers.authorization || '';
  const got = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });

  const auth = tokenOk(req);
  if (auth === null) return res.status(503).json({ ok: false, error: 'gateway not configured (BRAIN_API_TOKEN unset)' });
  if (!auth) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!store.serviceConfigured()) return res.status(503).json({ ok: false, error: 'brain store not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)' });

  const body = (req.body && typeof req.body === 'object')
    ? req.body
    : (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })();
  const op = body.op;

  try {
    if (op === 'notes') return res.status(200).json({ ok: true, notes: await store.fetchNotes() });
    if (op === 'counts') return res.status(200).json({ ok: true, counts: await store.counts() });
    if (op === 'record_fact') {
      const f = body.fact || {};
      if (!f.subject || !f.predicate || f.object === undefined || f.object === null) {
        return res.status(400).json({ ok: false, error: 'record_fact needs fact.subject, fact.predicate, fact.object' });
      }
      return res.status(200).json({ ok: true, ...(await store.recordFact(f, { note: body.note })) });
    }
    if (op === 'append_timeline') {
      if (!body.heading || !body.text) return res.status(400).json({ ok: false, error: 'append_timeline needs heading + text' });
      const date = body.date || new Date().toISOString().slice(0, 10);
      return res.status(200).json({ ok: true, ...(await store.appendTimeline(date, body.heading, body.text)) });
    }
    return res.status(400).json({ ok: false, error: `unknown op: ${op || '(none)'}` });
  } catch (e) {
    try { logError('api/brain', e, { op }); } catch { /* best-effort */ }
    return res.status(500).json({ ok: false, error: e.message });
  }
}
