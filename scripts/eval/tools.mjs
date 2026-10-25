// Every Pro / credit-spending tool, called IN-PROCESS through its real handler (api/*.js) with the
// fake DB from fakeDb.mjs. Each runner returns one record per (fixture, tool):
//   { tool, status, ms, charged, error, ui_reachable, output, items, meta }
// `items` is what checks.mjs reads: [{ field, kind, text, confirm? }] where kind is
//   claim        — words that will stand as the candidate's own facts (bullets, summary, intro, messages)
//   requirement  — what the tool says the posting requires
//   advice       — coaching / plan text written by Seen
//   question     — interview questions
//   structure    — parsed résumé structure (titles, employers)
//   excerpt      — verbatim posting/résumé text echoed back (not judged for traps)
import { installEnv, installFetch, callHandler, UID } from './fakeDb.mjs';

installEnv();
export const state = { pro: true, resume: '' };
installFetch(state);

const ROOT = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, ROOT).href);
const { default: resumeApi } = await imp('api/resume.js');
const { default: optimizerApi } = await imp('api/optimizer.js');
const { default: insightsApi } = await imp('api/job-insights.js');
const { default: prepApi } = await imp('api/interview-prep.js');
const { parseResume } = await imp('lib/resume/parse/index.js');
const { extractResumeFile } = await imp('lib/resume/extract/index.js');

export { parseResume, extractResumeFile };

const isGuidance = (s) => /^\s*\(/.test(String(s || ''));

/** Run one handler call and count the credits it spent. */
async function call(tool, handler, body, opts) {
  state.currentTool = tool;
  const before = state.charges.length;
  const r = await callHandler(handler, body, opts);
  r.charged = state.charges.length - before;
  return r;
}

function base(tool, r, extra = {}) {
  return {
    tool, status: r.status, ms: r.ms, charged: r.charged || 0, error: r.error || (r.status >= 500 ? JSON.stringify(r.body).slice(0, 300) : null),
    ui_reachable: true, output: null, items: [], meta: {}, ...extra,
  };
}

const push = (items, field, kind, text, extra = {}) => {
  if (text == null) return;
  const t = typeof text === 'string' ? text : JSON.stringify(text);
  items.push({ field, kind, text: t, ...extra });
};

// ── parse (text) ────────────────────────────────────────────────────────────────────────────────
export function parseItems(doc) {
  const items = [];
  for (const [i, e] of (doc.experience || []).entries()) {
    push(items, `experience[${i}].title`, 'structure', e.title || '');
    push(items, `experience[${i}].company`, 'structure', e.company || '');
    for (const [j, b] of (e.bullets || []).entries()) push(items, `experience[${i}].bullets[${j}]`, 'excerpt', b.text);
  }
  return items;
}
export function docSummary(doc) {
  return {
    name: doc.basics?.name, summary: doc.basics?.summary,
    experience: (doc.experience || []).map((e) => ({ title: e.title, company: e.company, location: e.location, start: e.start, end: e.end, bullets: (e.bullets || []).map((b) => b.text) })),
    education: (doc.education || []).map((e) => [e.degree, e.area, e.institution, e.end].filter(Boolean).join(' | ')),
    skills: (doc.skills || []).map((s) => `${s.label ? s.label + ': ' : ''}${(s.items || []).join(', ')}`),
    certifications: (doc.certifications || []).map((c) => c.name || c.title || JSON.stringify(c)),
    warnings: doc.meta?.warnings || [],
  };
}
export function runParse(fx) {
  const t0 = performance.now();
  let doc, error = null;
  try { doc = parseResume({ text: fx.resumeText, source: 'text' }); } catch (e) { error = String(e && e.stack || e); }
  const ms = Math.round(performance.now() - t0);
  if (!doc) return { tool: 'parse', status: 599, ms, charged: 0, error, ui_reachable: true, output: null, items: [], meta: {} };
  return { tool: 'parse', status: 200, ms, charged: 0, error, ui_reachable: true, output: docSummary(doc), items: parseItems(doc), meta: { doc } };
}

// ── SeenFit (free fit check) ────────────────────────────────────────────────────────────────────
function requirementItems(items, body) {
  for (const m of body.matched_requirements || []) push(items, 'matched_requirements', 'requirement', m.requirement, { anyOf: m.anyOf || null, importance: m.importance });
  for (const m of body.unsupported_requirements || []) push(items, 'unsupported_requirements', 'requirement', m.requirement, { anyOf: m.anyOf || null, importance: m.importance });
  for (const c of body.constraints || []) push(items, 'constraints', 'requirement', c.label, { importance: c.importance });
  for (const c of body.constraints || []) if (c.message) push(items, 'constraints.message', 'advice', c.message);
  if (body.verdict?.sentence) push(items, 'verdict.sentence', 'advice', body.verdict.sentence);
}
export async function runFit(fx) {
  const r = await call('fit', optimizerApi, { action: 'optimize', resumeText: fx.resumeText, jobTitle: fx.job.title, company: fx.job.company, jobDescription: fx.jd, postingPasted: true, jobId: `eval-${fx.id}`, remoteOk: /remote/i.test(fx.jd) }, { auth: false });
  const out = base('fit', r);
  const b = r.body || {};
  out.output = { verdict: b.verdict, fit_score: b.fit_score, fit_band: b.fit_band, requirement_count: b.requirement_count,
    matched: (b.matched_requirements || []).map((m) => `${m.requirement}${m.anyOf ? ` [${m.anyOf}]` : ''} ← ${String(m.evidence || '').slice(0, 90)}`),
    missing: (b.unsupported_requirements || []).map((m) => `${m.requirement}${m.anyOf ? ` [${m.anyOf}]` : ''} (${m.importance})`),
    constraints: (b.constraints || []).map((c) => `${c.status}: ${c.message}`) };
  requirementItems(out.items, b);
  return out;
}

// ── Paid optimize (1 credit) ────────────────────────────────────────────────────────────────────
export async function runOptimize(fx) {
  const body = { tool: 'optimize', resume: fx.resumeText, job: fx.job.title, company: fx.job.company, jobDescription: fx.jd, postingPasted: true, jobId: `eval-${fx.id}-${Date.now()}` };
  const probe = await call('optimize_probe', resumeApi, { ...body, probe: true });
  const r = await call('optimize', resumeApi, body);
  const out = base('optimize', r);
  out.charged += probe.charged;
  out.meta.probe = { status: probe.status, body: probe.body };
  const b = r.body || {};
  const real = (b.optimized_bullets || []).filter((x) => !isGuidance(x.original) && !isGuidance(x.optimized));
  out.output = r.status !== 200 ? { status: r.status, error: b.error, message: b.message, probe: probe.body } : {
    verdict: b.verdict?.sentence,
    rewrite_plan: (b.rewrite_plan || []).map((x) => ({ from: x.from, to: x.to, rules: x.rules })),
    optimized_bullets: (b.optimized_bullets || []).map((x) => ({ original: x.original, optimized: x.optimized, addresses: x.addresses })),
    reorder: (b.reorder || []).map((x) => x.why),
    questions: (b.questions || []).map((q) => `${q.question} → ${q.template}`),
    availability: b.availability?.text || null,
    summary: b.summary?.text || null,
    application_message: b.application_message || null,
    keywords_added: b.keywords_added, wording_notes: b.wording_notes,
    missing: (b.unsupported_requirements || []).map((m) => `${m.requirement}${m.anyOf ? ` [${m.anyOf}]` : ''}`),
  };
  for (const x of b.rewrite_plan || []) push(out.items, 'rewrite_plan.to', 'claim', x.to);
  for (const x of real) push(out.items, 'optimized_bullets.optimized', 'claim', x.optimized);
  for (const x of b.optimized_bullets || []) if (isGuidance(x.original) || isGuidance(x.optimized)) push(out.items, 'optimized_bullets.guidance', 'advice', x.optimized);
  if (b.summary?.text) push(out.items, 'summary', 'claim', b.summary.text);
  if (b.availability?.text) push(out.items, 'availability', 'claim', b.availability.text, { confirm: true });
  if (b.application_message) push(out.items, 'application_message', 'claim', b.application_message, { message: true });
  for (const q of b.questions || []) push(out.items, 'questions', 'advice', `${q.question} ${q.template}`);
  for (const x of b.reorder || []) push(out.items, 'reorder.why', 'advice', x.why);
  for (const w of b.wording_notes || []) push(out.items, 'wording_notes', 'advice', typeof w === 'string' ? w : (w.note || w.text || JSON.stringify(w)));
  requirementItems(out.items, b);
  const paidContent = (b.rewrite_plan || []).length + real.length + (b.reorder || []).length + (b.questions || []).length + (b.summary ? 1 : 0) + (b.availability ? 1 : 0);
  out.meta.paid_content = paidContent;
  out.meta.pairs = (b.rewrite_plan || []).map((x) => [x.from, x.to]);
  out.meta.body = b;
  out.meta.real_bullets = real.map((x) => x.optimized);
  return out;
}

// ── ATS scanner (legacy tool:'scanner', 1 credit — no UI caller found) ─────────────────────────
export async function runScanner(fx) {
  const r = await call('scanner', resumeApi, { tool: 'scanner', resume: fx.resumeText, job: fx.job.title, company: fx.job.company, jobDescription: fx.jd });
  const out = base('scanner', r, { ui_reachable: false });
  const b = r.body || {};
  out.output = { match_score: b.match_score, score_summary: b.score_summary, strong_keywords: b.strong_keywords, missing_keywords: b.missing_keywords, specific_fixes: b.specific_fixes, ghost_risk_note: b.ghost_risk_note };
  for (const k of b.strong_keywords || []) push(out.items, 'strong_keywords', 'requirement', k);
  for (const k of b.missing_keywords || []) push(out.items, 'missing_keywords', 'requirement', k);
  for (const f of b.specific_fixes || []) {
    if (!isGuidance(f.improved)) push(out.items, 'specific_fixes.improved', 'claim', f.improved);
    else push(out.items, 'specific_fixes.improved', 'advice', f.improved);
    if (f.note) push(out.items, 'specific_fixes.note', 'advice', f.note);
  }
  if (b.score_summary) push(out.items, 'score_summary', 'advice', b.score_summary);
  return out;
}

// ── Strategy / "advantage" (1 credit): outreach playbook + 30/60/90 plan ─────────────────────
export async function runAdvantage(fx) {
  const r = await call('advantage', resumeApi, { tool: 'advantage', resume: fx.resumeText, job: fx.job.title, company: fx.job.company, jobDescription: fx.jd });
  const out = base('advantage', r);
  const b = r.body || {};
  out.output = b;
  push(out.items, 'hiring_manager_script', 'claim', b.hiring_manager_script, { message: true });
  for (const k of ['timing_note', 'company_intel', 'cover_letter_framework', 'referral_strategy', 'opening_note', 'day_30', 'day_60', 'day_90']) push(out.items, k, 'advice', b[k]);
  return out;
}

// ── AI job insights (1 credit on a cache miss) ─────────────────────────────────────────────────
export async function runInsights(fx) {
  const body = { jobId: `eval-${fx.id}`, job: fx.job.title, company: fx.job.company, jobDescription: fx.jd, needsSummary: true };
  const probe = await call('insights_probe', insightsApi, { ...body, probe: true });
  const r = await call('insights', insightsApi, body);
  const out = base('insights', r);
  out.charged += probe.charged;
  const b = r.body || {};
  out.output = { what_they_want: b.what_they_want, hidden_requirements: b.hidden_requirements, insider_tip: b.insider_tip, _src: b._src, charged: b.charged };
  for (const w of b.what_they_want || []) push(out.items, 'what_they_want', 'requirement', w, { anyOf: /^Any of:|\(or similar\)/.test(w) ? w : null });
  for (const h of b.hidden_requirements || []) push(out.items, 'hidden_requirements', 'advice', h);
  push(out.items, 'insider_tip', 'advice', b.insider_tip);
  push(out.items, 'description_summary', 'excerpt', b.description_summary);
  return out;
}

// ── HumanProof / Human Voice (Pro) on the paid package, the way the résumé page sends it ───────
export async function runHumanProof(fx, optimizeRec) {
  const b = optimizeRec?.meta?.body || {};
  const real = optimizeRec?.meta?.real_bullets || [];
  const message = b.application_message || undefined;
  if (!real.length && !message) return { tool: 'humanproof', status: 0, ms: 0, charged: 0, error: null, ui_reachable: false, output: { skipped: 'the paid package has no bullets and no message' }, items: [], meta: {} };
  const r = await call('humanproof', optimizerApi, {
    action: 'humanize', bullets: real, applicationMessage: message,
    warnings: (b.optimized_bullets || []).filter((g) => isGuidance(g.original)).map((g) => ({ phrase: g.addresses, warning: `Add a bullet with a real detail for: ${g.addresses}` })),
    jobId: `eval-${fx.id}`, jobTitle: fx.job.title, company: fx.job.company, jobDescription: fx.jd, resumeText: fx.resumeText,
  });
  // the résumé page only offers HumanProof when the paid package has at least one real bullet
  const out = base('humanproof', r, { ui_reachable: real.length > 0 });
  const p = (r.body || {}).package || {};
  out.output = {
    bullets: (p.bullets || []).map((x) => ({ original: x.original, humanized: x.humanized_text, changes: x.changes_made })),
    application_message: p.application_message ? { original: p.application_message.original, humanized: p.application_message.humanized_text } : null,
    score: r.body?.humanproof_score, before: r.body?.before_score, after: r.body?.after_score,
  };
  for (const x of p.bullets || []) push(out.items, 'bullets.humanized', 'claim', x.humanized_text);
  if (p.application_message) push(out.items, 'application_message.humanized', 'claim', p.application_message.humanized_text, { message: true });
  out.meta.pairs = [...(p.bullets || []).map((x) => [x.original, x.humanized_text]), ...(p.application_message ? [[p.application_message.original, p.application_message.humanized_text]] : [])];
  return out;
}

// ── Résumé Studio: tailor (1 credit), ATS check (free), export (Pro = unbranded) ───────────────
export async function runTailor(fx, doc) {
  const r = await call('tailor', resumeApi, { action: 'tailor', doc, jobTitle: fx.job.title, company: fx.job.company, jobDescription: fx.jd, jobId: `eval-${fx.id}` });
  const out = base('tailor', r);
  const b = r.body || {};
  const plan = b.plan || {}, v = b.variant || {};
  const added = new Set((v.meta?.provenance || []).filter((p) => p.kind === 'transferable_bullet').map((p) => p.bulletId));
  out.output = r.status !== 200 ? { error: b.error } : {
    decisions: (plan.decisions || []).map((d) => `${d.decision} (${d.tier}) — ${d.title}${d.company ? ' @ ' + d.company : ''}: ${(d.reasons || []).slice(0, 2).join('; ')}`),
    summary: plan.summary?.text || null,
    rewrites: (plan.rewrites || []).map((x) => ({ from: x.from, to: x.to, rules: x.rules })),
    added_bullets: (v.meta?.provenance || []).filter((p) => p.kind === 'transferable_bullet').map((p) => `${p.text}  [${p.basis}]`),
    prompts: (plan.prompts || []).map((p) => `${p.roleTitle}: ${p.question}`),
    gaps: (plan.gaps || []).map((g) => `${g.requirement} (${g.level}, ${g.severity})`),
    keywords_missing: (plan.keywords?.missing || []).map((k) => k.term),
    skills_added: plan.skills?.added || [],
    variant_titles: (v.experience || []).map((e) => `${e.title}${e.company ? ' — ' + e.company : ''} (${e.bullets.length} bullets)`),
    section_titles: v.meta?.sectionTitles || {},
  };
  if (plan.summary?.text) push(out.items, 'summary', 'claim', plan.summary.text);
  for (const x of plan.rewrites || []) push(out.items, 'rewrites.to', 'claim', x.to);
  for (const e of v.experience || []) for (const bl of e.bullets || []) if (added.has(bl.id)) push(out.items, 'variant.added_bullet', 'claim', bl.text, { confirm: true });
  for (const s of plan.skills?.added || []) push(out.items, 'skills.added', 'claim', typeof s === 'string' ? s : (s.term || s.skill || JSON.stringify(s)));
  for (const g of plan.gaps || []) push(out.items, 'gaps', 'requirement', g.requirement, { importance: g.level });
  for (const k of plan.keywords?.missing || []) push(out.items, 'keywords.missing', 'requirement', k.term);
  for (const k of plan.keywords?.matched || []) push(out.items, 'keywords.matched', 'requirement', k.term, { matched: true });
  for (const p of plan.prompts || []) push(out.items, 'prompts', 'advice', p.question, { perRole: true });
  out.meta.plan = plan; out.meta.variant = v;
  out.meta.pairs = (plan.rewrites || []).map((x) => [x.from, x.to]);
  return out;
}

export async function runAtsCheck(fx, doc) {
  const res = {};
  let ms = 0, status = 200, error = null;
  for (const format of ['pdf', 'docx']) {
    const r = await call('ats_check', resumeApi, { action: 'ats_check', doc, format, template: 'classic' });
    ms += r.ms; if (r.status !== 200) { status = r.status; error = r.error || JSON.stringify(r.body).slice(0, 200); }
    const c = r.body?.check || {};
    res[format] = { score: c.score, passed: c.passed, failed: (c.checks || []).filter((x) => !x.ok).map((x) => `${x.label}: ${x.detail}`) };
  }
  const out = { tool: 'ats_check', status, ms, charged: 0, error, ui_reachable: true, output: res, items: [], meta: {} };
  for (const f of Object.keys(res)) for (const fail of res[f].failed || []) push(out.items, `${f}.failed`, 'advice', fail);
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[‐-―]/g, '-').replace(/[^a-z0-9%$+#]+/g, '');
/** Export a doc, re-extract it with the repo's own extractor, and say which bullets did not come back. */
export async function roundTrip(doc, { format, pro, template = 'classic' }) {
  state.pro = pro;
  const r = await call('export', resumeApi, { action: 'export', doc, format, template });
  state.pro = true;
  if (r.status !== 200 || !Buffer.isBuffer(r.body)) return { format, pro, status: r.status, error: r.error || (r.body && r.body.error) || 'no file', ms: r.ms };
  const ex = await extractResumeFile({ buffer: r.body, fileName: `resume.${format}` });
  const text = ex.ok ? ex.text : '';
  const flat = norm(text);
  const bullets = (doc.experience || []).flatMap((e) => (e.bullets || []).map((b) => b.text));
  const missing = bullets.filter((b) => !flat.includes(norm(b)));
  const branded = /\bSeen\b|seenjobs/i.test(text);
  return { format, pro, status: r.status, ms: r.ms, pages: r.headers['x-seen-pages'], branded, header_branded: r.headers['x-seen-branded'], bullets: bullets.length, missing, extracted_ok: ex.ok };
}
export async function runExport(fx, doc, tailorRec) {
  const t0 = performance.now();
  const checks = [];
  for (const [label, d] of [['base', doc], ['tailored', tailorRec?.meta?.variant]]) {
    if (!d || !d.experience) continue;
    for (const format of ['pdf', 'docx']) for (const pro of [true, false]) checks.push({ doc: label, ...(await roundTrip(d, { format, pro })) });
  }
  // legacy "Download résumé" (ApplyOptimizeModal) — PDF from the résumé text
  state.pro = true;
  const dl = await call('download_resume', resumeApi, { action: 'download_resume', resume: fx.resumeText, job: fx.job.title, company: fx.job.company, jobDescription: fx.jd });
  let legacy = { status: dl.status };
  if (dl.status === 200) {
    const buf = Buffer.isBuffer(dl.body) ? dl.body : (dl.body && dl.body.pdf ? Buffer.from(dl.body.pdf, 'base64') : null);
    if (buf) {
      const ex = await extractResumeFile({ buffer: buf, fileName: 'resume.pdf' });
      const flat = norm(ex.text);
      const bullets = (doc.experience || []).flatMap((e) => e.bullets.map((b) => b.text));
      legacy = { status: 200, missing: bullets.filter((b) => !flat.includes(norm(b))), bullets: bullets.length, branded: /\bSeen\b|seenjobs/i.test(ex.text || '') };
    } else legacy = { status: 200, note: `unexpected body ${typeof dl.body}` };
  }
  const out = { tool: 'export', status: checks.every((c) => c.status === 200) ? 200 : (checks.find((c) => c.status !== 200)?.status || 500), ms: Math.round(performance.now() - t0), charged: 0, error: checks.find((c) => c.error)?.error || null, ui_reachable: true, output: { checks, legacy_download: legacy }, items: [], meta: { checks, legacy } };
  return out;
}

// ── Interview Prep — the coached pack users get when the model is not available or fails ───────
export async function runPrepFallback(fx) {
  state.resume = fx.resumeText;
  const r = await call('interview_prep_fallback', prepApi, { action: 'build', company: fx.job.company, role: fx.job.title, refresh: true });
  const out = base('interview_prep_fallback', r);
  const p = r.body?.pack || {};
  out.output = prepOutput(p);
  prepItems(out.items, p);
  out.meta.family = p.family;
  return out;
}
export function prepOutput(p) {
  return {
    family: p.family, model: p.model, dropped: p.dropped,
    questions: (p.questions || []).map((q) => `${q.q} — ${q.why}`),
    answers: (p.answers || []).map((a) => ({ q: a.q, answer: a.answer, resume_fact: a.resume_fact, coached: !!a.coached })),
    intro: p.intro || null, sign_off: p.emails?.thankYou?.body?.split('\n').pop() || null,
  };
}
export function prepItems(items, p) {
  for (const q of p.questions || []) { push(items, 'questions.q', 'question', q.q); push(items, 'questions.why', 'advice', q.why); }
  for (const a of p.answers || []) {
    push(items, 'answers.answer', a.coached ? 'advice' : 'claim', a.answer);
    push(items, 'answers.resume_fact', 'excerpt', a.resume_fact, { isFact: true });
  }
  if (p.intro) push(items, 'intro', 'claim', p.intro, { message: true });
}

// ── Upload path: hanging-indent PDF → api/resume.js action:'parse' (the real upload handler) ───
export async function runParsePdf(fx) {
  const { renderHangingIndentPdf } = await import('./pdfFixtures.mjs');
  const buf = await renderHangingIndentPdf(fx.resumeText);
  const r = await call('parse_pdf', resumeApi, { action: 'parse', base64: buf.toString('base64'), fileName: `${fx.id}.pdf`, mimeType: 'application/pdf' });
  const out = base('parse_pdf', r);
  const doc = r.body?.doc;
  out.meta.layout = r.body?.layout || null;
  out.meta.pdf_bytes = buf.length;
  if (!doc) { out.output = { error: r.body?.error || 'no doc' }; return out; }
  out.output = { layout_method: r.body?.layout?.method, ...docSummary(doc) };
  out.items = parseItems(doc);
  out.meta.doc = doc;
  return out;
}

export const IN_PROCESS_TOOLS = ['parse', 'fit', 'optimize', 'scanner', 'advantage', 'insights', 'humanproof', 'tailor', 'ats_check', 'export', 'interview_prep_fallback'];
export { UID };
