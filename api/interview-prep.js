// Interview Prep — see lib/server/interviewPrep.js for the product rules.
//
//   POST {action:'record', company, role}          free, no sign-in: the company's interview record from
//                                                  Seen's reports, the pay range from its listings, and a
//                                                  follow-up schedule. Shown on every tracker card that
//                                                  reaches an interview.
//   POST {action:'build', company, role, application_id?, job_text?, interview_at?}
//                                                  signed in + Pro access (an Interview Prep purchase
//                                                  grants 14 days of it): questions, answers built only
//                                                  from the résumé, intro, emails. Cached per user +
//                                                  company + role in interview_preps when that table
//                                                  exists (migration 20261025120000).
//   POST {action:'event', event, company?}         funnel counters (funnel_events), allow-listed names.

import { applyRateLimit } from '../lib/server/ratelimit.js';
import { gateAI } from '../lib/server/credits.js';
import { chat, llmAvailable, LLMUnavailableError } from '../lib/server/llm.js';
import { SCORABLE_REPORTS_FILTER } from '../lib/server/reportCounts.js';
import { ONE_TIME_SKUS } from '../lib/server/creditRules.js';
import {
  interviewRecord, payRange, followUpPlan, prepPrompt, guardPack, prepEmails, prepKey, signOffName, prepFamily,
} from '../lib/server/interviewPrep.js';

export const FUNNEL_EVENTS = ['prep_offer_shown', 'prep_offer_clicked', 'prep_built', 'guest_email_shown', 'guest_email_given'];

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
// Legal suffixes dropped so "Ross Stores, Inc." and "ross stores" read the same reports.
const SUFFIX_RE = /[,.]?\s+(inc|llc|corp|corporation|co|company|ltd|plc)\.?$/i;
function nameVariants(company) {
  const base = clean(company, 120).toLowerCase();
  const stripped = base.replace(SUFFIX_RE, '').trim();
  return [...new Set([base, stripped].filter(Boolean))];
}
const inList = (vals) => encodeURIComponent(vals.map((v) => `"${v.replace(/["\\]/g, '')}"`).join(','));

export async function readRecord({ supabaseUrl, serviceKey, company, role }) {
  const h = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const names = nameVariants(company);
  if (!names.length) return null;
  const [repRes, jobRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/reports?company_name=in.(${inList(names)})&${SCORABLE_REPORTS_FILTER}&select=outcome,rounds,wait_days,report_text,role,platform,ghost_stage&order=created_at.desc&limit=1000`, { headers: h }).catch(() => null),
    fetch(`${supabaseUrl}/rest/v1/jobs?company=ilike.${encodeURIComponent(names[names.length - 1])}&or=${encodeURIComponent('(salary_min.not.is.null,salary.not.is.null)')}&select=title,salary,salary_min,salary_max&limit=600`, { headers: h }).catch(() => null),
  ]);
  if (!repRes || !repRes.ok) return null;
  const reports = await repRes.json().catch(() => []);
  const jobs = jobRes && jobRes.ok ? await jobRes.json().catch(() => []) : [];
  // Pay: only from the same kind of role — a software engineer's range is never shown to a warehouse lead
  // (round 2). A role with no clear field gets the company-wide range, labelled as such.
  const fam = prepFamily(role);
  const pool = fam !== 'general' ? jobs.filter((j) => prepFamily(j.title || '') === fam) : jobs;
  const pay = payRange(pool);
  return {
    record: interviewRecord(reports, { role }),
    pay: pay ? { ...pay, scope: fam !== 'general' ? 'role' : 'company' } : null,
  };
}

async function readJson(r) { try { return await r.json(); } catch { return null; } }

/** The signed-in user's id from the Bearer token, or null — for reads that need no Pro gate. */
async function uidFromToken(req, supabaseUrl, serviceKey) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const u = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${token}` } }).catch(() => null);
  return u && u.ok ? (await readJson(u))?.id || null : null;
}

export default async function handler(req, res) {
  const _o = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', !_o || _o.includes('localhost') || ['https://seenjobs.io', 'https://www.seenjobs.io'].includes(_o) ? (_o || '*') : 'https://seenjobs.io');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body || typeof body !== 'object') body = {};
  const action = String(body.action || '');

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Server not configured' });
  const db = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });

  const company = clean(body.company, 120);
  const role = clean(body.role, 160);

  if (action === 'record') {
    if (await applyRateLimit(req, res, 'interview-record')) return;
    if (!company) return res.status(400).json({ error: 'company required' });
    const out = await readRecord({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, company, role });
    if (!out) return res.status(502).json({ error: 'Could not read reports right now' });
    const sku = ONE_TIME_SKUS.interview;
    return res.status(200).json({
      ok: true, company, role, ...out,
      follow_up: followUpPlan(clean(body.interview_at, 40)),
      offer: { sku: 'interview', name: sku.name, amount_cents: sku.amount_cents, pro_days: sku.pro_days },
    });
  }

  if (action === 'event') {
    if (await applyRateLimit(req, res, 'interview-record')) return;
    const event = String(body.event || '');
    if (!FUNNEL_EVENTS.includes(event)) return res.status(400).json({ error: 'unknown event' });
    // Who, when signed in — read from the token without failing the beacon when it is absent.
    let uid = null;
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (token) {
      const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } }).catch(() => null);
      if (u && u.ok) uid = (await readJson(u))?.id || null;
    }
    const r = await db('funnel_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: uid, event, company: company || null }) }).catch(() => null);
    // A missing table (migration not applied) is not the visitor's problem.
    return res.status(200).json({ ok: !!(r && r.ok) });
  }

  // A prep pack someone already has is theirs on every device and after their Pro days end (round 2: the
  // pack vanished on another device, and the gate ran before the cache, so a bought prep would lock).
  const readCached = async (uid) => {
    const c = await db(`interview_preps?user_id=eq.${encodeURIComponent(uid)}&prep_key=eq.${encodeURIComponent(prepKey(company, role))}&select=pack,updated_at&limit=1`).catch(() => null);
    const rows = c && c.ok ? await readJson(c) : null;
    return Array.isArray(rows) && rows[0]?.pack ? rows[0].pack : null;
  };

  if (action === 'mine') {
    if (await applyRateLimit(req, res, 'interview-record')) return;
    if (!company) return res.status(400).json({ error: 'company required' });
    const uid = await uidFromToken(req, SUPABASE_URL, SERVICE_KEY);
    if (!uid) return res.status(200).json({ ok: true, pack: null, has_resume: null });
    // Whether a résumé is on file, so the card never sells a prep it cannot build (round 2: Ray paid, then
    // got "Add your résumé first").
    const [pack, pr] = await Promise.all([
      readCached(uid),
      db(`profiles?id=eq.${encodeURIComponent(uid)}&select=resume_text&limit=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const text = Array.isArray(pr) && pr[0] ? String(pr[0].resume_text || '') : null;
    return res.status(200).json({ ok: true, pack, has_resume: text == null ? null : text.replace(/\s+/g, ' ').length >= 200 });
  }

  if (action === 'build') {
    if (await applyRateLimit(req, res, 'interview-prep')) return;
    if (!company) return res.status(400).json({ error: 'company required' });
    if (!body.refresh) {
      const owner = await uidFromToken(req, SUPABASE_URL, SERVICE_KEY);
      const cached = owner ? await readCached(owner) : null;
      if (cached) return res.status(200).json({ ok: true, cached: true, pack: cached });
    }
    // Signed in + Pro access. gateAI logs the use and never charges a credit to a Pro user.
    const gate = await gateAI(req, 'interview_prep', { proOnly: true });
    if (!gate.ok) {
      return res.status(gate.status || 402).json({ ...gate, offer: 'interview' });
    }
    const uid = gate.uid;
    const key = prepKey(company, role);

    const [profRes, recOut] = await Promise.all([
      db(`profiles?id=eq.${encodeURIComponent(uid)}&select=resume_text,name&limit=1`).catch(() => null),
      readRecord({ supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, company, role }),
    ]);
    const prof = profRes && profRes.ok ? (await readJson(profRes))?.[0] : null;
    const resumeText = String(prof?.resume_text || '');
    if (resumeText.replace(/\s+/g, ' ').length < 200) {
      return res.status(409).json({ error: 'Add your résumé first — your answers are built from it.', need_resume: true });
    }

    // The posting: the card's own listing when it has one (round 2: the model was told "JOB POSTING: not
    // provided" while Seen held the exact listing), else what the client sent.
    let jobText = clean(body.job_text, 6000);
    const jobId = String(body.job_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!jobText && jobId) {
      const jr = await db(`jobs?id=eq.${encodeURIComponent(jobId)}&select=title,company,description&limit=1`).catch(() => null);
      const job = jr && jr.ok ? (await readJson(jr))?.[0] : null;
      if (job?.description) jobText = clean(`${job.title || ''} at ${job.company || ''}\n${job.description}`, 6000);
    }
    const stage = ['Phone Screen', 'Interview', 'Final Round'].includes(body.stage) ? body.stage : '';
    const pay = recOut?.pay || null;
    let pack;
    if (llmAvailable()) {
      try {
        const { system, user } = prepPrompt({ company, role, jobText, resumeText, stage });
        const raw = await chat({ system, user, maxTokens: 2400, timeoutMs: 45000, json: true });
        pack = guardPack(raw, { company, role, resumeText, pay, stage });
      } catch (e) {
        if (!(e instanceof LLMUnavailableError)) console.error('[interview-prep] model failed, using the coached pack:', String(e?.message || e).slice(0, 160));
        pack = guardPack({}, { company, role, resumeText, pay, stage });
      }
    } else {
      pack = guardPack({}, { company, role, resumeText, pay, stage });
    }

    const name = signOffName(resumeText, clean(prof?.name, 80));
    const full = {
      company, role,
      built_at: new Date().toISOString(),
      ...pack,
      emails: prepEmails({ company, role, name }),
      record: recOut?.record || null,
      pay: recOut?.pay || null,
      follow_up: followUpPlan(clean(body.interview_at, 40)),
    };
    // Cache; a missing table only means the next open rebuilds it.
    await db('interview_preps?on_conflict=user_id,prep_key', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: uid, prep_key: key, company, role, application_id: clean(body.application_id, 80) || null, pack: full, updated_at: new Date().toISOString() }),
    }).catch(() => null);
    await db('funnel_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: uid, event: 'prep_built', company }) }).catch(() => null);
    return res.status(200).json({ ok: true, cached: false, pack: full });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
