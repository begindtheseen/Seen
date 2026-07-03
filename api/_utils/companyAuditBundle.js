// Company Score Audit bundle — the SINGLE source of the "how the grade was computed"
// evidence chain for ONE company. Extracted from the inline export_company handler so that
// BOTH the raw JSON export AND the legal-audit PDF render from the EXACT same bundle object
// (JSON.stringify(bundle) → the SHA-256 that is printed inside the PDF). If the two ever
// diverged, the printed hash would no longer match the downloadable JSON — so there is one
// builder, used by both paths.
//
// Reads only. The caller supplies an already-authorized `db` fetch wrapper and the service
// key (used solely to derive the stable, one-way submitter pseudonym). The caller owns the
// admin audit-log write (the action name differs per surface).

import { createHash } from 'crypto';
import {
  SOURCE_TRUST, PRIOR_STRENGTH, classifyPlatform, fuseCompanyIntel, aggregateOutcomes,
  GHOST_OUTCOMES, RESPONSE_OUTCOMES, NONTERMINAL_OUTCOMES,
} from './companyIntel.js';
import { explainListingScore, SCORE_RANGE, WASTE_RANGE } from '../../lib/server/jobScore.js';

// Below this many reports actually counted toward the grade, the sample is treated as too
// small for a firm reading — the PDF prints a strong low-sample warning. Exported so the
// endpoint and the tests agree on one threshold.
export const LOW_SAMPLE_THRESHOLD = 5;

// SHA-256 of the canonical (compact) JSON serialization of the bundle — the legal fingerprint
// embedded in the PDF and returned to the caller. Returns both the exact bytes hashed and the
// hex digest so a recipient can re-hash the companion JSON and confirm it matches the PDF.
export function auditBundleHash(bundle) {
  const json = JSON.stringify(bundle);
  return { json, hash: createHash('sha256').update(json).digest('hex') };
}

export async function buildCompanyAuditBundle({ db, serviceKey, adminId, adminRole, company }) {
  const rawName = String(company || '').trim();
  if (rawName.length < 2) throw Object.assign(new Error('company name required'), { statusCode: 400 });
  const nameEnc = encodeURIComponent(rawName.toLowerCase());
  const nameLike = encodeURIComponent(`%${rawName.toLowerCase()}%`);

  // Stable, non-reversible submitter token: sha256(service_key : user_id). Same key ⇒ same
  // token across exports (so distinct-submitter counts are stable), but not reversible without
  // the server secret. Anonymous rows (no user_id) collapse to a shared 'anon' bucket (null).
  const pseudonymize = (uid) => uid ? `sub_${createHash('sha256').update(`${serviceKey}:${uid}`).digest('hex').slice(0, 16)}` : null;

  const [coRes, scoreRes, reportsRes, aliasRes, jobsRes] = await Promise.all([
    db(`companies?name=ilike.${nameLike}&select=id,name,logo_letter,created_at&limit=25`),
    db(`company_scores?company_name=ilike.${nameEnc}&order=created_at.desc&limit=1`),
    db(`reports?company_name=ilike.${nameEnc}&select=id,company_name,company_id,location_id,role,platform,source,outcome,ghost_stage,rounds,wait_days,unpaid_work,experience_level,needs_review,outcome_weight,trust_reason,user_id,created_at&order=created_at.desc&limit=2000`),
    db(`company_aliases?canonical=ilike.${nameEnc}&select=alias,canonical&limit=50`).catch(() => null),
    db(`jobs?company=ilike.${nameEnc}&select=id,title,company,location,salary,source,type,description,score,waste_score,created_at,apply_url&order=created_at.desc&limit=500`).catch(() => null),
  ]);
  const companies = coRes.ok ? await coRes.json() : [];
  const cachedScore = scoreRes.ok ? ((await scoreRes.json())[0] || null) : null;
  const reports = reportsRes.ok ? await reportsRes.json() : [];
  const aliases = aliasRes && aliasRes.ok ? await aliasRes.json() : [];
  const jobs = jobsRes && jobsRes.ok ? await jobsRes.json() : [];

  // Resolve location_id → city for readability.
  const locIds = [...new Set((reports || []).map(r => r.location_id).filter(Boolean))];
  const cityMap = {};
  if (locIds.length) {
    const lr = await db(`company_locations?id=in.(${locIds.join(',')})&select=id,city&limit=200`).catch(() => null);
    if (lr && lr.ok) { (await lr.json() || []).forEach(l => { if (l.id) cityMap[l.id] = l.city; }); }
  }

  // Annotate each report with its classified source, trust weight, and whether it counted
  // toward the grade (needs_review rows are held out of scoring, same as the fusion filter).
  const annotated = (reports || []).map(r => {
    const source_type = classifyPlatform(r.platform);
    return {
      id: r.id,
      submitter: pseudonymize(r.user_id),
      created_at: r.created_at,
      company_name: r.company_name,
      company_id: r.company_id,
      city: r.location_id ? (cityMap[r.location_id] || null) : null,
      role: r.role || null,
      platform: r.platform || null,
      stored_source: r.source || null,
      source_type,
      source_trust_weight: SOURCE_TRUST[source_type] ?? 0.5,
      outcome: r.outcome || null,
      ghost_stage: r.ghost_stage || null,
      rounds: r.rounds ?? null,
      wait_days: r.wait_days ?? null,
      unpaid_work: r.unpaid_work || null,
      experience_level: r.experience_level || null,
      outcome_weight: r.outcome_weight ?? null,
      needs_review: !!r.needs_review,
      included_in_score: !r.needs_review,
      trust_reason: r.trust_reason || null,
    };
  });
  const included = annotated.filter(r => r.included_in_score);
  const excluded = annotated.filter(r => !r.included_in_score);

  // Per-source aggregation breakdown — exactly the pooling the fusion engine performs.
  const bySource = {};
  for (const r of included) (bySource[r.source_type] ||= []).push({ outcome: r.outcome });
  const source_breakdown = Object.entries(bySource).map(([type, rows]) => {
    const agg = aggregateOutcomes(rows);
    const trust = SOURCE_TRUST[type] ?? 0.5;
    return {
      source_type: type,
      trust_weight: trust,
      report_count: rows.length,
      resolved: agg.resolved,
      ghosted: agg.ghost,
      responded: agg.response,
      weighted_resolved: Math.round(trust * agg.resolved * 100) / 100,
    };
  }).sort((a, b) => b.weighted_resolved - a.weighted_resolved);

  // Live-recompute the fused grade from the included reports (empty web prior = pure function
  // of our own reports) so the export shows the exact score + inputs, independent of any cache.
  const fusionSources = Object.entries(bySource).map(([type, rows]) => ({ type, outcomes: rows }));
  const computed = fuseCompanyIntel({ web: {}, sources: fusionSources });

  // Per-LISTING transparency scores WITH their full factor breakdown. Every listing score the
  // product ever displays is reproduced here next to the exact logic that produced it — the
  // factor deltas sum to the score, so each number is legally explainable from this export
  // alone. This is the listing-quality grade (from the posting's own signals), distinct from
  // the company grade above (from applicant reports). `score_mismatch` flags any listing whose
  // stored number no longer equals a live recomputation (e.g. scored before a logic change).
  const listing_scores = (jobs || []).map(j => {
    const ex = explainListingScore(j);
    return {
      id: j.id,
      title: j.title || null,
      location: j.location || null,
      source: j.source || null,
      salary: j.salary || null,
      type: j.type || null,
      posted_at: j.created_at || null,
      apply_url: j.apply_url || null,
      description_length: (j.description || '').length,
      score_mismatch: ex.stored_score != null && ex.stored_score !== ex.transparency_score,
      ...ex,
    };
  });

  return {
    export_type: 'company_audit_bundle',
    schema_version: 1,
    generated_at: new Date().toISOString(),
    generated_by: { admin_id: adminId, role: adminRole },
    query: rawName,
    privacy_note: 'Submitter identities are pseudonymized via a keyed one-way hash. The same submitter maps to a stable token across exports, but tokens cannot be reversed to accounts without the server secret.',
    company: {
      matched_records: companies,
      aliases: (aliases || []).map(a => a.alias),
    },
    cached_company_score: cachedScore,
    computed_score: computed,
    source_breakdown,
    totals: {
      total_reports: annotated.length,
      included_in_score: included.length,
      excluded_needs_review: excluded.length,
      distinct_submitters: new Set(annotated.map(r => r.submitter).filter(Boolean)).size,
      total_listings: listing_scores.length,
      listings_with_score_mismatch: listing_scores.filter(l => l.score_mismatch).length,
    },
    listing_methodology: {
      description: 'Each listing carries a transparency score (18–95) and a wasted-time/ghost-risk score (5–90) computed ONLY from signals present in the posting itself — its source/ATS, whether compensation is disclosed, the length and language of the description, and red-flag titles. It grades the POSTING, not the company. Every listing below lists the exact factors that fired, each with its point delta and reason; the deltas (including the neutral baseline) sum to the raw score, which is then clamped to the stated range. No listing receives a number without a stated reason.',
      transparency_range: [SCORE_RANGE.min, SCORE_RANGE.max],
      transparency_baseline: SCORE_RANGE.baseline,
      waste_range: [WASTE_RANGE.min, WASTE_RANGE.max],
      waste_baseline: WASTE_RANGE.baseline,
      distinct_from_company_grade: 'The listing transparency score is independent of the company grade above. The company grade requires applicant reports and reads "no data" without them; the listing score always has a basis because the evidence is the listing.',
    },
    listing_scores,
    methodology: {
      description: 'Company grade = trust-weighted fusion of applicant-reported outcomes, shrunk toward a web-research prior by sample size. Reports flagged needs_review are excluded until an admin clears them.',
      source_trust_weights: SOURCE_TRUST,
      prior_strength: PRIOR_STRENGTH,
      outcome_taxonomy: {
        ghost: [...GHOST_OUTCOMES],
        response: [...RESPONSE_OUTCOMES],
        non_terminal_excluded_from_rates: [...NONTERMINAL_OUTCOMES],
      },
    },
    reports: annotated,
  };
}
