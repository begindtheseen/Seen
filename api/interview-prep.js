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
//   POST {action:'preview', company, role, stage?} signed in, no gate, no model, no cost: a free taste of the
//                                                  prep before the ask — 2 questions for the role and 1
//                                                  coached story from the person's own résumé, built by the
//                                                  same deterministic path the paid pack falls back to
//                                                  (guardPack with no model output). {questions, answer,
//                                                  has_resume}; answer is null without a résumé.
//   POST {action:'stash', company, role, application_id?, job_text}
//                                                  signed in, free: the posting pasted BEFORE checkout, kept on
//                                                  the server so it is there on the build whatever device or
//                                                  browser comes back from Stripe (round 4: "it is kept if you
//                                                  buy" sat over a box that was thrown away).
//   POST {action:'fill', company, role, q, values}   signed in: the person's words for one answer's blanks (or
//                                                  the intro / an email: q = __intro__ | __thankyou__ |
//                                                  __followup__), saved with the prep.
//   POST {action:'event', event, company?, surface?, sku?}
//                                                  funnel counters (funnel_events) — lib/server/funnelEvents.js
//                                                  holds the allow-listed names, surfaces and SKUs.

import { applyRateLimit } from '../lib/server/ratelimit.js';
import { gateAI } from '../lib/server/credits.js';
import { localPack } from '../lib/server/prepLocal.js';
import { SCORABLE_REPORTS_FILTER } from '../lib/server/reportCounts.js';
import { ONE_TIME_SKUS } from '../lib/server/creditRules.js';
import {
  interviewRecord, payRange, followUpPlan, guardPack, fallbackPack, prepEmails, prepKey, signOffName, prepFamily,
} from '../lib/server/interviewPrep.js';
import { CLIENT_EVENTS, funnelRow, recordFunnelEvent } from '../lib/server/funnelEvents.js';
import { guideFor } from '../lib/server/interviewGuides.js';
import { carryFills, fillTarget, SPECIAL_FILL_KEYS } from '../lib/server/prepFills.js';

/** The events a browser may post here (checkout and build steps are written by the server). */
export const FUNNEL_EVENTS = CLIENT_EVENTS;

/** The same readable-résumé bar the build and `mine` use: at least 200 characters of text. */
const readableResume = (text) => String(text || '').replace(/\s+/g, ' ').length >= 200;

/**
 * The free preview, from the deterministic pack only (no model, no cost): the first 2 role questions from
 * the field bank (never the generic openers) and the first coached story from the résumé. Pure.
 */
export function previewFrom({ company, role, resumeText, stage = '' }) {
  const hasResume = readableResume(resumeText);
  const text = hasResume ? String(resumeText) : '';
  const guide = guideFor(company, role);
  // the same engine as the paid pack, so a phone screen previews recruiter questions and a company Seen knows
  // previews one of ITS questions (round 3: the preview ignored the stage and said nothing about the company)
  const local = localPack({ company, role, resumeText: text, stage });
  const openers = /^(?:Tell me about yourself|Why do you want to work at|What questions do you have)/;
  const pool = local.questions.filter((q) => !openers.test(q.q));
  const companyQ = pool.find((q) => q.company);
  const rest = pool.filter((q) => q !== companyQ);
  const questions = [...(companyQ ? [companyQ] : []), ...rest].slice(0, companyQ ? 3 : 2).map((q) => ({ q: q.q, why: q.why, ...(q.company ? { company: true } : {}) }));
  const a = hasResume ? local.answers.find((x) => !x.frame && !x.script) || null : null;
  return {
    questions,
    answer: a ? { q: a.q, answer: a.answer, resume_fact: a.resume_fact } : null,
    has_resume: hasResume,
    total_questions: local.questions.filter((q) => !q.exercise).length,
    practice_items: local.questions.filter((q) => q.exercise).length,
    guide: guide ? { company: guide.company, format: guide.format, framework: guide.framework, questions: guide.questions.length } : null,
  };
}

const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
// A posting keeps its lines: its sections ("What we're looking for") are how Seen reads requirements.
const cleanText = (s, n) => String(s || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n);
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
  const unit = /^(?:software_engineering|data_analytics|marketing|finance_accounting|education|project_management)$/.test(fam) ? { unit: 'year' } : {};
  let pay = payRange(pool, unit);
  let scope = pay ? (fam !== 'general' ? 'role' : 'company') : null;
  // too few of the company's own listings state pay (round 3: Amazon, Grubhub, Stripe all null) → the same
  // title at other employers on Seen, labelled as that, never as the company's pay
  const core = String(role || '').replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,\s/)[0].toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !/^(?:and|the|for|part|time|full)$/.test(w)).slice(0, 3);
  if (!pay && core.length) {
    const mRes = await fetch(`${supabaseUrl}/rest/v1/jobs?title=ilike.${encodeURIComponent(`*${core.join('*')}*`)}&or=${encodeURIComponent('(salary_min.not.is.null,salary.not.is.null)')}&select=title,salary,salary_min,salary_max&limit=600`, { headers: h }).catch(() => null);
    const market = mRes && mRes.ok ? await mRes.json().catch(() => []) : [];
    pay = payRange(fam !== 'general' ? market.filter((j) => prepFamily(j.title || '') === fam) : market, unit);
    if (pay) scope = 'market';
  }
  return {
    record: interviewRecord(reports, { role }),
    pay: pay ? { ...pay, scope } : null,
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
    const guide = guideFor(company, role);
    return res.status(200).json({
      ok: true, company, role, ...out,
      guide: guide ? { company: guide.company, format: guide.format, framework: guide.framework, questions: guide.questions.length, confidence: guide.confidence } : null,
      // one of the company's own questions, free, for the guest card too (round 4, Ray: the guest preview
      // showed only the pay question while the signed-in one named three Amazon questions)
      sample_question: guide && guide.questions[0] ? { q: guide.questions[0].q, why: guide.questions[0].why, principle: guide.questions[0].principle || null } : null,
      follow_up: followUpPlan(clean(body.interview_at, 40)),
      offer: { sku: 'interview', name: sku.name, amount_cents: sku.amount_cents, pro_days: sku.pro_days },
    });
  }

  if (action === 'event') {
    if (await applyRateLimit(req, res, 'interview-record')) return;
    const row = funnelRow({ event: body.event, company, surface: body.surface, sku: body.sku }, { client: true });
    if (!row) return res.status(400).json({ error: 'unknown event' });
    // Who, when signed in — read from the token without failing the beacon when it is absent.
    row.user_id = await uidFromToken(req, SUPABASE_URL, SERVICE_KEY);
    // A missing table or column (migration not applied) is not the visitor's problem.
    return res.status(200).json({ ok: await recordFunnelEvent(db, row) });
  }

  if (action === 'preview') {
    if (await applyRateLimit(req, res, 'interview-record')) return;
    if (!company) return res.status(400).json({ error: 'company required' });
    const uid = await uidFromToken(req, SUPABASE_URL, SERVICE_KEY);
    if (!uid) return res.status(401).json({ error: 'Sign in to see your preview' });
    const pr = await db(`profiles?id=eq.${encodeURIComponent(uid)}&select=resume_text&limit=1`).catch(() => null);
    const rows = pr && pr.ok ? await readJson(pr) : null;
    const resumeText = Array.isArray(rows) && rows[0] ? String(rows[0].resume_text || '') : '';
    const stage = ['Phone Screen', 'Interview', 'Final Round'].includes(body.stage) ? body.stage : '';
    return res.status(200).json({ ok: true, ...previewFrom({ company, role, resumeText, stage }) });
  }

  // A prep pack someone already has is theirs on every device and after their Pro days end (round 2: the
  // pack vanished on another device, and the gate ran before the cache, so a bought prep would lock).
  // The row may hold only a stash (pack.pending: the posting pasted before checkout) — that is not a prep.
  const readRow = async (uid) => {
    const c = await db(`interview_preps?user_id=eq.${encodeURIComponent(uid)}&prep_key=eq.${encodeURIComponent(prepKey(company, role))}&select=pack,updated_at&limit=1`).catch(() => null);
    const rows = c && c.ok ? await readJson(c) : null;
    return Array.isArray(rows) && rows[0]?.pack ? rows[0].pack : null;
  };
  const readCached = async (uid) => { const p = await readRow(uid); return p && !p.pending ? p : null; };

  if (action === 'stash') {
    if (await applyRateLimit(req, res, 'interview-record')) return;
    if (!company) return res.status(400).json({ error: 'company required' });
    const uid = await uidFromToken(req, SUPABASE_URL, SERVICE_KEY);
    if (!uid) return res.status(401).json({ error: 'Sign in' });
    const jobText = cleanText(body.job_text, 6000);
    const row = await readRow(uid);
    // a built prep keeps its own posting; a stash only fills the gap before the first build
    if (row && !row.pending) return res.status(200).json({ ok: true, kept: false, reason: 'prep exists' });
    if (!jobText) {
      if (row?.pending) await db(`interview_preps?user_id=eq.${encodeURIComponent(uid)}&prep_key=eq.${encodeURIComponent(prepKey(company, role))}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => null);
      return res.status(200).json({ ok: true, kept: false });
    }
    const w = await db('interview_preps?on_conflict=user_id,prep_key', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: uid, prep_key: prepKey(company, role), company, role, application_id: clean(body.application_id, 80) || null, pack: { pending: true, job_text: jobText, stashed_at: new Date().toISOString() }, updated_at: new Date().toISOString() }),
    }).catch(() => null);
    return res.status(w && w.ok ? 200 : 502).json(w && w.ok ? { ok: true, kept: true } : { error: 'Could not keep the posting right now' });
  }

  if (action === 'mine') {
    if (await applyRateLimit(req, res, 'interview-record')) return;
    if (!company) return res.status(400).json({ error: 'company required' });
    const uid = await uidFromToken(req, SUPABASE_URL, SERVICE_KEY);
    if (!uid) return res.status(200).json({ ok: true, pack: null, has_resume: null });
    // Whether a résumé is on file, so the card never sells a prep it cannot build (round 2: Ray paid, then
    // got "Add your résumé first").
    const [row, pr] = await Promise.all([
      readRow(uid),
      db(`profiles?id=eq.${encodeURIComponent(uid)}&select=resume_text&limit=1`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    const text = Array.isArray(pr) && pr[0] ? String(pr[0].resume_text || '') : null;
    const pack = row && !row.pending ? row : null;
    // the posting stashed before checkout, so the card can build with it the moment Pro is on
    return res.status(200).json({ ok: true, pack, pending_job_text: !pack && row?.pending ? String(row.job_text || '') : '', has_resume: text == null ? null : text.replace(/\s+/g, ' ').length >= 200 });
  }

  if (action === 'build') {
    if (await applyRateLimit(req, res, 'interview-prep')) return;
    if (!company) return res.status(400).json({ error: 'company required' });
    let prior = null;
    let priorJobText = '';
    {
      const owner = await uidFromToken(req, SUPABASE_URL, SERVICE_KEY);
      const row = owner ? await readRow(owner) : null;
      const cached = row && !row.pending ? row : null;
      if (cached && !body.refresh) return res.status(200).json({ ok: true, cached: true, pack: cached });
      // a rebuild keeps what the person already typed (pinned to the sentence it finished — prepFills.js), and
      // the posting they pasted before: on the earlier build, or stashed before checkout
      if (cached) prior = cached;
      if (row) priorJobText = String(row.job_text || '');
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
    let jobText = cleanText(body.job_text, 6000) || priorJobText;
    const jobId = String(body.job_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!jobText && jobId) {
      const jr = await db(`jobs?id=eq.${encodeURIComponent(jobId)}&select=title,company,description&limit=1`).catch(() => null);
      const job = jr && jr.ok ? (await readJson(jr))?.[0] : null;
      if (job?.description) jobText = clean(`${job.title || ''} at ${job.company || ''}\n${job.description}`, 6000);
    }
    const stage = ['Phone Screen', 'Interview', 'Final Round'].includes(body.stage) ? body.stage : '';
    const pay = recOut?.pay || null;
    // Seen's own engine, no model API (owner decision 2026-10-26): résumé lines told out loud, the
    // posting's requirements and your answer to each, questions to ask them.
    const pack = localPack({ company, role, resumeText, jobText, pay, stage });

    const name = signOffName(resumeText, clean(prof?.name, 80));
    const full = {
      company, role,
      built_at: new Date().toISOString(),
      ...pack,
      emails: prepEmails({ company, role, name }),
      record: recOut?.record || null,
      pay: recOut?.pay || null,
      follow_up: followUpPlan(clean(body.interview_at, 40)),
      // the posting the prep was built from (so "Add the posting and rebuild" works on any device), and the
      // person's own words for the blanks, keyed by question
      job_text: jobText || '',
      // the posting's own pay, when it states one, shown beside Seen's range from other employers
      posting_pay: pack.posting_pay || null,
      fills: {},
      notes: {},
    };
    if (prior) { const carried = carryFills(prior, full); full.fills = carried.fills; full.notes = carried.notes; }
    // Cache; a missing table only means the next open rebuilds it.
    await db('interview_preps?on_conflict=user_id,prep_key', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: uid, prep_key: key, company, role, application_id: clean(body.application_id, 80) || null, pack: full, updated_at: new Date().toISOString() }),
    }).catch(() => null);
    await db('funnel_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: uid, event: 'prep_built', company }) }).catch(() => null);
    return res.status(200).json({ ok: true, cached: false, pack: full });
  }

  // POST {action:'fill', company, role, q, values:[…]} — the person's words for one answer's blanks, saved with
  // the prep so the finished answer is theirs on every device. Values are plain text, bounded; the prep must exist.
  if (action === 'fill') {
    if (await applyRateLimit(req, res, 'interview-record')) return;
    if (!company) return res.status(400).json({ error: 'company required' });
    const uid = await uidFromToken(req, SUPABASE_URL, SERVICE_KEY);
    if (!uid) return res.status(401).json({ error: 'Sign in' });
    const q = clean(body.q, 240);
    const values = (Array.isArray(body.values) ? body.values : []).slice(0, 6).map((v) => cleanText(v, 400));
    if (!q) return res.status(400).json({ error: 'q required' });
    const cached = await readCached(uid);
    if (!cached) return res.status(404).json({ error: 'No prep yet' });
    if (fillTarget(cached, q) == null && !SPECIAL_FILL_KEYS.includes(q)) return res.status(400).json({ error: 'Not a question in this prep' });
    const fills = { ...(cached.fills && typeof cached.fills === 'object' ? cached.fills : {}) };
    if (values.some((v) => v)) fills[q] = values; else delete fills[q];
    // the person's own words replace a note for the same question
    const notes = { ...(cached.notes && typeof cached.notes === 'object' ? cached.notes : {}) };
    delete notes[q];
    const pack = { ...cached, fills, notes };
    const w = await db(`interview_preps?user_id=eq.${encodeURIComponent(uid)}&prep_key=eq.${encodeURIComponent(prepKey(company, role))}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ pack, updated_at: new Date().toISOString() }),
    }).catch(() => null);
    if (!w || !w.ok) return res.status(502).json({ error: 'Could not save right now' });
    return res.status(200).json({ ok: true, fills });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
