// Apply on Seen — messages on an application, applicant withdrawal, and the exit review
// (owner request 2026-10-18). Pure rules (no I/O); api/employer-listings.js (employer side),
// api/apply.js (applicant side) and api/user-sync.js (tracker load) share them.
//
// Storage, chosen to stay small (Seen keeps hiring data for the long run):
//   - The conversation lives ON the existing seen_applications row as `thread`, a JSON array of
//     tuples [from, unix_seconds, text] (+ kind). Tuples instead of objects drop the repeated key
//     names; seconds instead of ISO strings save ~14 bytes a message; NULL until the first message.
//   - One copy only. The employer inbox and the applicant's tracker both read the same row; the
//     tracker row keeps just a small `withdrawn` event.
//   - Hard caps: THREAD_MAX_ENTRIES × MESSAGE_MAX chars per application.
//   - The exit review is a normal `reports` row — that is the scoring pool, so it must live there.
//
// Migration: 20261018150000_application_messages_withdraw.sql (thread column + 'withdrawn').

export const THREAD_MAX_ENTRIES = 40;
export const MESSAGE_MAX = 600;
export const REVIEW_MAX = 1000;
// No reply for this long after applying = ghosted, matching the tracker's Day-30 "What happened?".
export const NO_RESPONSE_GHOST_DAYS = 30;

const FROM = { e: 'employer', a: 'applicant' };

/** Why someone withdrew. Codes are stored; labels are shown. */
export const WITHDRAW_REASONS = {
  other_offer: 'I took another offer',
  too_slow: 'The process took too long',
  no_response: 'They never got back to me',
  pay: 'Pay or benefits',
  role_mismatch: 'The role wasn’t what was described',
  bad_experience: 'A bad experience with the employer',
  personal: 'Personal reasons',
  other: 'Something else',
};

/** Trim, drop control characters (keeps line breaks), collapse long blank runs, cap. */
export function cleanMessage(s, max = MESSAGE_MAX) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function isEntry(x) {
  return Array.isArray(x) && (x[0] === 'e' || x[0] === 'a') && Number.isFinite(x[1]) && typeof x[2] === 'string';
}

/** The stored thread as a clean array (a corrupt or missing value reads as empty). */
export function readThread(thread) {
  let t = thread;
  if (typeof t === 'string') { try { t = JSON.parse(t); } catch { t = null; } }
  return Array.isArray(t) ? t.filter(isEntry) : [];
}

/**
 * Append one message. `from` 'e' | 'a'. An empty text is allowed only for the withdrawal marker
 * (kind 'w'), so the employer's inbox shows when the applicant withdrew even without a note.
 * Returns { ok:true, thread } or { ok:false, error }.
 */
export function appendThreadEntry(thread, { from, text, nowMs, kind } = {}) {
  if (from !== 'e' && from !== 'a') return { ok: false, error: 'Unknown sender' };
  const msg = cleanMessage(text);
  if (!msg && kind !== 'w') return { ok: false, error: 'Write a message first' };
  const cur = readThread(thread);
  if (cur.length >= THREAD_MAX_ENTRIES) return { ok: false, error: 'This conversation has reached its message limit' };
  const entry = [from, Math.floor(Number(nowMs) / 1000), msg];
  if (kind) entry.push(kind);
  return { ok: true, thread: [...cur, entry] };
}

/** Stored thread → what the API returns: [{ from, at (ISO), text, withdrawal? }]. */
export function decodeThread(thread) {
  return readThread(thread).map(([f, t, m, k]) => ({
    from: FROM[f],
    at: new Date(t * 1000).toISOString(),
    text: m,
    ...(k === 'w' ? { withdrawal: true } : {}),
  }));
}

/** Did the employer write to the applicant? (A human response, for the exit review's outcome.) */
export function employerMessaged(thread) {
  return readThread(thread).some((e) => e[0] === 'e');
}

/** First time the employer wrote, in ms, or null. */
function firstEmployerMessageMs(thread) {
  const e = readThread(thread).find((x) => x[0] === 'e');
  return e ? e[1] * 1000 : null;
}

const OFFER_EVENTS = new Set(['offer_received']);
const INTERVIEW_EVENTS = new Set(['interview_received', 'interview_completed']);
const RESPONSE_EVENTS = new Set(['response_received', 'assessment_received', 'interview_received', 'interview_completed', 'offer_received', 'rejected']);

/**
 * The hiring outcome an exit review reports, from what is actually on record — the employer's
 * status and messages (verified, for Seen applications) and the tracker's stage and events — never
 * from a field the reviewer types. Values are the `reports.outcome` CHECK set.
 *   offer > interview > rejected > human (someone replied) > ghosted (no reply in 30 days) > waiting
 */
export function withdrawalOutcome({ stage, events, appliedAtMs, nowMs, employerStatus = null, thread = null } = {}) {
  const ev = Array.isArray(events) ? events : [];
  const has = (set) => ev.some((e) => e && set.has(e.type));
  if (employerStatus === 'hired' || stage === 'Offer' || has(OFFER_EVENTS)) return 'offer';
  if (employerStatus === 'interviewing' || stage === 'Interview' || stage === 'Final Round' || has(INTERVIEW_EVENTS)) return 'interview';
  if (employerStatus === 'rejected') return 'rejected';
  if (employerMessaged(thread) || stage === 'Phone Screen' || ev.some((e) => e && (e.type === 'response_received' || e.type === 'assessment_received'))) return 'human';
  const days = (Number(nowMs) - Number(appliedAtMs)) / 86400000;
  return Number.isFinite(days) && days >= NO_RESPONSE_GHOST_DAYS ? 'ghosted' : 'waiting';
}

/** Whole days from applying to the first reply on record (event or employer message), or null. */
export function firstResponseDays({ events, appliedAtMs, thread = null } = {}) {
  const times = (Array.isArray(events) ? events : [])
    .filter((e) => e && RESPONSE_EVENTS.has(e.type) && Number.isFinite(Number(e.date)))
    .map((e) => Number(e.date));
  const m = firstEmployerMessageMs(thread);
  if (m != null) times.push(m);
  if (!times.length || !Number.isFinite(Number(appliedAtMs))) return null;
  const d = Math.round((Math.min(...times) - Number(appliedAtMs)) / 86400000);
  return d >= 0 ? d : null;
}

/** Interview rounds on record (for reports.rounds). */
export function interviewRounds(events) {
  return (Array.isArray(events) ? events : []).filter((e) => e && INTERVIEW_EVENTS.has(e.type)).length;
}

/**
 * The tracker PATCH that marks an application withdrawn, or null when it already is. Pure.
 * `app` = { status, events }.
 */
export function withdrawTrackerPatch(app, nowMs) {
  if (!app || app.status === 'withdrawn') return null;
  const events = Array.isArray(app.events) ? app.events.slice() : [];
  events.push({ id: `evt_${Number(nowMs).toString(36)}_wd`, type: 'withdrawn', date: Number(nowMs), source: 'user', confidence: 'high' });
  return { status: 'withdrawn', updated_at: new Date(nowMs).toISOString(), events };
}

/** The withdrawn event already carries an exit review → a second one is refused. */
export function alreadyReviewed(events) {
  return (Array.isArray(events) ? events : []).some((e) => e && e.type === 'withdrawn' && e.rv === 1);
}

/** Events with the exit-review marker (and reason code) set on the withdrawn event. Pure. */
export function markWithdrawReviewed(events, reason) {
  const out = (Array.isArray(events) ? events : []).map((e) => ({ ...e }));
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] && out[i].type === 'withdrawn') {
      out[i].rv = 1;
      if (reason) out[i].reason = reason;
      break;
    }
  }
  return out;
}

/** Validate the optional exit survey. Needs a reason or a review (both are optional, not both empty). */
export function validateWithdrawReview(input = {}) {
  const reason = input.reason == null || input.reason === '' ? null : String(input.reason);
  if (reason && !Object.prototype.hasOwnProperty.call(WITHDRAW_REASONS, reason)) return { ok: false, error: 'Unknown reason' };
  const review = cleanMessage(input.review, REVIEW_MAX) || null;
  if (!reason && !review) return { ok: false, error: 'Pick a reason or write a review — or skip' };
  return { ok: true, reason, review };
}

/**
 * The `reports` row for an exit review. platform 'Seen Apply' / 'Seen Tracker' classify as a
 * first-party direct report (companyIntel classifyPlatform → weight 1.0), so it lands in the scoring
 * pool unless the anti-gaming check (trust) holds it for review.
 */
export function buildWithdrawalReport({ role, outcome, waitDays, rounds, review, trust, uid, companyId, locationId, seenApply }) {
  return {
    company_id: companyId,
    location_id: locationId || null,
    role: String(role || '').trim().slice(0, 200),
    platform: seenApply ? 'Seen Apply' : 'Seen Tracker',
    outcome,
    rounds: Number.isFinite(rounds) ? rounds : 0,
    wait_days: Number.isFinite(waitDays) ? waitDays : null,
    unpaid_work: 'na',
    experience_level: '',
    report_text: review || null,
    source: seenApply ? 'seen_apply' : 'tracker',
    needs_review: !!trust?.review,
    outcome_weight: trust?.weight ?? 1,
    trust_reason: trust?.reason || 'direct_submission',
    user_id: uid,
  };
}
