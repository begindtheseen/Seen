// Saved résumés (owner request 2026-11-01) — the rules and the store behind the résumé actions in
// api/user-sync.js and the résumé picker in Apply on Seen (api/apply.js).
//
//   · Free keeps MAX_RESUMES_FREE, Pro keeps MAX_RESUMES_PRO (lib/server/creditRules.js).
//   · The DEFAULT résumé is mirrored into profiles.resume_text (+ file name, word count, updated at) on
//     every change, so every reader of profiles.resume_text keeps working unchanged.
//   · When Pro ends nothing is deleted: every résumé stays viewable and downloadable; only the default
//     is "usable" (optimize / apply) until Pro is back, and adding past the free cap is refused.
//   · Before migration 20261101140000 the table is missing: every call answers { ready: false } and
//     the caller keeps the single profiles.resume_text résumé.
// Every query is scoped user_id=eq.<uid>; ids are UUID-checked before they reach a query.
import { MAX_RESUMES_FREE, MAX_RESUMES_PRO, hasProAccess } from './creditRules.js';
import { isReadableResume } from './resumeReadability.js';

export const RESUME_NAME_MAX = 60;
export const RESUME_TEXT_MIN = 50;
export const RESUME_TEXT_MAX = 60000; // same ceiling as an Apply-on-Seen résumé (seenApply.js MAX_RESUME_TEXT)
export const DEFAULT_RESUME_NAME = 'My résumé';
export const RESUME_LIST_LIMIT = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isResumeId = (id) => typeof id === 'string' && UUID_RE.test(id);

// ── Pure rules ───────────────────────────────────────────────────────────────────────────────────

/** How many résumés this account may keep. */
export const resumeCap = (pro) => (pro === true ? MAX_RESUMES_PRO : MAX_RESUMES_FREE);
/** May one more be added? */
export const canAddResume = (count, pro) => (Number(count) || 0) < resumeCap(pro);
/** May this résumé be used to optimize or apply? The default always; the others with Pro. */
export const isUsableResume = (row, pro) => !!row && (row.is_default === true || pro === true);

const time = (r) => { const t = Date.parse(r && r.updated_at); return Number.isFinite(t) ? t : 0; };

/** Default first, then most recently updated. */
export function sortResumes(rows) {
  return [...(rows || [])].sort((a, b) => (b.is_default === true) - (a.is_default === true) || time(b) - time(a));
}

/** The résumé that becomes the default when `removedId` goes: the most recently updated other one. */
export function nextDefault(rows, removedId) {
  return [...(rows || [])].filter((r) => r && r.id !== removedId).sort((a, b) => time(b) - time(a))[0] || null;
}

/** A name a person typed: control characters out, spaces collapsed, ≤ RESUME_NAME_MAX characters. */
export function cleanResumeName(v) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, RESUME_NAME_MAX).join('').trim();
}

/** "Jordan Avery Resume 2026.pdf" → "Jordan Avery Resume 2026". */
export function nameFromFile(fileName) {
  return cleanResumeName(String(fileName || '').replace(/\.(pdf|docx?|txt|md|rtf)$/i, '').replace(/[_]+/g, ' '));
}

/** Validate the text of a new résumé. → { ok: true, text } | { ok: false, error, code } */
export function checkResumeText(text) {
  const s = typeof text === 'string' ? text.replace(/\u0000/g, '').trim() : '';
  if (s.length < RESUME_TEXT_MIN) return { ok: false, code: 'RESUME_TOO_SHORT', error: 'Add the résumé text — upload a file or paste it.' };
  if (s.length > RESUME_TEXT_MAX) return { ok: false, code: 'RESUME_TOO_LONG', error: 'That résumé is too long to save. Trim it and try again.' };
  if (!isReadableResume(s)) return { ok: false, code: 'RESUME_UNREADABLE', error: 'That file did not come through as readable text. Paste the text instead.' };
  return { ok: true, text: s };
}

/** What the list answers for one row (no text). */
export function resumeListItem(row, pro) {
  return {
    id: row.id, name: row.name || DEFAULT_RESUME_NAME, file_name: row.file_name || null,
    word_count: Number.isFinite(row.word_count) ? row.word_count : null, is_default: row.is_default === true,
    created_at: row.created_at || null, updated_at: row.updated_at || null, usable: isUsableResume(row, pro),
  };
}

/** The refusal when one more résumé would go past the cap — honest about why and what unlocks more. */
export function capMessage(count, pro) {
  if (pro === true) return `You have ${count} of ${MAX_RESUMES_PRO} résumés. Delete one to add another.`;
  if (count > MAX_RESUMES_FREE) return `You have ${count} résumés saved. They stay saved, and your default works as always — adding more needs Pro again.`;
  return `A free account keeps ${MAX_RESUMES_FREE} résumé. Pro keeps up to ${MAX_RESUMES_PRO} — or replace the one you have.`;
}

/** PostgREST's "no such table" (before the migration). */
export function isMissingTable(status, body) {
  const code = body && typeof body === 'object' ? String(body.code || '') : '';
  const msg = body && typeof body === 'object' ? String(body.message || '') : String(body || '');
  return status === 404 || code === 'PGRST205' || code === '42P01' || /relation .* does not exist|Could not find the table/i.test(msg);
}

/** The profiles mirror of the default résumé (null clears it). */
export function mirrorPatch(row, nowIso = new Date().toISOString()) {
  if (!row) return { resume_text: null, resume_file_name: null, resume_word_count: null, resume_updated_at: nowIso };
  return {
    resume_text: row.resume_text, resume_file_name: row.file_name || null,
    resume_word_count: Number.isFinite(row.word_count) ? row.word_count : null, resume_updated_at: nowIso,
  };
}

// ── Store (db = (path, opts) => fetch Response, service key, Prefer return=representation) ────────

const LIST_FIELDS = 'id,name,file_name,word_count,is_default,created_at,updated_at';

async function call(db, path, opts) {
  try {
    const r = await db(path, opts);
    const body = r.status === 204 ? null : await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, body, missing: !r.ok && isMissingTable(r.status, body) };
  } catch {
    return { ok: false, status: 0, body: null, missing: false };
  }
}

/** Is this account Pro right now? (the one definition, hasProAccess) */
export async function readPro(db, uid) {
  const r = await call(db, `ai_credits?user_id=eq.${uid}&limit=1`);
  return r.ok && Array.isArray(r.body) ? hasProAccess(r.body[0] || null) : false;
}

/** → { missing } | { error } | { rows } — this account's résumés, without their text. */
export async function readResumes(db, uid) {
  const r = await call(db, `resumes?user_id=eq.${uid}&select=${LIST_FIELDS}&order=updated_at.desc&limit=${RESUME_LIST_LIMIT}`);
  if (r.missing) return { missing: true };
  if (!r.ok || !Array.isArray(r.body)) return { error: true };
  return { rows: r.body };
}

/** One of this account's résumés with its text, or null. */
export async function readResume(db, uid, id) {
  if (!isResumeId(id)) return { row: null };
  const r = await call(db, `resumes?id=eq.${id}&user_id=eq.${uid}&select=${LIST_FIELDS},resume_text&limit=1`);
  if (r.missing) return { missing: true };
  if (!r.ok || !Array.isArray(r.body)) return { error: true };
  return { row: r.body[0] || null };
}

/** Write the default résumé (or nothing) into profiles. */
export async function writeMirror(db, uid, row) {
  const r = await call(db, 'profiles?on_conflict=id', {
    method: 'POST', body: JSON.stringify({ id: uid, ...mirrorPatch(row) }),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  return r.ok;
}

/** Make `id` the default: unset the old one first (one default per account is a unique index). */
async function promote(db, uid, id) {
  const off = await call(db, `resumes?user_id=eq.${uid}&is_default=eq.true&id=neq.${id}`, {
    method: 'PATCH', body: JSON.stringify({ is_default: false }), headers: { Prefer: 'return=minimal' },
  });
  if (!off.ok) return null;
  const on = await call(db, `resumes?id=eq.${id}&user_id=eq.${uid}&select=${LIST_FIELDS},resume_text`, {
    method: 'PATCH', body: JSON.stringify({ is_default: true }),
  });
  return on.ok && Array.isArray(on.body) && on.body[0] ? on.body[0] : null;
}

async function insertResume(db, row) {
  const r = await call(db, `resumes?select=${LIST_FIELDS},resume_text`, { method: 'POST', body: JSON.stringify(row) });
  if (r.missing) return { missing: true };
  return r.ok && Array.isArray(r.body) && r.body[0] ? { row: r.body[0] } : { error: true, status: r.status };
}

/**
 * The account has résumés saved before the table existed (profiles only) or a row set with no default:
 * make it whole. Returns the (possibly new) rows.
 */
async function healRows(db, uid, rows) {
  if (rows.length && rows.some((r) => r.is_default === true)) return rows;
  if (rows.length) {
    const pick = nextDefault(rows, null);
    const row = await promote(db, uid, pick.id);
    if (row) await writeMirror(db, uid, row);
    return (await readResumes(db, uid)).rows || rows;
  }
  const p = await call(db, `profiles?id=eq.${uid}&select=resume_text,resume_file_name,resume_word_count&limit=1`);
  const prof = p.ok && Array.isArray(p.body) ? p.body[0] : null;
  const text = prof && typeof prof.resume_text === 'string' ? prof.resume_text : '';
  if (text.trim().length < RESUME_TEXT_MIN || !isReadableResume(text)) return rows;
  const ins = await insertResume(db, {
    user_id: uid, name: DEFAULT_RESUME_NAME, resume_text: text, file_name: prof.resume_file_name || null,
    word_count: Number.isFinite(prof.resume_word_count) ? prof.resume_word_count : null, is_default: true,
  });
  return ins.row ? [ins.row] : rows;
}

/** The list answer every action returns. */
async function listAnswer(db, uid, pro, extra = {}) {
  const read = await readResumes(db, uid);
  if (read.missing) return { status: 200, body: { ready: false, pro, max: resumeCap(pro) } };
  if (read.error) return { status: 502, body: { error: 'Could not load your résumés — try again.' } };
  const rows = await healRows(db, uid, read.rows);
  return {
    status: 200,
    body: {
      ready: true, pro, max: resumeCap(pro), max_free: MAX_RESUMES_FREE, max_pro: MAX_RESUMES_PRO,
      count: rows.length, resumes: sortResumes(rows).map((r) => resumeListItem(r, pro)), ...extra,
    },
  };
}

export const RESUME_ACTIONS = new Set(['resumes_list', 'resume_get', 'resume_create', 'resume_rename', 'resume_delete', 'resume_set_default']);
export const RESUME_WRITE_ACTIONS = new Set(['resume_create', 'resume_rename', 'resume_delete', 'resume_set_default']);

/**
 * The résumé actions. → { status, body }.
 *   resumes_list                         → { ready, pro, max, max_free, max_pro, count, resumes[] }
 *   resume_get { id }                    → { ready, resume: { …item, text } } | 404
 *   resume_create { name?, text, file_name?, word_count? } → list + { id } | 403 { reason:'cap' } | 400
 *   resume_rename { id, name }           → list | 404 | 400
 *   resume_delete { id }                 → list (a deleted default hands over to the newest other one)
 *   resume_set_default { id }            → list (profiles mirror rewritten)
 * Before the migration every action answers 200 { ready: false, pro, max }.
 */
export async function handleResumeAction({ db, uid, action, body = {} }) {
  const pro = await readPro(db, uid);
  const notReady = { status: 200, body: { ready: false, pro, max: resumeCap(pro) } };

  if (action === 'resumes_list') return listAnswer(db, uid, pro);

  if (action === 'resume_get') {
    if (!isResumeId(body.id)) return { status: 400, body: { error: 'Which résumé?' } };
    const r = await readResume(db, uid, body.id);
    if (r.missing) return notReady;
    if (r.error) return { status: 502, body: { error: 'Could not load that résumé — try again.' } };
    if (!r.row) return { status: 404, body: { error: 'That résumé is not on your account.' } };
    return { status: 200, body: { ready: true, pro, resume: { ...resumeListItem(r.row, pro), text: r.row.resume_text } } };
  }

  if (action === 'resume_create') {
    const t = checkResumeText(body.text);
    if (!t.ok) return { status: 400, body: { error: t.error, code: t.code } };
    const read = await readResumes(db, uid);
    if (read.missing) return notReady;
    if (read.error) return { status: 502, body: { error: 'Could not save that résumé — try again.' } };
    const rows = await healRows(db, uid, read.rows);
    if (!canAddResume(rows.length, pro)) {
      return { status: 403, body: { error: capMessage(rows.length, pro), reason: 'cap', pro, max: resumeCap(pro), count: rows.length, upsell: pro !== true } };
    }
    const fileName = typeof body.file_name === 'string' ? body.file_name.trim().slice(0, 200) || null : null;
    const name = cleanResumeName(body.name) || nameFromFile(fileName) || `Résumé ${rows.length + 1}`;
    const wc = Number.parseInt(body.word_count, 10);
    const isDefault = !rows.some((r) => r.is_default === true);
    const ins = await insertResume(db, {
      user_id: uid, name, resume_text: t.text, file_name: fileName,
      word_count: Number.isFinite(wc) && wc >= 0 && wc < 100000 ? wc : null, is_default: isDefault,
    });
    if (ins.missing) return notReady;
    if (!ins.row) return { status: 502, body: { error: 'Could not save that résumé — try again.' } };
    if (isDefault) await writeMirror(db, uid, ins.row);
    return listAnswer(db, uid, pro, { ok: true, id: ins.row.id });
  }

  if (action === 'resume_rename') {
    if (!isResumeId(body.id)) return { status: 400, body: { error: 'Which résumé?' } };
    const name = cleanResumeName(body.name);
    if (!name) return { status: 400, body: { error: 'Give the résumé a name.' } };
    const r = await call(db, `resumes?id=eq.${body.id}&user_id=eq.${uid}&select=id`, { method: 'PATCH', body: JSON.stringify({ name }) });
    if (r.missing) return notReady;
    if (!r.ok) return { status: 502, body: { error: 'Could not rename it — try again.' } };
    if (!Array.isArray(r.body) || !r.body.length) return { status: 404, body: { error: 'That résumé is not on your account.' } };
    return listAnswer(db, uid, pro, { ok: true });
  }

  if (action === 'resume_delete' || action === 'resume_set_default') {
    if (!isResumeId(body.id)) return { status: 400, body: { error: 'Which résumé?' } };
    const read = await readResumes(db, uid);
    if (read.missing) return notReady;
    if (read.error) return { status: 502, body: { error: 'Could not reach your résumés — try again.' } };
    const target = read.rows.find((r) => r.id === body.id);
    if (!target) return { status: 404, body: { error: 'That résumé is not on your account.' } };

    if (action === 'resume_set_default') {
      if (target.is_default !== true) {
        const row = await promote(db, uid, target.id);
        if (!row) {
          const old = read.rows.find((r) => r.is_default === true);
          if (old) await promote(db, uid, old.id); // put the old default back
          return { status: 502, body: { error: 'Could not change your default — try again.' } };
        }
        await writeMirror(db, uid, row);
      }
      return listAnswer(db, uid, pro, { ok: true });
    }

    const del = await call(db, `resumes?id=eq.${target.id}&user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!del.ok) return { status: 502, body: { error: 'Could not delete it — try again.' } };
    if (target.is_default === true) {
      const next = nextDefault(read.rows, target.id);
      const row = next ? await promote(db, uid, next.id) : null;
      await writeMirror(db, uid, row);
    }
    return listAnswer(db, uid, pro, { ok: true });
  }

  return { status: 400, body: { error: 'Unknown action: ' + action } };
}

/**
 * save_resume with the table live: the text replaces the DEFAULT résumé (or becomes it). → 'missing'
 * when the table is not there (the caller writes profiles only, as before), else true / false.
 */
export async function saveDefaultResume(db, uid, { text, fileName, wordCount }) {
  const cur = await call(db, `resumes?user_id=eq.${uid}&is_default=eq.true&select=id&limit=1`);
  if (cur.missing) return 'missing';
  if (!cur.ok || !Array.isArray(cur.body)) return false;
  const wc = Number.parseInt(wordCount, 10);
  const fields = {
    resume_text: text, file_name: typeof fileName === 'string' ? fileName.slice(0, 200) || null : null,
    word_count: Number.isFinite(wc) && wc >= 0 && wc < 100000 ? wc : null,
  };
  if (cur.body[0]) {
    const r = await call(db, `resumes?id=eq.${cur.body[0].id}&user_id=eq.${uid}`, {
      method: 'PATCH', body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }), headers: { Prefer: 'return=minimal' },
    });
    return r.ok;
  }
  const ins = await insertResume(db, { user_id: uid, name: nameFromFile(fileName) || DEFAULT_RESUME_NAME, ...fields, is_default: true });
  return ins.missing ? 'missing' : !!ins.row;
}

/** clear_resume with the table live: the default goes, the newest other one takes over. 'missing' before the migration. */
export async function clearDefaultResume(db, uid) {
  const read = await readResumes(db, uid);
  if (read.missing) return 'missing';
  if (read.error) return false;
  const def = read.rows.find((r) => r.is_default === true);
  if (def) {
    const del = await call(db, `resumes?id=eq.${def.id}&user_id=eq.${uid}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!del.ok) return false;
  }
  const next = nextDefault(read.rows, def ? def.id : null);
  const row = next ? await promote(db, uid, next.id) : null;
  return writeMirror(db, uid, row);
}

/**
 * Apply on Seen with a chosen résumé: this account's row, if it may be used now.
 * → { text, fileName } | { error, status }
 */
export async function resumeForApply(db, uid, id) {
  if (!isResumeId(id)) return { status: 400, error: 'Choose one of your résumés.' };
  const r = await readResume(db, uid, id);
  if (r.missing || r.error) return { status: 502, error: 'Could not load that résumé — try again.' };
  if (!r.row) return { status: 404, error: 'That résumé is not on your account.' };
  if (!isUsableResume(r.row, await readPro(db, uid))) {
    return { status: 403, error: 'Only your default résumé can be sent without Pro. Pick your default, or make this one your default on the Résumé page.', reason: 'pro' };
  }
  return { text: r.row.resume_text, fileName: r.row.file_name || r.row.name || null };
}
