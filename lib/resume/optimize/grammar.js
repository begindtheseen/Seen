// Grammar for a résumé bullet, the way recruiters expect it written: implied first person (no "I",
// "my", "we"), an action verb first, present tense for the current job and past tense for every
// earlier one, the same tense across verbs joined in one bullet, no "responsible for", no buzzwords,
// no doubled words, one or two lines.
//
// Deterministic. What can be fixed without changing meaning (tense, "Manages" → "Manage", a leading
// capital, spacing) is fixed; what cannot (a pronoun inside a clause, a noun-only line, a buzzword) is
// reported so the caller rejects the rewrite instead of shipping it.

import { analyzeLead } from '../health/bullet.js';
import { KNOWN_VERBS, RECOGNITION_LEADS, BUZZWORD_RE, WEAK_LEAD_RE } from '../health/verbs.js';
import { pastTense, baseFromPast, matchCase } from '../rewrite/inflect.js';

const PRONOUN_RE = /\b(I|I'm|I've|I'd|me|my|mine|myself|we|we're|our|ours|us)\b/;
const MAX_CHARS = 240;

/** The base form of a verb token in any common form, or '' when it is not a known verb. */
export function verbBase(token) {
  const w = String(token || '').toLowerCase().replace(/[^a-z-]/g, '');
  if (!w) return '';
  if (KNOWN_VERBS.has(w)) return w;
  const past = baseFromPast(w, KNOWN_VERBS);
  if (past) return past;
  // third person: "manages" → "manage", "oversees" → "oversee", "carries" → "carry"
  if (/ies$/.test(w) && KNOWN_VERBS.has(`${w.slice(0, -3)}y`)) return `${w.slice(0, -3)}y`;
  if (/es$/.test(w) && KNOWN_VERBS.has(w.slice(0, -2))) return w.slice(0, -2);
  if (/s$/.test(w) && KNOWN_VERBS.has(w.slice(0, -1))) return w.slice(0, -1);
  return '';
}

/** The verb in the tense this job needs: base form for a current job, past for an earlier one. */
export function inTense(token, current) {
  const base = verbBase(token);
  if (!base) return token;
  const lower = String(token).toLowerCase();
  if (RECOGNITION_LEADS.has(lower)) return token; // "Named", "Promoted": past participles, right in either
  return matchCase(current ? base : pastTense(base), token);
}

// Verbs coordinated inside one bullet ("Lead a crew of 14 and trained 9 new hires").
const COORD_RE = /(,\s+(?:and\s+)?|;\s+|\s+and\s+|\s+then\s+)([A-Za-z][a-z-]+)\b/g;

/**
 * Check and tidy one bullet. `current` = the job is the person's current one (present tense).
 * Returns { text, issues: [{ code, fatal, note }], ok } — ok is false when a fatal issue remains.
 */
export function checkBullet(input, { current = false } = {}) {
  const issues = [];
  let t = String(input || '').replace(/^[\s•●▪◦*·\-–—]+/, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\s+([,;:.])/g, '$1').replace(/\.{2,}$/, '.');
  if (!t) return { text: '', issues: [{ code: 'empty', fatal: true, note: 'empty line' }], ok: false };

  if (WEAK_LEAD_RE.test(t)) issues.push({ code: 'weak_lead', fatal: true, note: `opens with "${t.match(WEAK_LEAD_RE)[0].trim()}" instead of what you did` });
  if (PRONOUN_RE.test(t)) issues.push({ code: 'pronoun', fatal: true, note: 'résumé bullets leave out "I", "my" and "we"' });
  BUZZWORD_RE.lastIndex = 0;
  const buzz = t.match(BUZZWORD_RE);
  BUZZWORD_RE.lastIndex = 0;
  if (buzz) issues.push({ code: 'buzzword', fatal: true, note: `"${buzz[0]}" says nothing a recruiter can check` });
  const doubled = t.match(/\b(\w{3,})\s+\1\b/i);
  if (doubled) issues.push({ code: 'doubled_word', fatal: true, note: `"${doubled[0]}"` });
  if (t.length > MAX_CHARS) issues.push({ code: 'too_long', fatal: true, note: `${t.length} characters — keep a bullet to two lines` });

  const lead = analyzeLead(t);
  // "Manages…": a third-person verb the lead reader takes for a noun.
  if (lead.kind === 'noun' && /s$/i.test(lead.token) && verbBase(lead.token)) { lead.kind = 'verb'; lead.tense = 'present_s'; }
  if (lead.kind === 'noun' || lead.kind === 'none') {
    issues.push({ code: 'no_verb', fatal: true, note: 'does not start with what you did' });
  }
  // The tense the bullet's verbs follow. An earlier job is past. The current job may be either: an
  // ongoing duty in present tense ("Lead a crew of 14") or a finished result in past ("Grew store sales
  // 9% in 2023") — recruiters accept both — so the lead verb decides and joined verbs follow it.
  let present = !current ? false : !(lead.tense === 'past' || RECOGNITION_LEADS.has(String(lead.token).toLowerCase()));
  // "Cut", "Set", "Put": the same word in both tenses, so the lead cannot decide. The first joined
  // verb does ("Cut shrink 54% and trained the team" is past), and nothing is changed to match.
  const leadBase = lead.kind === 'noun' || lead.kind === 'none' || lead.kind === 'weak' || lead.kind === 'pronoun' ? '' : verbBase(lead.token);
  const ambiguousLead = current && !!leadBase && String(lead.token).toLowerCase() === leadBase && pastTense(leadBase) === leadBase;
  if (lead.kind !== 'weak' && lead.kind !== 'pronoun' && lead.token) {
    const want = inTense(lead.token, present);
    if (ambiguousLead) {
      // left as written
    } else if (lead.tense === 'gerund') {
      issues.push({ code: 'gerund_lead', fatal: true, note: `"${lead.token}…" — start with the verb itself` });
    } else if (want !== lead.token) {
      issues.push({ code: 'tense', fatal: false, note: `${present ? 'present tense' : 'past tense'} ("${lead.token}" → "${want}")` });
      t = t.replace(lead.token, want);
    }
  }
  // Coordinated verbs follow the lead's tense.
  // Only a word that is unmistakably a verb here changes: for a current job, a past form ("and trained
  // 9 new hires"); for an earlier job, a base or -s form followed by its object ("and train 9 new
  // hires", "and lead the huddle") — never a noun phrase ("and cash handling").
  if (!ambiguousLead) t = t.replace(COORD_RE, (m, sep, word, offset, whole) => {
    const lower = word.toLowerCase();
    const base = verbBase(word);
    if (!base || RECOGNITION_LEADS.has(lower)) return m;
    const after = whole.slice(offset + m.length).trimStart();
    const objectNext = /^(?:a|an|the|all|every|each|new|our|their|its|his|her|\d|\$|[A-Z][a-z]+\b)/.test(after);
    const isPast = lower !== base && !!baseFromPast(lower, KNOWN_VERBS);
    const isPresent = lower === base || (lower !== base && !isPast);
    const fixed = inTense(word, present);
    if (fixed === word) return m;
    if ((present && isPast) || (!present && isPresent && objectNext)) {
      issues.push({ code: 'mixed_tense', fatal: false, note: `"${word}" → "${fixed}"` });
      return `${sep}${fixed}`;
    }
    return m;
  });
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return { text: t, issues, ok: !issues.some((i) => i.fatal) };
}

/** A summary sentence set: no pronoun-led sentences beyond the implied style, no buzzwords, no doubled words. */
export function checkSummary(input) {
  const issues = [];
  const t = String(input || '').replace(/\s+/g, ' ').trim();
  BUZZWORD_RE.lastIndex = 0;
  const buzz = t.match(BUZZWORD_RE);
  BUZZWORD_RE.lastIndex = 0;
  if (buzz) issues.push({ code: 'buzzword', fatal: true, note: `"${buzz[0]}"` });
  if (/\b(I|me|my)\b/.test(t)) issues.push({ code: 'pronoun', fatal: true, note: 'a résumé summary leaves out "I" and "my"' });
  const doubled = t.match(/\b(\w{3,})\s+\1\b/i);
  if (doubled) issues.push({ code: 'doubled_word', fatal: true, note: `"${doubled[0]}"` });
  if (t.length > 520) issues.push({ code: 'too_long', fatal: true, note: 'keep the summary to three lines' });
  return { text: t, issues, ok: !issues.some((i) => i.fatal) };
}
