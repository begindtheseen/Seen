// Is a proposed rewrite honest, and is it a real improvement?
//
// Honest: every number comes from the lines the rewrite cites; every named tool, system or credential
// is on the résumé; nothing the original said is lost (its numbers stay); the words are the person's
// facts, not new claims. Real: a rewrite that only swaps a word or two is not shown — that is the
// "replacing little words" the owner called a scam (2026-10-25).

import { digitize } from '../../server/prepClaims.js';

const lc = (s) => String(s || '').toLowerCase();
const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|m\b|x\b)?/gi;
export const numbersOf = (t) => (digitize(t).match(NUM_RE) || []).map((n) => lc(n).replace(/[\s,$]/g, '')).filter((n) => /\d/.test(n));

const STOP = new Set('the and for with from that this into over under their your our per each a an of to in on at by as or is are was were be been it its across within while also more than about through using via who which'.split(' '));
export const contentWords = (t) => (lc(t).match(/[a-z][a-z0-9+#.&/-]*/g) || []).map((w) => w.replace(/[.\-/]+$/, '')).filter((w) => w.length > 2 && !STOP.has(w));
// "passed" ~ "pass", "dated" ~ "date", "hiring" ~ "hire" — never "pass" → "pas".
export const stem = (w) => {
  if (w.length <= 4) return w.length === 4 ? w.replace(/e$/, '') : w;
  const x = w.replace(/(?:ing|ed|ly)$/, '').replace(/(?:ss)es$/, 'ss').replace(/([^s])e?s$/, '$1').replace(/e$/, '');
  return x.length >= 3 ? x : w;
};

// Named tools, systems, credentials: "Kronos", "NetSuite", "WMS", "P&L", "Power BI".
const TERM_RE = /\b(?:[A-Z]&[A-Z]|[A-Z]{2,}[a-z]?\d*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+ (?:BI|AI|CRM|ERP|365))\b/g;
// Plain words a clearer sentence may need that assert nothing on their own.
const CONNECTORS = ['each', 'every', 'per', 'week', 'weekly', 'day', 'daily', 'month', 'monthly', 'year', 'shift', 'shifts', 'including', 'across', 'within', 'while', 'keeping', 'using', 'through', 'after', 'before', 'during', 'about', 'nearly', 'over', 'under', 'from', 'into', 'onto', 'both', 'new', 'all', 'total', 'average', 'than', 'then', 'so', 'that', 'which', 'when', 'where', 'who'];
const CLAIM_WORDS = new Set(['budget', 'revenue', 'profit', 'margin', 'cost', 'overtime', 'payroll', 'saving', 'sav', 'save', 'reduc', 'increas', 'improv', 'grew', 'grow', 'boost', 'doubl', 'tripl', 'record', 'award', 'promot', 'top', 'rank', 'best', 'first', 'only', 'hir', 'fire', 'manag', 'led', 'lead', 'supervis', 'direct', 'own', 'p&l', 'quota', 'target', 'goal', 'kpi', 'satisfaction', 'retention', 'churn', 'growth', 'million', 'thousand', 'billion', 'strategy', 'strategic', 'enterprise', 'global', 'national', 'regional', 'district', 'company-wide', 'department', 'team']);
const TERM_OK = new Set(['STAR', 'US', 'USA', 'AM', 'PM', 'HR', 'ERP', 'CRM', 'POS', 'KPI', 'SOP', 'ID']);

/**
 * Check one rewrite. `facts` = the text of the résumé lines it cites (the original bullet first).
 * Returns { ok, reasons: [code…], notes: [text…] }.
 */
export function verifyRewrite({ before, after, facts = [], resumeText = '', allowTerms = [], allowNumbers = [], allowLost = false } = {}) {
  const reasons = [];
  const notes = [];
  const source = [before, ...facts].join(' \n ');
  // 1. numbers: only the cited lines' numbers, and none of the original's lost
  const have = new Set([...numbersOf(source), ...allowNumbers].flatMap((n) => [n, n.replace(/%$/, '')]));
  const extra = numbersOf(after).filter((n) => !have.has(n) && !have.has(n.replace(/%$/, '')));
  if (extra.length) { reasons.push('new_number'); notes.push(`numbers not in the cited lines: ${[...new Set(extra)].join(', ')}`); }
  const kept = new Set(numbersOf(after).flatMap((n) => [n, n.replace(/%$/, '')]));
  const lost = numbersOf(before).filter((n) => !kept.has(n) && !kept.has(n.replace(/%$/, '')));
  // The person's own answer about this line may replace a figure ("under 14 minutes" → "11–13 minutes").
  if (lost.length && !allowLost) { reasons.push('lost_number'); notes.push(`dropped the original's ${[...new Set(lost)].join(', ')}`); }
  // 2. named terms: in the CITED lines (or explicitly allowed: the target company and role). A tool
  // named elsewhere on the résumé is not evidence for this line — that is how a fact moves to the
  // wrong story ("trained the team on the new process" borrowed from another bullet, 2026-10-25).
  const resumeL = lc(source);
  const allow = allowTerms.map(lc);
  // plus any capitalised word after the first ("Built Workday schedules"): a product, place or name
  // (the first word of each clause is capitalised by grammar, not because it is a name: "Previously…")
  const proper = String(after).split(/(?<=[.;:!?])\s+/).flatMap((c) => c.split(/\s+/).slice(1)).map((w) => w.replace(/[^A-Za-z0-9&+#.-]/g, '').replace(/[.]+$/, '')).filter((w) => /^[A-Z][a-z]{2,}/.test(w));
  const terms = [...(String(after).match(TERM_RE) || []), ...proper].map((t) => t.replace(/s$/, '')).filter((t) => !TERM_OK.has(t));
  const newTerms = terms.filter((t) => !resumeL.includes(lc(t)) && !allow.some((a) => a.includes(lc(t))));
  if (newTerms.length) { reasons.push('new_term'); notes.push(`not on the résumé: ${[...new Set(newTerms)].join(', ')}`); }
  // 3. content: the rewrite's words come from its facts (a new lead verb and connectors are allowed)
  // Words come from the cited lines and answers; a few plain connectors are free.
  const srcStems = new Set([...contentWords(source), ...CONNECTORS].map(stem));
  const words = contentWords(after).slice(1); // the lead verb may change
  const foreign = words.filter((w) => !srcStems.has(stem(w)));
  const share = words.length ? 1 - foreign.length / words.length : 1;
  if (share < 0.8) { reasons.push('new_claims'); notes.push(`words the cited lines do not say: ${[...new Set(foreign)].slice(0, 8).join(', ')}`); }
  // One new word can be a whole claim: scope, money, results, rank ("schedules" → "labor budget").
  const claim = foreign.filter((w) => CLAIM_WORDS.has(stem(w)) || CLAIM_WORDS.has(w));
  if (claim.length) { reasons.push('claim_word'); if (!reasons.includes('new_claims')) reasons.push('new_claims'); notes.push(`a claim the cited lines do not make: ${[...new Set(claim)].join(', ')}`); }
  // 4. a real change, not a synonym swap
  if (isCosmetic(before, after)) { reasons.push('cosmetic'); notes.push('changes only a word or two'); }
  return { ok: reasons.length === 0, reasons, notes, foreign_share: Number((1 - share).toFixed(2)) };
}

/**
 * A rewrite that keeps the same words in the same order and swaps at most two of them is cosmetic.
 * Restructuring (leading with the result, adding scope from a cited line, cutting a "responsible
 * for", merging two lines) is not.
 */
export function isCosmetic(before, after) {
  const a = contentWords(before);
  const b = contentWords(after);
  if (!a.length || !b.length) return false;
  if (/^(?:responsible for|duties included|tasked with|helped|assisted|worked on)/i.test(String(before).trim())) return false;
  const A = new Set(a.map(stem));
  const B = new Set(b.map(stem));
  let shared = 0;
  for (const w of B) if (A.has(w)) shared += 1;
  const added = B.size - shared;
  const removed = A.size - shared;
  const sameOrder = a.map(stem).filter((w) => B.has(w)).join(' ') === b.map(stem).filter((w) => A.has(w)).join(' ');
  return sameOrder && added <= 2 && removed <= 2 && Math.abs(String(after).length - String(before).length) < 30;
}
