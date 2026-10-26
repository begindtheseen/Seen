// Seen's résumé optimizer with no model API (owner decision 2026-10-26: "We are not relying on api").
//
// Everything here is Seen's own code: the posting is read by lib/optimizer (requirements, evidence,
// screening constraints), the résumé by lib/server/prepFacts (every fact numbered), lines are restated
// by lib/resume/rewrite (rules that restate and never add), and every line still goes through the same
// checks as before (grammar and tense, claim-by-claim grounding — lib/resume/optimize/claims.js).
//
// The idea that makes it work without a model: Seen writes every question itself, so it knows where
// each answer goes. A question carries a SLOT:
//   - scale   (a bullet with no number) → the answer's figure is added to that bullet;
//   - outcome (a duty with no result)   → the answer's result is joined to that bullet;
//   - stepup / requirement (no bullet)  → a yes-answer with details becomes a new line in the
//     person's own words ("I run the store on the manager's two days off" → "Run the store on the
//     Store Manager's two days off");
//   - credential                        → what to put under Certifications.
// The answer is the person's words; Seen only turns first person into résumé form and fixes tense.

import { rewriteBullet } from '../rewrite/rules.js';
import { findMetrics, analyzeLead } from '../health/bullet.js';
import { checkBullet } from './grammar.js';
import { bulletById } from '../../server/prepFacts.js';
import { spokenLength } from '../../server/prepClaims.js';
import { guardDiagnosis, guardRewrites, affirmative } from './engine.js';
import { norm } from './claims.js';
import { sectionPosting } from '../../optimizer/postingSections.js';

const clean = (s, n = 400) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const lcFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const short = (t, n = 60) => { const s = clean(t); return s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n - 1))}…`; };

// A result word says the line already has an outcome ("cut", "grew", "raised", "%", "award").
const RESULT_RE = /\b(?:cut|grew|raised|reduced|increased|improved|saved|lifted|boosted|won|earned|ranked|named|recogni[sz]ed|award|top|record|zero|passed|hit|exceeded|beat|achieved|kept|held|retained|promoted)\b|\d+(?:\.\d+)?%|#\d/i;

// ── answers → résumé language ───────────────────────────────────────────────────────────────────
const LEAD_NOISE_RE = /^(?:yes|yeah|yep|yup|sure|correct|right|mostly|definitely|absolutely|kind of|sort of|some|sometimes|a little|i think|i'd say|honestly|well)\b[\s,.:;—–-]*/i;

/**
 * The person's answer as a résumé clause: no "I", "my" → "the", tense for the job, a capital first.
 * Returns '' when what is left does not start with something they did (it stays an interview note).
 */
/** "the SM" → "the Store Manager": initials of a title on the résumé or in the posting, written out. */
export function expandInitials(text, titles = []) {
  let t = String(text || '');
  for (const title of titles) {
    const words = String(title || '').split(/[^A-Za-z]+/).filter((w) => w.length > 1 && !/^(?:of|and|the|for|at|ii|iii|iv)$/i.test(w));
    if (words.length < 2) continue;
    const ini = words.map((w) => w[0].toUpperCase()).join('');
    t = t.replace(new RegExp(`\\b${ini}(?=['’]s\\b|\\b)`, 'g'), words.map((w) => capFirst(w)).join(' '));
  }
  return t;
}

export function fromFirstPerson(answer, { current = false, titles = [] } = {}) {
  let t = expandInitials(clean(answer, 300), titles);
  for (let i = 0; i < 3; i++) t = t.replace(LEAD_NOISE_RE, '');
  // the first sentence that states something they did ("Yes, regularly. I run the store on…" → the second)
  // split into clauses — never inside parentheses — and at ", and I …" so each clause is one fact
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(') depth += 1;
    if (c === ')') depth = Math.max(0, depth - 1);
    cur += c;
    const rest = t.slice(i + 1);
    if (depth === 0 && (/[.!?;]/.test(c) && /^\s/.test(rest) || /^,?\s+(?:and|but)\s+(?:i|we)\b/i.test(rest) || /^\s+[—–]\s+/.test(rest))) {
      parts.push(cur.trim()); cur = '';
      const m = rest.match(/^,?\s+(?:and|but)\s+(?=(?:i|we)\b)|^\s+[—–]\s+/i);
      if (m) i += m[0].length;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  for (const part of parts) {
    if (/^(?:not sure|no\b|i don'?t know|skip|n\/a)/i.test(part)) continue;
    let p = part.replace(/[.!?;]+$/, '');
    p = p.replace(/^(?:i|we)\s+(?:also\s+|usually\s+|normally\s+|typically\s+|mostly\s+)?/i, '').replace(/^(?:i'?ve|we'?ve)\s+/i, '').replace(/^(?:i'?m|we'?re)\s+/i, '');
    p = p.replace(/\b(?:my|our) own\s+/gi, '').replace(/\b(?:my|our)\b/gi, 'the').replace(/\bthe the\b/gi, 'the').replace(/\s{2,}/g, ' ').trim();
    if (p.split(/\s+/).length < 3 || /\b(?:I|me|we|us|she|he|they)\b/.test(p) || (p.match(/\(/g) || []).length !== (p.match(/\)/g) || []).length) continue;
    // the person's own tense stands: "I did the interviews" about 2023 hires stays past in a current job
    const lead = analyzeLead(capFirst(p));
    const g = checkBullet(capFirst(p), { current: current && lead.tense !== 'past' });
    if (g.ok) return g.text;
  }
  return '';
}

/** A figure from an answer ("about 900–950 a week, more in Nov–Dec") as a short phrase, or ''. */
const UNSURE_RE = /\b(?:not sure|don'?t know|no idea|i'?d have to check|unsure|i think|i guess|maybe|probably)\b/i;
export function figureFrom(answer) {
  const t = clean(answer, 200).replace(LEAD_NOISE_RE, '');
  if (!/\d/.test(t) || UNSURE_RE.test(t.split(/(?<=[.!?])\s+/)[0])) return '';
  // only a clean figure: it starts with the number or "about/up to/over/nearly" + the number
  if (!/^(?:about|around|roughly|up to|over|nearly|almost|more than|at least|\$)?\s*\$?\d/i.test(t)) return '';
  const first = t.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, '');
  const words = first.split(/\s+/);
  if (words.length > 14) return '';
  if (/^(?:i|we)\b/i.test(first)) return '';
  return lcFirst(first.replace(/^(?:it'?s|its|that'?s|that was|it was|around|roughly)\s+/i, (m) => (/around|roughly/i.test(m) ? 'about ' : '')).trim());
}

/** "my station" → "the station", "since I started" → "since starting"; '' when an "I" is left mid-line. */
export function withoutPronouns(text) {
  let t = clean(text).replace(/\b(?:my|our) own\s+/gi, '').replace(/\bsince (?:i|we) (?:started|joined|began)\b/gi, 'since starting').replace(/\bwhen (?:i|we)\b/gi, 'when')
    .replace(/\b(?:my|our)\b/gi, 'the').replace(/\bthe the\b/gi, 'the');
  return /\b(?:I|me|we|us|myself)\b/.test(t) ? '' : t;
}

// ── 1. Diagnose with no model ───────────────────────────────────────────────────────────────────
/**
 * The same diagnosis shape the model used to return, built from Seen's own readers, then validated by
 * guardDiagnosis exactly as before (evidence repair, credentials, step-up and requirement questions).
 */
export function localDiagnosis(ctx) {
  const all = ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => ({ ...b, job: j })));
  // Seen's posting reader: requirement → the résumé line it found as evidence
  const requirements = ctx.requirements.map((r) => {
    const ev = r.evidence ? norm(r.evidence).replace(/^[•\s]+/, '').slice(0, 40) : '';
    const hit = ev ? all.find((b) => norm(b.text).startsWith(ev)) : null;
    return { label: r.label + (r.importance === 'preferred' ? ' (preferred)' : r.hard || r.importance === 'required' ? ' (required)' : ''), evidence: hit ? [hit.id] : [], strength: hit ? 'strong' : 'none' };
  });
  // The posting's own short requirement and nice-to-have lines ("Seafood experience", "ServSafe Manager
  // certification") are requirements too, even when no skill list knows them.
  const known = (label) => requirements.some((r) => { const a = norm(r.label), b = norm(label); return a.includes(b) || b.includes(a.replace(/\s*\((?:required|preferred)\)$/, '')); });
  // "BLS required; ACLS required within 6 months of hire" is two requirements
  const lines = sectionPosting(ctx.jobDescription).flatMap((x) => clean(x.sentence).split(/;\s+/).map((part) => ({ ...x, sentence: part })));
  for (const x of lines) {
    if (x.kind !== 'requirements' && x.kind !== 'preferred') continue;
    let label = clean(x.sentence).replace(/[.;:]+$/, '').replace(/\s*\((?:a plus|preferred|nice to have)\)$/i, '').replace(/\s+(?:is )?a (?:big )?plus$/i, '').replace(/,?\s+(?:preferred|required|strongly preferred)$/i, '');
    if (!label || label.split(/\s+/).length > 9 || /^(?:what|who|about|you|we|our)\b/i.test(label) || known(label)) continue;
    // a line that tells you to do something ("Type at least 45 WPM", "Meet goals…") or sets a numeric
    // bar is not a named thing to ask about; the posting reader checks those as constraints
    const lead = analyzeLead(label);
    if (lead.kind !== 'noun' && lead.kind !== 'none') continue;
    if (/\d/.test(label) && !/\b(?:EPA|OSHA|ISO|CDL|ACLS|BLS|PALS|NRP|CPR|license|licen[cs]e|certif\w*|ServSafe)\b/i.test(label)) continue;
    requirements.push({ label: `${label}${x.kind === 'preferred' ? ' (preferred)' : ' (required)'}`, evidence: [], strength: 'none' });
  }
  const evidenceIds = new Set(requirements.flatMap((r) => r.evidence));
  // plan: a line the rules can restate or whose grammar needs fixing is a rewrite; posting evidence
  // that is not first in its job moves up
  const bullets = all.map((b) => {
    const lint = ctx.lint[b.id] || [];
    const rw = rewriteBullet(withoutPronouns(b.text) || b.text, { tense: 'keep' });
    const action = lint.length || !rw.unchanged ? 'rewrite' : evidenceIds.has(b.id) && b.job.bullets[0].id !== b.id ? 'move_up' : 'keep';
    const level = RESULT_RE.test(b.text) ? (findMetrics(b.text).length ? 3 : 2) : findMetrics(b.text).length ? 2 : 1;
    return { id: b.id, level, action, why: lint.length ? 'grammar or tense to fix' : !rw.unchanged ? 'can be said more directly' : evidenceIds.has(b.id) ? 'evidence for what this job asks' : '' };
  });
  // Questions Seen asks about specific lines: the closest evidence first, then the current job.
  const ranked = all
    .map((b) => ({ b, score: (evidenceIds.has(b.id) ? 3 : 0) + (b.job.current ? 2 : 0) + (b.job.id === 'J2' ? 1 : 0) }))
    .sort((x, y) => y.score - x.score);
  const questions = [];
  const recent = new Set(ctx.sheet.jobs.slice(0, 2).map((j) => j.id));
  for (const { b } of ranked) {
    if (questions.length >= 3) break;
    if (!recent.has(b.job.id)) continue; // the two most recent jobs carry the résumé
    const lead = analyzeLead(b.text);
    if (lead.kind === 'noun' || lead.kind === 'none' || lead.kind === 'weak') continue;
    if (!/\d|\b(?:half|third|quarter|double|twice|triple|dozen)\b/i.test(b.text)) {
      questions.push({ bullet: b.id, ask: `For "${short(b.text, 64)}": what numbers go with it — how many, how much, how often?`, why: 'A number lets a hiring manager see the size of the job.', kind: 'scale', choices: [] });
    } else if (!RESULT_RE.test(b.text) && evidenceIds.has(b.id)) {
      questions.push({ bullet: b.id, ask: `For "${short(b.text, 64)}": what came of it — a result, a comparison, or praise?`, why: 'A result turns a duty into proof.', kind: 'outcome', choices: [] });
    }
  }
  const gaps = requirements.filter((r) => r.strength === 'none').map((r) => ({ label: r.label, advice: '' }));
  const current = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  const target = current ? `${current.title} applying for ${clean(ctx.jobTitle, 80)}` : '';
  return guardDiagnosis({ target, bullets, requirements, questions, gaps }, ctx);
}

/** Does a clause mostly say what the line already says ("set common assessments" twice)? */
function repeats(line, clause) {
  const lw = new Set(norm(line).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const cw = norm(clause).split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  return cw.length > 0 && cw.filter((w) => lw.has(w)).length / cw.length >= 0.5;
}

// ── 2. Rewrite with no model ────────────────────────────────────────────────────────────────────
/** The draft (same shape the writer model returned), built by rules and the person's answers. */
export function localDraft(ctx, diagnosis, answers = []) {
  const titles = [...ctx.sheet.jobs.map((j) => j.title), ctx.jobTitle].filter(Boolean);
  const rewrites = [];
  const additions = [];
  const byBullet = new Map();
  for (const a of answers || []) if (a.bullet) byBullet.set(a.bullet, [...(byBullet.get(a.bullet) || []), a]);
  for (const plan of diagnosis.bullets) {
    if (plan.action === 'cut') continue;
    const b = bulletById(ctx.sheet, plan.id);
    if (!b) continue;
    let text = withoutPronouns(b.text) || b.text;
    const uses = [plan.id];
    // the rules restate (weak lead, hidden verb, passive, filler) — never add; tense is grammar.js's job
    const rw = rewriteBullet(text, { tense: 'keep' });
    if (!rw.unchanged && rw.firewall?.ok !== false) text = rw.text;
    // keep the résumé's own style: no full stop where its bullets have none
    if (!/[.]\s*$/.test(b.text)) text = text.replace(/\.\s*$/, '');
    // the person's answers about this line
    for (const a of byBullet.get(plan.id) || []) {
      if (!affirmative(a)) continue;
      const q = (diagnosis.questions || []).find((x) => x.id === a.id);
      const fig = figureFrom(a.answer);
      const clause = fromFirstPerson(a.answer, { current: b.job.current, titles });
      if (q?.kind === 'scale' && fig && !norm(text).includes(norm(fig))) { text = `${text.replace(/[.;]\s*$/, '')} — ${fig}`; uses.push(`a:${a.id}`); }
      else if (clause && !UNSURE_RE.test(clause) && clause.split(/\s+/).length <= 16 && !repeats(text, clause)) { text = `${text.replace(/[.;]\s*$/, '')}; ${lcFirst(clause)}`; uses.push(`a:${a.id}`); }
      else if (fig && !norm(text).includes(norm(fig))) { text = `${text.replace(/[.;]\s*$/, '')} — ${fig}`; uses.push(`a:${a.id}`); }
    }
    // a draft Seen cannot make grammatical is not shown as a suggestion at all
    if (!checkBullet(text, { current: b.job.current }).ok) continue;
    const RULE_WHY = { weak_lead: 'starts with what you did', hidden_verb: 'uses the verb instead of a noun', passive: 'active voice', filler: 'cuts filler words', doublet: 'cuts a repeated word', pronoun: 'résumé lines leave out "I" and "my"', tense: 'tense for this job' };
    const dropsMy = /\b(?:my|our)\b/i.test(b.text) && !/\b(?:my|our)\b/i.test(text);
    const why = uses.length > 1 ? 'adds what you told Seen' : [...new Set([...(dropsMy ? ['pronoun'] : []), ...(rw.changes || []).map((c) => c.rule)].map((r) => RULE_WHY[r]).filter(Boolean))].join('; ') || 'clearer';
    if (text !== b.text) rewrites.push({ id: plan.id, text, uses, why });
  }
  // answers with no single line (the step-up job, a requirement): a yes with details is a new line in
  // the person's own words, under their current job
  const current = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  for (const a of answers || []) {
    if (a.bullet || !affirmative(a) || !current) continue;
    const clause = fromFirstPerson(a.answer, { current: current.current, titles });
    if (!clause || clause.split(/\s+/).length < 4 || UNSURE_RE.test(clause)) continue;
    additions.push({ job: current.id, text: clause, uses: [`a:${a.id}`], why: 'from your answer' });
  }
  // summary: who they are for this job and the strongest proof, from facts only
  const summary = localSummary(ctx, diagnosis);
  // skills the posting asks for that the résumé shows and the skills line lacks
  // skills worth adding: a named tool or credential the posting asks for and the résumé shows, written
  // the way the posting writes it ("Salesforce", not "salesforce experience")
  const posting = String(ctx.jobDescription || '');
  const skills = (diagnosis.requirements || []).filter((r) => r.strength !== 'none' && r.label.split(/\s+/).length <= 3)
    .map((r) => { const m = posting.match(new RegExp(`\\b${r.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')); return m && /[A-Z]/.test(m[0]) ? { skill: m[0] } : null; })
    .filter(Boolean);
  return { rewrites, additions, summary, skills };
}

/** "Assistant Store Manager with 5½ years in retail who cut shrink from 2.4% to 1.1% in 12 months." */
export function localSummary(ctx, diagnosis) {
  const current = ctx.sheet.jobs.find((j) => j.current) || ctx.sheet.jobs[0];
  if (!current) return null;
  const months = Number(current.months) || (ctx.sheet.history.find((h) => h.title === current.title)?.months ?? 0);
  const length = months >= 12 ? spokenLength(months) : '';
  const evidence = new Set((diagnosis.requirements || []).flatMap((r) => r.evidence || []));
  const proof = ctx.sheet.jobs.flatMap((j) => j.bullets.map((b) => ({ ...b, job: j })))
    .filter((b) => RESULT_RE.test(b.text) && (findMetrics(b.text).length || /\b(?:half|third|quarter|double|twice|triple)\b/i.test(b.text)) && withoutPronouns(b.text))
    .sort((x, y) => (evidence.has(y.id) - evidence.has(x.id)) || (y.job.current - x.job.current))[0];
  const proofClause = proof ? lcFirst(checkBullet(withoutPronouns(proof.text), { current: false }).text).replace(/[.;]\s*$/, '') : '';
  const head = `${current.title}${length ? ` with ${length} at ${current.company}` : current.company ? ` at ${current.company}` : ''}`;
  const text = proofClause ? `${head} who ${proofClause}.` : `${head}.`;
  return { text, uses: [current.id, ...(proof ? [proof.id] : [])] };
}

/** The whole rewrite step, checked line by line exactly as before. */
export function localRewrite(ctx, diagnosis, answers = []) {
  const draft = localDraft(ctx, diagnosis, answers);
  return guardRewrites(ctx, diagnosis, draft, null, answers);
}
