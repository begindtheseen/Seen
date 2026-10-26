// Answers a company page can give, with its own real numbers, to the questions people actually searched
// (2026-10-24). lib/server/searchOpportunities.js topIntentsForCompany() says which intents real searchers used
// for a company; each function here turns the page's facts into { question, answer } for one intent, or null
// when the data cannot answer it honestly. The company FAQ leads with these, so a page answers first exactly
// what people came to ask.
//
// Input: the page's facts object, lib/companyMeta.ts companyMetaFacts() output (read-only contract):
//   { name, gradeable, score, grade, reportCount, mentions, ratesShown, ghostPct, respPct, waitDays,
//     verdictKind, basis, … }
// plus optional extras the facts object does not carry: { avgRounds } (score.avg_rounds, already gated by the
// grade) and { openListings } (count of open listings shown on the page).
//
// Rules (same as the rest of the company surface): nothing is invented; a number appears only when the facts
// carry it; every rate names how many applicant accounts it stands on ("N applicant accounts say…"); nothing is
// said about an ungraded company except what is countable; correct plurals; no dashes in the copy.

import { classifyIntent } from './searchIntents.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const reports = (n) => plural(n, 'applicant account');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const canQuoteRates = (f) => !!f && f.gradeable === true && f.ratesShown === true && num(f.respPct) != null && num(f.ghostPct) != null && num(f.reportCount) > 0;
const canQuoteWait = (f) => !!f && f.gradeable === true && num(f.waitDays) != null && f.waitDays >= 0 && num(f.reportCount) > 0;
const canQuoteGrade = (f) => !!f && f.gradeable === true && num(f.score) != null && !!f.grade && num(f.reportCount) > 0;

const waitPhrase = (d) => (d === 0 ? 'less than a day' : `about ${plural(d, 'day')}`);
const CLAIMS = 'These are outcomes applicants reported, not verified facts.';

/** "How long does Target take to respond to applications?" — response rate and/or average wait. */
export function applicationStatusAnswer(f) {
  if (!canQuoteRates(f) && !canQuoteWait(f)) return null;
  const parts = [];
  if (canQuoteRates(f)) parts.push(`${reports(f.reportCount)} say ${f.respPct}% of applicants heard back from ${f.name} and ${f.ghostPct}% never heard anything.`);
  if (canQuoteWait(f)) parts.push(`Applicants report waiting ${waitPhrase(f.waitDays)} on average to hear back${canQuoteRates(f) ? '' : `, based on ${reports(f.reportCount)}`}.`);
  parts.push(CLAIMS);
  return { question: `How long does ${f.name} take to respond to applications?`, answer: parts.join(' ') };
}

/** "How long does it take to hear back from Target?" — the average wait only. */
export function howLongAnswer(f) {
  if (!canQuoteWait(f)) return null;
  return { question: `How long does it take to hear back from ${f.name}?`,
    answer: `Applicants report waiting ${waitPhrase(f.waitDays)} on average to hear back from ${f.name}, based on ${reports(f.reportCount)}.${canQuoteRates(f) ? ` ${f.respPct}% of applicants heard back at all.` : ''} ${CLAIMS}` };
}

/** "Does Target ghost applicants?" — the ghost rate, only when rates are shown. */
export function doesGhostAnswer(f) {
  if (!canQuoteRates(f)) return null;
  const read = f.ghostPct >= 60 ? 'Most applicants report never hearing back.' : f.ghostPct >= 30 ? 'A large share of applicants report being ghosted.' : 'Most applicants do hear back one way or another.';
  return { question: `Does ${f.name} ghost applicants?`,
    answer: `${reports(f.reportCount)} say ${f.ghostPct}% of applicants never heard back from ${f.name} after applying or interviewing. ${read} ${CLAIMS}` };
}

/** "What is the interview process like at Target?" — needs the reported average rounds. */
export function interviewProcessAnswer(f, { avgRounds } = {}) {
  const r = num(avgRounds);
  if (!canQuoteGrade(f) || r == null || r <= 0) return null;
  const rounds = Math.max(1, Math.round(r));
  return { question: `What is the interview process like at ${f.name}?`,
    answer: `Applicants who described their interviews report about ${plural(rounds, 'round')} at ${f.name} on average, based on ${reports(f.reportCount)}.${canQuoteWait(f) ? ` Applicants report waiting ${waitPhrase(f.waitDays)} on average to hear back.` : ''} ${CLAIMS}` };
}

/** "What is the hiring process like at Target?" — grade, then response rate, wait and rounds when known. */
export function hiringProcessAnswer(f, { avgRounds } = {}) {
  if (!canQuoteGrade(f)) return null;
  const parts = [`Seen grades ${f.name} ${f.grade} (${f.score}/100) for hiring transparency from ${f.basis || reports(f.reportCount)}.`];
  if (canQuoteRates(f)) parts.push(`${f.respPct}% of applicants heard back and ${f.ghostPct}% were ghosted.`);
  if (canQuoteWait(f)) parts.push(`Applicants report waiting ${waitPhrase(f.waitDays)} on average to hear back.`);
  const r = num(avgRounds);
  if (r != null && r > 0) parts.push(`Applicants report about ${plural(Math.max(1, Math.round(r)), 'interview round')} on average.`);
  parts.push(CLAIMS);
  return { question: `What is the hiring process like at ${f.name}?`, answer: parts.join(' ') };
}

/** "Is Insight Global legit?" — what applicants report, never a verdict Seen cannot make. */
export function isLegitAnswer(f) {
  if (!canQuoteGrade(f)) return null;
  return { question: `Is ${f.name} legit, according to applicants?`,
    answer: `Seen cannot verify an employer, but ${f.basis || reports(f.reportCount)} give ${f.name} a Seen Grade of ${f.grade} (${f.score}/100).${canQuoteRates(f) ? ` ${f.respPct}% of applicants heard back and ${f.ghostPct}% never heard anything.` : ''} ${CLAIMS}` };
}

/** "Is Target hiring right now?" — only with a real count of open listings. */
export function jobsAtAnswer(f, { openListings } = {}) {
  const n = num(openListings);
  if (!f || !f.name || n == null || n < 1) return null;
  return { question: `Is ${f.name} hiring right now?`,
    answer: `Seen lists ${plural(Math.round(n), 'open job')} at ${f.name}.${canQuoteRates(f) ? ` Before you apply: ${reports(f.reportCount)} say ${f.respPct}% of applicants heard back.` : ''}` };
}

export const ANSWERS = {
  application_status: applicationStatusAnswer,
  how_long_to_hear_back: howLongAnswer,
  does_ghost: doesGhostAnswer,
  interview_process: interviewProcessAnswer,
  hiring_process: hiringProcessAnswer,
  is_legit: isLegitAnswer,
  jobs_at: jobsAtAnswer,
};

/** One intent → { question, answer } | null. */
export function answerForIntent(intent, facts, extra = {}) {
  const fn = ANSWERS[intent];
  if (!fn || !facts || !facts.name) return null;
  try { return fn(facts, extra) || null; } catch { return null; }
}

/**
 * The FAQ entries to lead with, in the order of `intents` (topIntentsForCompany output, or plain intent names),
 * deduplicated by question, skipping any the data cannot answer. Pass `existing` (the FAQ the page already
 * builds) to drop entries whose question it already asks.
 * @param {object} facts
 * @param {Array<string | { intent: string }>} intents
 * @param {{ avgRounds?: number|null, openListings?: number|null, existing?: Array<{ question: string }>, max?: number }} [extra]
 * @returns {Array<{ question: string, answer: string, intent: string }>}
 */
export function intentFaq(facts, intents, { existing = [], max = 3, ...extra } = {}) {
  const asked = new Set((existing || []).map((q) => String(q?.question || '').toLowerCase()));
  const out = [];
  for (const it of Array.isArray(intents) ? intents : []) {
    const intent = typeof it === 'string' ? it : it?.intent;
    const qa = answerForIntent(intent, facts, extra);
    if (!qa || asked.has(qa.question.toLowerCase())) continue;
    asked.add(qa.question.toLowerCase());
    out.push({ ...qa, intent });
    if (out.length >= max) break;
  }
  return out;
}

// Which intents a lead answer already answers (application_status states the wait too).
const COVERS = { application_status: ['application_status', 'how_long_to_hear_back'], how_long_to_hear_back: ['how_long_to_hear_back'] };

/**
 * The company FAQ with the searched questions first: intentFaq() entries lead, and any entry of the page's own
 * FAQ (lib/server/companyFaq.js buildCompanyFaq) that asks the same thing is dropped, so no question is
 * answered twice. Entries keep { question, answer } (lead entries also carry `intent`).
 * @param {Array<{ question: string, answer: string }>} baseFaq
 * @param {object} facts companyMetaFacts() output
 * @param {Array<string | { intent: string }>} intents topIntentsForCompany() output
 * @param {{ avgRounds?: number|null, openListings?: number|null, max?: number }} [extra]
 */
export function mergeIntentFaq(baseFaq, facts, intents, extra = {}) {
  const base = Array.isArray(baseFaq) ? baseFaq : [];
  const leads = intentFaq(facts, intents, { ...extra, existing: [] });
  if (!leads.length) return base;
  const covered = new Set(leads.flatMap((l) => COVERS[l.intent] || [l.intent]));
  const asked = new Set(leads.map((l) => l.question.toLowerCase()));
  return [...leads, ...base.filter((q) => !asked.has(String(q.question).toLowerCase()) && !covered.has(classifyIntent(q.question)))];
}
