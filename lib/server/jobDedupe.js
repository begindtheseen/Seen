// Admin "Remove dupes" for job listings — the pure rules (api/admin-stats.js › scan_job_dupes /
// dedupe_jobs drive them; tests: lib/server/jobDedupe.test.mjs).
//
// WHAT IS A DUPLICATE. Two rows are the same listing when ANY of these match:
//   • the database's own identity (trigger jobs_dedupe_refresh, migration 067): lower(title) +
//     lower(company) + job_location_key(location) — location lower-cased with every non [a-z0-9] removed;
//   • the same source + external_id;
//   • the same apply URL (host + path + query, tracking params like utm_* dropped) AND the same title —
//     a source re-returning one posting with drifted text (prod 2026-10-20: Adzuna /details/5928726948
//     came back as both "Savvy" and "Savvy Wealth"; "Bensonhurst, Brooklyn" vs "Brooklyn, New York City").
// The OLD rule was title + company + `city`. `city` is blank on every row in prod (27,668 / 27,668 on
// 2026-10-20), so it grouped the same job title at the same company in DIFFERENT places ("Chief Officer"
// in Constanta, Rijeka and Saint Petersburg) and deleted real listings — 4,247 of them were queued.
// It also only ever saw PostgREST's first 1,000 rows, so each press found more.
//
// WHAT IS NEVER DELETED: employer-posted rows, and any row a user holds (saved_jobs / applications
// job_id, seen_applications FK — which CASCADES, so deleting the job would delete their application).
// The keeper of a group is a protected row if there is one, else the one still serving, else the most
// recently seen. Protected extras are kept and counted, never removed.

const TRACKING_PARAM = /^(utm_.*|gclid|fbclid|msclkid|gh_src|mc_cid|mc_eid|lever-source|lever-origin)$/i;

export function locationKey(location) {
  return String(location || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function normalizeApplyUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
  return params ? `${host}${path}?${params}` : `${host}${path}`;
}

const lower = (v) => String(v ?? '').toLowerCase();

export function dupKeys(row) {
  const keys = [];
  if (String(row.title || '').trim()) keys.push(`loc:${lower(row.title)}|${lower(row.company)}|${locationKey(row.location)}`);
  if (row.external_id) keys.push(`ext:${lower(row.source)}|${row.external_id}`);
  const url = normalizeApplyUrl(row.apply_url);
  if (url && String(row.title || '').trim()) keys.push(`url:${url}|${lower(row.title).trim()}`);
  return keys;
}

const time = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? t : 0; };

// rows: jobs rows (id,title,company,location,apply_url,source,external_id,is_employer_posted,
// availability_status,expires_at,last_seen_at,created_at). referenced: Set of job ids users hold.
export function planJobDedupe(rows, referenced = new Set(), now = Date.now()) {
  // Union-find over shared keys: a row matching A on one key and B on another joins all three.
  const parent = rows.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const firstByKey = new Map();
  rows.forEach((r, i) => {
    for (const k of dupKeys(r)) {
      if (!firstByKey.has(k)) { firstByKey.set(k, i); continue; }
      const a = find(firstByKey.get(k)), b = find(i);
      if (a !== b) parent[b] = a;
    }
  });
  const byRoot = new Map();
  rows.forEach((r, i) => { const k = find(i); if (!byRoot.has(k)) byRoot.set(k, []); byRoot.get(k).push(r); });

  const isProtected = (r) => r.is_employer_posted === true || referenced.has(String(r.id));
  const isServing = (r) => r.availability_status === 'active' && time(r.expires_at) > now;
  const rank = (a, b) =>
    (isProtected(b) - isProtected(a)) || (isServing(b) - isServing(a)) ||
    (time(b.last_seen_at) - time(a.last_seen_at)) || (time(b.created_at) - time(a.created_at)) ||
    String(a.id).localeCompare(String(b.id));

  const groups = [];
  const deleteIds = [];
  let protectedExtras = 0;
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const [keep, ...rest] = [...members].sort(rank);
    const remove = rest.filter((r) => !isProtected(r));
    const kept = rest.filter(isProtected);
    protectedExtras += kept.length;
    deleteIds.push(...remove.map((r) => r.id));
    groups.push({ keep, remove, kept });
  }
  return { groups, deleteIds, protectedExtras, total: rows.length };
}

// What the admin sees before confirming: the rows that go and the one that stays.
export function describeGroups(groups, limit = 8) {
  const brief = (r) => ({ id: r.id, title: r.title, company: r.company, location: r.location, source: r.source, status: r.availability_status });
  return groups.slice(0, limit).map((g) => ({ keep: brief(g.keep), remove: g.remove.map(brief), kept: g.kept.map(brief) }));
}
