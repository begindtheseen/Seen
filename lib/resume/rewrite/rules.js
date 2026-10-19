// Deterministic bullet rewriting with provenance and a fabrication firewall.
//
// Rules RESTATE; they never ADD. Each rule is a small, guarded transform that records what it
// changed and why, so the UI can show a diff and the user can accept or reject it. After every
// rewrite the firewall checks that no number was added or changed, no new capitalized term
// (tool, company, product) appeared, and the content words of the result are a subset of the
// original plus the verb swap the rule declared. If a rewrite trips the firewall it is discarded
// and the original is returned with a note — an honest "no safe rewrite" beats a fabricated one.
//
// Pipeline: pronoun strip → weak-lead removal → hidden-verb unpacking → passive → active →
// filler removal → doublet collapse → tense normalization → number formatting → hygiene.

import { WEAK_LEAD_RE, NOMINALIZATIONS, LINKING_VERB_RE as LINKING_ALL_RE, FILLERS, STRONG_VERBS, GENERIC_VERBS, KNOWN_VERBS, RECOGNITION_LEADS, DOUBLETS } from '../health/verbs.js';
// "Assisted with X" / "Helped with X" keep their shared-credit meaning — never unpacked to "X-ed".
const LINKING_VERB_RE = /^(?:perform(?:ed|s)?|conduct(?:ed|s)?|provid(?:e|ed|es)|carr(?:y|ied|ies)\s+out|undert(?:ake|ook|akes)|g(?:ive|ave|ives)|t(?:ake|ook|akes)|achiev(?:e|ed|es)|effect(?:ed|s)?|d(?:o|id|oes)|m(?:ake|ade|akes)|handl(?:e|ed|es)|complet(?:e|ed|es)|execut(?:e|ed|es)|deliver(?:ed|s)?|was\s+responsible\s+for|were\s+responsible\s+for|responsible\s+for|in\s+charge\s+of)\s+(?:the\s+|a\s+|an\s+|all\s+|daily\s+|regular\s+|ongoing\s+)?/i;
void LINKING_ALL_RE;
import { pastTense, baseFromPast, baseFromGerund, matchCase } from './inflect.js';
import { analyzeLead, findMetrics } from '../health/bullet.js';

export const REWRITE_VERSION = 'rewrite_v2';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const wordsOf = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);

// ── R1: pronouns ──
function stripPronouns(text) {
  let t = text;
  const m = t.match(/^(?:I|We|My team and I|I have|I've|We have|We've|I am|I'm)\s+/i);
  if (m) t = t.slice(m[0].length);
  t = t.replace(/\b(?:my|our)\s+(team|department|store|unit|clients|customers|patients|accounts|region|territory|crew|shift)\b/gi, (_, n) => `the ${n}`);
  t = t.replace(/\bmyself\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  return t;
}

// ── R2: weak lead → promote the next verb ──
function removeWeakLead(text, notes) {
  const m = text.match(WEAK_LEAD_RE);
  if (!m || !m[0].trim()) return { text, swapped: null };
  let rest = text.slice(m[0].length).replace(/^(?:the|a|an|all|daily|weekly|various|multiple|several)\s+/i, (x) => (/^(?:the|a|an)$/i.test(x.trim()) ? '' : x));
  const first = (wordsOf(rest)[0] || '').replace(/[^A-Za-z-]/g, '');
  const lower = first.toLowerCase();
  if (!lower) return { text, swapped: null };
  // "Helped to increase sales" keeps the shared-credit meaning: "Contributed to a sales increase"
  // is a semantic change we do not make — we promote the verb only when the weak lead is pure
  // ownership language (responsible for / tasked with / in charge of / duties included / worked on).
  const ownership = /responsible|duties|responsibilities|tasked|charge|accountable|charged|worked\s+on|worked\s+with|served\s+as|acted\s+as|functioned|involved|participated|experience|exposure|familiar|knowledge|ability|able|proficient|skilled/i.test(m[0]);
  if (!ownership) { if (/helped|assisted/i.test(m[0])) notes.push('shared_credit'); return { text, swapped: null }; }
  // "Duties included cash drawer reconciliation and restocking" → "Reconciled cash drawer and restocked":
  // a short noun phrase ending in a hidden verb comes first, before any bare-word promotion.
  if (!baseFromGerund(lower, KNOWN_VERBS)) {
    const ws = wordsOf(rest);
    for (let k = 1; k <= 3 && k < ws.length; k++) {
      const head = ws[k].toLowerCase().replace(/[^a-z]/g, '');
      if (!NOMINALIZATIONS[head]) continue;
      if (!ws.slice(0, k).every((w) => /^[a-z-]+$/i.test(w))) break;
      const verb = pastTense(NOMINALIZATIONS[head]);
      const tail = rest.slice(ws.slice(0, k + 1).join(' ').length);
      return { text: `${cap(verb)} ${ws.slice(0, k).join(' ')}${coordinateGerunds(tail, 'past')}`, swapped: { from: head, to: verb } };
    }
  }
  const ger = baseFromGerund(lower, KNOWN_VERBS);
  if (ger && !isFieldGerund(lower, wordsOf(rest)[1])) {
    const verb = pastTense(ger);
    const out = cap(verb) + coordinateGerunds(rest.slice(first.length), 'past');
    return { text: out, swapped: { from: lower, to: verb } };
  }
  const second = (wordsOf(rest)[1] || '').toLowerCase().replace(/[^a-z]/g, '');
  if (KNOWN_VERBS.has(lower) && !NOMINALIZATIONS[second] && STRONG_VERBS.has(lower)) {
    const verb = pastTense(lower);
    return { text: cap(verb) + coordinateGerunds(rest.slice(first.length), 'past'), swapped: { from: lower, to: verb } };
  }
  // Hidden verb right after the weak lead: "Responsible for the management of X".
  const nom = rest.match(/^(?:the\s+|all\s+|daily\s+)?([a-z]+)\s+(?:of|for)\s+/i);
  if (nom && NOMINALIZATIONS[nom[1].toLowerCase()]) {
    const verb = pastTense(NOMINALIZATIONS[nom[1].toLowerCase()]);
    return { text: cap(verb) + ' ' + coordinateGerunds(rest.slice(nom[0].length), 'past'), swapped: { from: nom[1].toLowerCase(), to: verb } };
  }
  // A noun phrase ("Responsible for cash drawer reconciliation") — strip the weak lead only when the
  // remainder still reads as a bullet; otherwise leave it and let the note ask for a verb.
  if (/^[a-z]/i.test(rest) && wordsOf(rest).length >= 3) {
    notes.push('needs_action_verb');
    return { text, swapped: null };
  }
  return { text, swapped: null };
}

// Gerunds that are overwhelmingly fields or modifiers when followed by a noun ("marketing campaigns",
// "shipping labels"): never promoted to a verb — "Marketed campaigns" is not what the author meant.
const FIELD_GERUNDS_STRONG = new Set(['marketing', 'accounting', 'consulting', 'engineering', 'manufacturing', 'advertising', 'nursing', 'banking', 'lending', 'housing', 'landscaping', 'roofing', 'plumbing', 'welding', 'catering', 'printing', 'publishing', 'staffing', 'recruiting', 'purchasing', 'licensing', 'pricing', 'branding', 'funding', 'shipping', 'receiving', 'learning', 'clothing', 'bedding', 'parking', 'flooring', 'lighting', 'heating', 'cooling', 'merchandising', 'ticketing', 'gaming', 'farming', 'fishing', 'mining', 'drilling']);
// Gerunds that are actions unless a field-ish head noun follows ("training materials" vs "training new hires").
const FIELD_HEAD_RE = /^(?:department|team|staff|materials?|process(?:es)?|system|software|campaigns?|labels?|costs?|budget|schedule|reports?|programs?|plan|sessions?|class(?:es)?|courses?|data|lists?|policy|policies|procedures?|standards?|requirements?|strategy|content|efforts?|activities|activity|functions?|operations?|work|duties|duty|tasks?|manuals?|videos?|modules?|documentation|docs|needs|services?|industry|sector|firm|agency|company|business|experience|background|skills?|role|position|job|career|degree|certificate|certification|license)$/i;
function isFieldGerund(ger, next) {
  const g = String(ger || '').toLowerCase();
  const n = String(next || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!n) return false;
  if (/^(?:the|a|an|all|our|new|each|every|multiple|several|various|daily|weekly|monthly|over|more|up|for|of|to|with|and|on|in|at|\d+)$/.test(n) || /^\d/.test(next)) return false;
  if (FIELD_HEAD_RE.test(n)) return true;
  return FIELD_GERUNDS_STRONG.has(g) && /s$/.test(n);
}

// "Greeted customers and selling memberships" → "… and sold memberships": once the lead verb has a
// tense, coordinated gerunds take the same tense (first two only — deeper clauses are not ours).
function coordinateGerunds(rest, tense) {
  let n = 0;
  return String(rest || '').replace(/\b(and|or|,)\s+([a-z]+ing)\b(\s+[a-z]+)?/gi, (m0, conj, ger, next) => {
    if (n >= 2) return m0;
    const base = baseFromGerund(ger.toLowerCase(), KNOWN_VERBS);
    if (!base || isFieldGerund(ger, (next || '').trim())) return m0;
    n++;
    return `${conj} ${tense === 'present' ? base : pastTense(base)}${next || ''}`;
  });
}

// ── R3: hidden verbs ("Performed an analysis of" → "Analyzed") ──
function unpackNominalization(text) {
  const m = text.match(LINKING_VERB_RE);
  if (!m) return { text, swapped: null };
  const rest = text.slice(m[0].length);
  const nm = rest.match(/^([a-z]+)(?:\s+(?:of|for|on|to|in))?\s+/i);
  if (!nm) return { text, swapped: null };
  const noun = nm[1].toLowerCase();
  const base = NOMINALIZATIONS[noun];
  if (!base) return { text, swapped: null };
  // "Responsible for training materials": a gerund-noun followed by its head noun is a thing, not an act.
  const after = rest.slice(nm[0].length);
  if (/ing$/.test(noun) && !/\s(?:of|for|on|to|in)\s+$/.test(nm[0]) && isFieldGerund(noun, wordsOf(after)[0])) return { text, swapped: null };
  const verb = pastTense(base);
  return { text: cap(verb) + ' ' + coordinateGerunds(after, 'past'), swapped: { from: noun, to: verb } };
}

// ── R4: passive → active (implied subject is the candidate) ──
function activate(text) {
  // "Was promoted to lead" → "Promoted to lead" (a recognition participle stands on its own).
  const rec = text.match(/^(?:was|were|has been|have been|had been)\s+(\w+)\b\s*/i);
  if (rec && RECOGNITION_LEADS.has(rec[1].toLowerCase())) return { text: cap(rec[1]) + text.slice(rec[0].length - (rec[0].endsWith(' ') ? 1 : 0)), swapped: { from: rec[1].toLowerCase(), to: rec[1].toLowerCase() } };
  // "Weekly reports were generated for leadership" → "Generated weekly reports for leadership"
  const m = text.match(/^((?:[A-Za-z0-9,$%'-]+\s+){1,6}?)(?:was|were|is|are|has been|have been|had been)\s+(\w+(?:ed|en|t))\b(?:\s+by\s+(?:me|us|myself|the team|our team))?\s*/i);
  if (!m) return { text, swapped: null };
  const object = m[1].trim();
  const participle = m[2].toLowerCase();
  if (RECOGNITION_LEADS.has(participle)) return { text, swapped: null };
  const base = baseFromPast(participle, KNOWN_VERBS);
  if (!base) return { text, swapped: null };
  const rest = text.slice(m[0].length);
  const objLower = object.charAt(0).toLowerCase() + object.slice(1);
  return { text: `${cap(participle)} ${objLower}${rest ? ' ' + rest : ''}`.replace(/\s+([.,;])/g, '$1').trim(), swapped: { from: participle, to: participle } };
}

// ── R5: fillers ──
function stripFillers(text, removed) {
  let t = text;
  for (const [phrase, repl] of FILLERS) {
    const p = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = phrase.startsWith(' ') || phrase.endsWith(' ')
      ? new RegExp(p.replace(/^\\ |^ /, '(?:^|\\s)').replace(/\\ $| $/, '(?=\\s|$)'), 'gi')
      : new RegExp(`(?<![A-Za-z-])${p}(?![A-Za-z-])`, 'gi');
    const before = t;
    t = t.replace(re, (mm) => {
      const r = repl;
      // keep surrounding whitespace sane
      if (mm.startsWith(' ')) return r ? ' ' + r : ' ';
      return r;
    });
    if (t !== before) removed.push(phrase.trim());
  }
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
}

// ── R8: doublets ("Managed and oversaw" → "Managed") ──
function collapseDoublets(text) {
  const m = text.match(/^(\w+)\s+and\s+(\w+)\s+/);
  if (!m) return { text, swapped: null };
  const a = baseFromPast(m[1].toLowerCase(), KNOWN_VERBS) || m[1].toLowerCase();
  const b = baseFromPast(m[2].toLowerCase(), KNOWN_VERBS) || m[2].toLowerCase();
  const pair = DOUBLETS.find(([x, y]) => x === a && y === b);
  if (!pair) return { text, swapped: null };
  return { text: `${m[1]} ${text.slice(m[0].length)}`, swapped: { from: m[2].toLowerCase(), to: '' } };
}

// ── R6: tense ──
function normalizeTense(text, tense) {
  if (!tense || tense === 'keep') return { text, swapped: null };
  const lead = analyzeLead(text);
  if (!lead.lemma || lead.kind === 'weak' || lead.kind === 'pronoun' || lead.kind === 'noun' || lead.kind === 'recognition') return { text, swapped: null };
  const firstWord = wordsOf(text)[0];
  const bare = firstWord.replace(/[^A-Za-z'-]/g, '');
  if (lead.adverb) return { text, swapped: null };
  if (tense === 'past' && (lead.tense === 'present' || lead.tense === 'gerund')) {
    const past = pastTense(lead.lemma);
    return { text: matchCase(past, bare) + text.slice(bare.length), swapped: { from: bare.toLowerCase(), to: past } };
  }
  if (tense === 'present' && lead.tense === 'past') {
    return { text: matchCase(lead.lemma, bare) + text.slice(bare.length), swapped: { from: bare.toLowerCase(), to: lead.lemma } };
  }
  return { text, swapped: null };
}

// ── R7: number formatting (never changes a digit) ──
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
function formatNumbers(text, changes) {
  let t = text;
  t = t.replace(/\b(\d+(?:\.\d+)?)\s+percent\b/gi, (_, n) => { changes.push({ rule: 'number', from: `${n} percent`, to: `${n}%` }); return `${n}%`; });
  t = t.replace(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)\s+(percent|people|employees|staff|engineers|associates|clients|customers|patients|students|stores|locations|hours|days|weeks|months|years|reps|agents|members|teams|sites|units|vehicles|projects|accounts)\b/gi, (m0, w, unit) => {
    const n = NUMBER_WORDS[w.toLowerCase()];
    const to = unit.toLowerCase() === 'percent' ? `${n}%` : `${n} ${unit}`;
    changes.push({ rule: 'number', from: m0, to }); return to;
  });
  t = t.replace(/\$(\d{1,3}),(\d{3}),(\d{3})\b(?![,.]\d)/g, (m0, a, b) => { const to = `$${a}${b.slice(0, 1) !== '0' ? '.' + b.slice(0, 1) : ''}M`; changes.push({ rule: 'number', from: m0, to }); return to; });
  t = t.replace(/\bx\s?(\d+)\b/g, (m0, n) => { changes.push({ rule: 'number', from: m0, to: `${n}x` }); return `${n}x`; });
  return t;
}

// ── R9: hygiene ──
function hygiene(text) {
  let t = text.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
  t = t.replace(/^[•·▪◦‣●\-–—*]\s*/, '');
  t = t.replace(/[.;,\s]+$/, '');
  if (t) t = cap(t) + '.';
  return t;
}

// ── Firewall ──
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'that', 'this', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'their', 'our', 'my', 'we', 'i', 'me', 'us', 'he', 'she', 'they', 'them', 'his', 'her', 'into', 'onto', 'over', 'under', 'per', 'via', 'than', 'then', 'so', 'such', 'all', 'any', 'each', 'both', 'more', 'most', 'some', 'very', 'really', 'just']);
const contentTokens = (t) => {
  const out = new Set();
  for (const raw of String(t).toLowerCase().replace(/[^a-z0-9%$.'-]+/g, ' ').split(/\s+/)) {
    const w = raw.replace(/^[.'-]+|[.'-]+$/g, '');
    if (!w || STOP.has(w) || /\d/.test(w)) continue;
    out.add(w);
    // a hyphenated compound also licenses its parts ("three-phase" → "three", "phase"), so a
    // rewrite that splits or re-joins a compound is not a new word
    if (w.includes('-')) for (const part of w.split('-')) if (part && !STOP.has(part) && !/\d/.test(part)) out.add(part);
  }
  return out;
};
const NUMBER_WORD_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/gi;
const digitize = (t) => String(t).replace(NUMBER_WORD_RE, (w) => String(NUMBER_WORDS[w.toLowerCase()] ?? w));
const numbers = (t) => (digitize(t).match(/\d[\d,.]*%?/g) || []).map((n) => n.replace(/[,.]$/, '')).sort();
const properNouns = (t) => new Set((String(t).match(/\b[A-Z][a-zA-Z0-9+#-]*/g) || []).slice(1).map((w) => w.toLowerCase().replace(/[.,;:]+$/, '')));

/**
 * True when `rewritten` adds no fact to `original`: same numbers, no new capitalized terms, and
 * every content word either existed, is a declared verb swap, or is a filler replacement.
 */
export function passesFirewall(original, rewritten, allowed = []) {
  const o = contentTokens(original), r = contentTokens(rewritten);
  const allow = new Set(allowed.map((w) => String(w).toLowerCase()));
  for (const [, repl] of FILLERS) for (const w of String(repl).toLowerCase().split(/\s+/)) if (w) allow.add(w);
  for (const w of ['the', 'a', 'an']) allow.add(w);
  // numbers: the rewrite may reformat ("12 percent" → "12%", "$1,200,000" → "$1.2M") but never add
  const no = numbers(original).map((n) => n.replace(/[^0-9]/g, '')).join('|');
  const nr = numbers(rewritten).map((n) => n.replace(/[^0-9]/g, '')).join('|');
  const digitsO = no.replace(/\|/g, ''), digitsR = nr.replace(/\|/g, '');
  if (digitsR.length > digitsO.length) return { ok: false, reason: 'number_added' };
  for (const d of nr.split('|').filter(Boolean)) if (!digitsO.includes(d.replace(/0+$/, '').slice(0, 2))) return { ok: false, reason: `number_changed:${d}` };
  const po = properNouns(original), pr = properNouns(rewritten);
  for (const w of pr) if (!po.has(w) && !o.has(w) && !allow.has(w)) return { ok: false, reason: `new_proper_noun:${w}` };
  const lemma = (w) => baseFromPast(w, KNOWN_VERBS) || baseFromGerund(w, KNOWN_VERBS) || (KNOWN_VERBS.has(w) ? w : null);
  const oLemmas = new Set([...o].map(lemma).filter(Boolean));
  for (const w of r) {
    if (o.has(w) || allow.has(w)) continue;
    // tolerate inflection of an existing word (manag/managed/managing, sell/selling/sold) and plural/singular
    const stem = w.replace(/(ing|ed|es|s|ly)$/, '');
    if ([...o].some((ow) => ow.replace(/(ing|ed|es|s|ly)$/, '') === stem && stem.length >= 3)) continue;
    const lw = lemma(w);
    if (lw && (oLemmas.has(lw) || o.has(lw))) continue;
    if (w.length <= 1) continue; // a stray letter from punctuation splitting ("cash drawer's" → "s")
    return { ok: false, reason: `new_word:${w}` };
  }
  return { ok: true };
}

/**
 * Rewrite one bullet.
 * @param {string} text
 * @param {{ tense?: 'past'|'present'|'keep' }} opts
 * @returns {{ text: string, original: string, changes: Array<{rule:string, from:string, to:string}>, notes: string[], unchanged: boolean, firewall: object }}
 */
export function rewriteBullet(text, opts = {}) {
  const original = String(text || '').replace(/\s+/g, ' ').trim();
  const changes = [];
  const notes = [];
  const allowed = [];
  if (!original) return { text: '', original, changes, notes, unchanged: true, firewall: { ok: true } };
  let t = original.replace(/^[•·▪◦‣●\-–—*]\s*/, '');

  const p1 = stripPronouns(t);
  if (p1 !== t) { changes.push({ rule: 'pronoun', from: t.slice(0, 40), to: p1.slice(0, 40) }); t = p1; }

  const r2 = removeWeakLead(t, notes);
  if (r2.text !== t) { changes.push({ rule: 'weak_lead', from: t.split(/\s+/).slice(0, 4).join(' '), to: r2.text.split(/\s+/).slice(0, 2).join(' ') }); if (r2.swapped) allowed.push(r2.swapped.to, r2.swapped.from); t = r2.text; }

  const r3 = unpackNominalization(t);
  if (r3.text !== t) { changes.push({ rule: 'hidden_verb', from: t.split(/\s+/).slice(0, 4).join(' '), to: r3.text.split(/\s+/).slice(0, 2).join(' ') }); if (r3.swapped) allowed.push(r3.swapped.to, r3.swapped.from); t = r3.text; }

  const r4 = activate(t);
  if (r4.text !== t) { changes.push({ rule: 'passive', from: t.slice(0, 50), to: r4.text.slice(0, 50) }); t = r4.text; }

  const removed = [];
  const r5 = stripFillers(t, removed);
  if (r5 !== t) { for (const f of removed) changes.push({ rule: 'filler', from: f, to: (FILLERS.find(([p]) => p.trim() === f) || ['', ''])[1].trim() }); t = r5; }

  const r8 = collapseDoublets(t);
  if (r8.text !== t) { changes.push({ rule: 'doublet', from: r8.swapped.from, to: '' }); t = r8.text; }

  const r6 = normalizeTense(t, opts.tense);
  if (r6.text !== t) { changes.push({ rule: 'tense', from: r6.swapped.from, to: r6.swapped.to }); allowed.push(r6.swapped.to); t = r6.text; }

  t = formatNumbers(t, changes);
  const r9 = hygiene(t);
  if (r9 !== t) t = r9;

  // Vague quantity words become a note, never a deletion.
  if (!findMetrics(t).length && /\b(?:various|multiple|several|numerous|many)\b/i.test(t)) notes.push('quantify');

  const firewall = passesFirewall(original, t, allowed);
  if (!firewall.ok) {
    const safe = hygiene(original);
    return { text: safe, original, changes: safe === original ? [] : [{ rule: 'hygiene', from: original.slice(-12), to: safe.slice(-12) }], notes: [...notes, `firewall:${firewall.reason}`], unchanged: safe === original, firewall };
  }
  const unchanged = t === original;
  if (!unchanged && !changes.length) changes.push({ rule: 'hygiene', from: original.slice(-12), to: t.slice(-12) });
  return { text: t, original, changes, notes, unchanged, firewall };
}

/** Suggest a stronger verb for a generic lead, from the bullet's own category hints. */
export function suggestVerbs(lemma, text = '') {
  const t = String(text).toLowerCase();
  const picks = [];
  const add = (...vs) => { for (const v of vs) if (!picks.includes(v) && v !== lemma) picks.push(v); };
  if (/\b(reports?|dashboards?|data|analys[ie]s|spreadsheets?|metrics)\b/.test(t)) add('built', 'analyzed', 'compiled');
  if (/\b(customers?|clients?|guests?|patients?)\b/.test(t)) add('served', 'resolved', 'advised');
  if (/\b(team|staff|crew|associates|employees|shift)\b/.test(t)) add('supervised', 'led', 'coordinated');
  if (/\b(process|workflow|system|procedure)\b/.test(t)) add('streamlined', 'implemented', 'standardized');
  if (/\b(inventory|stock|orders?|shipments?|pallets?)\b/.test(t)) add('processed', 'tracked', 'reconciled');
  if (/\b(sales?|revenue|deals?|accounts?)\b/.test(t)) add('generated', 'closed', 'grew');
  if (/\b(train|onboard|mentor|coach)/.test(t)) add('trained', 'mentored', 'onboarded');
  if (/\b(code|software|api|feature|app|platform)\b/.test(t)) add('built', 'shipped', 'engineered');
  if (/\b(schedul|calendar|appointment|book)/.test(t)) add('scheduled', 'coordinated', 'organized');
  if (/\b(clean|sanit|maintain|repair|fix)/.test(t)) add('maintained', 'repaired', 'restored');
  if (!picks.length) add('delivered', 'executed', 'coordinated');
  return picks.slice(0, 4);
}

/**
 * Rewrite every bullet of a document (experience + projects). Returns a NEW doc and a change
 * log keyed by bullet id. Role tense: past unless the role is current.
 */
export function rewriteDoc(doc, opts = {}) {
  const out = JSON.parse(JSON.stringify(doc));
  const log = [];
  const apply = (items, section, itemId, tense) => {
    for (const b of items) {
      const r = rewriteBullet(b.text, { tense });
      if (!r.unchanged) {
        log.push({ section, itemId, bulletId: b.id, from: b.text, to: r.text, changes: r.changes, notes: r.notes });
        if (opts.apply !== false) b.text = r.text;
      } else if (r.notes.length) log.push({ section, itemId, bulletId: b.id, from: b.text, to: b.text, changes: [], notes: r.notes });
    }
  };
  for (const e of out.experience) apply(e.bullets, 'experience', e.id, e.end === 'present' ? 'present' : 'past');
  for (const p of out.projects) apply(p.bullets, 'projects', p.id, 'keep');
  if (opts.apply !== false) {
    out.meta = out.meta || {};
    out.meta.provenance = [...(out.meta.provenance || []), ...log.filter((l) => l.changes.length).map((l) => ({ kind: 'rewrite', bulletId: l.bulletId, from: l.from, to: l.to, rules: l.changes.map((c) => c.rule) }))];
  }
  return { doc: out, log };
}
