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

import { parseFrontmatter, normalizeFacts } from './memoryGraph.js';
import { applyFact } from './writeFact.js';

const env = (k) => { const v = process.env[k]; return v && v.trim() ? v.trim() : null; };
const supaUrl = () => (env('SUPABASE_URL') || '').replace(/\/+$/, '');
const supaKey = () => env('SUPABASE_SERVICE_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
const isoToday = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

export const serviceConfigured = () => !!(supaUrl() && supaKey());

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const key = supaKey();
  if (!supaUrl() || !key) throw new Error('brain store not configured (need SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  const res = await fetch(`${supaUrl()}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(prefer ? { prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const UPSERT = 'resolution=merge-duplicates,return=minimal';

// READ: every vault note (verbatim markdown) as { path, text } — the shape buildIndex() consumes.
export async function fetchNotes() {
  const rows = await rest('brain_notes?select=path,content&order=path.asc');
  return (rows || []).map((r) => ({ path: r.path, text: r.content }));
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
  await rest('brain_notes', { method: 'POST', body: [{ path, content, updated_at: nowIso() }], prefer: UPSERT });
  const { facts } = normalizeFacts(parseFrontmatter(content).data, path);
  if (facts.length) {
    const rows = facts.map((f) => ({
      note: path, id: f.id, subject: String(f.subject), predicate: String(f.predicate), object: String(f.object),
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
  const noteRel = note || DEFAULT_NOTE;
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
  if (cur && cur.includes(entry)) return { note: rel, heading, appended: false };
  const content = cur
    ? cur.replace(/\n*$/, '\n') + entry
    : `---\ntitle: ${date}\ndate: ${date}\ntags: [timeline]\n---\n${entry}`;
  await rest('brain_notes', { method: 'POST', body: [{ path: rel, content, updated_at: nowIso() }], prefer: UPSERT });
  return { note: rel, heading, appended: true };
}

// AUDIT (fire-and-forget): one brain_access row per gateway op, so cloud-session activity — READS
// INCLUDED — is visible live in Chronos. Before this, a cloud session could read the whole vault and
// leave no trace anywhere.
//
// CONTRACT: never throws and is never awaited by the request path. An audit failure must not slow,
// fail, or alter the op it describes (same posture as logError()). Callers get a boolean so tests can
// assert the write was attempted; the request path ignores it.
//
// `args` must stay a SHORT, NON-SENSITIVE summary — never fact objects, note/timeline bodies, or
// credentials. Column caps are enforced here too, so a hostile caller can't fail the insert (or bloat
// the table) by stuffing a megabyte into fact.subject.
export async function recordAccess({ op, mode, by, args, ok, ms } = {}) {
  try {
    if (!serviceConfigured()) return false;
    await rest('brain_access', {
      method: 'POST',
      prefer: 'return=minimal',
      body: [{
        op: String(op || '(none)').slice(0, 120),
        mode: mode === 'write' ? 'write' : 'read', // NOT NULL + CHECK IN ('read','write')
        by: by == null ? null : String(by).slice(0, 200),
        args: args == null ? null : String(args).slice(0, 300),
        ok: ok !== false,
        ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : null,
      }],
    });
    return true;
  } catch (e) {
    try { console.error(`[brain-access] audit insert failed: ${e && e.message}`); } catch { /* ignore */ }
    return false;
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
