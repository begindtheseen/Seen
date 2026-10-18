// Apply on Seen — pure helpers (no I/O) shared by api/apply.js (applicant side),
// api/employer-listings.js (employer side) and the UI.
//
// apply_mode lives on jobs (migration 20261017150000_apply_on_seen.sql):
//   'external' — apply on the employer's own site (default; every aggregated listing)
//   'seen'     — apply on Seen only (the employer has no process for receiving résumés)
//   'both'     — both buttons
// Only EMPLOYER-POSTED listings can be anything but 'external' — an aggregated listing's employer
// never asked to receive applications through Seen.
//
// Deploy order: this code ships BEFORE the migration. isNotMigrated() recognises PostgREST's
// "column/table doesn't exist" errors so every caller degrades to today's behaviour (external only).

import { decodeThread } from './applicationThread.js';

export const APPLY_MODES = ['external', 'seen', 'both'];
export const APPLICATION_STATUSES = ['new', 'reviewed', 'interviewing', 'rejected', 'hired'];
export const RESUME_BUCKET = 'application-resumes';
// Vercel caps a function request body at 4.5 MB; base64 adds a third. Same limit as the bucket.
export const MAX_RESUME_BYTES = 3 * 1024 * 1024;
export const MAX_NOTE = 2000;
export const MAX_RESUME_TEXT = 60000;

/** Unknown / missing → 'external' (today's behaviour). */
export function normalizeApplyMode(v) {
  const m = String(v == null ? '' : v).trim().toLowerCase();
  return APPLY_MODES.includes(m) ? m : 'external';
}

/** The apply_mode a listing actually honours: only employer-posted listings can take Seen applies. */
export function effectiveApplyMode(job) {
  if (!job || !(job.is_employer_posted || job.employer_posted)) return 'external';
  return normalizeApplyMode(job.apply_mode);
}
export function allowsSeenApply(job) { const m = effectiveApplyMode(job); return m === 'seen' || m === 'both'; }
export function allowsExternalApply(job) {
  const m = effectiveApplyMode(job);
  return (m === 'external' || m === 'both') && !!(job && (job.apply_url || job.url));
}

/** True when a PostgREST error means the Apply-on-Seen migration hasn't been applied yet. */
export function isNotMigrated(status, text) {
  const t = String(text || '');
  if (/42703|PGRST204|42P01|PGRST205/.test(t)) return true;
  if (/apply_mode|seen_applications/.test(t) && /(does not exist|could not find|schema cache)/i.test(t)) return true;
  return status === 404 && /seen_applications/.test(t);
}

/** Employer form: website/both need a real http(s) link; Seen-only needs none. */
export function validateApplyChoice(mode, applyUrl, isHttpUrl) {
  const m = normalizeApplyMode(mode);
  const url = String(applyUrl == null ? '' : applyUrl).trim();
  if (m !== 'seen' && !isHttpUrl(url)) {
    return { ok: false, error: m === 'both' ? 'Add your website’s apply link (http/https), or choose “On Seen” only' : 'A valid apply link (http/https) is required' };
  }
  return { ok: true, apply_mode: m, apply_url: m === 'seen' ? (isHttpUrl(url) ? url : null) : url };
}

const EMAIL_RE = /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]{2,}$/;
export function isValidEmail(s) { return typeof s === 'string' && s.length < 254 && EMAIL_RE.test(s.trim()); }

/**
 * Validate the applicant's form. Résumé: 'saved' (the text on their Seen profile) or 'upload'
 * (a file, extracted by the caller). Returns { ok, application } or { ok:false, error }.
 */
export function validateSeenApplication(input = {}) {
  const job_id = String(input.job_id == null ? '' : input.job_id).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(job_id)) return { ok: false, error: 'That listing can’t take applications' };
  const name = String(input.name == null ? '' : input.name).replace(/\s+/g, ' ').trim();
  if (name.length < 2) return { ok: false, error: 'Add your name' };
  const email = String(input.email == null ? '' : input.email).trim();
  if (!isValidEmail(email)) return { ok: false, error: 'Add a valid email address' };
  const phone = String(input.phone == null ? '' : input.phone).trim();
  if (phone && !/^[0-9+().\-\s]{7,25}$/.test(phone)) return { ok: false, error: 'That phone number doesn’t look right' };
  const resumeSource = input.resume_source === 'upload' ? 'upload' : input.resume_source === 'saved' ? 'saved' : null;
  if (!resumeSource) return { ok: false, error: 'Choose a résumé to send' };
  if (resumeSource === 'upload' && !input.file_base64) return { ok: false, error: 'Attach your résumé file' };
  if (input.consent !== true) return { ok: false, error: 'Confirm you agree to share your application' };
  return {
    ok: true,
    application: {
      job_id,
      name: name.slice(0, 120),
      email: email.slice(0, 254),
      phone: phone ? phone.slice(0, 25) : null,
      note: input.note ? String(input.note).trim().slice(0, MAX_NOTE) || null : null,
      resumeSource,
    },
  };
}

/** Decoded byte length of a base64 payload without decoding it. */
export function base64Bytes(b64) {
  const s = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - pad;
}

const MIME_BY_EXT = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' };
/** A safe storage object path + mime for an uploaded résumé (never user-controlled path parts). */
export function resumeObject({ applicantId, jobId, fileName, nowMs }) {
  const ext = (String(fileName || '').toLowerCase().match(/\.(pdf|docx?|txt)$/) || [])[1] || 'pdf';
  return { path: `${applicantId}/${jobId}-${nowMs}.${ext}`, mime: MIME_BY_EXT[ext] };
}

/** The seen_applications row. Pure — timestamps come from the DB defaults. */
export function buildSeenApplicationRow(app, { job, applicantId, companyKey, resumeText, resumePath, resumeFileName, resumeMime }) {
  return {
    job_id: app.job_id,
    company_key: companyKey,
    company_name: job.company || null,
    job_title: job.title || null,
    employer_user_id: job.employer_user_id || null,
    applicant_user_id: applicantId,
    applicant_name: app.name,
    applicant_email: app.email,
    applicant_phone: app.phone,
    resume_text: resumeText ? String(resumeText).slice(0, MAX_RESUME_TEXT) : null,
    resume_path: resumePath || null,
    resume_file_name: resumeFileName ? String(resumeFileName).slice(0, 200) : null,
    resume_mime: resumeMime || null,
    note: app.note,
    status: 'new',
  };
}

/** The applicant's own tracker row (applications table — same shape user-sync add_application writes). */
export function buildTrackerRow({ job, applicantId, nowMs }) {
  return {
    user_id: applicantId,
    job_id: String(job.id),
    company_name: job.company || '',
    role: job.title || '',
    city: job.location || '',
    platform: 'Seen',
    job_url: `https://seenjobs.io/jobs/${job.id}`,
    status: 'active',
    stage: 'Applied',
    applied_at: new Date(nowMs).toISOString(),
    events: [{ id: `evt_${nowMs.toString(36)}`, type: 'application_submitted', date: nowMs, source: 'seen_apply', confidence: 'high' }],
  };
}

/** Is this a unique-violation response (already applied)? */
export function isDuplicate(status, text) {
  return status === 409 || /23505|duplicate key|seen_applications_one_per_applicant/i.test(String(text || ''));
}

/** Inbox row for the employer — what they see about each applicant (all consented to at apply time).
 *  The résumé itself is fetched on demand (action application_resume → short-lived signed URL or text). */
export function inboxItem(row) {
  return {
    id: row.id,
    job_id: row.job_id,
    job_title: row.job_title || null,
    name: row.applicant_name,
    email: row.applicant_email,
    phone: row.applicant_phone || null,
    note: row.note || null,
    // 'withdrawn' is set only by the applicant (api/apply.js withdraw), never by the employer.
    status: APPLICATION_STATUSES.includes(row.status) || row.status === 'withdrawn' ? row.status : 'new',
    created_at: row.created_at,
    resume_file_name: row.resume_file_name || null,
    has_resume_file: !!row.resume_path,
    has_resume_text: !!row.resume_text,
    thread: decodeThread(row.thread),
  };
}

// ── Employer status → the applicant's tracker (owner request 2026-10-18) ───────────────────────
// When an employer moves a Seen application in their inbox, the applicant's own tracker row (the
// `applications` row created at apply time) follows: stage, status, an employer-sourced event, and
// `employer_stage` (shown as a badge on the tracker card). Never moves the applicant backwards —
// if they already logged an interview, a later "reviewed" doesn't undo it — and never duplicates
// an event the employer already sent.
export const EMPLOYER_STATUS_TRACKER = {
  new:          null, // nothing to tell the applicant yet
  reviewed:     { label: 'Reviewed',     stage: 'Viewed',    status: 'active',   event: 'application_viewed', email: false },
  interviewing: { label: 'Interviewing', stage: 'Interview', status: 'active',   event: 'interview_received', email: true },
  rejected:     { label: 'Not selected', stage: 'Rejected',  status: 'rejected', event: 'rejected',           email: true },
  hired:        { label: 'Hired',        stage: 'Offer',     status: 'hired',    event: 'offer_received',     email: true },
};
const STAGE_RANK = { Applied: 0, Viewed: 1, 'Phone Screen': 2, Interview: 3, 'Final Round': 4, Offer: 5 };

/**
 * The PATCH for the applicant's tracker row after the employer sets `status`, or null when nothing
 * should change. Pure. `app` = { status, stage, events } as stored.
 */
export function trackerUpdateForEmployerStatus(app, status, nowMs) {
  const m = EMPLOYER_STATUS_TRACKER[status];
  if (!m || !app) return null;
  const events = Array.isArray(app.events) ? app.events.slice() : [];
  const already = events.some((e) => e && e.type === m.event && e.source === 'employer');
  const terminal = m.status === 'rejected' || m.status === 'hired';
  const curRank = STAGE_RANK[app.stage] ?? 0;
  const newRank = STAGE_RANK[m.stage] ?? 0;
  // An active stage only ever moves forward; a decision (rejected / hired) always lands.
  const moveStage = terminal || newRank > curRank;
  const patch = { employer_stage: m.label, updated_at: new Date(nowMs).toISOString() };
  if (moveStage) { patch.stage = m.stage; patch.status = m.status; }
  if (!already) {
    events.push({ id: `evt_${nowMs.toString(36)}_emp`, type: m.event, date: nowMs, source: 'employer', confidence: 'verified', note: `Employer marked your application: ${m.label}` });
    patch.events = events;
  }
  return patch;
}

// ── Hired → close the listing (owner request 2026-10-18) ───────────────────────────────────────
// One manual step for the employer: confirm everyone they hired, then every applicant still waiting
// gets one decline message and the listing closes. Applicants already marked hired are never
// messaged; ones already declined (they were told) and ones who withdrew are left alone.
export const OPEN_APPLICATION_STATUSES = ['new', 'reviewed', 'interviewing'];
export const DECLINE_MESSAGE_MAX = 600;

/**
 * Recommended decline messages, in the employer's name. The employer picks one or writes their own,
 * and can edit any of them before it goes out. `context` 'filled' (closing a filled listing) leads
 * with "we've filled the position"; 'single' (declining one applicant) leaves that one out, because
 * the role may still be open. None promises to keep a résumé on file — declined résumés are cleared
 * after 30 days (lib/server/applicationRetention.js).
 */
export function declineTemplates({ title, company } = {}, context = 'filled') {
  const role = title ? `the ${title} role` : 'this role';
  const at = company ? ` at ${company}` : '';
  const all = {
    filled: { id: 'filled', label: 'Position filled', text: `Thank you for applying for ${role}${at}. We've filled the position and won't be moving forward with your application. We appreciate your interest and wish you the best in your search.` },
    another: { id: 'another', label: 'Other candidates', text: `Thank you for applying for ${role}${at}. We've decided to move forward with other candidates. We appreciate your interest and wish you the best in your search.` },
    interviewed: { id: 'interviewed', label: 'After an interview', text: `Thank you for taking the time to interview for ${role}${at}. It was a difficult decision, but we won't be moving forward with your application. We're grateful for your time and wish you all the best.` },
  };
  return context === 'single' ? [all.another, all.interviewed] : [all.filled, all.another, all.interviewed];
}

/** The automated decline used when the employer doesn't pick one. */
export function defaultDeclineMessage(ctx = {}) {
  return declineTemplates(ctx, 'filled')[0].text;
}

/**
 * Who gets what when the employer closes a filled listing. `rows` = this listing's applications
 * ({ id, status }); `hiredIds` = the ones the employer just confirmed as hired. Pure.
 * Returns { ok:true, hire:[rows to mark hired], decline:[rows to decline + message], keep:{ hired, declined, withdrawn } }
 * or { ok:false, error }.
 */
export function planFill(rows, hiredIds) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.id) : [];
  const ids = new Set((Array.isArray(hiredIds) ? hiredIds : []).map(String));
  const byId = new Map(list.map((r) => [String(r.id), r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) return { ok: false, error: 'One of the people you picked isn’t an applicant on this listing' };
    if (r.status === 'withdrawn') return { ok: false, error: 'Someone you picked withdrew their application' };
  }
  const hire = [], decline = [];
  const keep = { hired: 0, declined: 0, withdrawn: 0 };
  for (const r of list) {
    if (r.status === 'hired') { keep.hired += 1; continue; } // already hired — never messaged
    if (ids.has(String(r.id))) { hire.push(r); continue; }
    if (r.status === 'withdrawn') { keep.withdrawn += 1; continue; }
    if (r.status === 'rejected') { keep.declined += 1; continue; } // already told
    if (OPEN_APPLICATION_STATUSES.includes(r.status)) decline.push(r);
  }
  return { ok: true, hire, decline, keep };
}

// ── Editing a posted listing ────────────────────────────────────────────────────────────────────
/**
 * The jobs PATCH for an employer's edit of their own listing (already validated by
 * validateNewListing). Keeps created_at / expires_at; stamps edited_at so the change is dated on the
 * listing and on applications sent before it. Pure.
 */
export function buildListingEditPatch(listing, { nowISO, withApplyMode } = {}) {
  const remote = /\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b/i.test(String(listing.location || ''));
  return {
    title: listing.title,
    location: listing.location,
    city: remote ? null : listing.location,
    remote,
    salary: listing.salary,
    description: listing.description,
    apply_url: listing.apply_url,
    ...(withApplyMode ? { apply_mode: listing.apply_mode } : {}),
    type: listing.type,
    edited_at: nowISO,
  };
}

// ── Take Seen applications on an aggregated listing (owner request 2026-10-18) ─────────────────
// An employer can switch a listing Seen pulled in (Adzuna, an ATS feed, …) for their company to
// accept applications on Seen. It is converted IN PLACE: same row and id (saved jobs, trackers and
// links keep working), now owned by the employer — is_employer_posted + employer_user_id — so it
// gets everything their own posts get: editable, closable when filled, shown ahead in search, and
// never swept as stale (sweep_stale_jobs skips employer-posted rows). Re-ingesting the same listing
// only refreshes last_seen_at/expires_at (jobs_dedupe_refresh), so the employer's settings stay.
// Posting a separate copy instead would make the dedupe trigger DELETE the original row.
export const CLAIMED_LISTING_TTL_DAYS = 60; // same lifetime as a listing the employer posts

/**
 * Validate + build the jobs PATCH that turns `job` into an employer-managed listing taking Seen
 * applications. Pure. `isHttpUrl` is injected (listingDisputes.js). Returns { ok:true, patch } or
 * { ok:false, status, error, reason }.
 */
export function claimListingPatch(job, { mode, uid, companyKey, companyOf, nowMs, isHttpUrl }) {
  const m = normalizeApplyMode(mode);
  if (m === 'external') return { ok: false, status: 400, error: 'Choose “On Seen” or “Both”', reason: 'mode' };
  if (!job) return { ok: false, status: 404, error: 'That listing no longer exists', reason: 'missing' };
  if (companyOf(job.company) !== companyKey) return { ok: false, status: 403, error: 'That listing is not attached to your company', reason: 'company' };
  if (job.employer_user_id && job.employer_user_id !== uid) return { ok: false, status: 403, error: 'Another account on your company already manages this listing', reason: 'owned' };
  if (job.availability_status === 'expired' || (job.expires_at && Date.parse(job.expires_at) <= nowMs)) {
    return { ok: false, status: 400, error: 'This listing has closed — post a new one instead', reason: 'closed' };
  }
  if (m === 'both' && !isHttpUrl(job.apply_url)) return { ok: false, status: 400, error: 'This listing has no outside apply link — choose “On Seen”', reason: 'no_link' };
  const ttl = nowMs + CLAIMED_LISTING_TTL_DAYS * 86400000;
  const current = job.expires_at ? Date.parse(job.expires_at) : 0;
  const nowISO = new Date(nowMs).toISOString();
  return {
    ok: true,
    patch: {
      is_employer_posted: true,
      employer_user_id: uid,
      apply_mode: m,
      availability_status: 'active',
      expires_at: new Date(Math.max(current || 0, ttl)).toISOString(),
      last_checked_at: nowISO,
    },
  };
}
