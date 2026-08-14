// Chronos brain store — the SERVICE-SIDE read/write layer for the always-on online brain (Supabase
// mirror). This is the ONLY code path that uses the Supabase service_role key to touch the brain_*
// tables, so it runs ONLY where that key already lives: the Mac (command-os pushes here) and the
// seenjobs.io gateway (api/brain.js). It is NEVER shipped to a cloud sandbox — a repo-connected web
// session reaches the brain only through the token-gated gateway, never with the service key.
//
// The service_role key bypasses RLS on the WHOLE product project (users, admin, billing) that these
// brain_* tables share — which is exactly why it must stay server-side.
//
// Writes reuse applyFact (the pure, supersede-aware vault writer) so a fact recorded here is
// byte-identical to one written on the Mac, and brain_notes stays canonical with brain_facts
// re-derived from it. Dependency-free (fetch + PostgREST).

import { createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { buildBriefing, buildIndex, findContradictions, normalizeFacts, parseFrontmatter,
  searchFacts } from './memoryGraph.js';
import { applyFact, ensureTimelineFrontmatter } from './writeFact.js';

const env = (k) => { const v = process.env[k]; return v && v.trim() ? v.trim() : null; };
const supaUrl = () => (env('SUPABASE_URL') || '').replace(/\/+$/, '');
const supaKey = () => env('SUPABASE_SERVICE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
const isoToday = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
const NOTE_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function assertNotePath(note) {
  const n = String(note ?? '').trim();
  if (!n) throw new Error('brain write rejected: note path is required');
  if (n.includes('..') || !NOTE_PATH_RE.test(n) || n.length > 120) {
    throw new Error('brain write rejected: note must be a safe vault path such as knowledge/seen.md');
  }
  return n.endsWith('.md') ? n : `${n}.md`;
}

export function isForbiddenLegacySource(name) {
  const n = String(name || '').trim().toLowerCase();
  return n === 'claude' || n.startsWith('claude-session') || n.startsWith('claude:');
}

export const serviceConfigured = () => !!(supaUrl() && supaKey());

const scryptAsync = promisify(scrypt);
const credentialVerifier = (secret, salt) => scryptAsync(secret, salt, 32);
const credentialLookup = (secret) => createHash('sha256').update(secret).digest('hex');
const scopeAllowed = (scopes, required) => Array.isArray(scopes)
  && (scopes.includes('admin') || (Array.isArray(required) ? required : [required]).every((s) => scopes.includes(s)));

async function rest(path, { method = 'GET', body, prefer, signal } = {}) {
  const key = supaKey();
  if (!supaUrl() || !key) throw new Error('brain store not configured (need SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  const res = await fetch(`${supaUrl()}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const UPSERT = 'resolution=merge-duplicates,return=minimal';

// Resolve a per-client bearer credential to one authoritative identity. The gateway's global token
// remains an outer deployment secret; this registry prevents one AI from claiming another AI's name.
// The random 256-bit credential's SHA-256 lookup selects one row through a unique index; a salted
// scrypt verifier then authenticates that row. Neither stored value can be used as the credential.
export async function authorizeClient(secret, { scope = 'read', at = nowIso() } = {}) {
  if (typeof secret !== 'string' || !secret.startsWith('chr_')) {
    return { ok: false, error: 'invalid client credential' };
  }
  const digest = credentialLookup(secret);
  const rows = await rest(`brain_clients?select=id,name,scopes,salt,verifier,created_at,expires_at,revoked_at,last_used_at&lookup=eq.${encodeURIComponent(digest)}&limit=1`);
  // The unique lookup and limit=1 should already bound this, but consume only the first row even if
  // a faulty REST mock/proxy violates that contract. Authentication performs at most one scrypt.
  for (const row of (rows || []).slice(0, 1)) {
    let match = false;
    try {
      const got = await credentialVerifier(secret, row.salt);
      const want = Buffer.from(String(row.verifier || ''), 'hex');
      match = got.length === want.length && timingSafeEqual(got, want);
    } catch { /* malformed registry row cannot authenticate */ }
    if (!match) continue;
    const identity = {
      id: row.id, name: row.name, scopes: row.scopes || [], createdAt: row.created_at || null,
      expiresAt: row.expires_at || null, revokedAt: row.revoked_at || null, lastUsedAt: row.last_used_at || null,
    };
    if (isForbiddenLegacySource(row.name)) return { ok: false, error: 'legacy Claude session identity forbidden', identity };
    if (row.revoked_at) return { ok: false, error: 'client credential revoked', identity };
    if (row.expires_at && Date.parse(row.expires_at) <= Date.parse(at)) return { ok: false, error: 'client credential expired', identity };
    if (!scopeAllowed(row.scopes, scope)) {
      const wanted = (Array.isArray(scope) ? scope : [scope]).join('+');
      return { ok: false, error: `client credential lacks ${wanted} scope`, identity };
    }
    // Usage metadata is operational only. Authentication never depends on this best-effort update.
    rest(`brain_clients?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'PATCH', body: { last_used_at: at }, prefer: 'return=minimal',
    }).catch(() => {});
    return { ok: true, identity };
  }
  return { ok: false, error: 'invalid client credential' };
}

// READ: every vault note (verbatim markdown) as { path, text } — the shape buildIndex() consumes.
export async function fetchNotes() {
  const rows = await rest('brain_notes?select=path,content&order=path.asc');
  return (rows || []).map((r) => ({ path: r.path, text: r.content }));
}

const FACT_SCAN_LIMIT = 5000;
const FACT_PAGE_SIZE = 500;
const FACT_SELECT = [
  'note', 'id', 'subject', 'predicate', 'object', 'valid_from', 'valid_to', 'confidence', 'source',
  'recorded', 'recorded_at', 'invalidated', 'by', 'change', 'supersedes',
].join(',');

// The queryable mirror is paged and bounded before any client-side filtering. Paging avoids
// PostgREST's deployment-level max-rows cap silently truncating a full read; refuse an overgrown
// mirror rather than returning a legitimate-looking false clean result (the silent-zero class).
async function fetchFactsForRead() {
  const facts = [];
  for (let offset = 0; offset <= FACT_SCAN_LIMIT; offset += FACT_PAGE_SIZE) {
    const rows = await rest(
      `brain_facts?select=${FACT_SELECT}&order=recorded_at.desc.nullslast&limit=${FACT_PAGE_SIZE}&offset=${offset}`,
    ) || [];
    facts.push(...rows);
    if (facts.length > FACT_SCAN_LIMIT) {
      throw new Error(`brain fact scan exceeds the ${FACT_SCAN_LIMIT}-row safety bound`);
    }
    if (rows.length < FACT_PAGE_SIZE) return facts;
  }
  throw new Error(`brain fact scan exceeds the ${FACT_SCAN_LIMIT}-row safety bound`);
}

// READ: compact server-side session orientation. The gateway may read the canonical notes internally,
// but the cloud client receives only the bounded briefing instead of downloading the entire vault.
export async function briefing({ today = isoToday(), since = null } = {}) {
  const b = buildBriefing(buildIndex(await fetchNotes()), { today, since });
  return {
    today: b.today,
    since: b.since,
    counts: b.counts,
    changed: { added: b.changed.added.slice(0, 8), invalidated: b.changed.invalidated.slice(0, 8) },
    openThreads: b.openThreads.slice(0, 10),
    contradictions: b.contradictions.slice(0, 5),
    lowConfidence: b.lowConfidence.slice(0, 5),
  };
}

// READ: bi-temporal fact search over the queryable mirror. api/brain.js validates and bounds the
// public filter/limit contract before this function is reached.
export async function findFacts(filters = {}) {
  const limit = filters.limit == null ? 50 : Number(filters.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('brain fact limit must be an integer from 1 to 100');
  if (![filters.query, filters.subject, filters.predicate].some((v) => typeof v === 'string' && v.trim())) {
    throw new Error('brain fact search requires query, subject, or predicate');
  }
  const matches = searchFacts(await fetchFactsForRead(), {
    query: filters.query || null,
    subject: filters.subject || null,
    predicate: filters.predicate || null,
    asOf: filters.as_of || null,
  });
  return { facts: matches.slice(0, limit), count: matches.length, truncated: matches.length > limit };
}

// READ: same contradiction definition as the local Chronos engine. The full-scan safety bound above
// makes an overgrown mirror fail loudly rather than claim that a partial scan is clean.
export async function contradictions() {
  const all = findContradictions(await fetchFactsForRead());
  return { conflicts: all.slice(0, 100), count: all.length, truncated: all.length > 100 };
}

async function fetchNoteContent(path) {
  const rows = await rest(`brain_notes?select=content&path=eq.${encodeURIComponent(path)}`);
  return rows && rows.length ? rows[0].content : '';
}

// Upsert one note's canonical markdown, then re-derive its facts into brain_facts (same contract as
// the Mac's pushBrain, so the queryable table always matches the note).
// Exported for scripts/brain-repair.mjs --apply: repairing a note rewrites its markdown AND must
// re-derive brain_facts from it, which is exactly this contract. Service-key path only.
export async function putNote(path, content) {
  const notePath = assertNotePath(path);
  await rest('brain_notes', { method: 'POST', body: [{ path: notePath, content, updated_at: nowIso() }], prefer: UPSERT });
  const { facts } = normalizeFacts(parseFrontmatter(content).data, notePath);
  if (facts.length) {
    const rows = facts.map((f) => ({
      note: notePath, id: f.id, subject: String(f.subject), predicate: String(f.predicate), object: String(f.object),
      valid_from: f.valid_from || null, valid_to: f.valid_to || null,
      confidence: f.confidence || null, source: f.source || null,
      recorded: f.recorded || null, recorded_at: f.recorded_at || null, invalidated: f.invalidated || null,
      by: f.by || null, change: f.change || null, supersedes: f.supersedes || null, synced_at: nowIso(),
    }));
    await rest('brain_facts?on_conflict=note,id', { method: 'POST', body: rows, prefer: UPSERT });
  }
}

// WRITE: record a bi-temporal fact (supersede-never-overwrite). Throws on a contradiction (same as local).
const DEFAULT_NOTE = 'claude-observations.md';
export async function recordFact(fact, { note } = {}) {
  const noteRel = assertNotePath(note || DEFAULT_NOTE);
  const cur = await fetchNoteContent(noteRel);
  const out = applyFact(cur, noteRel, fact, isoToday());
  if (out === null) return { written: 0, reason: 'unchanged', note: noteRel };
  await putNote(noteRel, out);
  return { written: 1, note: noteRel };
}

// WRITE: append a dated timeline episode; mirrors the local appendTimeline byte-for-byte and keeps
// the queryable brain_timeline table in parity.
//
// MIRROR-FIRST, deliberately. This used to write the note and THEN mirror the row, which made the op
// capable of a PARTIAL WRITE: the old UNIQUE btree(date, heading, body) blew past Postgres's ~2704-byte
// btree entry cap on any body over ~2.7KB, so the mirror insert failed AFTER the note was durably
// persisted. The op returned ok:false while the note was already in the vault, so a retry appended it
// twice. (Hit live 3× by a cloud session 2026-08-13 09:53–09:55Z. Migration 069 rekeys the index to
// md5(body) so size can no longer fail it; this ordering is what makes a failure clean regardless.)
//
// Why THIS ordering is the honest one, given one of the two writes has to go first:
//   • mirror fails  → we return the error having written NOTHING. A failed op leaves zero durable
//     state, so a retry is unambiguously safe. This is the case that used to corrupt the vault.
//   • note fails    → the mirror row is already in. That is the acceptable direction: the mirror is
//     append-only and deduped by UNIQUE(date, heading, body_md5), so the retry's mirror insert is a
//     no-op and only the note write is redone — the two converge. The reverse (note in, mirror out)
//     cannot converge, because the note append is not idempotent on its own.
// The `body_md5` in the on_conflict target is a STORED GENERATED column — it must be named as the
// conflict target but must NEVER appear in the row payload, or PostgREST rejects the insert (400).
export async function appendTimeline(date, heading, text) {
  const rel = `timeline/${date}.md`;
  const entry = `\n## ${heading}\n\n${text}\n`;

  // 1. Mirror first. Throws (→ ok:false) before anything durable happens if this can't land.
  await rest('brain_timeline?on_conflict=date,heading,body_md5', {
    method: 'POST', body: [{ date, heading, body: text }], prefer: 'resolution=ignore-duplicates,return=minimal',
  });

  // 2. Then the canonical note. Skip a byte-identical re-append so a retry (or a lost response on an
  // op that actually succeeded) converges instead of stacking the same episode twice — this is the
  // note-side counterpart of the mirror's ignore-duplicates, and keeps the two in parity.
  const cur = await fetchNoteContent(rel);
  const prepared = ensureTimelineFrontmatter(cur, date);
  if (cur && cur.includes(entry)) {
    if (prepared !== cur) {
      await rest('brain_notes', {
        method: 'POST', body: [{ path: rel, content: prepared, updated_at: nowIso() }], prefer: UPSERT,
      });
    }
    return { note: rel, heading, appended: false, repaired: prepared !== cur };
  }
  const content = `${prepared.replace(/\n*$/, '\n')}${entry}`;
  await rest('brain_notes', { method: 'POST', body: [{ path: rel, content, updated_at: nowIso() }], prefer: UPSERT });
  return { note: rel, heading, appended: true };
}

// AUDIT: one brain_access row per gateway op, so authenticated cloud-client activity — READS
// INCLUDED — is visible live in Chronos. Before this, a cloud session could read the whole vault and
// leave no trace anywhere.
//
// CONTRACT: never throws. The gateway awaits this bounded write before responding so Vercel cannot
// discard the traffic event when an invocation ends. Failure still cannot alter the Brain op's result.
//
// `args` must stay a SHORT, NON-SENSITIVE summary — never fact objects, note/timeline bodies, or
// credentials. Column caps are enforced here too, so a hostile caller can't fail the insert (or bloat
// the table) by stuffing a megabyte into fact.subject.
export async function recordAccess({ op, mode, by, args, ok, ms, error } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  if (timeout.unref) timeout.unref();
  try {
    if (!serviceConfigured()) return false;
    await rest('brain_access', {
      method: 'POST',
      prefer: 'return=minimal',
      signal: controller.signal,
      body: [{
        op: String(op || '(none)').slice(0, 120),
        mode: mode === 'write' ? 'write' : 'read', // NOT NULL + CHECK IN ('read','write')
        by: by == null ? null : String(by).slice(0, 200),
        args: args == null ? null : String(args).slice(0, 300),
        ok: ok !== false,
        ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null,
        error: error == null ? null : String(error).slice(0, 300),
      }],
    });
    return true;
  } catch (e) {
    try { console.error(`[brain-access] audit insert failed: ${e && e.message}`); } catch { /* ignore */ }
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function counts() {
  const [n, f, t] = await Promise.all([
    rest('brain_notes?select=path&limit=100000'),
    rest('brain_facts?select=note&limit=100000'),
    rest('brain_timeline?select=id&limit=100000'),
  ]);
  return { notes: (n || []).length, facts: (f || []).length, episodes: (t || []).length };
}
