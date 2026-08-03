// Pure shaper for the employer "Applicant activity" surface (Wave 2, Part 1). Turns raw apply_events
// rows (migration 058) into the aggregate view an employer sees on their Analytics tab: totals,
// 7/30-day counts, per-role breakdown, and a recent list. No I/O — the endpoint fetches, this shapes.
//
// PRIVACY (load-bearing): apply_events.user_id is server-only and is NEVER passed in here. This shaper
// only ever reads role / city / created_at — aggregate, non-identifying signal. It must not surface,
// require, or return any applicant identity.

const DAY = 86400000;

function tsOf(row) {
  const t = Date.parse(row && row.created_at);
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {Array<{role?:string, city?:string, created_at?:string, job_id?:string}>} events
 * @param {number} nowMs
 * @returns {{ total:number, last7:number, last30:number, byRole:Array, recent:Array, activeRoles:number }}
 */
export function shapeApplyActivity(events, nowMs) {
  const list = Array.isArray(events) ? events.filter(Boolean) : [];
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const c7 = now - 7 * DAY;
  const c30 = now - 30 * DAY;

  let last7 = 0;
  let last30 = 0;
  const roleMap = new Map(); // role → { role, count, count7, last }

  for (const e of list) {
    const t = tsOf(e);
    if (t != null) {
      if (t >= c7) last7++;
      if (t >= c30) last30++;
    }
    const role = (typeof e.role === 'string' && e.role.trim()) ? e.role.trim() : 'Unspecified role';
    const cur = roleMap.get(role) || { role, count: 0, count7: 0, last: null };
    cur.count++;
    if (t != null && t >= c7) cur.count7++;
    if (t != null && (cur.last == null || t > cur.last)) cur.last = t;
    roleMap.set(role, cur);
  }

  const byRole = [...roleMap.values()]
    .sort((a, b) => b.count - a.count || (b.last || 0) - (a.last || 0))
    .slice(0, 12)
    .map(r => ({ role: r.role, count: r.count, count7: r.count7, last: r.last ? new Date(r.last).toISOString() : null }));

  const recent = list
    .map(e => ({ role: (typeof e.role === 'string' && e.role.trim()) ? e.role.trim() : null, city: (typeof e.city === 'string' && e.city.trim()) ? e.city.trim() : null, created_at: typeof e.created_at === 'string' ? e.created_at : null, t: tsOf(e) }))
    .sort((a, b) => (b.t || 0) - (a.t || 0))
    .slice(0, 15)
    .map(({ role, city, created_at }) => ({ role, city, created_at }));

  return { total: list.length, last7, last30, byRole, recent, activeRoles: roleMap.size };
}
