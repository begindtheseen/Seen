// A small deterministic world for the admin server tests, plus a caller that runs the real handler against
// the in-memory PostgREST (fakeRest.mjs) with a signed-in admin.

import { createFakeRest, makeRes } from './fakeRest.mjs';

export const TOKEN = 'a'.repeat(64);
export const uid = (n, p = '0000') => `${p.padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const D = 86400e3;

export function world({ held = 12, liveReports = 20, companies = ['Walmart', 'Tesla', 'Stripe', 'Home Depot'], jobs = 30 } = {}) {
  const T = {};
  T.admin_accounts = [{ id: 1, username: 'owner', role: 'super_admin', is_active: true, salt: 's', password_hash: 'h', login_attempts: 0 }];
  T.admin_sessions = [{ token: TOKEN, admin_id: 1, role: 'super_admin', expires_at: new Date(Date.now() + 3600e3).toISOString() }];
  T.admin_audit_log = [];
  T.reports = [];
  for (let i = 0; i < held; i++) {
    T.reports.push({ id: uid(i + 1, '1'), company_name: companies[i % companies.length], outcome: i % 3 ? 'interview' : 'ghosted', role: 'Cashier', platform: 'Indeed', source: 'external', created_at: ago((i + 1) * 3600e3), report_text: `Held account number ${i} with its own words for the test`, outcome_weight: 0.55, trust_reason: 'external_import', needs_review: true });
  }
  for (let i = 0; i < liveReports; i++) {
    T.reports.push({ id: uid(i + 1, '2'), company_name: companies[i % companies.length], outcome: i % 2 ? 'rejected' : 'offer', role: 'Engineer', platform: 'Seen', source: 'direct', created_at: ago(i * D / 2), report_text: `Live account ${i}`, outcome_weight: 1, trust_reason: null, needs_review: false });
  }
  T.company_scores = companies.map((c, i) => ({ id: uid(i + 1, '3'), company_name: c.toLowerCase(), overall_score: 60 + i, report_count: 5 + i, ghost_rate: 0.2, response_rate: 0.5, created_at: ago(30 * D) }));
  T.company_scores.push({ id: uid(99, '3'), company_name: 'walmart inc', overall_score: 50, report_count: 1, ghost_rate: 0.3, response_rate: 0.4, created_at: ago(30 * D) });
  T.companies = companies.map((c, i) => ({ id: uid(i + 1, '4'), name: c }));
  T.jobs = [];
  for (let i = 0; i < jobs; i++) {
    const stale = i % 5 === 0;
    T.jobs.push({ id: uid(i + 1, '5'), title: i % 7 === 0 ? 'Driver' : `Role ${i}`, company: companies[i % companies.length], location: `Town ${i % 7 === 0 ? 1 : i}`, apply_url: `https://jobs.example.com/${i % 7 === 0 ? 'dup' : i}`, source: 'greenhouse', external_id: null, is_employer_posted: false, availability_status: stale ? 'stale' : 'active', expires_at: new Date(Date.now() + 10 * D).toISOString(), last_seen_at: ago(i * 3600e3), created_at: ago(i * 3600e3), status: 'open', salary: null, salary_min: null, salary_max: null, score: 50, remote: false, city: null, last_checked_at: null });
  }
  T.profiles = [1, 2, 3, 4, 5].map((n) => ({ id: uid(n, '6'), email: `person${n}@example.com`, created_at: ago(n * 3600e3 * 7) }));
  T.ai_credits = [{ user_id: uid(1, '6'), balance: 7, pro: false, pro_until: null, comped: false }, { user_id: uid(2, '6'), balance: 30, pro: false, pro_until: new Date(Date.now() + 5 * D).toISOString(), comped: false }];
  T.credit_transactions = [{ id: 1, user_id: uid(2, '6'), delta: 0, reason: 'purchase_interview', created_at: ago(2 * D) }];
  T.user_issues = [{ id: 1, type: 'wrong_grade', target_type: 'company', target_name: 'Walmart', notes: 'grade looks off', status: 'open', created_at: ago(D) }, { id: 2, type: 'bad_link', target_type: 'company', target_name: 'Tesla', notes: '', status: 'open', created_at: ago(2 * D) }];
  T.company_reddit_disputes = [{ id: 1, company_name: 'Walmart', company_key: 'walmart', reason: 'not_about_hiring', detail: 'x', permalink: 'https://reddit.com/r/x/1', contact: null, status: 'open', created_at: ago(D) }];
  T.listing_disputes = [{ id: 1, job_id: uid(2, '5'), company_name: 'Tesla', company_key: 'tesla', employer_user_id: uid(3, '6'), kind: 'still_active', reason: 'r', detail: 'd', proposed_changes: null, status: 'open', created_at: ago(D) }];
  T.job_availability_reports = [{ id: uid(1, '7'), job_id: uid(3, '5'), status: 'expired', reported_at: ago(D), company: 'Stripe', title: 'Role 2', city: 'Town', apply_url: 'https://jobs.example.com/2' }, { id: uid(2, '7'), job_id: uid(3, '5'), status: 'expired', reported_at: ago(2 * D), company: 'Stripe', title: 'Role 2', city: 'Town', apply_url: 'https://jobs.example.com/2' }];
  T.suppressed_listings = [];
  T.employer_purchases = [{ id: 1, company: 'Acme', email: 'a@acme.com', employer_sku: 'featured30', amount_cents: 4900, status: 'paid', created_at: ago(D) }];
  T.employer_perks = [];
  T.employer_report_replies = [{ id: uid(1, '8'), report_id: uid(1, '2'), company_key: 'walmart', body: 'We reply', status: 'pending', created_at: ago(D) }];
  T.employer_company_claims = [{ id: uid(1, '9'), user_id: uid(4, '6'), company_name: 'acme', company_display_name: 'Acme', status: 'pending', created_at: ago(D) }];
  T.duplicate_clusters = [{ id: 1, user_ids: [uid(1, '6'), uid(2, '6')], signals: ['ip:1.2.3.4'], risk_score: 40, status: 'suspected', admin_note: null, created_at: ago(D) }];
  T.feature_flags = [{ flag_name: 'ai_credit_system_enabled', status: 'fully_on', percentage: 0, description: 'credits', updated_by: null, updated_at: ago(D) }, { flag_name: 'job_refresh_enabled', status: 'fully_on', percentage: 0 }, { flag_name: 'job_search_target', status: 'fully_on', percentage: 25 }];
  T.api_errors = [{ id: 1, endpoint: '/api/jobs', error_msg: 'boom', created_at: ago(3600e3), context: { ref: 'abc' } }];
  T.company_merges = [];
  T.saved_jobs = []; T.applications = []; T.seen_applications = [];
  T.login_signals = [{ user_id: uid(1, '6'), ip_address: '9.9.9.9', created_at: ago(D) }, { user_id: uid(3, '6'), ip_address: '9.9.9.9', created_at: ago(D) }];
  T.collector_runs = [{ id: 1, pipeline: 'applicant_reports_cloud', started_at: ago(3600e3), finished_at: ago(3500e3), status: 'complete', error: null }];
  T.outcome_email_log = []; T.search_daily = []; T.demand_refresh_log = []; T.job_match_email_log = [];
  T.funnel_events = []; T.company_aliases = []; T.resume_surveys = [];
  return T;
}

export const RPCS = {
  increment_rate_limit: (() => { const m = new Map(); return ({ p_key }) => { const n = (m.get(p_key) || 0) + 1; m.set(p_key, n); return n; }; })(),
  sweep_stale_jobs: ({ p_batch }, T) => {
    const stale = T.jobs.filter((j) => j.availability_status === 'stale' && !j.is_employer_posted).slice(0, p_batch);
    T.jobs = T.jobs.filter((j) => !stale.includes(j));
    const more = T.jobs.some((j) => j.availability_status === 'stale' && !j.is_employer_posted);
    return { staled: 0, deleted: stale.length, retained: 0, more };
  },
};

/** Run the real handler: POST {action,...} (or GET with `query`) as the signed-in owner. */
export async function caller(handler, fake) {
  return async (body, { method = 'POST', token = TOKEN, query = undefined } = {}) => {
    global.fetch = fake.fetch;
    const res = makeRes();
    const req = { method, headers: { 'x-admin-token': token, origin: '' }, body: method === 'POST' ? body : undefined, query: query || {} };
    await handler(req, res);
    return res;
  };
}

export { createFakeRest };
