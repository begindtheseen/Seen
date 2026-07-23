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
async function putNote(path, content) {
  await rest('brain_notes', { method: 'POST', body: [{ path, content, updated_at: nowIso() }], prefer: UPSERT });
  const { facts } = normalizeFacts(parseFrontmatter(content).data, path);
  if (facts.length) {
    const rows = facts.map((f) => ({
      note: path, id: f.id, subject: String(f.subject), predicate: String(f.predicate), object: String(f.object),
      valid_from: f.valid_from || null, valid_to: f.valid_to || null,
      confidence: f.confidence || null, source: f.source || null,
      recorded: f.recorded || null, invalidated: f.invalidated || null, synced_at: nowIso(),
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
export async function appendTimeline(date, heading, text) {
  const rel = `timeline/${date}.md`;
  const entry = `\n## ${heading}\n\n${text}\n`;
  const cur = await fetchNoteContent(rel);
  const content = cur
    ? cur.replace(/\n*$/, '\n') + entry
    : `---\ntitle: ${date}\ndate: ${date}\ntags: [timeline]\n---\n${entry}`;
  await rest('brain_notes', { method: 'POST', body: [{ path: rel, content, updated_at: nowIso() }], prefer: UPSERT });
  await rest('brain_timeline?on_conflict=date,heading,body', {
    method: 'POST', body: [{ date, heading, body: text }], prefer: 'resolution=ignore-duplicates,return=minimal',
  });
  return { note: rel, heading };
}

export async function counts() {
  const [n, f, t] = await Promise.all([
    rest('brain_notes?select=path&limit=100000'),
    rest('brain_facts?select=note&limit=100000'),
    rest('brain_timeline?select=id&limit=100000'),
  ]);
  return { notes: (n || []).length, facts: (f || []).length, episodes: (t || []).length };
}
