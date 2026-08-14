// Chronos brain gateway — the scoped, token-gated door to the always-on online brain for CLOUD sessions.
//
// WHY: a repo-connected (web) Claude session has git but no Supabase key — and must NEVER be given the
// service_role key, which bypasses RLS on the WHOLE product project (users, admin, billing, 23k companies)
// that the brain_* tables share. This endpoint runs on seenjobs.io where the service key already lives and
// exposes ONLY brain read/write ops, gated by BRAIN_API_TOKEN plus a distinct per-client credential.
// The cloud session holds the gateway URL, outer token, exact BRAIN_CLIENT, and its own client token;
// the service key and the product DB are never exposed.
//
// CONTRACT — POST JSON `{ op, by, ... }` with BOTH the deployment bearer and a per-client credential.
// `by` is REQUIRED but never trusted: it must match the identity resolved from the credential registry.
//   op "notes"           → { ok:true, notes:[{path,text}] }              (all vault notes; read backbone)
//   op "counts"          → { ok:true, counts:{notes,facts,episodes} }    (freshness / self-test)
//   op "briefing"        { today?, since? } → { ok:true, briefing }      (compact session orientation)
//   op "search_facts"    { query?|subject?|predicate?, as_of?, limit? }  (bounded bi-temporal search)
//   op "contradictions"  → { ok:true, contradictions:{count,conflicts} } (full hygiene sweep)
//   op "record_fact"     { fact:{subject,predicate,object,confidence?,source?}, note? } → { ok:true, written, note }
//   op "append_timeline" { date?, heading, text } → { ok:true, note, heading, appended }
//        `appended:false` means the identical episode was already in the note (a converged retry), not a failure.
//        Body size is unbounded: the brain_timeline mirror is keyed on md5(body) (migration 069), and the
//        mirror insert runs BEFORE the note write so a failure leaves zero durable state. See brainStore.js.
// Errors: 401 missing/bad token or client credential · 403 revoked/expired/scope/identity mismatch
// · 428 missing identity · 405 non-POST · 400 bad op/params · 503 not configured · 500 (error).
// Server-to-server only (no CORS headers exposed): the caller is the MCP server / a script, not a browser.
//
// AUDIT: every authenticated op — READS INCLUDED — appends one row to brain_access, so cloud client
// activity is visible live from the Chronos Mac app. Reads used to leave no trace anywhere, which meant
// a cloud session could pull the entire vault invisibly. The bounded insert is awaited before the
// response so serverless teardown cannot discard it; storage failure never changes the Brain op result.

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
  const short = (value, max = 120) => String(value).slice(0, max);
  if (op === 'record_fact') {
    const f = body.fact || {};
    return [f.subject, f.predicate].filter(Boolean).map((v) => short(v)).join(' · ') || null;
  }
  if (op === 'append_timeline') return body.heading ? short(body.heading) : null;
  if (op === 'briefing') return [body.today && `today:${body.today}`, body.since && `since:${body.since}`].filter(Boolean).join(' · ') || null;
  if (op === 'search_facts') {
    return [body.subject && `subject:${short(body.subject)}`, body.predicate && `predicate:${short(body.predicate)}`,
      body.as_of && `as_of:${body.as_of}`, body.query && `query:${String(body.query).length} chars`]
      .filter(Boolean).map(String).join(' · ') || null;
  }
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function optionalDate(value, name) {
  if (value == null || value === '') return null;
  const v = String(value);
  const parsed = new Date(`${v}T00:00:00.000Z`);
  if (!ISO_DATE.test(v) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v) {
    throw new Error(`${name} must be an ISO date (YYYY-MM-DD)`);
  }
  return v;
}
function optionalBoundedString(value, name, max) {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  if (!v) return null;
  if (v.length > max) throw new Error(`${name} exceeds ${max} characters`);
  return v;
}

// Run one op → { status, json }. Split out of the handler so the result (and therefore a TRUTHFUL
// `ok`/`ms`) is known before the audit row is written.
async function runOp(op, body, actor) {
  if (op === 'notes') return { status: 200, json: { ok: true, notes: await store.fetchNotes() } };
  if (op === 'counts') return { status: 200, json: { ok: true, counts: await store.counts() } };
  if (op === 'briefing') {
    let today; let since;
    try {
      today = optionalDate(body.today, 'today') || new Date().toISOString().slice(0, 10);
      since = optionalDate(body.since, 'since');
    } catch (e) { return { status: 400, json: { ok: false, error: e.message } }; }
    return { status: 200, json: { ok: true, briefing: await store.briefing({ today, since }) } };
  }
  if (op === 'search_facts') {
    let filters; let n;
    try {
      filters = {
        query: optionalBoundedString(body.query, 'query', 200),
        subject: optionalBoundedString(body.subject, 'subject', 160),
        predicate: optionalBoundedString(body.predicate, 'predicate', 160),
        as_of: optionalDate(body.as_of, 'as_of'),
      };
      if (!filters.query && !filters.subject && !filters.predicate) {
        throw new Error('search_facts needs query, subject, or predicate');
      }
      n = body.limit == null ? 50 : Number(body.limit);
      if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error('limit must be an integer from 1 to 100');
    } catch (e) { return { status: 400, json: { ok: false, error: e.message } }; }
    return { status: 200, json: { ok: true, ...(await store.findFacts({ ...filters, limit: n })) } };
  }
  if (op === 'contradictions') {
    return { status: 200, json: { ok: true, contradictions: await store.contradictions() } };
  }
  if (op === 'record_fact') {
    const f = body.fact || {};
    if (!f.subject || !f.predicate || f.object === undefined || f.object === null) {
      return { status: 400, json: { ok: false, error: 'record_fact needs fact.subject, fact.predicate, fact.object' } };
    }
    try { store.assertNotePath(body.note || 'claude-observations.md'); }
    catch (e) { return { status: 400, json: { ok: false, error: e.message } }; }
    const authenticatedFact = {
      ...f,
      by: actor,
    };
    return { status: 200, json: { ok: true, ...(await store.recordFact(authenticatedFact, { note: body.note })) } };
  }
  if (op === 'append_timeline') {
    if (!body.heading || !body.text) return { status: 400, json: { ok: false, error: 'append_timeline needs heading + text' } };
    const date = body.date || new Date().toISOString().slice(0, 10);
    return { status: 200, json: { ok: true, ...(await store.appendTimeline(date, body.heading, body.text)) } };
  }
  return { status: 400, json: { ok: false, error: `unknown op: ${op || '(none)'}` } };
}

// Durable audit — ONE row per authenticated op, no dedupe or sampling. Awaited before the response so
// serverless invocation teardown cannot discard traffic; recordAccess is bounded and never throws.
async function audit(op, body, out, ms, actor) {
  try {
    await store.recordAccess({
      op,
      mode: WRITE_OPS.has(op) ? 'write' : 'read',
      by: actor || 'unidentified',
      args: auditArgs(op, body),
      ok: out.json.ok === true,
      ms,
      error: out.json.ok === true ? null : String(out.json.error || 'request failed').slice(0, 300),
    });
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

  const body = (req.body && typeof req.body === 'object')
    ? req.body
    : (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })();
  const op = body.op;
  const identity = typeof body.by === 'string' ? body.by.trim() : '';
  if (!identity) {
    const out = { status: 428, json: { ok: false, error: 'Identify yourself: include a nonblank `by` client identity. Brain access is denied.' } };
    await audit(op, body, out, 0, 'unidentified'); // authenticated denial is traffic too
    return res.status(out.status).json(out.json);
  }
  if (!store.serviceConfigured()) return res.status(503).json({ ok: false, error: 'brain store not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)' });

  const clientToken = String(req.headers['x-chronos-client-token'] || '').trim();
  // Writes read the existing note before superseding it, so a write-only principal would gain an
  // observable read channel through conflict behavior. Require both capabilities (admin implies both).
  const requiredScope = WRITE_OPS.has(op) ? ['read', 'write'] : 'read';
  let client;
  try { client = await store.authorizeClient(clientToken, { scope: requiredScope }); }
  catch (e) {
    const out = { status: 500, json: { ok: false, error: `client authorization unavailable: ${e.message}` } };
    await audit(op, body, out, 0, 'unidentified');
    return res.status(out.status).json(out.json);
  }
  if (!client.ok) {
    const known = client.identity?.name || 'unidentified';
    const invalid = client.error === 'invalid client credential';
    const out = { status: invalid ? 401 : 403, json: { ok: false, error: `Access denied: ${client.error}` } };
    await audit(op, body, out, 0, known);
    return res.status(out.status).json(out.json);
  }
  if (identity.toLowerCase() !== String(client.identity.name).toLowerCase()) {
    const out = { status: 403, json: { ok: false, error: `Access denied: identity claim does not match credential owner ${client.identity.name}` } };
    await audit(op, body, out, 0, client.identity.name);
    return res.status(out.status).json(out.json);
  }

  const t0 = Date.now();
  let out;
  try {
    out = await runOp(op, body, client.identity.name);
  } catch (e) {
    try { logError('api/brain', e, { op }); } catch { /* best-effort */ }
    out = { status: 500, json: { ok: false, error: e.message } };
  }

  // Audit AFTER the outcome is known (so ok/ms are truthful) and await durability before responding.
  await audit(op, body, out, Date.now() - t0, client.identity.name);

  return res.status(out.status).json(out.json);
}
