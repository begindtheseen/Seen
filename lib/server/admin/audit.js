// THE admin audit writer. A destructive action records what it is about to change (prior values) in the
// same step as the write, and does not write at all when the audit row cannot be recorded — an unaudited
// destructive write cannot be undone or explained later. `audit(..., { required: false })` is for reads
// worth logging (exports), where a missing row must not block the answer.

import { AdminError } from './respond.js';

export function auditRow(sess, action, target = {}, data = {}) {
  const metadata = { ...(data.metadata || {}) };
  if (data.prior !== undefined) metadata.prior = data.prior;
  if (data.next !== undefined) metadata.next = data.next;
  return {
    admin_id: sess?.admin_id ?? null,
    username: sess?.username || 'admin',
    action,
    target_type: target.kind ?? target.type ?? null,
    target_id: target.id != null ? String(target.id) : null,
    metadata,
  };
}

/** Insert one audit row. Returns its id (string). Throws AdminError(502) when required and it failed. */
export async function audit(db, sess, action, target = {}, data = {}, { required = true } = {}) {
  const r = await db('admin_audit_log?select=id', { method: 'POST', body: JSON.stringify(auditRow(sess, action, target, data)) });
  const got = r && r.ok ? await r.json().catch(() => null) : null;
  const id = Array.isArray(got) ? got[0]?.id : got?.id;
  if (!r || !r.ok) {
    if (required) throw new AdminError(502, 'Could not write the audit record, so nothing was changed. Try again.', { code: 'upstream' });
    return null;
  }
  return id != null ? String(id) : null;
}

/** Insert many audit rows (one body, ≤500 per call). Returns [{ id, target_id }]. Throws when required. */
export async function auditMany(db, rowsIn, { required = true } = {}) {
  const out = [];
  for (let i = 0; i < rowsIn.length; i += 500) {
    const part = rowsIn.slice(i, i + 500);
    const r = await db('admin_audit_log?select=id,target_id', { method: 'POST', body: JSON.stringify(part) });
    if (!r || !r.ok) {
      if (required) throw new AdminError(502, 'Could not write the audit record, so nothing was changed. Try again.', { code: 'upstream', changed: 0 });
      return out;
    }
    const got = await r.json().catch(() => []);
    for (const g of Array.isArray(got) ? got : []) out.push({ id: String(g.id), target_id: g.target_id });
  }
  return out;
}

/** Remove audit rows that describe a write which then did not happen (a row decided by someone else first). */
export async function dropAuditRows(db, ids) {
  const clean = ids.filter((id) => /^\d{1,19}$/.test(String(id)));
  for (let i = 0; i < clean.length; i += 100) {
    await db(`admin_audit_log?id=in.(${clean.slice(i, i + 100).join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => null);
  }
}

/** Merge facts into an audit row's metadata after the write (counts). Best-effort. */
export async function annotateAudit(db, id, metadata) {
  if (!/^\d{1,19}$/.test(String(id || ''))) return false;
  const r = await db(`admin_audit_log?id=eq.${id}&select=metadata&limit=1`);
  const cur = r && r.ok ? (await r.json().catch(() => []))[0] : null;
  const up = await db(`admin_audit_log?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ metadata: { ...(cur?.metadata || {}), ...metadata } }) });
  return !!(up && up.ok);
}
