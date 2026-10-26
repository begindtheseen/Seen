// Seen's résumé optimizer, v3 (2026-10-25). Reasons like a strong recruiter-writer, writes only what is
// true. Specification: scratchpad research3/resume-science.md §9 — the evidence says the measurable gain
// from software help is clean, clear writing (Wiles et al.: +8% hires), that invented metrics are what
// recruiters punish, that mirroring a posting's words has lost its value since LLMs, and that the best
// human writers ASK before they write.
//
// Two steps, both deterministic around one model pass each:
//   1. diagnose — read the posting (lib/optimizer runOptimizer: requirements, importance, evidence,
//      constraints), number every fact on the résumé (lib/server/prepFacts.js), check every bullet's
//      grammar, then the model places each bullet on the quality ladder (L0 duty → L4 outcome with
//      stakes), maps the posting's requirements to the person's evidence, and plans at most 6 questions
//      that would let a bullet climb. Free.
//   2. rewrite — with the person's answers (facts too, cited as a:<question id>), the model rewrites the
//      bullets the plan marked, writes a summary and the skills the evidence supports; a second pass
//      fact-checks each line against the facts it cites; then every line passes Seen's gates (grammar
//      and tense for that job, numbers and named things traced to cited facts, no claim words, no
//      intensified verbs, no AI tells, not a word swap). What fails is dropped, never shipped.

import { factSheet, factSheetText, bulletById } from '../../server/prepFacts.js';
import { claimsOk, digitize, stripDurations } from '../../server/prepClaims.js';
import { prepFamily } from '../../server/interviewPrep.js';
import { runOptimizer } from '../../optimizer/index.js';
import { checkBullet, checkSummary, verbBase } from './grammar.js';
import { verifyRewrite, contentWords } from './verify.js';
import { playbookFor, AI_TELL_RE, verbStrength } from './playbooks.js';

export const OPTIMIZER_V3 = 'optimizer_v3.1';
const lc = (s) => String(s || '').toLowerCase();
const clean = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ── 1. Context (deterministic) ───────────────────────────────────────────────────────────────────
export function buildContext({ resumeText, jobTitle = '', company = '', jobDescription = '', nowMs = Date.now(), taxonomy = null } = {}) {
  const sheet = factSheet(resumeText, nowMs);
  let fit = null;
  try { fit = runOptimizer({ resumeText: String(resumeText || ''), jobTitle: jobTitle || undefined, company: company || undefined, jobDescription: jobDescription || '' }, { taxonomy: taxonomy || undefined }); } catch { fit = null; }
  const family = prepFamily(jobTitle);
  const playbook = playbookFor(family, jobTitle);
  const requirements = [
    ...(fit?.matched_requirements || []).map((r) => ({ label: r.requirement, importance: r.importance, hard: !!r.hard, evidence: r.evidence ? clean(r.evidence, 220) : null, posting: clean(r.postingEvidence, 220) })),
    ...(fit?.unsupported_requirements || []).map((r) => ({ label: r.requirement, importance: r.importance, hard: !!r.hard, evidence: null, posting: clean(r.postingEvidence, 220) })),
  ];
  const constraints = (fit?.constraints || []).map((c) => ({ kind: c.kind, label: c.label, status: c.status, message: clean(c.message, 240) }));
  const lint = {};
  for (const j of sheet.jobs) for (const b of j.bullets) {
    const g = checkBullet(b.text, { current: j.current });
    lint[b.id] = g.issues.map((i) => i.code);
  }
  return { resumeText: String(resumeText || ''), jobTitle, company, jobDescription: String(jobDescription || ''), nowMs, sheet, fit, family, playbook, requirements, constraints, lint };
}

function playbookText(pb) {
  const lines = [`FIELD PLAYBOOK — ${pb.label} (what hiring managers in this field look for; NOT facts about the person):`,
    `- Screens for: ${pb.screens_for}`,
    `- Evidence they trust: ${pb.evidence.join('; ')}`,
    `- Seniority signals: ${pb.seniority.join('; ')}`,
    `- Red flags: ${pb.red_flags.join('; ')}`,
    `- Worth asking about: ${pb.ask_about.join('; ')}`];
  if (pb.management) lines.push(`- This role runs people: also ${pb.management.screens_for}.`);
  return lines.join('\n');
}

function postingText(ctx) {
  const req = ctx.requirements.map((r) => `- ${r.label} (${r.importance || 'listed'}${r.hard ? ', a hard requirement' : ''}) — posting: "${r.posting || ''}"${r.evidence ? ` — résumé evidence: "${r.evidence}"` : ' — no résumé evidence found'}`);
  const con = ctx.constraints.map((c) => `- ${c.kind}: ${c.label} (${c.status})`);
  return [`TARGET JOB: ${clean(ctx.jobTitle, 160)} at ${clean(ctx.company, 120)}`,
    req.length ? `REQUIREMENTS READ FROM THE POSTING:\n${req.join('\n')}` : 'REQUIREMENTS: the posting states none Seen could read.',
    con.length ? `SCREENING CONSTRAINTS:\n${con.join('\n')}` : '',
    ctx.jobDescription ? `POSTING TEXT (may be partial):\n<<<\n${ctx.jobDescription.slice(0, 5000)}\n>>>` : ''].filter(Boolean).join('\n\n');
}

const CORE_RULES = [
  'The FACT SHEET and the person\'s ANSWERS are the only truth about the person. Never add a number, employer, tool, credential, title, date, team size, scope, result or recognition they do not state.',
  'Optimize for a human hiring manager reading for 7 seconds and for what the person can defend in an interview — not for keyword counts. Use the posting\'s words only where they are true for this person.',
  'A bullet climbs the ladder only as far as its facts allow: L0 duty ("Responsible for X") → L1 action → L2 specific (what, for whom, how many, with what) → L3 outcome (result, recognition, comparison) → L4 outcome with stakes. To climb further, ASK.',
  'Never intensify: "helped" never becomes "led", "assisted" never becomes "managed", team results never become personal.',
  'No AI house words or grand verbs: spearheaded, orchestrated, leveraged, utilized, seamlessly, robust, dynamic, passionate, results-driven, proven track record, innovative, fostered, championed.',
];

/** Step 1 prompt: ladder, evidence map, plan, questions. */
export function diagnosePrompt(ctx) {
  const system = ['You are a senior recruiter and résumé writer for this field. You diagnose a résumé against one job and plan an honest rewrite. Output ONLY a JSON object.', 'Rules:', ...CORE_RULES.map((r) => `- ${r}`),
    '- Questions: at most 6, each about ONE bullet, each asking for a fact that would make that bullet much stronger FOR THIS JOB (a volume, scope, money, before/after result, recognition, trust given, tool, setting, credential status), or whether the person has done a requirement the résumé does not show. Specific and short ("About how many customers did you ring up on a busy Saturday?"). Never ask about age, health, family, race or other protected things. Never ask for something the fact sheet already states.',
    '- Choices for a question are optional ranges or options the person can pick (never a pre-filled number as an answer).',
    '- Plan actions: keep (already strong or not relevant to change), rewrite (a clearer or stronger line is possible from its facts, or once a question is answered), cut (says what every holder of the job does, or irrelevant to this job and the space is better used), move_up (most relevant evidence for this job; lead its role).',
  ].join('\n');
  const user = [postingText(ctx), playbookText(ctx.playbook), factSheetText(ctx.sheet),
    `GRAMMAR FINDINGS BY BULLET (from Seen's checker): ${JSON.stringify(ctx.lint)}`,
    `Return JSON: {"target":"one sentence: who this person is for THIS job, from facts only",
"bullets":[{"id":"J1.2","level":0,"action":"keep|rewrite|cut|move_up","why":"one short reason a recruiter would give"}] (every bullet on the fact sheet),
"requirements":[{"label":"…","evidence":["J1.2"],"strength":"strong|weak|none"}] (every requirement listed above),
"questions":[{"id":"q1","bullet":"J1.3","ask":"…","why":"what it would prove for this job","kind":"volume|scope|money|outcome|recognition|trust|tool|setting|credential|requirement","choices":["…"]}],
"gaps":[{"label":"a requirement with no evidence","advice":"one honest line: how to handle it (say so in the cover letter, be ready in the interview, or what to learn) — never pretend"}]}`,
  ].join('\n\n');
  return { system, user };
}

const PROTECTED_RE = /\b(age|old are you|born|birth|disab|health|medical condition|pregnan|child|kids|married|spouse|religio|race|ethnic|national origin|immigra|visa status|gender|sexual|veteran)\b/i;

/** Validate the model's diagnosis against the fact sheet; fill gaps deterministically. */
export function guardDiagnosis(raw, ctx) {
  const ids = new Set(ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => b.id)));
  const byId = new Map();
  for (const b of Array.isArray(raw?.bullets) ? raw.bullets : []) {
    if (!ids.has(String(b?.id))) continue;
    const action = ['keep', 'rewrite', 'cut', 'move_up'].includes(b.action) ? b.action : 'keep';
    const level = Math.max(0, Math.min(4, Number.isFinite(Number(b.level)) ? Math.round(Number(b.level)) : 1));
    byId.set(String(b.id), { id: String(b.id), level, action, why: clean(b.why, 200) });
  }
  // Every bullet with a grammar finding is at least a rewrite candidate; unknown bullets default to keep.
  for (const id of ids) {
    if (!byId.has(id)) byId.set(id, { id, level: 1, action: (ctx.lint[id] || []).length ? 'rewrite' : 'keep', why: (ctx.lint[id] || []).length ? 'grammar or tense to fix' : '' });
    else if ((ctx.lint[id] || []).length && byId.get(id).action === 'keep') byId.get(id).action = 'rewrite';
  }
  const questions = [];
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    const ask = clean(q?.ask, 220);
    if (!ask || !/\?$/.test(ask) || PROTECTED_RE.test(ask)) continue;
    if (q.bullet && !ids.has(String(q.bullet))) continue;
    if (questions.some((x) => lc(x.ask) === lc(ask))) continue;
    const choices = (Array.isArray(q.choices) ? q.choices : []).map((c) => clean(c, 60)).filter(Boolean).slice(0, 5);
    questions.push({ id: `q${questions.length + 1}`, bullet: q.bullet ? String(q.bullet) : null, ask, why: clean(q.why, 200), kind: clean(q.kind, 20) || 'outcome', choices });
    if (questions.length >= 6) break;
  }
  const reqs = (Array.isArray(raw?.requirements) ? raw.requirements : []).map((r) => ({
    label: clean(r?.label, 120),
    evidence: (Array.isArray(r?.evidence) ? r.evidence : []).map(String).filter((id) => ids.has(id)).slice(0, 4),
    strength: ['strong', 'weak', 'none'].includes(r?.strength) ? r.strength : 'none',
  })).filter((r) => r.label);
  for (const r of reqs) if (r.strength !== 'none' && !r.evidence.length) r.strength = 'none';
  const gaps = (Array.isArray(raw?.gaps) ? raw.gaps : []).map((g) => ({ label: clean(g?.label, 120), advice: clean(g?.advice, 280) })).filter((g) => g.label && g.advice).slice(0, 6);
  const target = typeof raw?.target === 'string' && claimsOk(raw.target, { resumeText: ctx.resumeText, history: ctx.sheet.history, company: ctx.company, role: ctx.jobTitle, nowMs: ctx.nowMs }) ? clean(raw.target, 260) : '';
  return {
    target,
    bullets: [...byId.values()],
    requirements: reqs,
    questions,
    gaps,
    constraints: ctx.constraints,
    fit: ctx.fit ? { score: ctx.fit.fit_score, band: ctx.fit.fit_band, sentence: ctx.fit.verdict?.sentence || '' } : null,
    resume_check: ctx.sheet.stale.map(({ line, note }) => ({ line, note })),
    playbook: ctx.playbook.key,
  };
}

// ── 2. Rewrite ───────────────────────────────────────────────────────────────────────────────────
function answersText(answers) {
  const rows = (answers || []).filter((a) => a && a.id && String(a.answer || '').trim());
  if (!rows.length) return 'ANSWERS: none given (rewrite only from the fact sheet; leave out anything a question would have supplied).';
  return `ANSWERS FROM THE PERSON (facts, cite as "a:<id>"):\n${rows.map((a) => `- a:${a.id} (about ${a.bullet || 'the résumé'}) Q: ${clean(a.ask, 200)} A: ${clean(a.answer, 300)}`).join('\n')}`;
}

export function rewritePrompt(ctx, diagnosis, answers = []) {
  const todo = diagnosis.bullets.filter((b) => b.action === 'rewrite' || b.action === 'move_up');
  const system = ['You rewrite résumé bullets for one job, the way the best human résumé writer would after interviewing the person. Output ONLY a JSON object.', 'Rules:', ...CORE_RULES.map((r) => `- ${r}`),
    '- Allowed changes only: fix grammar, spelling and tense; start with the verb; turn "responsible for X" into the action; surface an achievement buried in a duty line; add the specifics and results the cited facts and answers give; split or merge lines; use the forms recruiters search for the SAME skill; cut filler.',
    '- Tense: the current job in present tense for ongoing work and past tense for finished results; every earlier job in past tense. No "I", "my", "we". One or two lines (under 220 characters). Numbers as digits, copied exactly.',
    '- Keep every number and fact the original line had, unless you are merging it into another line you also return.',
    '- Vary the structure across bullets; do not use one formula on every line.',
    '- A change must be real: if the best honest version is the original, do not return it.',
    '- The summary: 2–3 lines for THIS job, from facts only, no adjectives without evidence, no "I". Lengths of time only as the fact sheet gives them.',
    '- Skills: only skills the fact sheet or answers show the person used, in the form recruiters search.',
  ].join('\n');
  const user = [postingText(ctx), playbookText(ctx.playbook), factSheetText(ctx.sheet), answersText(answers),
    `PLAN — rewrite these bullets (id: action — why): ${todo.map((b) => `${b.id}: ${b.action} — ${b.why}`).join(' | ') || 'none'}`,
    `TARGET: ${diagnosis.target || ''}`,
    `Return JSON: {"rewrites":[{"id":"J1.3","text":"the new bullet","uses":["J1.3","a:q1"],"why":"what changed and why it helps for this job, in one short line"}],
"summary":{"text":"…","uses":["J1.1","J2.2"]},
"skills":[{"skill":"…","evidence":"J1.2"}]}`,
  ].join('\n\n');
  return { system, user };
}

/** The fact-check pass: may only remove, correct grammar, or reject — never add. */
export function reviewPrompt(ctx, draft, answers = []) {
  const items = (Array.isArray(draft?.rewrites) ? draft.rewrites : []).map((r) => {
    const cited = (Array.isArray(r.uses) ? r.uses : []).map((u) => citeText(ctx, u, answers)).filter(Boolean);
    const orig = bulletById(ctx.sheet, r.id);
    return { id: r.id, original: orig?.text || '', job_current: !!orig?.job?.current, text: r.text, cited };
  });
  const system = ['You fact-check rewritten résumé bullets before a job seeker pays for them. Output ONLY a JSON object.',
    'For each item: compare the new text with the ORIGINAL and the CITED facts. Remove anything they do not support — a number, tool, scope, team size, result, setting, purpose or method. Remove an intensified verb ("helped" → "led"). Fix grammar and tense (current job: present for ongoing work, past for finished results; earlier jobs: past). Keep the meaning and every number the original had. If what is left is not clearly better than the original, set "reject": true with a reason. Never add a fact.'].join('\n');
  const user = [`ITEMS:\n${JSON.stringify(items).slice(0, 14000)}`,
    `SUMMARY TO CHECK (facts: the whole fact sheet and answers): ${JSON.stringify(draft?.summary || null).slice(0, 1200)}`,
    factSheetText(ctx.sheet), answersText(answers),
    'Return JSON: {"rewrites":[{"id":"J1.3","text":"corrected text","reject":false,"reason":"when rejected"}],"summary":{"text":"corrected summary or empty to drop"}}'].join('\n\n');
  return { system, user };
}

function citeText(ctx, ref, answers) {
  const r = String(ref || '').trim();
  if (/^a:/i.test(r)) {
    const a = (answers || []).find((x) => `a:${x.id}` === r || x.id === r.slice(2));
    return a && String(a.answer || '').trim() ? `${clean(a.ask, 200)} — ${clean(a.answer, 300)}` : null;
  }
  return bulletById(ctx.sheet, r)?.text || null;
}

const firstWord = (t) => (String(t || '').trim().match(/^[A-Za-z'-]+/) || [''])[0];

/**
 * Every line through Seen's gates. `draft` is the writer's output, `review` the fact-checker's
 * (either may be null). Returns proposals the person can accept one by one.
 */
export function guardRewrites(ctx, diagnosis, draft, review, answers = []) {
  const answerText = (answers || []).filter((a) => a && String(a.answer || '').trim()).map((a) => `${a.ask} ${a.answer}`).join('\n');
  const vocab = `${ctx.resumeText}\n${answerText}`;
  const reviewed = new Map((Array.isArray(review?.rewrites) ? review.rewrites : []).map((r) => [String(r.id), r]));
  const proposals = [];
  const rejected = [];
  const leadCount = new Map();
  for (const r of Array.isArray(draft?.rewrites) ? draft.rewrites : []) {
    const id = String(r?.id || '');
    const orig = bulletById(ctx.sheet, id);
    if (!orig) { rejected.push({ id, reason: 'unknown bullet' }); continue; }
    const rv = reviewed.get(id);
    if (rv?.reject) { rejected.push({ id, reason: `fact-check: ${clean(rv.reason, 160)}` }); continue; }
    let text = clean(rv?.text || r.text, 260);
    const uses = (Array.isArray(r.uses) ? r.uses : []).map(String);
    if (!uses.includes(id)) uses.unshift(id);
    const facts = uses.map((u) => citeText(ctx, u, answers)).filter(Boolean);
    // grammar for this job's tense
    const g = checkBullet(text, { current: orig.job.current });
    text = g.text;
    if (!g.ok) { rejected.push({ id, text, reason: `grammar: ${g.issues.filter((i) => i.fatal).map((i) => i.note).join('; ')}` }); continue; }
    // facts
    const v = verifyRewrite({ before: orig.text, after: text, facts, resumeText: vocab, allowTerms: [ctx.company, ctx.jobTitle] });
    if (!v.ok) { rejected.push({ id, text, reason: `facts: ${v.notes.join('; ')}` }); continue; }
    if (AI_TELL_RE.test(text) && !AI_TELL_RE.test(orig.text)) { rejected.push({ id, text, reason: `AI wording: "${text.match(AI_TELL_RE)[0]}"` }); continue; }
    // no intensified lead verb unless a cited fact uses the stronger verb's stem
    const lead = verbBase(firstWord(text)) || lc(firstWord(text));
    const was = verbBase(firstWord(orig.text)) || lc(firstWord(orig.text));
    if (verbStrength(lead) > verbStrength(was) && verbStrength(lead) === 3 && !facts.some((f) => lc(f).includes(lead.slice(0, 4)))) {
      rejected.push({ id, text, reason: `"${firstWord(orig.text)}" became "${firstWord(text)}" — a stronger claim than the facts make` });
      continue;
    }
    if (!claimsOk(text, { resumeText: vocab, history: ctx.sheet.history, company: ctx.company, role: ctx.jobTitle, nowMs: ctx.nowMs })) { rejected.push({ id, text, reason: 'a length of time or date the résumé does not back' }); continue; }
    const roleKey = orig.job.id;
    const k = `${roleKey}|${lead}`;
    leadCount.set(k, (leadCount.get(k) || 0) + 1);
    proposals.push({
      id, job: orig.job.id, before: orig.text, after: text,
      why: clean(r.why, 200),
      uses: uses.filter((u) => citeText(ctx, u, answers)),
      used_answers: uses.filter((u) => /^a:/.test(u)),
      checks: ['facts traced', 'grammar and tense', 'no new claims', g.issues.length ? `fixed: ${g.issues.map((i) => i.code).join(', ')}` : null].filter(Boolean),
      repeated_lead: false,
    });
  }
  for (const p of proposals) p.repeated_lead = (leadCount.get(`${p.job}|${verbBase(firstWord(p.after)) || lc(firstWord(p.after))}`) || 0) > 2;

  // summary: facts only, tenure checked, no AI tells
  let summary = null;
  const sText = clean(review?.summary?.text ?? draft?.summary?.text, 600);
  if (sText) {
    const s = checkSummary(sText);
    // Numbers must be the résumé's (lengths of time are checked against the dates by claimsOk instead).
    const nums = (stripDurations(digitize(sText)).match(/\d[\d,.]*%?/g) || []).map((n) => n.replace(/[,.]+$/, ''));
    const have = new Set((digitize(vocab).match(/\d[\d,.]*%?/g) || []).flatMap((n) => { const x = n.replace(/[,]/g, '').replace(/[.]+$/, ''); return [x, x.replace(/%$/, '')]; }));
    const numsOk = nums.every((n) => have.has(n.replace(/[,]/g, '')) || have.has(n.replace(/[,]/g, '').replace(/%$/, '')));
    const claims = claimsOk(sText, { resumeText: vocab, history: ctx.sheet.history, company: ctx.company, role: ctx.jobTitle, nowMs: ctx.nowMs });
    // A summary is new prose by nature: check named things and claim words, not every connecting word.
    const v = verifyRewrite({ before: '', after: stripDurations(sText), facts: [vocab], resumeText: vocab, allowTerms: [ctx.company, ctx.jobTitle] });
    const termsOk = !v.reasons.includes('new_term') && !v.reasons.includes('claim_word');
    if (s.ok && numsOk && claims && termsOk && !AI_TELL_RE.test(sText)) summary = { text: s.text, replaces: '' };
    else rejected.push({ id: 'summary', text: sText, reason: [!s.ok && 'grammar', !numsOk && 'a number not on the résumé', !claims && 'a length of time the dates do not back', !termsOk && v.notes.filter((n) => /^not on the résumé|^a claim/.test(n)).join('; '), AI_TELL_RE.test(sText) && 'AI wording'].filter(Boolean).join('; ') });
  }

  // skills: on the résumé or in an answer, deduped
  const seen = new Set();
  const skills = (Array.isArray(draft?.skills) ? draft.skills : []).map((x) => clean(x?.skill, 60)).filter((sk) => {
    const k = lc(sk);
    if (!sk || seen.has(k)) return false;
    seen.add(k);
    return lc(vocab).includes(k) || contentWords(sk).every((w) => lc(vocab).includes(w));
  }).slice(0, 18);

  return { proposals, summary, skills, rejected };
}

/** Apply accepted proposals to the résumé text (bullet text replaced in place). */
export function applyProposals(resumeText, proposals, acceptedIds) {
  let out = String(resumeText || '');
  const ok = new Set(acceptedIds || proposals.map((p) => p.id));
  for (const p of proposals) {
    if (!ok.has(p.id)) continue;
    const idx = out.indexOf(p.before);
    if (idx >= 0) out = out.slice(0, idx) + p.after + out.slice(idx + p.before.length);
  }
  return out;
}
