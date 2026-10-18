// Apply on Seen — the I/O half (DB availability probe, private résumé storage, employer email).
// Pure rules live in lib/server/seenApply.js. Every function here is best-effort where noted and
// never throws to its caller.

import { RESUME_BUCKET } from './seenApply.js';

// Is the Apply-on-Seen migration live? Probed once per 5 minutes per warm instance: the
// seen_applications table AND jobs.apply_mode must both exist. Before the migration every caller
// degrades to today's behaviour (external apply only, no Seen-apply UI).
let _avail = { at: 0, ok: false };
export async function seenApplyAvailable(db) {
  const now = Date.now();
  if (now - _avail.at < 300_000) return _avail.ok;
  try {
    const [t, c] = await Promise.all([
      db('seen_applications?select=id&limit=1'),
      db('jobs?select=apply_mode&limit=1'),
    ]);
    _avail = { at: now, ok: !!(t.ok && c.ok) };
  } catch { _avail = { at: now, ok: false }; }
  return _avail.ok;
}
/** Test hook: forget the cached probe. */
export function _resetSeenApplyAvailability() { _avail = { at: 0, ok: false }; }

const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');

/** Upload an applicant's résumé file to the PRIVATE bucket. Returns { ok, path } / { ok:false }. */
export async function uploadResumeFile({ SUPABASE_URL, SERVICE_KEY, path, mime, buffer }) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${RESUME_BUCKET}/${enc(path)}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'false' },
      body: buffer,
    });
    if (!r.ok) {
      console.warn('[seen-apply] résumé upload failed:', r.status, (await r.text().catch(() => '')).slice(0, 160));
      return { ok: false };
    }
    return { ok: true, path };
  } catch (e) {
    console.warn('[seen-apply] résumé upload error:', e?.message || e);
    return { ok: false };
  }
}

/** A short-lived signed URL for one résumé object (default 10 minutes). null on failure. */
export async function signResumeUrl({ SUPABASE_URL, SERVICE_KEY, path, expiresIn = 600, download }) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${RESUME_BUCKET}/${enc(path)}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn }),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    const signed = j.signedURL || j.signedUrl;
    if (!signed) return null;
    const url = `${SUPABASE_URL}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
    return download ? `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(download)}` : url;
  } catch { return null; }
}

/** Remove every résumé file an applicant uploaded (account deletion). Best-effort. */
export async function deleteApplicantResumes({ SUPABASE_URL, SERVICE_KEY, uid }) {
  try {
    const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
    const list = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${RESUME_BUCKET}`, { method: 'POST', headers: h, body: JSON.stringify({ prefix: `${uid}/`, limit: 1000 }) });
    if (!list.ok) return;
    const objs = await list.json();
    const prefixes = (Array.isArray(objs) ? objs : []).map((o) => `${uid}/${o.name}`);
    if (prefixes.length) await fetch(`${SUPABASE_URL}/storage/v1/object/${RESUME_BUCKET}`, { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes }) });
  } catch { /* best-effort */ }
}

/** The email address on a Supabase auth user (service key). null when unknown. */
export async function authUserEmail({ SUPABASE_URL, SERVICE_KEY, uid }) {
  if (!uid) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return (j && (j.email || j.user?.email)) || null;
  } catch { return null; }
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Tell the employer someone applied on Seen. No applicant details in the email body beyond the name —
 * the full application (email, résumé, note) is behind the employer's sign-in. Best-effort: a silent
 * no-op without a Resend key or recipient, never throws.
 */
export async function sendNewApplicationEmail({ to, company, role, applicantName }) {
  const KEY = process.env.RESEND_KEY || process.env.RESEND_API_KEY || '';
  if (!KEY || !to) return { ok: false, skipped: true };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen <noreply@seenjobs.io>',
        to: [to],
        subject: `New application on Seen — ${role || 'your listing'}`,
        html: `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#111;line-height:1.7">
          <p><strong>${esc(applicantName || 'A candidate')}</strong> applied to <strong>${esc(role || 'your listing')}</strong> at ${esc(company || 'your company')} on Seen.</p>
          <p>Their résumé, contact details and note are in your applications inbox.</p>
          <p><a href="https://seenjobs.io/employers/dashboard" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700">Open your applications →</a></p>
          <p style="color:#666;font-size:12px">Replying quickly — even with a no — is what keeps your response rate on Seen high.</p>
        </div>`,
      }),
    });
    return { ok: r.ok };
  } catch { return { ok: false }; }
}

/**
 * Tell the applicant their Seen application moved (interviewing / not selected / hired). Best-effort:
 * a silent no-op without a Resend key or recipient, never throws.
 */
export async function sendApplicationUpdateEmail({ to, company, role, label, text }) {
  const KEY = process.env.RESEND_KEY || process.env.RESEND_API_KEY || '';
  if (!KEY || !to) return { ok: false, skipped: true };
  const what = role ? `${role} at ${company || 'the company'}` : (company || 'your application');
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Seen <noreply@seenjobs.io>',
        to: [to],
        subject: `Update on your application — ${what}`,
        html: `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#111;line-height:1.7">
          <p>${esc(company || 'The employer')} updated your application for <strong>${esc(role || 'their listing')}</strong>: <strong>${esc(label)}</strong>.</p>
          ${text ? `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #1d4ed8;background:#f5f7ff;white-space:pre-wrap">${esc(text)}</blockquote>` : ''}
          <p>Your Seen tracker is already updated.</p>
          <p><a href="https://seenjobs.io/tracker" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700">Open your tracker →</a></p>
        </div>`,
      }),
    });
    return { ok: r.ok };
  } catch { return { ok: false }; }
}

// ── Messages + withdrawal (migration 20261018150000) ───────────────────────────────────────────
// Is seen_applications.thread live? Same 5-minute cached probe as seenApplyAvailable. Before the
// migration every message / withdraw path answers "not available yet" and nothing writes 'withdrawn'.
let _thread = { at: 0, ok: false };
export async function threadAvailable(db) {
  const now = Date.now();
  if (now - _thread.at < 300_000) return _thread.ok;
  try {
    const r = await db('seen_applications?select=thread&limit=1');
    _thread = { at: now, ok: !!r.ok };
  } catch { _thread = { at: now, ok: false }; }
  return _thread.ok;
}
/** Test hook: forget the cached probe. */
export function _resetThreadAvailability() { _thread = { at: 0, ok: false }; }

async function sendEmail({ to, subject, html }) {
  const KEY = process.env.RESEND_KEY || process.env.RESEND_API_KEY || '';
  if (!KEY || !to) return { ok: false, skipped: true };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Seen <noreply@seenjobs.io>', to: [to], subject, html }),
    });
    return { ok: r.ok };
  } catch { return { ok: false }; }
}
const quote = (m) => `<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #1d4ed8;background:#f5f7ff;white-space:pre-wrap">${esc(m)}</blockquote>`;

/** The employer wrote on the applicant's application. Includes the message — it is meant for them. */
export async function sendEmployerMessageEmail({ to, company, role, text }) {
  return sendEmail({
    to,
    subject: `Message from ${company || 'an employer'} about your application`,
    html: `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#111;line-height:1.7">
      <p>${esc(company || 'The employer')} sent you a message about <strong>${esc(role || 'your application')}</strong>:</p>
      ${quote(text)}
      <p><a href="https://seenjobs.io/tracker" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700">Open your tracker →</a></p>
    </div>`,
  });
}

/** The applicant withdrew. Includes their optional note to the employer. */
export async function sendWithdrawalEmail({ to, applicantName, role, text }) {
  return sendEmail({
    to,
    subject: `${applicantName || 'An applicant'} withdrew their application — ${role || 'your listing'}`,
    html: `<div style="font-family:-apple-system,sans-serif;font-size:14px;color:#111;line-height:1.7">
      <p><strong>${esc(applicantName || 'An applicant')}</strong> withdrew their application for <strong>${esc(role || 'your listing')}</strong>.</p>
      ${text ? `<p>Their note to you:</p>${quote(text)}` : ''}
      <p><a href="https://seenjobs.io/employers/dashboard" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700">Open your applications →</a></p>
    </div>`,
  });
}

// ── Listing edits / fill / retention (migration 20261018170000) ─────────────────────────────────
// Are jobs.edited_at + seen_applications.decided_at/purged_at live? Same cached probe pattern.
let _life = { at: 0, ok: false };
export async function lifecycleAvailable(db) {
  const now = Date.now();
  if (now - _life.at < 300_000) return _life.ok;
  try {
    const [a, j] = await Promise.all([
      db('seen_applications?select=decided_at,purged_at&limit=1'),
      db('jobs?select=edited_at&limit=1'),
    ]);
    _life = { at: now, ok: !!(a.ok && j.ok) };
  } catch { _life = { at: now, ok: false }; }
  return _life.ok;
}
/** Test hook: forget the cached probe. */
export function _resetLifecycleAvailability() { _life = { at: 0, ok: false }; }

/** Delete résumé objects from the private bucket. Returns true when the call succeeded (or nothing to do). */
export async function deleteResumeObjects({ SUPABASE_URL, SERVICE_KEY, paths }) {
  const prefixes = (Array.isArray(paths) ? paths : []).filter(Boolean);
  if (!prefixes.length) return true;
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${RESUME_BUCKET}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes }),
    });
    return r.ok;
  } catch { return false; }
}
