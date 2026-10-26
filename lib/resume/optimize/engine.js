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
import { claimsOk, digitize, stripDurations, premiseOk, sentences, durationsOk } from '../../server/prepClaims.js';
import { prepFamily } from '../../server/interviewPrep.js';
import { runOptimizer } from '../../optimizer/index.js';
import { impliedCompetencies, termCompetencies } from '../tailor/competencies.js';
import { checkBullet, checkSummary, verbBase } from './grammar.js';
import { verifyRewrite, contentWords, numbersOf } from './verify.js';
import { playbookFor, AI_TELL_RE, verbStrength } from './playbooks.js';

export const OPTIMIZER_V3 = 'optimizer_v3.4';
const lc = (s) => String(s || '').toLowerCase();
const clean = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Whole sentences that fit in n characters — never a line cut mid-word. '' when the first does not fit. */
export function clip(s, n) {
  const t = clean(s, 4000);
  if (t.length <= n) return t;
  let out = '';
  for (const x of sentences(t)) { if (`${out} ${x}`.trim().length > n) break; out = `${out} ${x}`.trim(); }
  return out;
}

const CREDENTIAL_RE = /\b(?:high school|diploma|GED|degree|bachelor'?s?|master'?s?|associate'?s?|B\.?[AS]\.?|M\.?[AS]\.?|MBA|Ph\.?D|certificat\w*|certified|licen[cs]\w*|registered)\b/gi;
const ABOUT_YOU_RE = /\b(?:you|your|you've|you're)\b/i;
const numbersIn = (t) => (digitize(String(t || '')).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/,/g, ''));

/**
 * Advice about a gap may talk about the person only with what the résumé says: a sentence about "you"
 * may not carry a number the résumé and posting do not have, a credential the résumé does not name
 * ("your high school diploma"), or a premise premiseOk refuses. Failing sentences are dropped.
 */
export function adviceOk(sentence, { resumeText, history, company, role, jobDescription = '' }) {
  if (!ABOUT_YOU_RE.test(sentence)) return true;
  const have = lc(digitize(resumeText));
  const known = new Set([...numbersIn(resumeText), ...numbersIn(jobDescription)]);
  if (numbersIn(sentence).some((n) => !known.has(n))) return false;
  for (const m of String(sentence).matchAll(CREDENTIAL_RE)) {
    const term = lc(m[0]).replace(/'s?$/, '').replace(/\./g, '');
    if (have.replace(/\./g, '').includes(term)) continue;
    // Naming a credential the posting asks for is fine; saying the person has it is not.
    const before = lc(String(sentence).slice(Math.max(0, m.index - 40), m.index));
    if (/\b(?:your|you have|you've|you hold|you earned|with your)\b[^.]*$/.test(before)) return false;
  }
  return premiseOk(sentence, { resumeText, history, company, role });
}

/** Content words of a requirement label that must all appear in one résumé line for it to count. */
const LABEL_STOP = new Set(['experience', 'skills', 'skill', 'ability', 'knowledge', 'and', 'or', 'with', 'of', 'in', 'the', 'a', 'to', 'for', 'strong', 'proven', 'working', 'years', 'year']);
const stemWord = (w) => w.replace(/(?:ing|ed|es|s)$/, '');
function labelWords(label) {
  return lc(label).replace(/[()]/g, ' ').split(/[^a-z0-9&+#]+/).filter((w) => w.length > 1 && !LABEL_STOP.has(w)).map(stemWord);
}

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
  // What each title the person has held implies (a line cook prepares food; a teacher plans lessons).
  const roleVecs = sheet.jobs.map((j) => impliedCompetencies(j.title, j.company, j.bullets.map((b) => b.text).join(' ')).vector);
  return { resumeText: String(resumeText || ''), jobTitle, company, jobDescription: String(jobDescription || ''), nowMs, sheet, fit, family, playbook, requirements, constraints, lint, roleVecs };
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
    '- Which questions to ask, in this order of value: (1) a REQUIRED item of the posting the résumé does not show — "Have you used Power BI?", "Have you serviced rooftop units?" (bullet may be null only for these); (2) the scale of the bullets closest to this job (how many, how much, how often, for whom); (3) a result the line implies but does not state. Never ask about process trivia or how something was done, never for a story ("describe…"), never about willingness, comfort or schedule — those are for the interview or the application form.',
    '- Questions: at most 6, each about ONE bullet, each asking for a fact that would make that bullet much stronger FOR THIS JOB (a volume, scope, money, before/after result, recognition, trust given, tool, setting, credential status), or whether the person has done a requirement the résumé does not show. Specific and short — ONE question, under 25 words, one question mark ("About how many customers did you ring up on a busy Saturday?"). Ask only for a fact that could go into a bullet; never how time is split, feelings or plans. Never ask about age, health, family, race or other protected things. Never ask for something the fact sheet already states.',
    '- Every "why" is one sentence under 20 words. Gap advice is one or two sentences under 40 words, and says nothing about the person the fact sheet does not state (no degrees, diplomas, years or numbers of your own).',
    '- Before calling a requirement unproven, read the whole résumé, including the summary, skills and education lines.',
    '- Choices are optional: up to 4 short options (under 6 words each), mutually exclusive, starting from the LOW end ("None", "1–5", …) and never worded to sound better than the truth ("No, but I\'m comfortable with it" is not an option). Seen adds "Not sure".',
    '- Plan actions: keep (already strong or not relevant to change), rewrite (a clearer or stronger line is possible from its facts, or once a question is answered), cut (says what every holder of the job does, or irrelevant to this job and the space is better used), move_up (most relevant evidence for this job; lead its role).',
  ].join('\n');
  const user = [postingText(ctx), playbookText(ctx.playbook), factSheetText(ctx.sheet),
    `THE RÉSUMÉ AS WRITTEN (summary, skills and education count as evidence too):\n<<<\n${ctx.resumeText.slice(0, 6000)}\n>>>`,
    `GRAMMAR FINDINGS BY BULLET (from Seen's checker): ${JSON.stringify(ctx.lint)}`,
    `Return JSON: {"target":"one sentence: who this person is for THIS job, from facts only",
"bullets":[{"id":"J1.2","level":0,"action":"keep|rewrite|cut|move_up","why":"one short reason a recruiter would give"}] (every bullet on the fact sheet),
"requirements":[{"label":"…","evidence":["J1.2"],"strength":"strong|weak|none"}] (every requirement listed above),
"questions":[{"id":"q1","bullet":"J1.3","ask":"…","why":"what it would prove for this job","kind":"volume|scope|money|outcome|recognition|trust|tool|setting|credential|requirement","choices":["…"]}],
"gaps":[{"label":"a requirement with no evidence","advice":"one honest line: how to handle it (say so in the cover letter, be ready in the interview, or what to learn) — never pretend"}]}`,
  ].join('\n\n');
  return { system, user };
}

// A named thing (SOX, ACLS, Power BI, Workday, a license number) is never "implied" by a title.
const NAMED_RE = /\b(?:[A-Z]{2,}[a-z]?|[A-Z][a-z]+[A-Z]\w*)\b|\d/;
// The bare requirement, without the model's "(required, hard requirement)" or "— preferred" notes.
export const bareLabel = (l) => clean(l, 160).replace(/\s*[(—–-]\s*(?:required|preferred|nice[- ]to[- ]have|hard requirement|screening constraint|strongly preferred|must[- ]have)[^)]*\)?\s*$/i, '').replace(/\s*\((?:required|preferred)[^)]*\)/gi, '').trim().slice(0, 120);

/** Is this requirement a skill the person's own past title already implies? Generic skills only. */
export function impliedByTitles(label, ctx) {
  if (!label || NAMED_RE.test(label)) return false;
  const want = Object.entries(termCompetencies(label).vector).filter(([, w]) => w >= 0.5).map(([c]) => c);
  if (!want.length) return false;
  return (ctx.roleVecs || []).some((v) => want.every((c) => (v[c] || 0) >= 0.6));
}

// Screening logistics (lifting, schedule, availability, travel) are answered on the application, not
// shown with a résumé line.
const SCREENING_RE = /\b(?:lift|lbs|pounds|stand(?:ing)? for|on your feet|schedule|availability|available|nights?|weekends?|holidays?|on-?call|shifts?|travel up to|\d+% travel|background check|drug (?:test|screen)|driver'?s licen[cs]e|reliable transportation|work authori[sz]ation|relocat)/i;
const ACTION_RE = /\b(?:add|say|mention|name|note|be ready|ask|show|list|lead with|renew|take|learn|get|bring|explain|describe|put|use|confirm|include|tell|frame|point to|cite|write|call out|highlight)\b/i;
const STANCE_RE = /\b(?:prefers?|preferred|nice[- ]to[- ]have|not required|does not require|doesn't require|optional|not a blocker)\b/i;
function fallbackAdvice(label) {
  CREDENTIAL_RE.lastIndex = 0;
  if (CREDENTIAL_RE.test(label)) { CREDENTIAL_RE.lastIndex = 0; return 'If you have it, list it under Education or Certifications. If not, still apply when the posting prefers rather than requires it, and lead with your experience.'; }
  return NAMED_RE.test(label)
    ? `If you have used ${label}, add where and for what. If not, name the closest tool you do use and say you would learn ${label}.`
    : 'If you have done this, add one bullet that shows it with an example. If not, be ready to say how you would handle it.';
}

// Questions a person can answer in a few words with a fact that fits on a résumé line. Stories,
// feelings, willingness and how something was done belong to the interview, not this form.
const STORY_RE = /\b(?:describe|tell (?:me|us)|walk (?:me|us) through|explain|feel comfortable|comfortable with|willing to|would you be|are you open to|why did you|what was it like)\b|^how did you\b/i;
const HAVE_YOU_RE = /^(?:have|do|did|are|were|can) you\b/i;

/**
 * Answer choices that do not lead the witness: short (an option too long to read whole is dropped, never
 * cut mid-word), no spin ("No, but I'm comfortable with it" → "No"), a plain "No" for a have-you question,
 * and always a way to say "Not sure". A range list that cannot express "none" gets "None".
 */
export function fairChoices(raw, ask) {
  let out = (Array.isArray(raw) ? raw : []).map((c) => clean(c, 200)).filter((c) => c && c.length <= 48);
  out = out.map((c) => (/^no\b/i.test(c) ? 'No' : c));
  out = [...new Set(out)];
  if (!out.length) return [];
  const yesNo = HAVE_YOU_RE.test(ask);
  if (yesNo && !/\bor\b/i.test(ask) && !out.some((c) => /^no$/i.test(c))) out.push('No');
  const numeric = out.some((c) => /\d/.test(c));
  if (numeric && !yesNo && !out.some((c) => /^(?:none|0|zero|never|no|under|fewer|less|below|<)\b/i.test(c))) {
    // The low end: "Fewer than 10" when the lowest range starts at 10, "None" when it starts at 1.
    const lows = out.map((c) => Number((digitize(c).match(/\d+(?:\.\d+)?/) || [])[0])).filter(Number.isFinite);
    const low = lows.length ? Math.min(...lows) : 0;
    out.unshift(low > 1 ? `Fewer than ${low}` : 'None');
  }
  if (!out.some((c) => /not sure|don'?t (?:know|track)|unsure/i.test(c))) out.push('Not sure');
  return out.slice(0, 6);
}

// "How is your time split…" cannot become a bullet.
const TIME_SPLIT_RE = /\b(?:how much of your time|what (?:share|percent(?:age)?|portion) of your (?:time|day|week)|time (?:is )?(?:spent|split))\b/i;
const PROTECTED_RE = /\b(age|old are you|born|birth|disab|health|medical condition|pregnan|child|kids|married|spouse|religio|race|ethnic|national origin|immigra|visa status|gender|sexual|veteran)\b/i;

/** Validate the model's diagnosis against the fact sheet; fill gaps deterministically. */
export function guardDiagnosis(raw, ctx) {
  const ids = new Set(ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => b.id)));
  const byId = new Map();
  for (const b of Array.isArray(raw?.bullets) ? raw.bullets : []) {
    if (!ids.has(String(b?.id))) continue;
    const action = ['keep', 'rewrite', 'cut', 'move_up'].includes(b.action) ? b.action : 'keep';
    const level = Math.max(0, Math.min(4, Number.isFinite(Number(b.level)) ? Math.round(Number(b.level)) : 1));
    byId.set(String(b.id), { id: String(b.id), level, action, why: clip(b.why, 160) });
  }
  // Every bullet with a grammar finding is at least a rewrite candidate; unknown bullets default to keep.
  for (const id of ids) {
    if (!byId.has(id)) byId.set(id, { id, level: 1, action: (ctx.lint[id] || []).length ? 'rewrite' : 'keep', why: (ctx.lint[id] || []).length ? 'grammar or tense to fix' : '' });
    else if ((ctx.lint[id] || []).length && byId.get(id).action === 'keep') byId.get(id).action = 'rewrite';
  }
  const questions = [];
  for (const q of Array.isArray(raw?.questions) ? raw.questions : []) {
    // One question each: a second "And did…?" is dropped, and a question too long to read is refused.
    const first = (clean(q?.ask, 600).match(/^[^?]*\?/) || [''])[0].trim();
    const ask = first.length <= 170 ? first : '';
    if (!ask || PROTECTED_RE.test(ask) || TIME_SPLIT_RE.test(ask) || STORY_RE.test(ask)) continue;
    // A question not about a bullet must ask whether they have done something the job requires.
    if (!q.bullet && (!HAVE_YOU_RE.test(ask) || SCREENING_RE.test(ask))) continue;
    if (!premiseOk(ask, { resumeText: ctx.resumeText, history: ctx.sheet.history, company: ctx.company, role: ctx.jobTitle })) continue;
    if (q.bullet && !ids.has(String(q.bullet))) continue;
    if (questions.some((x) => lc(x.ask) === lc(ask))) continue;
    const choices = fairChoices(q.choices, ask);
    questions.push({ id: `q${questions.length + 1}`, bullet: q.bullet ? String(q.bullet) : null, ask, why: clip(q.why, 160), kind: clean(q.kind, 20) || 'outcome', choices });
    if (questions.length >= 6) break;
  }
  const reqs = (Array.isArray(raw?.requirements) ? raw.requirements : []).map((r) => ({
    label: bareLabel(r?.label),
    importance: /preferred|nice[- ]to[- ]have|bonus|plus\b/i.test(String(r?.label || '')) ? 'preferred' : /required|must|hard/i.test(String(r?.label || '')) ? 'required' : undefined,
    evidence: (Array.isArray(r?.evidence) ? r.evidence : []).map(String).filter((id) => ids.has(id)).slice(0, 4),
    strength: ['strong', 'weak', 'none'].includes(r?.strength) ? r.strength : 'none',
  })).filter((r) => r.label);
  for (const r of reqs) if (r.strength !== 'none' && !r.evidence.length) r.strength = 'none';
  // A requirement the model calls unproven may still be on the résumé: in a bullet it did not cite, or in
  // the summary, skills or education ("Bilingual English/Spanish"). Seen looks before it calls it a gap.
  const bulletLines = ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => ({ id: b.id, words: new Set(labelWords(b.text)) })));
  const otherLines = ctx.resumeText.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !ctx.sheet.jobs.some((j) => j.bullets.some((b) => l.includes(b.text))))
    .map((l) => new Set(labelWords(l)));
  const stated = new Set();
  for (const r of reqs) {
    if (r.strength !== 'none') continue;
    const need = labelWords(r.label);
    if (!need.length) continue;
    const hit = bulletLines.filter((b) => need.every((w) => b.words.has(w))).map((b) => b.id);
    if (hit.length) { r.evidence = hit.slice(0, 4); r.strength = 'weak'; stated.add(lc(r.label)); continue; }
    if (otherLines.some((l) => need.every((w) => l.has(w)))) { r.strength = 'stated'; r.note = 'on your résumé, but no bullet shows it'; stated.add(lc(r.label)); continue; }
    if (impliedByTitles(r.label, ctx)) { r.strength = 'implied'; r.note = 'your job titles show it; name it in a bullet if the posting stresses it'; stated.add(lc(r.label)); }
  }
  const qids = new Set(questions.map((q) => q.id));
  const advise = (text) => {
    const keep = sentences(clean(text, 600))
      .filter((x) => adviceOk(x, { resumeText: ctx.resumeText, history: ctx.sheet.history, company: ctx.company, role: ctx.jobTitle, jobDescription: ctx.jobDescription }))
      .filter((x) => [...x.matchAll(/\bq(\d+)\b/gi)].every((m) => qids.has(`q${m[1]}`)));
    const out = clip(keep.join(' '), 220);
    // Advice says what to do, or how much the posting cares; otherwise Seen's own line replaces it.
    return ACTION_RE.test(out) || STANCE_RE.test(out) ? out : '';
  };
  const gapLabel = bareLabel;
  const sameReq = (a, b) => { const x = labelWords(a).join(' '); return !!x && x === labelWords(b).join(' '); };
  const gaps = (Array.isArray(raw?.gaps) ? raw.gaps : [])
    .map((g) => ({ label: gapLabel(g?.label), advice: advise(g?.advice) }))
    .filter((g) => g.label && !SCREENING_RE.test(g.label))
    .filter((g) => !stated.has(lc(g.label)) && !reqs.some((r) => r.strength !== 'none' && sameReq(r.label, g.label)) && !impliedByTitles(g.label, ctx))
    .map((g) => ({ ...g, advice: g.advice || fallbackAdvice(g.label) }))
    .slice(0, 6);
  const target = typeof raw?.target === 'string' && claimsOk(raw.target, { resumeText: ctx.resumeText, history: ctx.sheet.history, company: ctx.company, role: ctx.jobTitle, nowMs: ctx.nowMs }) ? clean(raw.target, 260) : '';
  return {
    target,
    bullets: [...byId.values()].map((b) => ({ ...b, text: bulletById(ctx.sheet, b.id)?.text || '' })),
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
export function guardRewrites(ctx, diagnosis, draft, review, answers = [], { only = null } = {}) {
  const answerText = (answers || []).filter((a) => a && String(a.answer || '').trim()).map((a) => `${a.ask} ${a.answer}`).join('\n');
  const vocab = `${ctx.resumeText}\n${answerText}`;
  const reviewed = new Map((Array.isArray(review?.rewrites) ? review.rewrites : []).map((r) => [String(r.id), r]));
  const proposals = [];
  const rejected = [];
  const leadCount = new Map();
  const shipped = new Set();
  for (const r of Array.isArray(draft?.rewrites) ? draft.rewrites : []) {
    const id = String(r?.id || '');
    if (only && !only.has(id)) continue;
    const orig = bulletById(ctx.sheet, id);
    if (!orig) { rejected.push({ id, reason: 'unknown bullet' }); continue; }
    if (shipped.has(id)) continue; // the first version that passes is the one shown
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
    // A length of time that matches the job's own dates ("in 4½ years") is the dates, not a new number.
    const durNums = durationsOk(text, { resumeText: vocab, history: ctx.sheet.history, strict: true })
      ? numbersOf(text).filter((n) => !numbersOf(stripDurations(text)).includes(n)) : [];
    const answeredHere = (answers || []).some((a) => a.bullet === id && uses.includes(`a:${a.id}`));
    const v = verifyRewrite({ before: orig.text, after: text, facts, resumeText: vocab, allowTerms: [ctx.company, ctx.jobTitle], allowNumbers: durNums, allowLost: answeredHere });
    if (!v.ok) { rejected.push({ id, text, reason: `facts: ${v.notes.join('; ')}`, codes: v.reasons }); continue; }
    // Borrowing another bullet's facts is a merge: that line's numbers all come along and it is removed,
    // or the rewrite is refused (the same fact twice, or a fact lost).
    const merges = [];
    let mergeBad = '';
    for (const u of uses.filter((x) => /^J\d+\.\d+$/.test(x) && x !== id)) {
      const other = bulletById(ctx.sheet, u);
      if (!other) continue;
      const missing = numbersOf(other.text).filter((n) => !numbersOf(text).includes(n));
      if (missing.length) { mergeBad = `repeats ${u} but drops its ${missing.join(', ')} — keep ${u} as is or merge all of it`; break; }
      if (proposals.some((p) => p.id === u || (p.merges || []).includes(u))) { mergeBad = `${u} is already changed by another suggestion`; break; }
      merges.push(u);
    }
    if (mergeBad) { rejected.push({ id, text, reason: mergeBad, codes: ['merge'] }); continue; }
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
    shipped.add(id);
    proposals.push({
      id, job: orig.job.id, before: orig.text, after: text,
      ...(merges.length ? { merges, merged_text: merges.map((u) => bulletById(ctx.sheet, u).text) } : {}),
      why: clip(r.why, 180),
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

// A refused line goes back to the writer once, with the exact reason. A word swap is not repaired:
// when the honest best is the original, the original stays.
const REPAIRABLE = (r) => r && /^J\d+\.\d+$/.test(r.id) && r.text && !(r.codes || []).includes('cosmetic') && !/^unknown|^fact-check/.test(r.reason || '');
export function repairable(rejected) { return (rejected || []).filter(REPAIRABLE); }

export function repairPrompt(ctx, rejected, answers = []) {
  const items = repairable(rejected).slice(0, 8);
  const system = ['You fix résumé bullets that Seen\'s checks refused. Output ONLY a JSON object.', 'Rules:', ...CORE_RULES.map((r) => `- ${r}`),
    '- Fix exactly what the check names: drop or replace any word, number or claim the cited facts do not state; keep every number the original line has; correct tense; no "I". If the honest version adds nothing over the original, leave that bullet out.'].join('\n');
  const user = [factSheetText(ctx.sheet), answersText(answers),
    `REFUSED LINES (fix each, or leave it out):\n${items.map((r) => `- ${r.id} — original: "${bulletById(ctx.sheet, r.id)?.text || ''}" — refused version: "${r.text}" — why: ${r.reason}`).join('\n')}`,
    'Return JSON: {"rewrites":[{"id":"J1.3","text":"…","uses":["J1.3","a:q1"],"why":"what changed, one short line"}]}'].join('\n\n');
  return { system, user, ids: items.map((r) => r.id) };
}

/** Apply accepted proposals to the résumé text (bullet text replaced in place). */
export function applyProposals(resumeText, proposals, acceptedIds) {
  let out = String(resumeText || '');
  const ok = new Set(acceptedIds || proposals.map((p) => p.id));
  for (const p of proposals) {
    if (!ok.has(p.id)) continue;
    const idx = out.indexOf(p.before);
    if (idx >= 0) out = out.slice(0, idx) + p.after + out.slice(idx + p.before.length);
    // a merged line leaves the résumé with its bullet marker
    for (const m of p.merged_text || []) out = out.split('\n').filter((l) => l.replace(/^[\s•●▪◦*·\-–—]+/, '').trim() !== m).join('\n');
  }
  return out;
}
