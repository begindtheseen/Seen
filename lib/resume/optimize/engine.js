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
import { verifyRewrite, contentWords, numbersOf, isCosmetic } from './verify.js';
import { checkClaims, unsupportedClaims, norm } from './claims.js';
import { playbookFor, AI_TELL_RE, verbStrength } from './playbooks.js';

export const OPTIMIZER_V3 = 'optimizer_v3.8';
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
const LABEL_STOP = new Set(['card', 'certification', 'certificate', 'experience', 'skills', 'skill', 'ability', 'knowledge', 'and', 'or', 'with', 'of', 'in', 'the', 'a', 'to', 'for', 'strong', 'proven', 'working', 'years', 'year']);
const stemWord = (w) => w.replace(/(?:ing|ed|es|s)$/, '');
function labelWords(label) {
  return norm(label).replace(/[()]/g, ' ').split(/[^a-z0-9&+#]+/).filter((w) => w.length > 1 && !LABEL_STOP.has(w)).map(stemWord);
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
// Products and named tools are shown by a line that names them, never by a job title.
const TOOL_RE = /\b(?:excel|word|outlook|powerpoint|office|facebook|instagram|tiktok|linkedin|twitter|youtube|meta|salesforce|hubspot|zendesk|freshdesk|servicenow|quickbooks|netsuite|sap|oracle|sql|python|java|javascript|go|tableau|power ?bi|looker|kronos|workday|adp|concur|canva|adobe|photoshop|figma|mailchimp|google|shopify|jira|aws|azure|gcp|kubernetes|kafka|servsafe|epa|osha|nate|cdl|bls|acls|cpr|forklift)\b/i;
export function impliedByTitles(label, ctx) {
  if (!label || NAMED_RE.test(label) || TOOL_RE.test(label)) return false;
  const tc = termCompetencies(label);
  if (Object.values(tc.hits).flat().some((h) => TOOL_RE.test(h))) return false;
  const want = Object.entries(tc.vector).filter(([, w]) => w >= 0.5).map(([c]) => c);
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
  // Number buckets are invented ("Low: 100–1k payouts/month") and the only way to answer one is to
  // guess; a number is typed in the person's own words or left as "Not sure".
  out = out.filter((c) => !/\d/.test(c));
  out = out.map((c) => (/^no\b/i.test(c) ? 'No' : c));
  out = [...new Set(out)];
  if (!out.length) return [];
  const yesNo = HAVE_YOU_RE.test(ask);
  if (yesNo && !/\bor\b/i.test(ask) && !out.some((c) => /^no$/i.test(c))) out.push('No');
  if (!out.some((c) => /not sure|don'?t (?:know|track)|unsure/i.test(c))) out.push('Not sure');
  // A list that offers nothing but "None" and "Not sure" is not a choice; the person types instead.
  const real = out.filter((c) => !/^(?:none|no|not sure|don'?t know|unsure|n\/a)$/i.test(c));
  return real.length ? out.slice(0, 6) : [];
}

/**
 * The question Seen asks itself about a requirement the résumé does not show, so the posting's own
 * asks are never skipped ("Seafood experience" → "Have you worked with seafood?").
 */
export function requirementQuestion(label) {
  const bare = String(label || '').replace(/\s+(?:experience|knowledge|skills?|background|exposure|proficiency)$/i, '').trim();
  if (!bare) return '';
  // a tool reads as the tool: "excel advanced" → "Have you used Excel?"
  const tool = (bare.match(TOOL_RE) || [])[0];
  if (tool && tool.length >= bare.length - 12) return `Have you used ${tool.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Power Bi$/i, 'Power BI').replace(/^Sql$/i, 'SQL').replace(/^Sap$/i, 'SAP').replace(/^Aws$/i, 'AWS')}?`;
  CREDENTIAL_RE.lastIndex = 0;
  if (CREDENTIAL_RE.test(bare)) { CREDENTIAL_RE.lastIndex = 0; return `Do you hold ${/^[aeiou]/i.test(bare) ? 'an' : 'a'} ${bare}?`; }
  const first = bare.split(/\s+/)[0];
  const lower = /^[A-Z][a-z]/.test(first) && !NAMED_RE.test(bare) ? bare.charAt(0).toLowerCase() + bare.slice(1) : bare;
  if (/ing$/i.test(first)) return `Does your work include ${lower}?`;
  return `Have you worked with ${lower}?`;
}

const SOFT_SKILL_RE = /\b(?:attention to detail|detail[- ]oriented|communication|communicat\w+ skills|teamwork|team player|interpersonal|problem[- ]solving|time management|organi[sz]ation(?:al)? skills|organized|self[- ]starter|motivated|work ethic|reliab\w+|dependab\w+|positive attitude|customer[- ]focused|multitask\w*|adaptab\w+|flexib\w+|leadership skills|critical thinking|professionalism|confidentiality|friendly|patience|fast[- ]paced)\b/i;

// "How is your time split…" cannot become a bullet.
const TIME_SPLIT_RE = /\b(?:how much of your time|what (?:share|percent(?:age)?|portion) of your (?:time|day|week)|time (?:is )?(?:spent|split))\b/i;
const PROTECTED_RE = /\b(age|old are you|born|birth|disab|accommodat\w*|health|medical condition|pregnan|child|kids|married|spouse|religio|race|ethnic|national origin|immigra|visa status|gender|sexual|veteran)\b/i;
// Screening asks (lifting, availability, willingness) are for the application form, not a résumé question.
const SCREENING_Q_RE = /\b(?:lift|lbs|pounds|stand for|on your feet|available|availability|willing|background check|drug (?:test|screen)|relocat\w*|work (?:weekends|nights|evenings|holidays)|on-?call rotation)\b/i;

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
    let first = (clean(q?.ask, 600).match(/^[^?]*\?/) || [''])[0].trim();
    // "How many trips do you book, and do you handle Concur?" is two questions: keep the first.
    const two = first.search(/,?\s+(?:and|or)\s+(?:do|did|does|how|what|which|is|are|was|were|have|has|can|could|would|when|where)\b/i);
    if (two > 20) first = `${first.slice(0, two).replace(/[,;:—–-]\s*$/, '')}?`;
    const ask = first.length <= 170 ? first : '';
    if (!ask || PROTECTED_RE.test(ask) || TIME_SPLIT_RE.test(ask) || STORY_RE.test(ask) || SCREENING_Q_RE.test(ask)) continue;
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
  const overlap = (a, b) => { const x = labelWords(a); const y = new Set(labelWords(b)); return x.length > 0 && x.filter((w) => y.has(w)).length >= Math.ceil(x.length / 2); };
  // Seen's own posting reader is one source of truth with the model's map: a constraint it found met
  // ("Your résumé lists EPA 608 Universal") or a requirement it matched to a résumé line cannot be
  // reported as missing two lines later.
  for (const r of reqs) {
    if (r.strength !== 'none') continue;
    const con = ctx.constraints.find((c) => c.status === 'met' && (overlap(r.label, c.label) || overlap(c.label, r.label)));
    if (con) { r.strength = 'stated'; r.note = con.message; stated.add(lc(r.label)); continue; }
    const seen = ctx.requirements.find((x) => x.evidence && (overlap(r.label, x.label) || overlap(x.label, r.label)));
    if (seen) {
      const ev = norm(seen.evidence).replace(/^[•\s]+/, '').slice(0, 60);
      const hitId = ctx.sheet.jobs.flatMap((j) => j.bullets).find((b) => ev && norm(b.text).startsWith(ev.slice(0, 40)))?.id;
      if (hitId) { r.evidence = [hitId]; r.strength = 'weak'; } else { r.strength = 'stated'; r.note = 'on your résumé, but no bullet shows it'; }
      stated.add(lc(r.label));
    }
  }
  for (const r of reqs) {
    if (r.strength !== 'none') continue;
    const need = labelWords(r.label);
    if (!need.length) continue;
    const hit = bulletLines.filter((b) => need.every((w) => b.words.has(w))).map((b) => b.id);
    if (hit.length) { r.evidence = hit.slice(0, 4); r.strength = 'weak'; stated.add(lc(r.label)); continue; }
    if (otherLines.some((l) => need.every((w) => l.has(w)))) { r.strength = 'stated'; r.note = 'on your résumé, but no bullet shows it'; stated.add(lc(r.label)); continue; }
    // "excel advanced", "Power BI dashboards": the tool itself on the résumé is the evidence; the
    // posting's modifier is something to show, not a reason to call it missing.
    const tool = (r.label.match(TOOL_RE) || [])[0];
    if (tool && new RegExp(`\\b${norm(tool).replace(/\s+/g, '\\s*')}\\b`).test(norm(ctx.resumeText))) {
      const hitId = ctx.sheet.jobs.flatMap((j) => j.bullets).find((b) => new RegExp(`\\b${norm(tool)}\\b`).test(norm(b.text)))?.id;
      if (hitId) { r.evidence = [hitId]; r.strength = 'weak'; } else { r.strength = 'stated'; r.note = `${tool} is on your résumé; a bullet that shows how you use it would prove the rest`; }
      stated.add(lc(r.label)); continue;
    }
    if (impliedByTitles(r.label, ctx)) { r.strength = 'implied'; r.note = 'your job titles show it; name it in a bullet if the posting stresses it'; stated.add(lc(r.label)); }
  }
  // Cuts and moves are conservative: a line with a number, or one that is the evidence for a
  // requirement, is never cut; a job keeps at least two lines; only evidence for the posting moves up.
  const evidenceIds = new Set(reqs.flatMap((r) => r.evidence));
  for (const j of ctx.sheet.jobs) {
    let left = j.bullets.length;
    for (const b of j.bullets) {
      const plan = byId.get(b.id);
      if (!plan) continue;
      if (plan.action === 'cut') {
        if (/\d/.test(b.text) || evidenceIds.has(b.id) || !plan.why || left <= 2) { plan.action = 'keep'; plan.why = plan.why && /\d/.test(b.text) ? '' : plan.why; }
        else left -= 1;
      }
      if (plan.action === 'move_up' && (!evidenceIds.has(b.id) || j.bullets[0].id === b.id)) plan.action = 'keep';
    }
  }
  // Every requirement the résumé does not show gets asked, before the model's own questions: the
  // posting's must-haves first. Screening items are for the application form.
  const asked = (label) => { const w = labelWords(label); return questions.some((q) => { const qw = new Set(labelWords(q.ask)); return w.length && w.filter((x) => qw.has(x)).length >= Math.ceil(w.length / 2); }); };
  // Only concrete requirements get Seen's own question: a tool, a credential, a setting or a kind of work.
  // "Have you worked with attention to detail?" is not a question anyone can answer.
  const missing = reqs.filter((r) => r.strength === 'none' && !SCREENING_RE.test(r.label) && !SOFT_SKILL_RE.test(r.label) && !asked(r.label))
    .sort((a, b) => (a.importance === 'preferred') - (b.importance === 'preferred'));
  const own = missing.slice(0, 3).map((r) => ({ bullet: null, ask: requirementQuestion(r.label), why: `${r.importance === 'preferred' ? 'The posting would like' : 'The posting asks for'} ${r.label}; your résumé doesn't show it.`, kind: 'requirement', choices: ['Yes', 'Some', 'No'] }))
    .filter((q) => q.ask && q.ask.length <= 170);
  if (own.length) {
    const merged = [...own.map((q) => ({ ...q, choices: fairChoices(q.choices, q.ask) })), ...questions].slice(0, 6);
    questions.length = 0;
    merged.forEach((q, i) => questions.push({ ...q, id: `q${i + 1}` }));
  }
  const qids = new Set(questions.map((q) => q.id));
  const advise = (text) => {
    const keep = sentences(clean(text, 600))
      .filter((x) => !/\[[^\]]+\]|\{[^}]+\}|<[^>]+>/.test(x)) // an unfilled "[your system]" placeholder
      .filter((x) => adviceOk(x, { resumeText: ctx.resumeText, history: ctx.sheet.history, company: ctx.company, role: ctx.jobTitle, jobDescription: ctx.jobDescription }))
      .filter((x) => [...x.matchAll(/\bq(\d+)\b/gi)].every((m) => qids.has(`q${m[1]}`)));
    const out = clip(keep.join(' '), 220);
    // Advice says what to do, or how much the posting cares; otherwise Seen's own line replaces it.
    return ACTION_RE.test(out) || STANCE_RE.test(out) ? out : '';
  };
  const gapLabel = bareLabel;
  const sameReq = (a, b) => { const x = labelWords(a).join(' '); return !!x && x === labelWords(b).join(' '); };
  // Advice that calls a requirement optional when the posting requires it is wrong ("PowerPoint: the
  // posting prefers it" — it is under Qualifications); such a sentence is dropped.
  const requiredBy = (label) => reqs.some((r) => r.importance === 'required' && overlap(label, r.label)) || ctx.requirements.some((r) => (r.importance === 'required' || r.hard) && (overlap(label, r.label) || overlap(r.label, label)));
  const stanceOk = (label, text) => !requiredBy(label) ? text : sentences(text).filter((x) => !/\b(?:prefers?|preferred|nice[- ]to[- ]have|not required|does not require|doesn't require|optional|not a blocker)\b/i.test(x)).join(' ');
  const gaps = (Array.isArray(raw?.gaps) ? raw.gaps : [])
    .map((g) => ({ label: gapLabel(g?.label), advice: advise(stanceOk(gapLabel(g?.label), clean(g?.advice, 600))) }))
    .filter((g) => g.label && !SCREENING_RE.test(g.label))
    .filter((g) => !stated.has(lc(g.label)) && !reqs.some((r) => r.strength !== 'none' && (sameReq(r.label, g.label) || overlap(g.label, r.label))) && !ctx.constraints.some((c) => c.status === 'met' && overlap(g.label, c.label)) && !impliedByTitles(g.label, ctx))
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
const NEGATIVE_ANSWER_RE = /^(?:no\b|nope|not sure|skip|never|n\/?a\b|none\b|don'?t know|idk|i don'?t|i haven'?t|i have not|i didn'?t)/i;
/** An answer that adds a fact (not "no", "not sure", a skip). */
export const affirmative = (a) => !!a && !!String(a.answer || '').trim() && !NEGATIVE_ANSWER_RE.test(String(a.answer).trim());

function answersText(answers) {
  const rows = (answers || []).filter((a) => a && a.id && String(a.answer || '').trim());
  if (!rows.length) return 'ANSWERS: none given (rewrite only from the fact sheet; leave out anything a question would have supplied).';
  return `ANSWERS FROM THE PERSON (facts, cite as "a:<id>"; a "no" or "not sure" is a fact too — never claim what it denies):\n${rows.map((a) => `- a:${a.id} (about ${a.bullet || 'the job as a whole'}) Q: ${clean(a.ask, 200)} A: ${clean(a.answer, 300)}`).join('\n')}`;
}

const jobOfBullet = (ctx, id) => bulletById(ctx.sheet, id)?.job || null;
/** The answers that are facts about one job: asked about one of its bullets. */
function answersForJob(ctx, answers, jobId) {
  return (answers || []).filter((a) => a && a.bullet && jobOfBullet(ctx, a.bullet)?.id === jobId);
}
const answerFact = (a) => `${clean(a.ask, 200)} ${clean(a.answer, 300)}`;
const jobHeader = (job) => `${job.title} ${job.company} ${job.dates || ''}`;

export function rewritePrompt(ctx, diagnosis, answers = []) {
  const plan = diagnosis.bullets.filter((b) => b.action !== 'cut');
  const byBullet = (id) => (answers || []).filter((a) => a.bullet === id && String(a.answer || '').trim());
  const system = ['You are the best human résumé writer in this field, working for one job after interviewing the person. Output ONLY a JSON object.', 'Rules:', ...CORE_RULES.map((r) => `- ${r}`),
    '- Most lines on a good résumé should be left alone. Return a line only when you can make it clearly better for THIS job — with a fact from an answer, or a real restructure (lead with the result, cut a "responsible for", surface a buried achievement, name the scale). A synonym swap or reshuffle is not a change: leave that line out.',
    '- Use the person\'s ANSWERS. Every answer that adds a fact this job cares about should end up in a rewritten line or a new bullet, cited as "a:<id>". An answer that says "no", "not sure" or walks something back ("the store\'s result, not mine", "the sous chef ran onboarding") limits what the line may claim.',
    '- Allowed changes only: grammar, spelling, tense; start with the verb; turn a duty into the action; surface an achievement; add the specifics the facts and answers give; split or merge lines; the forms recruiters search for the SAME skill; cut filler.',
    '- Tense: the current job present for ongoing work, past for finished results; earlier jobs past. No "I", "my", "we". Under 220 characters. Numbers as digits, copied exactly; simple arithmetic on the facts is fine (94% vs 88% → "6 points above").',
    '- Keep every number and fact the original had, unless you merge it into another line you also return (then keep ALL of both lines\' numbers).',
    '- When a result was shared, say what THIS person did and give the shared result as context ("Ran the weekday floor plan and credit-card push in a year the store grew sales 9%"). Never weaken to "Contributed to", "Helped with", "Participated in" when their own action is known; never strengthen past what they did.',
    '- Never claim a level the facts do not state: no "mastered", "expert", "advanced", "owned", "led", "mentored" unless the person said it.',
    '- New bullets: when an ANSWER reveals something the résumé does not say and this job cares about, add it under that job, citing the answer, saying only what it says. Never from a "no"/"not sure".',
    '- The summary: at most 2 sentences / 300 characters positioning the person for THIS job with the 1–2 strongest proofs. No recap. Every figure keeps exactly what it measured — never join two facts into one claim. Never name a credential they do not hold (a passed exam section is not the credential), never state availability they did not give, never mention what they lack.',
    '- Skills: only ones the résumé or answers show, in the form recruiters search, and only ones NOT already in the résumé\'s skills line.',
  ].join('\n');
  const lines = plan.map((b) => {
    const t = bulletById(ctx.sheet, b.id)?.text || '';
    const ans = byBullet(b.id).map((a) => `      answer a:${a.id}: Q "${clean(a.ask, 160)}" A "${clean(a.answer, 300)}"`).join('\n');
    return `  ${b.id} [${b.action}${b.why ? ` — ${b.why}` : ''}]: ${t}${ans ? `\n${ans}` : ''}`;
  }).join('\n');
  const general = (answers || []).filter((a) => !a.bullet && String(a.answer || '').trim());
  const user = [postingText(ctx), playbookText(ctx.playbook), factSheetText(ctx.sheet), answersText(answers),
    `THE BULLETS, WITH THE PLAN AND THE ANSWERS ABOUT EACH:\n${lines || '  none'}`,
    general.length ? `ANSWERS ABOUT THE JOB'S REQUIREMENTS (no single bullet):\n${general.map((a) => `  a:${a.id}: Q "${clean(a.ask, 160)}" A "${clean(a.answer, 300)}"`).join('\n')}` : '',
    `TARGET: ${diagnosis.target || ''}`,
    `Return JSON: {"rewrites":[{"id":"J1.3","text":"the new bullet","uses":["J1.3","a:q1"],"why":"what changed and why it helps for this job, in one short line"}],
"additions":[{"job":"J1","text":"a new bullet from an answer","uses":["a:q2"],"why":"one short line"}],
"summary":{"text":"…","uses":["J1.1","a:q2"]},
"skills":[{"skill":"…","evidence":"J1.2"}]}`,
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/**
 * The fact-check pass. It lists every claim in each new line with the fact that supports it (an id
 * from the fact sheet or an answer), corrects grammar, and removes or rejects — it never adds.
 */
export function reviewPrompt(ctx, draft, answers = []) {
  const items = (Array.isArray(draft?.rewrites) ? draft.rewrites : []).map((r) => {
    const orig = bulletById(ctx.sheet, r.id);
    return { id: r.id, job: orig?.job?.id, job_current: !!orig?.job?.current, original: orig?.text || '', text: r.text, cites: r.uses };
  }).concat((Array.isArray(draft?.additions) ? draft.additions : []).map((a, i) => ({ id: `add${i + 1}`, job: a.job, original: '(a new bullet)', text: a.text, cites: a.uses })));
  if (draft?.summary?.text) items.push({ id: 'summary', original: '(the summary)', text: draft.summary.text, cites: draft.summary.uses });
  const system = ['You fact-check résumé lines before a job seeker pays for them. You are strict and literal. Output ONLY a JSON object.',
    'For each item, split the new text into its claims (every action, number, scope, tool, setting, result, level and credential). For each claim give the ids that support it: a fact-sheet id (J1.2, or J1 for a job\'s title, employer and dates, or "skills"/"education"/"certifications") or an answer id (a:q2). A claim is supported only if that fact says it — not a related or bigger thing.',
    'Supported: a paraphrase of a fact; a narrower true statement (someone who "explains the shrink and labor lines" in the P&L meeting may say exactly that even though they never owned the P&L); plain arithmetic on the facts (15 of 22 → 68%; 94% vs 88% → 6 points).',
    'Unsupported: anything that says MORE than a fact; a fact from a DIFFERENT job; an intensified verb ("helped" → "led"); a level word ("mastered", "expert", "owned"); two facts joined into one claim; the very thing an answer denied; a credential only in progress; availability the person did not state.',
    'List the claims of your CORRECTED text only — what you removed is gone.',
    'If a claim is unsupported, either remove it from the text (when what is left still reads well and is better than the original) or set reject. Fix grammar and tense (current job: present for ongoing, past for finished; earlier jobs: past). Never add a fact.'].join('\n');
  const user = [factSheetText(ctx.sheet), answersText(answers), `ITEMS:\n${JSON.stringify(items).slice(0, 16000)}`,
    'Return JSON: {"items":[{"id":"J1.3","text":"the corrected text","claims":[{"claim":"cut shrink from 2.4% to 1.1%","source":["J1.2"],"supported":true}],"reject":false,"reason":"why, when rejected"}]}'].join('\n\n');
  return { system, user };
}

function citeText(ctx, ref, answers) {
  const r = String(ref || '').trim();
  if (/^a:/i.test(r)) {
    const a = (answers || []).find((x) => `a:${x.id}` === r || x.id === r.slice(2));
    return a && String(a.answer || '').trim() ? answerFact(a) : null;
  }
  return bulletById(ctx.sheet, r)?.text || null;
}

const firstWord = (t) => (String(t || '').trim().match(/^[A-Za-z'-]+/) || [''])[0];

/** The résumé's own skills line(s), to offer only the skills it does not list yet. */
function skillsSection(resumeText) {
  const lines = String(resumeText || '').split('\n');
  const h = lines.findIndex((l) => /^\s*(?:skills|technical skills|core skills|tools|skills (?:&|and) tools)\s*:?\s*$/i.test(l));
  if (h < 0) return '';
  const out = [];
  for (let i = h + 1; i < lines.length && !/^[A-Z][A-Z &/]{3,}$/.test(lines[i].trim()); i++) out.push(lines[i]);
  return out.join(' ');
}

/**
 * Every line through Seen's checks. `draft` is the writer's output, `review` the fact-checker's
 * (either may be null). Returns proposals the person can accept one by one.
 */
export function guardRewrites(ctx, diagnosis, draft, review, answers = [], { only = null } = {}) {
  const yes = (answers || []).filter(affirmative);
  const allAnswers = (answers || []).filter((a) => a && String(a.answer || '').trim());
  const answersAll = allAnswers.map(answerFact).join('\n');
  const vocab = `${ctx.resumeText}\n${yes.map(answerFact).join('\n')}`;
  const reviewItems = new Map((Array.isArray(review?.items) ? review.items : Array.isArray(review?.rewrites) ? review.rewrites : []).map((r) => [String(r.id), r]));
  const plan = new Map((diagnosis?.bullets || []).map((b) => [b.id, b]));
  const allow = [ctx.company, ctx.jobTitle];
  const proposals = [];
  const rejected = [];
  const leadCount = new Map();
  const shipped = new Set();
  const refuse = (id, text, reason, codes = []) => rejected.push({ id, text, reason, codes });

  // The fact-checker's verdict on one item: its corrected text, or a refusal.
  const reviewed = (key, text) => {
    const rv = reviewItems.get(key);
    if (!rv) return { text, ok: true, checked: false };
    if (rv.reject) return { ok: false, reason: `fact-check: ${clean(rv.reason, 160) || 'not supported'}` };
    const bad = unsupportedClaims(rv, clean(rv.text || text, 400));
    if (bad.length) return { ok: false, reason: `fact-check: not supported — ${bad.join('; ')}` };
    return { text: clean(rv.text || text, 400), ok: true, checked: true };
  };

  for (const r of Array.isArray(draft?.rewrites) ? draft.rewrites : []) {
    const id = String(r?.id || '');
    if (only && !only.has(id)) continue;
    const orig = bulletById(ctx.sheet, id);
    if (!orig) { refuse(id, '', 'unknown bullet'); continue; }
    if (shipped.has(id)) continue; // the first version that passes is the one shown
    if (plan.get(id)?.action === 'cut') continue; // a line the plan cuts is not also rewritten
    const rv = reviewed(id, r.text);
    if (!rv.ok) { refuse(id, clean(r.text, 260), rv.reason, ['fact-check']); continue; }
    const uses = (Array.isArray(r.uses) ? r.uses : []).map(String);
    if (!uses.includes(id)) uses.unshift(id);
    // grammar for this job's tense
    const g = checkBullet(clean(rv.text, 260), { current: orig.job.current });
    const text = g.text;
    if (!g.ok) { refuse(id, text, `grammar: ${g.issues.filter((i) => i.fatal).map((i) => i.note).join('; ')}`, ['grammar']); continue; }
    // The line's sources: itself, the bullets it cites, the person's answers about this job, the job header.
    const jobAnswers = answersForJob(ctx, answers, orig.job.id);
    const citedGeneral = uses.filter((u) => /^a:/.test(u)).map((u) => (answers || []).find((a) => `a:${a.id}` === u)).filter((a) => a && !a.bullet);
    const facts = [...uses.filter((u) => /^J\d+\.\d+$/.test(u) && u !== id).map((u) => bulletById(ctx.sheet, u)?.text).filter(Boolean),
      ...[...jobAnswers, ...citedGeneral].filter(affirmative).map(answerFact), ...[...jobAnswers, ...citedGeneral].filter((a) => !affirmative(a)).map(answerFact), jobHeader(orig.job)];
    const answeredHere = jobAnswers.some((a) => a.bullet === id && affirmative(a));
    const issues = checkClaims(text, { before: orig.text, facts, resumeText: ctx.resumeText, history: ctx.sheet.history, allowTerms: allow, answersText: answersAll, allowLost: answeredHere });
    if (issues.length) { refuse(id, text, issues.map((i) => i.note).join('; '), issues.map((i) => i.code)); continue; }
    // Without the fact-checker, the older word-overlap check stands in for it.
    if (!rv.checked) {
      const v = verifyRewrite({ before: orig.text, after: text, facts, resumeText: vocab, allowTerms: allow, allowLost: answeredHere });
      if (v.reasons.some((x) => x === 'new_claims' || x === 'claim_word')) { refuse(id, text, `facts: ${v.notes.join('; ')}`, v.reasons); continue; }
    }
    // The same line back is no change; a word swap is not one either, unless the person's answer added a fact.
    if (norm(text).replace(/[^a-z0-9%]+/g, '') === norm(orig.text).replace(/[^a-z0-9%]+/g, '')) continue;
    const changedNumbers = numbersOf(text).join(' ') !== numbersOf(orig.text).join(' ');
    const origWords = new Set(contentWords(norm(orig.text)));
    const addsWords = contentWords(norm(text)).filter((w) => !origWords.has(w)).length >= 2;
    if (!changedNumbers && !(answeredHere && addsWords) && isCosmetic(orig.text, text)) { refuse(id, text, 'changes only a word or two — the original stays', ['cosmetic']); continue; }
    // Borrowing another bullet's facts is a merge: all of that line's numbers come along and it is removed.
    const merges = [];
    let mergeBad = '';
    for (const u of uses.filter((x) => /^J\d+\.\d+$/.test(x) && x !== id)) {
      const other = bulletById(ctx.sheet, u);
      if (!other) continue;
      if (other.job.id !== orig.job.id) { mergeBad = `uses ${u}, a line from a different job`; break; }
      const missing = numbersOf(other.text).filter((n) => !numbersOf(text).includes(n));
      if (missing.length) { mergeBad = `merges ${u} but leaves out its ${missing.join(', ')}`; break; }
      if (proposals.some((p) => p.id === u || (p.merges || []).includes(u))) { mergeBad = `${u} is already changed by another suggestion`; break; }
      merges.push(u);
    }
    if (mergeBad) { refuse(id, text, mergeBad, ['merge']); continue; }
    if (AI_TELL_RE.test(text) && !AI_TELL_RE.test(orig.text)) { refuse(id, text, `AI wording: "${text.match(AI_TELL_RE)[0]}"`, ['ai']); continue; }
    const lead = verbBase(firstWord(text)) || lc(firstWord(text));
    const was = verbBase(firstWord(orig.text)) || lc(firstWord(orig.text));
    if (verbStrength(lead) > verbStrength(was) && verbStrength(lead) === 3 && !facts.concat(orig.text).some((f) => lc(f).includes(lead.slice(0, 4)))) {
      refuse(id, text, `"${firstWord(orig.text)}" became "${firstWord(text)}" — a stronger claim than the facts make`, ['intensified']);
      continue;
    }
    leadCount.set(`${orig.job.id}|${lead}`, (leadCount.get(`${orig.job.id}|${lead}`) || 0) + 1);
    shipped.add(id);
    proposals.push({
      id, job: orig.job.id, before: orig.text, after: text,
      ...(merges.length ? { merges, merged_text: merges.map((u) => bulletById(ctx.sheet, u).text) } : {}),
      why: clip(r.why, 180),
      uses: uses.filter((u) => citeText(ctx, u, answers)),
      used_answers: uses.filter((u) => /^a:/.test(u) && citeText(ctx, u, answers)),
      checks: ['every claim traced', 'grammar and tense', g.issues.length ? `fixed: ${g.issues.map((i) => i.code).join(', ')}` : null].filter(Boolean),
      repeated_lead: false,
    });
  }

  // New bullets from answers: only what a yes-answer says, in the job's tense, after the job's last bullet.
  const perJob = new Map();
  (Array.isArray(draft?.additions) ? draft.additions : []).slice(0, 4).forEach((a, i) => {
    const job = ctx.sheet.jobs.find((j) => j.id === String(a?.job || ''));
    const uses = (Array.isArray(a?.uses) ? a.uses : []).map(String).filter((u) => /^a:/.test(u));
    const cited = uses.map((u) => (answers || []).find((x) => `a:${x.id}` === u)).filter(Boolean);
    const key = `new:${a?.job || '?'}`;
    if (!job || !job.bullets.length) { refuse(key, clean(a?.text, 260), 'a new bullet needs a job on the résumé'); return; }
    if (!cited.length || !cited.every(affirmative)) { refuse(key, clean(a?.text, 260), 'a new bullet must come from a yes-answer the person gave', ['no-answer']); return; }
    const rv = reviewed(`add${i + 1}`, a.text);
    if (!rv.ok) { refuse(key, clean(a?.text, 260), rv.reason, ['fact-check']); return; }
    const g = checkBullet(clean(rv.text, 260), { current: job.current });
    const text = g.text;
    if (!g.ok) { refuse(key, text, `grammar: ${g.issues.filter((x) => x.fatal).map((x) => x.note).join('; ')}`, ['grammar']); return; }
    const facts = [...cited.map(answerFact), jobHeader(job)];
    const issues = checkClaims(text, { facts, resumeText: ctx.resumeText, history: ctx.sheet.history, allowTerms: allow, answersText: answersAll });
    if (issues.length) { refuse(key, text, issues.map((x) => x.note).join('; '), issues.map((x) => x.code)); return; }
    if (!rv.checked) {
      const v = verifyRewrite({ before: '', after: text, facts, resumeText: vocab, allowTerms: allow });
      if (v.reasons.some((x) => x === 'new_claims' || x === 'claim_word')) { refuse(key, text, `facts: ${v.notes.join('; ')}`, v.reasons); return; }
    }
    if (AI_TELL_RE.test(text)) { refuse(key, text, `AI wording: "${text.match(AI_TELL_RE)[0]}"`, ['ai']); return; }
    if (proposals.some((p) => lc(p.after) === lc(text)) || job.bullets.some((b) => lc(b.text) === lc(text))) return;
    const n = (perJob.get(job.id) || 0) + 1;
    perJob.set(job.id, n);
    proposals.push({
      id: `${job.id}.new${n}`, job: job.id, before: '', after: text, add: true,
      insert_after: job.bullets[job.bullets.length - 1].text,
      why: clip(a?.why, 180) || 'From your answer.',
      uses, used_answers: uses,
      checks: ['from your answer', 'every claim traced', 'grammar and tense'], repeated_lead: false,
    });
  });
  for (const p of proposals) p.repeated_lead = (leadCount.get(`${p.job}|${verbBase(firstWord(p.after)) || lc(firstWord(p.after))}`) || 0) > 2;

  // The summary: the strictest item — every claim sourced, the person's own credentials and years only.
  let summary = null;
  const sDraft = clean(draft?.summary?.text, 600);
  if (sDraft && !only) {
    const rv = reviewed('summary', sDraft);
    if (!rv.ok) refuse('summary', sDraft, rv.reason, ['fact-check']);
    else {
      const sText = clean(rv.text, 600);
      const g = checkSummary(sText);
      const issues = checkClaims(sText, { facts: [ctx.resumeText, ...yes.map(answerFact)], resumeText: ctx.resumeText, history: ctx.sheet.history, allowTerms: allow, answersText: answersAll, isSummary: true });
      const tooLong = sText.length > 360 || sentences(sText).length > 2;
      if (g.ok && !issues.length && !tooLong && !AI_TELL_RE.test(sText)) summary = { text: g.text, replaces: '' };
      else refuse('summary', sText, [!g.ok && 'grammar', ...issues.map((i) => i.note), tooLong && 'too long — a summary is two sentences', AI_TELL_RE.test(sText) && 'AI wording'].filter(Boolean).join('; '), ['summary']);
    }
  }

  // Skills to ADD: shown by the résumé or a yes-answer, and not already on the skills line.
  const listed = norm(skillsSection(ctx.resumeText));
  const seen = new Set();
  const skills = (Array.isArray(draft?.skills) ? draft.skills : []).map((x) => clean(x?.skill, 60)).filter((sk) => {
    const k = norm(sk);
    if (!sk || seen.has(k) || (listed && listed.includes(k))) return false;
    seen.add(k);
    return norm(vocab).includes(k) || contentWords(sk).every((w) => norm(vocab).includes(norm(w)));
  }).slice(0, 10);

  // Answers that added a fact but went unused — the repair pass gets one more try with them.
  const used = new Set(proposals.flatMap((p) => p.used_answers));
  if (summary) for (const u of (draft?.summary?.uses || [])) used.add(String(u));
  const unused = yes.filter((a) => !used.has(`a:${a.id}`)).map((a) => a.id);

  return { proposals, summary, skills, rejected, unused };
}

// A refused line goes back to the writer once with the exact reason, and unused answers go with it.
// A word swap is not repaired: when the honest best is the original, the original stays.
const REPAIRABLE = (r) => r && /^J\d+\.\d+$/.test(r.id) && r.text && !(r.codes || []).some((c) => c === 'cosmetic' || c === 'credential') && !/^unknown/.test(r.reason || '');
export function repairable(rejected) { return (rejected || []).filter(REPAIRABLE); }

export function repairPrompt(ctx, rejected, answers = [], unused = []) {
  const items = repairable(rejected).slice(0, 8);
  const left = (answers || []).filter((a) => unused.includes(a.id));
  const system = ['You fix résumé lines that Seen\'s checks refused, and use answers the first draft left out. Output ONLY a JSON object.', 'Rules:', ...CORE_RULES.map((r) => `- ${r}`),
    '- Fix exactly what the check names: drop or replace any claim the facts do not state; keep every number the original has; correct tense; no "I". If the honest version adds nothing over the original, leave it out.',
    '- For each UNUSED ANSWER that adds a fact this job cares about, rewrite the bullet it is about or add a new bullet under its job, citing it. Say only what the answer says.'].join('\n');
  const user = [factSheetText(ctx.sheet), answersText(answers),
    items.length ? `REFUSED LINES (fix each, or leave it out):\n${items.map((r) => `- ${r.id} — original: "${bulletById(ctx.sheet, r.id)?.text || ''}" — refused version: "${r.text}" — why: ${r.reason}`).join('\n')}` : '',
    left.length ? `UNUSED ANSWERS:\n${left.map((a) => `- a:${a.id} (about ${a.bullet || 'the job'}): Q "${clean(a.ask, 160)}" A "${clean(a.answer, 300)}"`).join('\n')}` : '',
    'Return JSON: {"rewrites":[{"id":"J1.3","text":"…","uses":["J1.3","a:q1"],"why":"what changed, one short line"}],"additions":[{"job":"J1","text":"…","uses":["a:q2"],"why":"…"}]}'].filter(Boolean).join('\n\n');
  return { system, user, ids: items.map((r) => r.id) };
}

/** Apply accepted proposals to the résumé text (bullet text replaced in place). */
export function applyProposals(resumeText, proposals, acceptedIds) {
  let out = String(resumeText || '');
  const ok = new Set(acceptedIds || proposals.map((p) => p.id));
  for (const p of proposals) {
    if (!ok.has(p.id)) continue;
    if (p.add) {
      const lines = out.split('\n');
      const at = lines.findIndex((l) => l.includes(p.insert_after));
      if (at >= 0) { const mark = (lines[at].match(/^\s*[•●▪◦*·\-–—]\s*/) || ['• '])[0]; lines.splice(at + 1, 0, `${mark}${p.after}`); out = lines.join('\n'); }
      continue;
    }
    const idx = out.indexOf(p.before);
    if (idx >= 0) out = out.slice(0, idx) + p.after + out.slice(idx + p.before.length);
    // a merged line leaves the résumé with its bullet marker
    for (const m of p.merged_text || []) out = out.split('\n').filter((l) => l.replace(/^[\s•●▪◦*·\-–—]+/, '').trim() !== m).join('\n');
  }
  return out;
}
