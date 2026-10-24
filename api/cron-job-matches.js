// Job-match emails (owner request 2026-10-24). Twice a day, for every account with a résumé on file:
// find the listings that match it (the SAME matcher as the /jobs "Matched to your résumé" rail —
// lib/server/resumeMatches.js), pick the single best one the person has not applied to, saved, or
// heard about (lib/server/jobMatchEmails.js pickBestMatch), and email an invitation to apply with
// the listing's Seen link. At most 2 a California day, at least 4 hours apart, never the same job
// twice. The résumé is read fresh every run, so a changed résumé means new matches.
//
// Auth: Vercel's cron GET (Authorization: Bearer CRON_SECRET, lib/server/cronAuth.js); a manual run
// with the secret or an admin session. `?dry=1` (manual only) picks and reports without claiming or
// sending — the safe way to see what the next run would send.
//
// Idempotent and race-safe: the (user_id, job_key) log row is CLAIMED before the send; a failed send
// deletes the claim so a later run can retry. No RESEND_KEY → a dry run.
//
// Limits: JOB_MATCH_DAILY_CAP (default 40) sends a California day across ALL users — Resend's free
// plan allows 100 emails a day shared with sign-up confirmations and outcome check-ins.
// Addresses on JOB_MATCH_SKIP_DOMAINS (default seenjobs.io: the audit/test accounts) are skipped, as
// are unconfirmed addresses and anyone who opted out.

import { isVercelCron, hasCronSecret, hasAdminSession } from '../lib/server/cronAuth.js';
import { findResumeMatches } from '../lib/server/resumeMatches.js';
import {
  pickBestMatch, canSendNow, buildJobMatchEmail, jobKey, companyScoreKey, companyVerdict,
} from '../lib/server/jobMatchEmails.js';
import { unsubToken } from '../lib/server/outcomeEmails.js';
import { loadTenantNames, withTenantName } from '../lib/server/tenantNames.js';
import { pacificDayStart } from '../lib/time/pacific.js';
import { logError } from '../lib/server/errlog.js';

const SITE = 'https://seenjobs.io';
const BUDGET_MS = 240_000;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const cron = req.method === 'GET' && isVercelCron(req);
  const manual = !cron && (hasCronSecret(req) || await hasAdminSession(req));
  if (!cron && !manual) return res.status(401).json({ error: 'unauthorized' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_KEY;
  const EMAIL_SECRET = process.env.EMAIL_UNSUB_SECRET || process.env.CRON_SECRET || SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'db_not_configured' });

  const qDry = String(req.query?.dry ?? '') === '1';
  const dry = (manual && qDry) || !RESEND_KEY;
  const dailyCap = Math.max(0, Number(process.env.JOB_MATCH_DAILY_CAP ?? 40) || 0);
  const skipDomains = String(process.env.JOB_MATCH_SKIP_DOMAINS ?? 'seenjobs.io').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const deadline = Date.now() + BUDGET_MS;

  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  const q = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const rows = async (path) => { const r = await q(path).catch(() => null); if (!r || !r.ok) return null; const j = await r.json().catch(() => null); return Array.isArray(j) ? j : null; };

  const summary = { ok: true, dry, users: 0, sent: 0, picked: [], skipped: {}, cap: dailyCap, sent_today_before: 0 };
  const skip = (why) => { summary.skipped[why] = (summary.skipped[why] || 0) + 1; };

  try {
    const dayStart = pacificDayStart(new Date()).toISOString();
    const todayRes = await q(`job_match_email_log?sent_at=gte.${encodeURIComponent(dayStart)}&select=id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
    if (!todayRes.ok) return res.status(200).json({ ok: false, reason: 'log_unreadable', status: todayRes.status });
    let sentToday = Number(String(todayRes.headers.get('content-range') || '').split('/')[1]) || 0;
    summary.sent_today_before = sentToday;

    // Everyone with a résumé on file (keyset pages; PostgREST caps a read at 1,000 rows).
    const users = [];
    for (let after = '', guard = 0; guard < 50; guard++) {
      const page = await rows(`profiles?select=id&resume_text=not.is.null${after ? `&id=gt.${after}` : ''}&order=id.asc&limit=1000`);
      if (!page) return res.status(200).json({ ok: false, reason: 'profiles_unreadable' });
      users.push(...page.map((p) => p.id));
      if (page.length < 1000) break;
      after = page[page.length - 1].id;
    }
    summary.users = users.length;

    const optRows = await rows('email_prefs?select=user_id&job_match_opt_out=eq.true&limit=10000');
    if (!optRows) return res.status(200).json({ ok: false, reason: 'prefs_unreadable' });
    const optOut = new Set(optRows.map((r) => r.user_id));
    const tenantNames = await loadTenantNames(SUPABASE_URL, headers).catch(() => new Map());

    for (const uid of users) {
      if (Date.now() > deadline) { skip('out_of_time'); continue; }
      if (sentToday >= dailyCap) { skip('daily_cap'); continue; }
      if (optOut.has(uid)) { skip('opted_out'); continue; }

      // This person's history: what Seen already emailed, applied to, saved.
      const u = encodeURIComponent(uid);
      const [log, apps, saved] = await Promise.all([
        rows(`job_match_email_log?user_id=eq.${u}&select=job_id,job_key,company,sent_at&order=sent_at.desc&limit=1000`),
        rows(`applications?user_id=eq.${u}&select=job_id,company_name,role&limit=1000`),
        rows(`saved_jobs?user_id=eq.${u}&select=job_id&limit=1000`),
      ]);
      if (!log || !apps || !saved) { skip('history_unreadable'); continue; } // never risk a repeat
      const dayStartMs = Date.parse(dayStart);
      const todays = log.filter((r) => Date.parse(r.sent_at) >= dayStartMs);
      if (!canSendNow({ sentToday: todays.length, lastSentAt: log[0]?.sent_at || null })) { skip('user_limit'); continue; }

      const m = await findResumeMatches({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, userId: uid, allowFloor: false });
      if (m.heal) await m.heal;
      if (m.reason) { skip(m.reason); continue; }
      const ranked = m.ranked.map((j) => withTenantName(j, tenantNames));
      if (!ranked.length) { skip('no_matches'); continue; }

      // The employers' Seen grades, for the D/F gate and the email's verdict line.
      const companies = [...new Set(ranked.slice(0, 40).map((j) => companyScoreKey(j.company)).filter(Boolean))];
      const scores = new Map();
      if (companies.length) {
        const list = companies.map((c) => `"${c.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
        const sr = await rows(`company_scores?company_name=in.(${encodeURIComponent(list)})&select=company_name,overall_score,response_rate,first_party_report_count,mention_count&limit=200`);
        if (!sr) { skip('grades_unreadable'); continue; } // the D/F gate must not be skipped silently
        for (const s of sr) scores.set(companyScoreKey(s.company_name), s);
      }

      const pick = pickBestMatch(ranked, {
        emailedKeys: new Set(log.map((r) => r.job_key)),
        emailedJobIds: new Set(log.map((r) => String(r.job_id))),
        appliedJobIds: new Set(apps.map((a) => a.job_id).filter(Boolean).map(String)),
        appliedKeys: new Set(apps.map((a) => jobKey({ title: a.role, company: a.company_name }))),
        savedJobIds: new Set(saved.map((s) => s.job_id).filter(Boolean).map(String)),
        companiesToday: new Set(todays.map((r) => companyScoreKey(r.company))),
        scores,
      });
      if (!pick) { skip('no_good_match'); continue; }
      const { job } = pick;
      const verdict = companyVerdict(scores.get(companyScoreKey(job.company)));

      // The address: confirmed, not a test domain.
      let email = null;
      try {
        const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
        if (ur.ok) { const au = await ur.json(); if (au?.email && au.email_confirmed_at) email = String(au.email); }
      } catch { /* leave null */ }
      if (!email) { skip('no_confirmed_email'); continue; }
      const domain = email.split('@')[1]?.toLowerCase() || '';
      if (skipDomains.includes(domain)) { skip('test_domain'); continue; }

      const utm = 'utm_source=email&utm_medium=job_match&utm_campaign=resume_match';
      const applyUrl = `${SITE}/jobs/${encodeURIComponent(String(job.id))}?${utm}`;
      const companyPageUrl = verdict ? `${SITE}/company/${encodeURIComponent(String(job.company).toLowerCase().replace(/\s+/g, '-'))}?${utm}` : null;
      const unsubUrl = `${SITE}/api/unsubscribe?list=job_matches&uid=${u}&token=${unsubToken(uid, EMAIL_SECRET, 'job_matches')}`;
      const mail = buildJobMatchEmail({ job, verdict, city: m.city, applyUrl, unsubUrl, companyPageUrl });
      const report = { user: uid.slice(0, 8), job_id: job.id, title: job.title, company: job.company, location: job.location, phrase: job._phrase, grade: verdict?.letter || null, subject: mail.subject };

      if (dry) { summary.picked.push(report); continue; }

      const key = jobKey(job);
      const claim = await q('job_match_email_log', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ user_id: uid, job_id: String(job.id), job_key: key, company: companyScoreKey(job.company) }),
      });
      if (claim.status === 409) { skip('already_sent'); continue; }
      if (!claim.ok) { skip('claim_failed'); continue; }
      const release = () => q(`job_match_email_log?user_id=eq.${u}&job_key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});

      try {
        const send = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Seen <noreply@seenjobs.io>', to: [email], subject: mail.subject, html: mail.html, text: mail.text,
            headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
            tags: [{ name: 'kind', value: 'job_match' }],
          }),
        });
        if (send.ok) { summary.sent++; sentToday++; summary.picked.push(report); }
        else { await release(); skip(`send_${send.status}`); }
      } catch {
        await release();
        skip('send_error');
      }
    }
    return res.status(200).json(summary);
  } catch (e) {
    logError('cron-job-matches', e.message);
    return res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 200), ...summary });
  }
}
