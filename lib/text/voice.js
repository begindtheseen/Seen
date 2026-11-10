// The person's own words, said out loud — ONE set of helpers for every sentence a tool writes in the person's voice
// (Interview Prep's drafts, the intro, the emails). Nothing here adds a fact: each helper changes the person of a verb,
// the tense, the article, the way a number is said, or joins words the caller already has.
//
//   firstPerson(line, { tense })  "Lead a team of 8 agents" → { first: "I lead a team of 8 agents", rest: [] }
//   spokenNumber(text)            "5–6" → "5 to 6", "900+" → "more than 900", "$4.2M" → "$4.2 million"
//   aAn(word)                     "a" | "an"  ("an RN", "a Store Manager", "an HVAC technician")
//   joinList(items)               "A, B and C"
//   sentenceCase(text)            first letter capital
//   agree(noun, 'was')            "the training materials" → "were"
//   gerundPhrase(duty)            "Coach agents through live call monitoring" → "coaching agents through live call monitoring"

import { checkBullet, verbBase } from '../resume/optimize/grammar.js';

const clean = (s, n = 600) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Common verbs the résumé grammar's list does not carry (it is built for résumé bullets).
const MORE_VERBS = new Set(['correct', 'research', 'reconcile', 'escalate', 'educate', 'guide', 'refer', 'triage', 'find', 'keep', 'give', 'take', 'make', 'get', 'see', 'hold', 'meet', 'bring', 'set', 'put', 'know', 'show', 'tell', 'ask', 'learn', 'grow', 'spot', 'catch', 'stay', 'become', 'identify', 'close', 'open', 'drive', 'move', 'turn', 'help', 'raise', 'reach', 'share', 'gather', 'select', 'adapt', 'adopt', 'apply', 'shape', 'own']);
/** The base form of a verb ("finds" → "find"), or ''. */
export function baseVerb(w) {
  const t = String(w || '').toLowerCase();
  const b = verbBase(t);
  if (b) return b;
  if (MORE_VERBS.has(t)) return t;
  if (/s$/.test(t) && MORE_VERBS.has(t.slice(0, -1))) return t.slice(0, -1);
  return '';
}

/** First letter capital. */
export const sentenceCase = capFirst;

/** "a" or "an" for the word that follows: by sound for acronyms ("an RN", "an HVAC", "a CPA"), else by letter. */
export function aAn(t) {
  const w = String(t || '').trim().split(/\s+/)[0] || '';
  if (/^[A-Z]{2,}/.test(w)) return /^[AEFHILMNORSX]/.test(w) ? 'an' : 'a';
  if (/^(?:uni|use|usu|eu|one|once)/i.test(w)) return 'a';
  if (/^(?:hour|honest|honou?r)/i.test(w)) return 'an';
  return /^[aeiou]/i.test(w) ? 'an' : 'a';
}

/** "A", "A and B", "A, B and C". */
export function joinList(items, conj = 'and') {
  const xs = (items || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ${conj} ${xs[xs.length - 1]}`;
}

// Head nouns that are plural without a final -s, and -s words that are singular.
const PLURAL_IRREGULAR = /\b(?:people|staff|children|men|women|data|media|criteria|feet|teeth|mice|personnel|police)$/i;
const SINGULAR_S = /(?:ss|us|is|ics|news|sales|series|species|status|process|campus|analysis|basis|address|business|class|access|progress|success)$/i;
/** True when a noun phrase is plural by its head noun ("the training materials", "job aids", "people"). */
export function isPluralNoun(phrase) {
  const head = String(phrase || '').trim().replace(/[.,;:!?)]+$/, '').split(/\s+(?:of|for|with|in|on|at|to|from|through|across|and|or)\s+/i)[0].trim().split(/\s+/).pop() || '';
  if (PLURAL_IRREGULAR.test(head)) return true;
  if (/\band\b/i.test(String(phrase || '').split(/\s+(?:of|for|with|in|on|at|to|from|through|across)\s+/i)[0])) return true;
  return /[^s']s$/i.test(head) && !SINGULAR_S.test(head);
}
/** The form of be/have/do that agrees with a noun phrase: agree('the job aids', 'was') → 'were'. */
export function agree(noun, verb) {
  const pl = isPluralNoun(noun);
  const map = { was: ['was', 'were'], is: ['is', 'are'], has: ['has', 'have'], does: ['does', 'do'] };
  const pair = map[String(verb).toLowerCase()];
  return pair ? pair[pl ? 1 : 0] : verb;
}

/** Numbers and shorthand the way people say them: "5–6" → "5 to 6", "900+" → "more than 900", "$4.2M" → "$4.2 million". */
export function spokenNumber(text) {
  return String(text || '')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    // "4-5 telemetry patients", "2-3 apprentices": a hyphen between two small counts is a range said out loud (never
    // "1-in-5", a date or a phone number)
    .replace(/(?<![\d./-])(\d{1,3})-(\d{1,3})(?![\d./-])(?=\s+[a-z])/g, '$1 to $2')
    .replace(/(?<![\w.])(\d[\d,.]*)\+(?=\s|$)/g, 'more than $1')
    .replace(/\$(\d+(?:\.\d+)?)M\b/g, '$$$1 million')
    .replace(/\s&\s/g, ' and ')
    .replace(/\b([a-z]+)\/([a-z]+)\b/g, (m, a, b) => (verbBase(a) && verbBase(b) ? `${a} and ${b}` : m));
}

// Leads that are something done TO the person ("Named Employee of the Month") read "I was named …".
const PASSIVE_LEADS = new Set(['named', 'promoted', 'selected', 'recognized', 'recognised', 'nominated', 'elected', 'chosen', 'honored', 'honoured', 'appointed', 'voted', 'ranked', 'rated', 'commended', 'featured', 'invited', 'entrusted', 'tasked', 'assigned', 'trusted', 'awarded', 'certified', 'licensed', 'cross-trained']);
// Words that are passive only with what follows: "Promoted to Shift Lead" (done to the person) but
// "Promoted seasonal launches at the register" (something the person did) — round 3: "I was promoted
// seasonal launches".
const PASSIVE_IF_FOLLOWED = /^(?:to|as|for|in|into|by|among|from|with|twice|three|two|after|within|#?\d)\b/i;
const ALWAYS_PASSIVE = new Set(['named', 'nominated', 'elected', 'honored', 'honoured', 'appointed', 'voted', 'commended', 'entrusted', 'cross-trained']);
export function passiveLead(head) {
  const [w0, w1 = ''] = String(head).split(/\s+/);
  const lw = String(w0).toLowerCase();
  if (!PASSIVE_LEADS.has(lw)) return false;
  return ALWAYS_PASSIVE.has(lw) || PASSIVE_IF_FOLLOWED.test(w1) || /^(?:top|employee|associate|partner|crew|team|student|nurse|rep|agent|teacher|cashier|member|one)\b/i.test(w1) && /^(?:awarded|selected|recognized|recognised|ranked|rated|chosen|featured)$/.test(lw);
}

/**
 * One résumé line in first person: "I cut shrink …" / "I was named …" / for a current job's ongoing duty
 * "I lead a team of 18 …". `tense: 'past'` tells an earlier job's present-tense line in the past ("Build schedules" →
 * "I built schedules"); 'present' (a job still held) keeps the line's own tense. Returns { first, rest } — the line's
 * main clause and any clauses after a ";" — or null when the line does not start with something the person did.
 */
export function firstPerson(text, { tense = 'past' } = {}) {
  let t = clean(text).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/[.;\s]+$/, '');
  if (!t) return null;
  if (tense !== 'present') t = checkBullet(t, { current: false }).text.replace(/[.;\s]+$/, '');
  const [head, ...tail] = t.split(/;\s+/);
  const w0 = head.split(/\s+/)[0];
  // a noun that spells like a past tense ("Wound care, ostomy care", "Lead time", "Ground floor") is not a verb
  if (/^(?:wound|ground|found|lead|left|rose|saw|felt|bore|bound)\s+(?:care|times?|floor|level|areas?|sets?|paint|issues?|cases?)\b/i.test(head)) return null;
  let first;
  if (passiveLead(head)) first = `I was ${head.charAt(0).toLowerCase()}${head.slice(1)}`;
  else if (verbBase(w0)) first = `I ${head.charAt(0).toLowerCase()}${head.slice(1)}`;
  else return null;
  // "Serve as charge nurse 2 shifts a week: make assignments, …" → "…, where I make assignments, …"
  first = first.replace(/:\s+(?=[a-z]+\b)/, (m, i) => { const next = first.slice(i + m.length).split(/\s+/)[0]; return verbBase(next) ? ', where I ' : m; });
  const rest = tail.map((p) => {
    const w = p.split(/\s+/)[0];
    // "…; returns, refunds and money orders" is a list of things, not "I returns" (a plural noun before a comma)
    if (verbBase(w) && !/^\d/.test(w) && !(/s,?$/.test(w) && verbBase(w.replace(/,$/, '')) !== w.replace(/,$/, '').toLowerCase() && /,/.test(p.split(/\s+/).slice(0, 2).join(' ')))) return `I ${p.charAt(0).toLowerCase()}${p.slice(1)}`;
    if (/^\d/.test(p) && /\d/.test(head) && /\b(?:were|are|was|is|still|stayed)\b/.test(p)) return `Of those, ${p}`;
    // a measured result with no verb ("p99 latency 180ms to 70ms") is said as the result, never as a fragment
    if (/\d[\w%.]*\s+to\s+\$?\d/.test(p) && !verbBase(w.toLowerCase()) && !/\b(?:was|were|went|is|are|fell|rose|dropped)\b/i.test(p)) return `The result: ${p.charAt(0).toLowerCase()}${p.slice(1)}`;
    return capFirst(p);
  });
  return { first: spokenNumber(first), rest: rest.map(spokenNumber) };
}

/**
 * A résumé line that states a result with no verb of the person's ("Team CSAT held at 94% for 6 straight quarters",
 * "Top-3 agent for CSAT 5 quarters in a row") said as a sentence of theirs, or null. Only shapes that need no new
 * word beyond "my", "our", "I was": a team/store/unit result, or a ranking.
 */
export function resultSentence(text) {
  const t = clean(text).replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/[.;\s]+$/, '');
  if (!t || /;/.test(t)) return null;
  let m;
  // "Team CSAT held at 94% …" → "My team's CSAT held at 94% …"
  if ((m = t.match(/^(Team|Store|Unit|Department|Crew|Shift|Site|Branch|Office|Clinic|Floor)\s+(.+)$/)) && /\b(?:held|hit|rose|fell|grew|stayed|reached|was|were|went|improved|increased|dropped|climbed|beat|exceeded|kept|averaged|ranked)\b/i.test(m[2]) && /\d/.test(m[2])) {
    return spokenNumber(`My ${m[1].toLowerCase()}'s ${m[2]}`);
  }
  // "Top-3 agent for CSAT 5 quarters in a row" → "I was a top-3 agent for CSAT 5 quarters in a row"
  if ((m = t.match(/^(Top[- ]\d+%?|Top|#\d+|No\.\s?\d+|Highest[- ]rated|Best)\s+(\w[\w-]*)\b(.*)$/i)) && !verbBase(m[2].toLowerCase())) {
    return spokenNumber(`I was ${aAn(m[1])} ${m[1].toLowerCase()} ${m[2]}${m[3]}`);
  }
  return null;
}

// ── A posting's duty said inside a sentence ──────────────────────────────────────────────────────
const NO_DOUBLE = /(?:er|en|on|it|el|al|or|ow|ew|aw|ix|ox|ax|ex|ss|ck|sh|ch|st|nd|rt|lt|ld|rn|rm|nt|ng|ct|pt|ft|mp|wn|lk|sk|rd|wl)$/i;
const DOUBLE = new Set(['run', 'plan', 'set', 'get', 'put', 'cut', 'shop', 'stop', 'map', 'ship', 'chat', 'prep', 'log', 'tag', 'jog', 'win', 'begin', 'swim', 'sit', 'hit', 'drop', 'grab', 'scan', 'step', 'skim', 'trim', 'chop', 'mop', 'wrap', 'flag', 'audit']);
const DUTY_VERBS = new Set(['escalate', 'guide', 'research', 'correct', 'run', 'track', 'refer', 'triage', 'follow', 'monitor', 'document', 'report', 'maintain', 'ensure', 'track', 'manage', 'review', 'coordinate', 'communicate', 'provide', 'support', 'execute', 'deliver', 'train', 'coach', 'build', 'create', 'develop', 'design', 'lead', 'plan', 'schedule', 'assess', 'evaluate', 'implement', 'analyze', 'analyse', 'prepare', 'process', 'resolve', 'respond', 'administer', 'educate', 'teach', 'inspect', 'install', 'repair', 'test', 'verify', 'update', 'organize', 'organise', 'oversee', 'supervise', 'hire', 'recruit', 'onboard', 'mentor', 'facilitate', 'present', 'write', 'edit', 'publish', 'sell', 'negotiate', 'close', 'audit', 'reconcile', 'record', 'clean', 'stock', 'load', 'pick', 'pack', 'ship', 'receive', 'operate', 'serve', 'greet', 'answer', 'assist', 'handle']);
/** The -ing form of a verb ("coach" → "coaching", "create" → "creating", "run" → "running", "audit" → "auditing"). */
export function gerund(base) {
  const b = String(base || '').toLowerCase();
  if (!b) return b;
  if (b === 'audit') return 'auditing';
  if (/ie$/.test(b)) return `${b.slice(0, -2)}ying`;
  if (/e$/.test(b) && !/(?:ee|ye|oe)$/.test(b) && b !== 'be') return `${b.slice(0, -1)}ing`;
  if (DOUBLE.has(b)) return `${b}${b.slice(-1)}ing`;
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(b) && b.length <= 4 && !NO_DOUBLE.test(b)) return `${b}${b.slice(-1)}ing`;
  return `${b}ing`;
}

/**
 * A duty line said as an -ing phrase, its leading verbs turned ("Create or improve training materials" → "creating or
 * improving training materials", "Coach agents through live call monitoring and roleplay" → "coaching agents through
 * live call monitoring and roleplay"). "our"/"your" become "the". A line that does not start with a verb is returned
 * as a noun phrase, its first letter lowered (unless it is an acronym or a name).
 */
export function gerundPhrase(duty) {
  const words = clean(duty).replace(/[.;:!]+$/, '').split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const out = [];
  let lead = true;
  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const w = raw.replace(/,$/, '');
    // "Clean driving history", "Valid license": an adjective that spells like a verb leads a requirement, not a duty
    if (i === 0 && /^(?:clean|valid|current|open|close|clear|direct|present|complete|correct|perfect|separate|live|level|light|safe|fit)$/i.test(w) && /^(?:driving|record|background|history|license|licence|driver'?s|criminal|availability|communication|candidate|schedule|ability)/i.test(words[1] || '')) { lead = false; out.push(raw.toLowerCase()); continue; }
    if (lead && verbBase(w.toLowerCase()) && !/(?:ing|ed)$/i.test(w)) {
      out.push(`${gerund(verbBase(w.toLowerCase()))}${raw.endsWith(',') ? ',' : ''}`);
      // "Create or improve", "Plan, build and run" — the next verb after a conjunction or a comma is turned too
      const nxt = words[i + 1] || '';
      if (/^(?:and|or|&)$/i.test(nxt) && verbBase(String(words[i + 2] || '').replace(/,$/, '').toLowerCase())) { out.push(nxt === '&' ? 'and' : nxt.toLowerCase()); i++; continue; }
      lead = raw.endsWith(',');
      continue;
    }
    // "… progress and report on speed-to-proficiency", "Follow up with, execute, and properly document orders": a later
    // duty verb after "and" / "or" / a comma (an adverb between is kept), known by what follows it or by being a duty verb
    const prev = out[out.length - 1] || '';
    const prev2 = out[out.length - 2] || '';
    const afterJoin = i > 1 && (/^(?:and|or)$/i.test(prev) || /,$/.test(prev) || (/ly$/i.test(prev) && (/^(?:and|or)$/i.test(prev2) || /,$/.test(prev2))));
    const wl = w.toLowerCase();
    if (afterJoin && verbBase(wl) === wl && (DUTY_VERBS.has(wl) || /^(?:on|the|a|an|to|with|for|all|any|new|their|its|our|your|daily|weekly|monthly|key)$/i.test(words[i + 1] || ''))) { out.push(`${gerund(wl)}${raw.endsWith(',') ? ',' : ''}`); continue; }
    lead = false;
    out.push(i === 0 && /^[A-Z][a-z]+$/.test(raw) && !/^[A-Z]/.test(words[i + 1] || '') ? raw.charAt(0).toLowerCase() + raw.slice(1) : raw);
  }
  return out.join(' ').replace(/\bour\b/gi, 'the').replace(/\byour\b/gi, 'the');
}
