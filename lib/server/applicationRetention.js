// Retention for declined and withdrawn Apply-on-Seen applications (owner delegated the call,
// 2026-10-18).
//
// Decision: 30 days after the decision, the EMPLOYER's copy is cleared.
//   - Why not 5 days: a hire often falls through in the first weeks, and the employer needs the
//     runner-up's résumé to call them back. 30 days covers that window.
//   - Why not longer: after that, a declined applicant's résumé, phone and note are personal data
//     Seen has no reason to keep. Keeping less is cheaper too.
//   - Hired applications are never cleared — the employer is working with that person.
//   - Applications still waiting on a decision are never cleared.
// What is removed: the résumé file (private bucket), résumé text, email, phone, name, note. What stays:
// status, dates, listing and company — so response-time stats still add up — and the conversation,
// which is the applicant's record too (their tracker shows it). The applicant's own tracker row and
// any report they wrote are untouched.
// The employer is told in the inbox: download any résumé you need to keep within 30 days.

export const RETENTION_DAYS = 30;
const CLEARED_STATUSES = ['rejected', 'withdrawn'];

/** ISO cutoff: decisions at or before this are cleared. */
export function retentionCutoffISO(nowMs) {
  return new Date(Number(nowMs) - RETENTION_DAYS * 86400000).toISOString();
}

/** The PATCH that clears an application's personal data. name/email are NOT NULL, so they become ''. */
export function purgePatch(nowISO) {
  return {
    applicant_name: '',
    applicant_email: '',
    applicant_phone: null,
    resume_text: null,
    resume_path: null,
    resume_file_name: null,
    resume_mime: null,
    note: null,
    purged_at: nowISO,
  };
}

/** Days left before an application is cleared (for the inbox note), or null when it won't be. */
export function daysUntilCleared(row, nowMs) {
  if (!row || !CLEARED_STATUSES.includes(row.status) || !row.decided_at) return null;
  const left = Math.ceil((Date.parse(row.decided_at) + RETENTION_DAYS * 86400000 - Number(nowMs)) / 86400000);
  return Math.max(0, left);
}

/**
 * Clear one batch. `db(path, opts)` is a service-key PostgREST fetch; `deleteFiles(paths)` removes
 * résumé objects. Files go first: a row is cleared only once its file is gone (or it had none), so a
 * storage failure leaves the row for the next run instead of orphaning a file. Returns
 * { scanned, cleared, fileErrors }. Never throws.
 */
export async function purgeDecidedApplications({ db, deleteFiles, nowMs = Date.now(), limit = 200 }) {
  const out = { scanned: 0, cleared: 0, fileErrors: 0 };
  try {
    const cutoff = retentionCutoffISO(nowMs);
    const r = await db(
      `seen_applications?purged_at=is.null&status=in.(${CLEARED_STATUSES.join(',')})` +
      `&decided_at=lte.${encodeURIComponent(cutoff)}&select=id,resume_path&order=decided_at.asc&limit=${limit}`,
    );
    if (!r.ok) return out;
    const rows = await r.json();
    out.scanned = rows.length;
    if (!rows.length) return out;
    const withFile = rows.filter((x) => x.resume_path);
    let clearable = rows;
    if (withFile.length && !(await deleteFiles(withFile.map((x) => x.resume_path)))) {
      out.fileErrors = withFile.length;
      clearable = rows.filter((x) => !x.resume_path);
    }
    if (!clearable.length) return out;
    const ids = clearable.map((x) => x.id).join(',');
    const nowISO = new Date(nowMs).toISOString();
    const up = await db(
      `seen_applications?id=in.(${ids})&purged_at=is.null&status=in.(${CLEARED_STATUSES.join(',')})`,
      { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(purgePatch(nowISO)) },
    );
    if (up.ok) out.cleared = clearable.length;
    return out;
  } catch { return out; }
}
