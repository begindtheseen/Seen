// Employer self-serve listing management (seen-command#94) — the engine behind the
// `employer_listings` / `employer_close_listing` actions in api/reports.js and the
// "Manage your listings" card on /employers.
//
// WHY THIS SHAPE
// Seen's jobs corpus is ingest-driven (api/refresh-jobs.js aggregation + paste-a-link
// import) — employers don't post listings here and have NO accounts (the employer portal
// is deliberately account-free; see app/employers/page.tsx). So "manage my posting" can't
// lean on auth. Instead it leans on the same first-party signal the nightly liveness cron
// already trusts (lib/server/staleRefresh.js): when an employer says "this role is
// filled", we fetch THEIR OWN listing URL and let the source answer.
//
//   • verdict `dead`  → the source itself confirms the posting is gone → expire the row
//     NOW with the exact write admin-stats.js › delete_listing and staleRefresh's dead
//     path use ({ availability_status:'expired', expires_at:now, last_checked_at:now })
//     and suppress the apply_url so a lagging aggregator can't resurrect it
//     (suppressed_listings, mirroring the admin path). Abuse-proof by construction: the
//     verdict comes from the listing's own source, never from the anonymous claimant —
//     the claim merely accelerates a check the stale cron would run anyway (but only
//     after 7 days of `stale`, which an active listing never reaches early).
//   • verdict `live`/`unknown` → precision-first, we NEVER write on an unverified claim.
//     The request is filed into user_issues (type broken_listing) — the same open-issues
//     queue admin already reviews (api/admin-stats.js) — so it reaches a human without
//     the employer having to find an email address.
//
// `availability_status` has a CHECK constraint of active/stale/expired/unknown — every
// value written here is inside it ('filled' is UI vocabulary only, never a DB status).
// All IO takes an injectable fetchImpl/checkImpl so the test suite runs fully offline
// (same pattern as staleRefresh.js).

import { checkListing } from './staleRefresh.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UI-level reasons an employer can give. These label the request in copy + the review
// queue; the jobs row itself only ever receives CHECK-constraint vocabulary.
export const CLOSE_REASONS = ['filled', 'closed'];
export const isCloseReason = (r) => CLOSE_REASONS.includes(r);

// Company lookup input → a safe PostgREST ilike value for a case-insensitive EXACT match.
// Strips % and * so a crafted "name" can't widen into a wildcard scan ("Meta%" must not
// match Metabase's listings), plus the <>` chars every other public write here strips.
export function sanitizeCompanyName(raw) {
  const s = (raw == null ? '' : String(raw)).replace(/[<>`%*]/g, '').trim();
  return s.slice(0, 100);
}

// The one true expire write — byte-identical to admin-stats.js › delete_listing and
// staleRefresh's confirmed-dead PATCH, so search (which filters expires_at > now())
// drops the row immediately while the row survives for direct /jobs/<id> links.
export function expireListingPatch(nowISO = new Date().toISOString()) {
  return { availability_status: 'expired', expires_at: nowISO, last_checked_at: nowISO };
}

// user_issues row for the can't-verify path. Stays inside report_issue's existing
// vocabulary (type broken_listing / target_type job) so it lands in the same admin
// open-issues queue with the same caps (200-char target, 500-char notes).
export function buildCloseIssue({ job, jobId, reason, verdict }) {
  const name = [job?.company, job?.title].filter(Boolean).join(' — ') || String(jobId);
  const notes =
    `Employer says this listing is ${isCloseReason(reason) ? reason : 'closed'} ` +
    `(job ${jobId}). Liveness check came back "${verdict}", so it was NOT auto-removed — ` +
    `verify and expire it in admin if the role is really gone.` +
    (job?.apply_url ? ` URL: ${job.apply_url}` : '');
  return {
    type: 'broken_listing',
    target_type: 'job',
    target_name: name.slice(0, 200).replace(/[<>`]/g, '').trim(),
    notes: notes.slice(0, 500).replace(/[<>`]/g, '').trim(),
  };
}

const dbHeaders = (key) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

// The employer's live listings, found the same way they find their reputation: by company
// name. Case-insensitive exact match (never substring — "Meta" must not return Metabase
// rows) over non-expired listings only. Every field returned is already public in search.
export async function listEmployerListings({ url, key, company, fetchImpl = fetch }) {
  const name = sanitizeCompanyName(company);
  if (!name) return { http: 400, body: { error: 'Company name required' } };
  const nowISO = new Date().toISOString();
  const cols = 'id,title,location,source,availability_status,created_at,apply_url';
  const r = await fetchImpl(
    `${url}/rest/v1/jobs?company=ilike.${encodeURIComponent(name)}` +
      `&expires_at=gt.${encodeURIComponent(nowISO)}&select=${cols}&order=created_at.desc&limit=50`,
    { headers: dbHeaders(key) },
  );
  if (!r.ok) return { http: 500, body: { error: 'Lookup failed' } };
  const rows = await r.json().catch(() => []);
  const listings = (Array.isArray(rows) ? rows : []).map((j) => ({
    id: j.id,
    title: j.title || 'Untitled role',
    location: j.location || '',
    source: j.source || '',
    availability_status: j.availability_status || 'active',
    created_at: j.created_at || null,
    apply_url: j.apply_url || null,
  }));
  return { http: 200, body: { ok: true, company: name, listings } };
}

// Close one listing on the employer's word + the source's confirmation. Idempotent:
// an already-expired row reports closed without re-checking anything.
export async function closeEmployerListing({
  url, key, jobId, reason,
  fetchImpl = fetch, checkImpl = checkListing, timeoutMs = 12000,
}) {
  const jid = String(jobId || '');
  if (!UUID_RE.test(jid)) return { http: 400, body: { error: 'Valid job_id required' } };
  const why = isCloseReason(reason) ? reason : 'closed';
  const hdrs = dbHeaders(key);

  const rowRes = await fetchImpl(
    `${url}/rest/v1/jobs?id=eq.${encodeURIComponent(jid)}` +
      '&select=id,company,title,apply_url,availability_status,expires_at&limit=1',
    { headers: hdrs },
  );
  if (!rowRes.ok) return { http: 500, body: { error: 'Lookup failed' } };
  const job = ((await rowRes.json().catch(() => [])) || [])[0];
  if (!job) return { http: 404, body: { error: 'Listing not found' } };

  const nowISO = new Date().toISOString();
  const alreadyGone =
    job.availability_status === 'expired' ||
    (job.expires_at && Date.parse(job.expires_at) <= Date.now());
  if (alreadyGone) return { http: 200, body: { ok: true, closed: true, already: true } };

  const { verdict } = await checkImpl(job, { timeoutMs, fetchImpl });

  if (verdict === 'dead') {
    const up = await fetchImpl(`${url}/rest/v1/jobs?id=eq.${encodeURIComponent(jid)}`, {
      method: 'PATCH',
      headers: { ...hdrs, Prefer: 'return=minimal' },
      body: JSON.stringify(expireListingPatch(nowISO)),
    });
    if (!up.ok) return { http: 500, body: { error: 'Could not close listing' } };
    // Suppress the URL so re-aggregation / paste-a-link can't resurrect the dead posting
    // (mirrors admin delete_listing). Best-effort: the expire above already removed it
    // from every search/read path.
    if (job.apply_url) {
      await fetchImpl(`${url}/rest/v1/suppressed_listings?on_conflict=apply_url`, {
        method: 'POST',
        headers: { ...hdrs, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          apply_url: job.apply_url, stable_job_id: jid,
          title: job.title || null, company: job.company || null, reason: 'employer_closed',
        }),
      }).catch(() => {});
    }
    return { http: 200, body: { ok: true, closed: true, verified: true } };
  }

  // live/unknown → queue for human review; never write to the jobs row on trust alone.
  const iss = await fetchImpl(`${url}/rest/v1/user_issues`, {
    method: 'POST',
    headers: { ...hdrs, Prefer: 'return=minimal' },
    body: JSON.stringify(buildCloseIssue({ job, jobId: jid, reason: why, verdict })),
  });
  if (!iss.ok) return { http: 500, body: { error: 'Could not record the request' } };
  return { http: 200, body: { ok: true, closed: false, queued: true, verdict } };
}
