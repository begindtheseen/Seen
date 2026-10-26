// What a rewritten line may say, judged claim by claim against the facts it may draw on.
//
// Round 3 of the live evaluation (2026-10-25, two independent graders, 14 job seekers) scored the
// word-overlap gate 1.8/5: it refused good lines (the person's own answers, "sauté", "English/Spanish",
// 94 − 88 = 6 points) and let one invented word through ("mastered", "migrated", "rotate", "email
// sequence"). The checks now work on claims:
//   - the SOURCE of a line is its original, the bullets it cites (a merge), and the person's answers
//     about that job — never another job's lines unless cited;
//   - numbers come from the source or plain arithmetic on it (a difference, "1 in 4" = 25%);
//   - named things (tools, systems, credentials, places) come from the source; a credential must be
//     HELD, not in progress ("passed FAR and AUD of the CPA exam" is not "CPA");
//   - skill-level and ownership words ("mastered", "expert", "mentor", "owned") come from the source;
//   - the fact-check model lists every claim with its source; a claim with none sinks the line;
//   - a summary or bullet never volunteers a disqualifier ("no IT buyer experience").

import { digitize, durationsOk, stripDurations } from '../../server/prepClaims.js';
import { certHeld } from '../../optimizer/constraints.js';

const lc = (s) => String(s || '').toLowerCase();

/** Lower-case, accents folded ("sauté" → "saute"), slashes and dashes between words split. */
export function norm(t) {
  return lc(String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')).replace(/(\w)[/](\w)/g, '$1 $2');
}

const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|m\b|x\b)?/gi;
const numKey = (n) => lc(n).replace(/[\s,$]/g, '');
export const numbersIn = (t) => (digitize(String(t || '')).match(NUM_RE) || []).map(numKey).filter((n) => /\d/.test(n));
const val = (k) => { const m = /^(\d+(?:\.\d+)?)(k|m)?/.exec(k); if (!m) return NaN; return Number(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1); };

/**
 * Every number a line built on these facts may state: the facts' own, and arithmetic a reader can
 * check — the difference of two numbers in one fact ("94% vs 88%" → 6), "N in M" / "N of M" as a
 * percent ("1 in 4" → 25%), a change as a percent ("8 to 5 days" → 38%).
 */
export function allowedNumbers(facts) {
  const out = new Set();
  for (const f of facts) {
    const ns = numbersIn(f);
    for (const n of ns) { out.add(n); out.add(n.replace(/%$/, '')); }
    const vals = ns.map(val).filter(Number.isFinite);
    for (let i = 0; i < vals.length; i++) for (let j = i + 1; j < vals.length; j++) {
      const d = Math.abs(vals[i] - vals[j]);
      if (d > 0) { out.add(String(Math.round(d * 10) / 10)); out.add(String(Math.round(d))); }
      const hi = Math.max(vals[i], vals[j]), lo = Math.min(vals[i], vals[j]);
      if (hi > 0 && lo > 0) {
        out.add(String(Math.round((1 - lo / hi) * 100)));          // a cut of …%
        out.add(String(Math.round((hi / lo - 1) * 100)));          // a rise of …%
      }
    }
    for (const m of digitize(f).matchAll(/(\d+(?:\.\d+)?)\s*(?:in|of|out of)\s*(?:every\s+)?(\d+(?:\.\d+)?)/gi)) {
      const p = Number(m[1]) / Number(m[2]);
      if (p > 0 && p <= 1) out.add(String(Math.round(p * 100)));
    }
  }
  return out;
}

// Named things: "Kronos", "NetSuite", "WMS", "P&L", "Power BI", "CPA".
const TERM_RE = /\b(?:[A-Z]&[A-Z]|[A-Z]{2,}[a-z]?\d*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+ (?:BI|AI|CRM|ERP|365))\b/g;
const TERM_OK = new Set(['I', 'STAR', 'US', 'USA', 'AM', 'PM', 'HR', 'ID', 'OK', 'TV', 'CEO', 'KPI', 'SOP', 'FAQ']);
/** Named things in a line, the first word of each clause excepted (capitalised by grammar). */
export function namedTerms(text) {
  const t = String(text || '');
  const proper = t.split(/(?<=[.;:!?])\s+/).flatMap((c) => c.split(/\s+/).slice(1)).flatMap((w) => w.split('/'))
    .map((w) => w.replace(/['’]s$/, '').replace(/[^A-Za-z0-9&+#.À-ɏ-]/g, '').replace(/[.]+$/, ''))
    .filter((w) => /^[A-Z][a-zà-ÿ]{2,}/.test(w));
  return [...new Set([...(t.match(TERM_RE) || []), ...proper].map((x) => x.replace(/^([A-Z]{2,})s$/, '$1')).filter((x) => !TERM_OK.has(x)))];
}

// Credentials written as letters: a line may name one only when the résumé shows it HELD.
const CRED_TOKEN_RE = /\b(?:CPA|CMA|CIA|CFA|CFP|PMP|CAPM|RN|LPN|LVN|CNA|NP|PA-C|BLS|ACLS|PALS|NRP|TNCC|CCRN|CDL|EMT|OSHA(?:\s*\d+)?|EPA\s*608|NATE|SHRM-(?:CP|SCP)|PHR|SPHR|CSM|CISSP|CCNA|ServSafe(?:\s+Manager)?|Six Sigma|Lean)\b/g;
export function credentialsHeld(text, resumeText) {
  const bad = [];
  for (const m of String(text || '').matchAll(CRED_TOKEN_RE)) if (!certHeld(resumeText, m[0], m[0])) bad.push(m[0]);
  return bad;
}

// Words that claim a level or ownership: they must be the person's own words (or an answer's).
const LEVEL_RE = /\b(?:master(?:ed|y)?|expert(?:ise)?|specialist|advanced|senior|principal|architect(?:ed)?|mentor(?:ed|s|ing)?|own(?:ed|s)?|led|lead(?:s)?|head(?:ed)?|direct(?:ed)?|manag(?:e|ed|es|ing)|supervis(?:e|ed|es|ing)|spearhead(?:ed)?|pioneer(?:ed)?|sole(?:ly)?|top|first|best|record|award(?:ed)?|promot(?:ed|ion)|recogni[sz]ed)\b/gi;
// "I never owned the P&L", "I didn't lead it": a word the person denied is not a source for it.
const NEGATED_RE = /\b(?:never|not|no|didn'?t|did not|don'?t|do not|wasn'?t|was not|haven'?t|have not|n'?t)\b[^.;,]{0,25}$/;
export function levelWordsNotInSource(text, source) {
  const src = norm(source);
  const out = [];
  for (const m of String(text || '').matchAll(LEVEL_RE)) {
    const w = lc(m[0]);
    const stem = w.replace(/(?:ed|es|s|ing|y)$/, '').replace(/e$/, '');
    const re = new RegExp(`\\b${stem.slice(0, Math.max(3, stem.length))}`, 'gi');
    let ok = false;
    for (const hit of src.matchAll(re)) if (!NEGATED_RE.test(src.slice(Math.max(0, hit.index - 30), hit.index))) { ok = true; break; }
    if (!ok) out.push(m[0]);
  }
  return [...new Set(out)];
}

// A résumé line never volunteers what the person lacks.
export const DISQUALIFIER_RE = /\b(?:no|without|lack(?:ing|s)?(?: of)?|limited|not yet|never|little)\b[^.;]{0,40}\b(?:experience|background|exposure|knowledge|degree|certification|license)\b/i;

// Availability and other screening facts come only from the person's answers.
export const AVAILABILITY_RE = /\b(?:available|availability|open availability|evenings?|weekends?|nights?|holidays?|on-?call|overtime|relocat\w*|travel up to)\b/i;

/**
 * The deterministic checks for one line. `facts` = every text the line may draw on (original, cited
 * bullets, the person's answers about this job). `resumeText` decides credentials. Returns reasons.
 */
export function checkClaims(text, { facts = [], before = '', resumeText = '', history = [], allowTerms = [], answersText = '', allowLost = false, isSummary = false } = {}) {
  const reasons = [];
  const source = [before, ...facts].join(' \n ');
  // numbers: from the facts or plain arithmetic on them; a length of time must match the dates
  const durationsFine = durationsOk(text, { resumeText: `${resumeText}\n${answersText}`, history, strict: true });
  if (!durationsFine) reasons.push({ code: 'duration', note: 'a length of time the dates do not back' });
  const allowed = allowedNumbers([source]);
  const nums = numbersIn(durationsFine ? stripDurations(text) : text);
  const extra = nums.filter((n) => !allowed.has(n) && !allowed.has(n.replace(/%$/, '')));
  if (extra.length) reasons.push({ code: 'new_number', note: `numbers the facts do not give: ${[...new Set(extra)].join(', ')}` });
  if (before && !allowLost) {
    const keep = new Set(numbersIn(text).flatMap((n) => [n, n.replace(/%$/, '')]));
    const lost = numbersIn(before).filter((n) => !keep.has(n) && !keep.has(n.replace(/%$/, '')));
    if (lost.length) reasons.push({ code: 'lost_number', note: `drops the original's ${[...new Set(lost)].join(', ')}` });
  }
  // named things
  const src = norm(source);
  const allow = allowTerms.map(norm);
  const newTerms = namedTerms(text).filter((t) => !src.includes(norm(t)) && !allow.some((a) => a.includes(norm(t))));
  if (newTerms.length) reasons.push({ code: 'new_term', note: `names the facts do not give: ${newTerms.join(', ')}` });
  const notHeld = credentialsHeld(text, `${resumeText}\n${answersText}`);
  if (notHeld.length) reasons.push({ code: 'credential', note: `a credential the résumé does not show as held: ${notHeld.join(', ')}` });
  // level and ownership words
  const levels = levelWordsNotInSource(text, source);
  if (levels.length) reasons.push({ code: 'level_word', note: `claims a level or ownership the facts do not: ${levels.join(', ')}` });
  if (DISQUALIFIER_RE.test(text)) reasons.push({ code: 'disqualifier', note: 'volunteers something the person lacks — that belongs in the interview, not the résumé' });
  if (AVAILABILITY_RE.test(text) && !AVAILABILITY_RE.test(answersText) && !AVAILABILITY_RE.test(before) && (isSummary || !AVAILABILITY_RE.test(source))) {
    reasons.push({ code: 'availability', note: 'availability is the person\'s to state — ask them first' });
  }
  return reasons;
}

/** The fact-checker's claim list for one item → the unsupported claims (empty = all sourced). */
export function unsupportedClaims(item) {
  const claims = Array.isArray(item?.claims) ? item.claims : [];
  return claims.filter((c) => c && (c.supported === false || !(Array.isArray(c.source) && c.source.length))).map((c) => String(c.claim || '').slice(0, 120)).filter(Boolean);
}
