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
//   op "append_timeline" { date?, heading, text } → { ok:true, note, heading, appended }
//        `appended:false` means the identical episode was already in the note (a converged retry), not a failure.
//        Body size is unbounded: the brain_timeline mirror is keyed on md5(body) (migration 069), and the
//        mirror insert runs BEFORE the note write so a failure leaves zero durable state. See brainStore.js.
// Errors: 401 missing/bad token · 405 non-POST · 400 bad op/params · 503 not configured · 500 (error).
// Server-to-server only (no CORS headers exposed): the caller is the MCP server / a script, not a browser.
//
// AUDIT: every authenticated op — READS INCLUDED — appends one row to brain_access, so cloud-session
// activity is visible live from the Chronos Mac app. Reads used to leave no trace anywhere, which meant
// a cloud session could pull the entire vault invisibly. The insert is strictly fire-and-forget (never
// awaited, all failures swallowed): the audit trail must never slow, fail, or change a brain op.

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

// Ops that MUTATE the vault. Everything else (including an unknown op, which changes nothing) is a read.
const WRITE_OPS = new Set(['record_fact', 'append_timeline']);

// One-line, non-sensitive summary of WHAT the op touched — safe to read in full from Chronos.
// Deliberately never the fact object, the note body, the timeline text, or any credential: for a read
// the op name is the whole story, and for a write the identifiers are enough to recognise the change.
function auditArgs(op, body) {
  if (op === 'record_fact') {
    const f = body.fact || {};
    return [f.subject, f.predicate].filter(Boolean).map(String).join(' · ') || null;
  }
  if (op === 'append_timeline') return body.heading ? String(body.heading) : null;
  return null;
}

// Run one op → { status, json }. Split out of the handler so the result (and therefore a TRUTHFUL
// `ok`/`ms`) is known before the audit row is written.
async function runOp(op, body) {
  if (op === 'notes') return { status: 200, json: { ok: true, notes: await store.fetchNotes() } };
  if (op === 'counts') return { status: 200, json: { ok: true, counts: await store.counts() } };
  if (op === 'record_fact') {
    const f = body.fact || {};
    if (!f.subject || !f.predicate || f.object === undefined || f.object === null) {
      return { status: 400, json: { ok: false, error: 'record_fact needs fact.subject, fact.predicate, fact.object' } };
    }
    return { status: 200, json: { ok: true, ...(await store.recordFact(f, { note: body.note })) } };
  }
  if (op === 'append_timeline') {
    if (!body.heading || !body.text) return { status: 400, json: { ok: false, error: 'append_timeline needs heading + text' } };
    const date = body.date || new Date().toISOString().slice(0, 10);
    return { status: 200, json: { ok: true, ...(await store.appendTimeline(date, body.heading, body.text)) } };
  }
  return { status: 400, json: { ok: false, error: `unknown op: ${op || '(none)'}` } };
}

// Fire-and-forget audit — ONE row per authenticated op, no dedupe, no sampling, no rate limit.
// Never awaited and never allowed to throw, so the op's latency and status code are untouched.
function audit(op, body, out, ms) {
  try {
    const p = store.recordAccess({
      op,
      mode: WRITE_OPS.has(op) ? 'write' : 'read',
      by: (typeof body.by === 'string' && body.by.trim()) ? body.by.trim() : 'claude:cloud-session',
      args: auditArgs(op, body),
      ok: out.json.ok === true,
      ms,
    });
    // recordAccess already swallows its own failures; this guards a future/unexpected rejection.
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {
    try { console.error(`[brain-audit] ${e && e.message}`); } catch { /* ignore */ }
  }
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

  const t0 = Date.now();
  let out;
  try {
    out = await runOp(op, body);
  } catch (e) {
    try { logError('api/brain', e, { op }); } catch { /* best-effort */ }
    out = { status: 500, json: { ok: false, error: e.message } };
  }

  // Audit AFTER the outcome is known (so ok/ms are truthful) and BEFORE responding, but never awaited.
  audit(op, body, out, Date.now() - t0);

  return res.status(out.status).json(out.json);
}
