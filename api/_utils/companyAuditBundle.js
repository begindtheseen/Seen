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

// The seven use-classifications every source class in the audit is sorted into. A source
// being AVAILABLE does not mean it affected the company grade — this taxonomy is what makes
// that explicit and legally reproducible. Exported so the PDF and tests share one vocabulary.
export const SOURCE_USE_CATEGORIES = {
  included_in_score: 'Included in company score',
  available_not_included: 'Available but not included in company score',
  matching_only: 'Used only for company matching / alias resolution',
  listing_transparency_only: 'Used only for listing transparency',
  display_context_only: 'Used only for display / context',
  held_out_excluded: 'Held out / excluded pending review',
  not_available: 'Not available for this export',
};

// The nature of a source: who/what produced it. Drives the "applicant-reported vs
// third-party/contextual vs listing-derived vs admin-enriched" column.
export const SOURCE_NATURE = {
  applicant_reported: 'Applicant-reported',
  third_party_contextual: 'Third-party / contextual',
  listing_derived: 'Listing-derived',
  admin_enriched: 'Admin-enriched',
  matching: 'Company-matching data',
};

// Parse a possibly-stringified web_reviews field into an array (or []).
function parseReviews(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
}

// Build the full Source Inventory: EVERY source class SeenJobs can hold for a company, each
// sorted into exactly one use-classification, whether or not it affected the grade — and
// including methodology-configured classes that had zero records for this export (so the
// packet proves the methodology supports the source even when it wasn't present).
function buildSourceInventory({ annotated, computed, companies, aliases, cachedScore, listingCount }) {
  const sourcesUsed = new Set(computed?.sources_used || []);
  const inv = [];

  // ── Applicant-report + web classes, driven by the methodology's configured trust weights
  //    (so a configured-but-absent source still appears, count 0). ──
  const REPORT_CLASSES = {
    direct:     { name: 'Direct applicant reports', nature: 'applicant_reported', limitation: 'Applicant-submitted; not independently verified per report.' },
    seen_intel: { name: 'SeenJobs internal intelligence (seen_intel)', nature: 'applicant_reported', limitation: 'In-product survey / Opportunity-Engine applicant answers; applicant-reported, not independently verified.' },
    ingest:     { name: 'Imported applicant reports — ingest (Glassdoor / Blind / Indeed / LinkedIn)', nature: 'applicant_reported', limitation: 'Applicant reports imported from third-party platforms; lower trust than direct; third-party platform terms and attribution rules apply.' },
    reddit:     { name: 'Reddit hiring-process reports', nature: 'applicant_reported', limitation: 'Public discussion imported as reports; lowest trust weight; a discussion/imported signal — not a verified fact.' },
    web:        { name: 'Web / external review research (Glassdoor / Reddit / Blind snippets)', nature: 'third_party_contextual', limitation: 'Third-party external-review signal used only as a contextual prior. In this export the web prior is empty, so it is summarized for context and does not pool into the computed grade; underlying platform terms and attribution rules must be respected.' },
  };
  for (const [cls, meta] of Object.entries(REPORT_CLASSES)) {
    const trust = SOURCE_TRUST[cls] ?? null;
    let record_count = 0, included_count = 0, excluded_count = 0;
    if (cls === 'web') {
      record_count = parseReviews(cachedScore?.web_reviews).length;
    } else {
      const rows = annotated.filter(r => r.source_type === cls);
      record_count = rows.length;
      included_count = rows.filter(r => r.included_in_score).length;
      excluded_count = record_count - included_count;
    }
    const affected_score = sourcesUsed.has(cls);
    let category, reason;
    if (record_count === 0) {
      category = 'not_available';
      reason = `Methodology supports this source (configured trust weight ${trust ?? 'n/a'}) but no records were present for this company/export.`;
    } else if (affected_score) {
      category = 'included_in_score';
      reason = `${included_count} report(s) counted toward the company grade at trust weight ${trust}.`;
    } else if (cls === 'web') {
      category = 'display_context_only';
      reason = `${record_count} external-review snippet(s) held for context; the web prior is empty in this export, so they did not affect the computed grade.`;
    } else if (included_count === 0 && excluded_count > 0) {
      category = 'held_out_excluded';
      reason = `${excluded_count} report(s) present but flagged needs_review; none counted toward the grade.`;
    } else {
      category = 'available_not_included';
      reason = `${record_count} report(s) present but not pooled into the grade (no resolved terminal outcomes to contribute).`;
    }
    inv.push({
      source: meta.name, source_class: cls, nature: meta.nature,
      record_count, included_count, excluded_count, affected_score,
      configured_trust_weight: trust, effective_trust_weight: affected_score ? trust : null,
      category, reason, limitation: meta.limitation, available: record_count > 0,
    });
  }

  // ── Non-report classes ──
  const aliasCount = (aliases || []).length;
  inv.push({
    source: 'Company aliases / alias resolution', source_class: 'aliases', nature: 'matching',
    record_count: aliasCount, included_count: 0, excluded_count: 0, affected_score: false,
    configured_trust_weight: null, effective_trust_weight: null,
    category: aliasCount ? 'matching_only' : 'not_available',
    reason: aliasCount ? `${aliasCount} alias(es) used only to resolve name variants to one company.` : 'No aliases recorded for this company.',
    limitation: 'Helps identify the entity; does not itself prove any hiring behavior.', available: aliasCount > 0,
  });

  const coCount = (companies || []).length;
  inv.push({
    source: 'Company records (matched)', source_class: 'company_record', nature: 'admin_enriched',
    record_count: coCount, included_count: 0, excluded_count: 0, affected_score: false,
    configured_trust_weight: null, effective_trust_weight: null,
    category: coCount ? 'display_context_only' : 'not_available',
    reason: coCount ? `${coCount} matched company record(s); identifying/context data.` : 'No company records matched the query.',
    limitation: 'Admin/enrichment record; must be auditable and timestamped; not a hiring-outcome signal.', available: coCount > 0,
  });

  inv.push({
    source: 'Job listings (Adzuna / job sources)', source_class: 'listings', nature: 'listing_derived',
    record_count: listingCount, included_count: 0, excluded_count: 0, affected_score: false,
    configured_trust_weight: null, effective_trust_weight: null,
    category: listingCount ? 'listing_transparency_only' : 'not_available',
    reason: listingCount ? `${listingCount} listing(s) scored independently for LISTING transparency; they do not feed the company grade.` : 'No job listings on record for this company.',
    limitation: 'Grades the posting, not the company as a whole.', available: listingCount > 0,
  });

  // Cached score row + its enrichment fields (industry / summary / provenance). The cached
  // grade may be web-derived (data_source) and is NOT the authoritative recomputed grade.
  const enrich = [];
  if (cachedScore) {
    if (cachedScore.industry) enrich.push('industry');
    if (cachedScore.raw_summary) enrich.push('summary');
    if (cachedScore.data_source) enrich.push(`data_source=${cachedScore.data_source}`);
  }
  inv.push({
    source: 'Admin / cached company enrichment', source_class: 'admin_enrichment', nature: 'admin_enriched',
    record_count: cachedScore ? 1 : 0, included_count: 0, excluded_count: 0, affected_score: false,
    configured_trust_weight: null, effective_trust_weight: null,
    category: cachedScore ? 'display_context_only' : 'not_available',
    reason: cachedScore
      ? `Cached company_scores row (${enrich.join(', ') || 'no enrichment fields'}); shown for context. The authoritative grade in this export is recomputed live from the included reports, not this cached row.`
      : 'No cached company_scores row for this company.',
    limitation: 'Enrichment/context; must be auditable and timestamped. A cached grade may be web-derived (see data_source) and is not the recomputed report grade.',
    available: !!cachedScore,
  });

  return inv;
}

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

  // Full source inventory — every source class SeenJobs can hold for this company, each sorted
  // into one use-classification (score-contributing / context-only / listing-only / matching-
  // only / held-out / not-available). Availability ≠ influence: the classification is what
  // states whether a source actually moved the grade.
  const source_inventory = buildSourceInventory({
    annotated, computed, companies, aliases, cachedScore, listingCount: listing_scores.length,
  });

  // Split availability/confidence — replaces the single vague "Data quality" reading beside a
  // possibly-zero report count. Each dimension is reported independently.
  const externalReviewCount = parseReviews(cachedScore?.web_reviews).length;
  const qnorm = s => String(s || '').trim().toLowerCase().replace(/[\s,]+(inc|llc|corp|ltd|co|plc)\.?$/i, '').trim();
  const matchedExact = (companies || []).some(c => qnorm(c.name) === qnorm(rawName));
  const source_availability = {
    applicant_report_confidence: computed?.confidence_label || 'low',
    applicant_report_sample_size: included.length,
    no_applicant_reports_counted: (computed?.sources_used || []).length === 0,
    external_context_available: externalReviewCount > 0 || (aliases || []).length > 0 || (companies || []).length > 0,
    external_review_snippet_count: externalReviewCount,
    listing_data_available: listing_scores.length,
    company_matching_confidence: (companies || []).length ? (matchedExact ? 'exact' : 'partial') : 'none',
    cached_score_provenance: cachedScore?.data_source || null,
  };

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
    source_availability,
    source_inventory,
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
      distinct_from_company_grade: 'The listing transparency score is independent of the company grade above. The company grade requires applicant reports and, without any that count, sits at a neutral 50/100 baseline (no applicant reports counted) rather than a positive or negative reading; the listing score always has a basis because the evidence is the listing.',
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
