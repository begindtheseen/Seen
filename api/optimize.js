// /api/optimize — Seen's résumé optimizer. No model API (owner decision 2026-10-26: "We are not relying
// on api"): the diagnosis and every rewrite are Seen's own code — lib/resume/optimize/local.js builds them
// from the posting reader, the fact sheet, the rule-based rewriter and the person's answers, and
// lib/resume/optimize/engine.js + claims.js check every line. The old optimize tool in api/resume.js is
// untouched until the new screen replaces it.
//
//   POST { action:'diagnose', resume, job, company, jobDescription, jobId? }
//        → { diagnosis } — the bullet ladder, the requirement map, up to 6 questions, honest gaps. Free
//          (signed in, rate-limited); cached per (user, résumé, posting).
//   POST { action:'rewrite', resume, job, company, jobDescription, jobId?, answers:[{id, answer}] }
//        → { proposals, summary, skills, … } — 1 credit (Pro: free) on a fresh build; the same inputs
//          reopen free from the cache. Needs a diagnosis first (the questions and plan come from it).
//   POST { action:'decide', key, accepted:[bulletId], rejected:[bulletId] } → records the person's
//        decisions (facts only) so later versions can learn which changes people keep.
//
// Every run is stored in public.optimizer_runs (service-role only, deleted with the account): the
// diagnosis and the proposals — the person's own résumé lines and Seen's suggestions — so the
// cache works and, later, what people accepted and what got interviews can train Seen's own model.

import { createHash } from 'node:crypto';
import { applyRateLimit } from '../lib/server/ratelimit.js';
import { logError } from '../lib/server/errlog.js';
import { gateAI, resolveAuthedUser } from '../lib/server/credits.js';
import { previewOnlyError } from '../lib/server/postingGate.js';
import { isReadableResume } from '../lib/server/resumeReadability.js';
import { canonicalResumeText } from '../lib/resume/canonical.js';
import { loadSkillTaxonomy } from '../lib/server/skillTaxonomy.js';
import { unoptimizableListing } from '../lib/server/optimizePackage.js';
import { textHash } from '../lib/server/optimizeCache.js';
import { OPTIMIZER_V3, gapsAfterAnswers, buildContext } from '../lib/resume/optimize/engine.js';
import { localDiagnosis, localRewrite } from '../lib/resume/optimize/local.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
// A posting keeps its lines: its sections ("What we're looking for") are how Seen reads requirements.
const cleanText = (s, n) => String(s || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n);
const CACHE_DAYS = 7;

function db(path, opts = {}) {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!URL || !KEY) return null;
  return fetch(`${URL}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}
async function readRun(uid, key) {
  try {
    const since = new Date(Date.now() - CACHE_DAYS * 86400e3).toISOString();
    const r = await db(`optimizer_runs?user_id=eq.${encodeURIComponent(uid)}&job_id=eq.${encodeURIComponent(key)}&created_at=gte.${encodeURIComponent(since)}&select=output,created_at&order=created_at.desc&limit=1`);
    if (!r || !r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) && rows[0]?.output ? rows[0] : null;
  } catch { return null; }
}
async function writeRun(uid, key, output) {
  try {
    const r = await db('optimizer_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: uid, job_id: key, output }) });
    return !!(r && r.ok);
  } catch { return false; }
}

export function sessionKey({ uid, resume, jobDescription, jobId }) {
  return `v3:${sha([OPTIMIZER_V3, uid, jobId || '', textHash(jobDescription), textHash(resume)].join('|')).slice(0, 40)}`;
}
const answersKey = (answers) => textHash(JSON.stringify((answers || []).map((a) => [a.id, clean(a.answer, 300)]).sort()));

async function inputs(req, res, body) {
  const authed = await resolveAuthedUser(req);
  if (!authed?.uid) { res.status(401).json({ error: 'Sign in to optimize your résumé', credits_required: true }); return null; }
  if (!body.resume) { res.status(400).json({ error: 'Resume required' }); return null; }
  if (!isReadableResume(body.resume)) { res.status(400).json({ error: 'RESUME_CORRUPTED' }); return null; }
  const preview = previewOnlyError(body);
  if (preview) { res.status(preview.status).json({ ...preview.body, charged: false }); return null; }
  const resume = canonicalResumeText(body.resume);
  const jobDescription = cleanText(body.jobDescription, 12000);
  const job = clean(body.job, 160);
  const company = clean(body.company, 120);
  const taxonomy = await loadSkillTaxonomy().catch(() => null);
  const unopt = unoptimizableListing({ resume, jobDescription, job, company, taxonomy });
  if (unopt) { res.status(422).json({ error: 'no_requirements', ...unopt, cost: 0, charged: false }); return null; }
  return { uid: authed.uid, resume, jobDescription, job, company, jobId: clean(body.jobId, 80), taxonomy };
}

function diagnose(inp) {
  const ctx = buildContext({ resumeText: inp.resume, jobTitle: inp.job, company: inp.company, jobDescription: inp.jobDescription, taxonomy: inp.taxonomy });
  return { ctx, diagnosis: { ...localDiagnosis(ctx), model: false } };
}

export default async function handler(req, res) {
  const body = (typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : req.body) || {};
  if (req.method !== 'POST' && req.method !== 'OPTIONS') return res.status(405).json({ error: 'POST only' });
  const action = String(body.action || '');
  try {
    if (action === 'diagnose') {
      if (await applyRateLimit(req, res, 'optimize-diagnose')) return;
      const inp = await inputs(req, res, body);
      if (!inp) return;
      const key = sessionKey({ uid: inp.uid, resume: inp.resume, jobDescription: inp.jobDescription, jobId: inp.jobId });
      const hit = body.fresh ? null : await readRun(inp.uid, `${key}:d`);
      if (hit) return res.status(200).json({ ok: true, key, cached: true, diagnosis: hit.output.diagnosis });
      const { diagnosis } = diagnose(inp);
      await writeRun(inp.uid, `${key}:d`, { version: OPTIMIZER_V3, job: inp.job, company: inp.company, diagnosis });
      return res.status(200).json({ ok: true, key, cached: false, diagnosis });
    }

    if (action === 'rewrite') {
      if (await applyRateLimit(req, res, 'optimize-rewrite')) return;
      const inp = await inputs(req, res, body);
      if (!inp) return;
      const key = sessionKey({ uid: inp.uid, resume: inp.resume, jobDescription: inp.jobDescription, jobId: inp.jobId });
      const d = await readRun(inp.uid, `${key}:d`);
      if (!d?.output?.diagnosis) return res.status(409).json({ error: 'diagnose_first', charged: false });
      const diagnosis = d.output.diagnosis;
      // Answers are matched to the server's own questions; free text only, never more than asked.
      const byId = new Map(diagnosis.questions.map((q) => [q.id, q]));
      const answers = (Array.isArray(body.answers) ? body.answers : [])
        .map((a) => ({ q: byId.get(String(a?.id)), answer: clean(a?.answer, 300) }))
        .filter((a) => a.q && a.answer && !/^(?:skip|n\/?a|not sure|don'?t know|idk)$/i.test(a.answer))
        .map(({ q, answer }) => ({ id: q.id, bullet: q.bullet, ask: q.ask, answer }));
      const rkey = `${key}:r:${answersKey(answers)}`;
      const hit = body.fresh ? null : await readRun(inp.uid, rkey);
      if (hit) return res.status(200).json({ ok: true, key, cached: true, charged: false, ...hit.output.result });
      const gate = await gateAI(req, 'resume_optimize');
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error, credits_required: gate.credits_required, pro_required: gate.pro_required, balance: gate.balance ?? 0, charged: false });

      const ctx = buildContext({ resumeText: inp.resume, jobTitle: inp.job, company: inp.company, jobDescription: inp.jobDescription, taxonomy: inp.taxonomy });
      const gated = localRewrite(ctx, diagnosis, answers);
      const result = {
        version: OPTIMIZER_V3,
        proposals: gated.proposals,
        summary: gated.summary,
        skills: gated.skills,
        order: diagnosis.bullets.filter((b) => b.action === 'move_up').map((b) => b.id),
        cut: diagnosis.bullets.filter((b) => b.action === 'cut').map((b) => ({ id: b.id, why: b.why })),
        gaps: gapsAfterAnswers(diagnosis.gaps, answers),
        requirements: diagnosis.requirements,
        answered: answers.map((a) => a.id),
        rejected_count: gated.rejected.length,
        // What Seen considered and refused, and why — shown so the person can see nothing was slipped in.
        refused: gated.rejected.filter((r) => r.text).slice(0, 20).map((r) => ({ id: r.id, text: r.text, reason: clean(r.reason, 200) })),
        model: false,
      };
      await writeRun(inp.uid, rkey, { version: OPTIMIZER_V3, job: inp.job, company: inp.company, answers, result, rejected: gated.rejected });
      return res.status(200).json({ ok: true, key, cached: false, charged: !gate.pro, pro: !!gate.pro, balance: gate.balance, ...result });
    }

    if (action === 'decide') {
      if (await applyRateLimit(req, res, 'optimize-rewrite')) return;
      const authed = await resolveAuthedUser(req);
      if (!authed?.uid) return res.status(401).json({ error: 'Sign in' });
      const key = clean(body.key, 80);
      if (!/^v3:[a-f0-9]{40}$/.test(key)) return res.status(400).json({ error: 'Bad key' });
      const ids = (x) => (Array.isArray(x) ? x : []).map(String).filter((s) => /^J\d+\.(?:\d+|new\d+)$|^summary$/.test(s)).slice(0, 80);
      const saved = await writeRun(authed.uid, `${key}:decision`, { version: OPTIMIZER_V3, accepted: ids(body.accepted), rejected: ids(body.rejected), at: new Date().toISOString() });
      return res.status(200).json({ ok: true, saved });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    const ref = logError('optimize', err, { action });
    return res.status(500).json({ error: 'Something went wrong — nothing was charged.', ref, charged: false });
  }
}
