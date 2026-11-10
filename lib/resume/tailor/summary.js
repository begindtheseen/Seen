// The tailored summary — built from the verdict and the person's own words (director's decision B).
//
//   [identity] with [N]+ years of experience[, most recently <Title> at <Company>]. Experienced in [the
//   3–4 heaviest matched requirements, in the résumé's own phrasing]. Credentials: [what the posting names
//   that the résumé holds, as the résumé writes it].
//
//   • identity — the person's own phrase from their summary/headline ("Registered nurse", "CPA",
//     "Administrative professional"; adjectives like "Compassionate" / "Hard working and dependable" left
//     out), else their latest relevant title as written;
//   • years — a title identity counts only the months of roles with that title's head word ("Registered
//     nurse with 6+ years" never counts the CNA years); a field identity counts the relevant roles
//     (lib/resume/years.js supportedYears — never above a figure the person states);
//   • "most recently" — the latest-ENDING role (never a gap note); named only when it is relevant to the
//     posting, as "most recently at <Company>" when it is the identity's own title, else "most recently
//     <Title> at <Company>" — never "<Title> at <Title> at <Company>";
//   • never a pasted bullet, never "Strengths in", never a job-hunting sentence.
//
// The person's summary is KEPT unless the new one names strictly more of the posting's matched requirements
// (counted the same way for both); a "Looking for / Seeking …" sentence is the only thing ever removed from
// a kept summary. Every decision is returned with its reason.
import { escapeRegExp } from '../../text/escapeRegExp.js';
import { coveredMonths, statedYears } from '../years.js';
import { passesFirewall } from '../rewrite/rules.js';
import { serializeToText } from '../model.js';
import { isGapNote, stemsCovered, contentStems, cleanLine, GENERIC_REQ, qualifiedProof, reqRank } from './verdict.js';
import { detectRoleFamily } from '../../application-intelligence/roleOntology.js';
import { isTool } from '../../optimizer/extractResumeFacts.js';
import { showLabel } from './paid.js';
import { KNOWN_VERBS } from '../health/verbs.js';
import { baseFromPast } from '../rewrite/inflect.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
let CASE_TEXT = '';
// requirement labels in the résumé's own casing inside a sentence ("GAAP", "PostgreSQL", never "gaap")
const nameList = (xs) => listJoin(xs.map((x) => showLabel(x, CASE_TEXT)));
const escRe = (s) => escapeRegExp(s);

export const JOB_SEARCH_RE = /(?:^|\b)(?:looking\s+for|looking\s+to|seeking|to\s+obtain|in\s+search\s+of|searching\s+for|hoping\s+to\s+(?:join|find|grow)|open\s+to\s+(?:a|new|roles?|opportunit)|eager\s+to\s+(?:join|find)|my\s+goal\s+is|objective:|to\s+obtain\s+a|to\s+secure\s+a|ready\s+for\s+(?:a|my)\s+next)\b/i;
const CLICHE_RE = /\b(?:team player|works? well under pressure|hard[- ]?working|dependable|detail[- ]oriented|known for|running smoothly|results[- ]driven|self[- ]starter|go[- ]getter|people person|fast learner|quick learner|passionate about|think outside the box)\b/i;
// substance = what is left once job-hunting sentences and cliché CLAUSES are cut ("Registered Nurse with 6 years in home
// health and med-surg, known for careful assessments" keeps its first clause)
const substanceWords = (sentences) => sentences.filter((x) => !JOB_SEARCH_RE.test(x)).map((x) => x.split(/,|;|\band\b(?=\s+(?:known|a|an)\b)/).filter((c) => !CLICHE_RE.test(c)).join(' ')).join(' ').split(/\s+/).filter((w) => w.length > 2).length;
const ADJECTIVES = new Set(['compassionate', 'organized', 'dedicated', 'hard', 'working', 'hardworking', 'hard-working', 'dependable', 'motivated', 'passionate', 'results-driven', 'results', 'driven', 'detail-oriented', 'detail', 'oriented', 'reliable', 'enthusiastic', 'experienced', 'seasoned', 'dynamic', 'proven', 'skilled', 'energetic', 'friendly', 'caring', 'diligent', 'highly', 'self-motivated', 'versatile', 'accomplished', 'professional,', 'driven,', 'and', 'a', 'an', 'creative', 'ambitious', 'confident', 'personable', 'outgoing', 'loyal', 'punctual', 'trustworthy', 'efficient', 'effective', 'strong', 'talented', 'enthusiastic,']);
const ROLE_HEAD = /\b(nurse|engineer|electrician|accountant|professional|developer|manager|specialist|technician|assistant|associate|analyst|designer|marketer|coordinator|administrator|representative|lead|supervisor|cpa|rn|lpn|cna|driver|operator|clerk|cashier|receptionist|bookkeeper|graduate|student|advisor|consultant|recruiter|teacher|paralegal|pharmacist|therapist|mechanic|plumber|welder|carpenter|machinist|chef|cook|server|bartender|barista|attendant|agent|officer|scientist|architect|writer|editor|planner|buyer|controller|auditor|director|executive|generalist|worker|handler|picker|packer|loader|custodian|janitor|aide|caregiver|technologist|hygienist|medic|emt|paramedic|electrical|journeyman)\b/i;
const HEAD_SYNONYMS = { nurse: ['rn', 'lpn', 'lvn'], rn: ['nurse'], engineer: ['developer', 'swe'], developer: ['engineer'], accountant: ['cpa'], cpa: ['accountant'] };
const GENERIC_HEADS = new Set(['professional', 'graduate', 'student', 'worker', 'specialist', 'associate', 'executive', 'generalist', 'cpa', 'rn', 'lpn', 'journeyman']);

const cleanTitle = (t) => String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*[|]\s*.*$/, '').trim();
// "Sunbelt Electric Contractors, Phoenix AZ" / "Ledgerline (Series B fintech)" → the employer's name
const cleanCompany = (c) => String(c || '').replace(/\s*\([^)]*\)/g, '').replace(/,\s*[A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+)?,?\s+(?:[A-Z]{2})\b.*$/, '').replace(/,\s*(?:remote|hybrid)$/i, '').trim();
const headWord = (phrase) => { const m = String(phrase || '').toLowerCase().match(new RegExp(ROLE_HEAD.source, 'gi')); return m ? m[m.length - 1].toLowerCase() : ''; };

/** The person's own identity phrase from the opener of their summary or headline, adjectives removed. */
export function ownIdentity(base) {
  for (const src of [base.basics.summary, base.basics.headline]) {
    const first = String(src || '').split(/(?<=[.!?])\s+/)[0] || '';
    if (!first || /^\s*(?:i\s+am\s+|i.m\s+)?(?:looking|seeking|searching|objective|to obtain|to secure)\b/i.test(first)) continue;
    // the noun phrase that opens the sentence and ends on a role word ("Hard working and dependable warehouse
    // professional looking for…" → "warehouse professional"), up to six words
    const toks = first.replace(/[,.;:]+/g, ' $& ').split(/\s+/).filter(Boolean);
    let end = -1;
    for (let i = 0; i < Math.min(toks.length, 7); i++) {
      if (/^[,.;:]$/.test(toks[i])) break;
      if (ROLE_HEAD.test(toks[i]) && new RegExp(`^${ROLE_HEAD.source}$`, 'i').test(toks[i].replace(/[^A-Za-z]/g, ''))) {
        const next = (toks[i + 1] || '').toLowerCase();
        if (!next || /^[,.;:]$/.test(next) || /^(?:with|who|and|having|specializing|skilled|experienced|focused|offering|bringing|known|looking|seeking|eager|ready|interested|in|at|for)$/.test(next)) { end = i; break; }
      }
    }
    if (end < 0) continue;
    const words = toks.slice(0, end + 1);
    while (words.length && ADJECTIVES.has(words[0].toLowerCase())) words.shift();
    if (!words.length || words.length > 4) continue;
    const phrase = words.join(' ');
    return { phrase: /^[A-Z]{2,}$/.test(words[0]) ? phrase : cap(phrase.charAt(0).toLowerCase() + phrase.slice(1)), source: src === base.basics.summary ? 'summary' : 'headline' };
  }
  return null;
}

// ── the summary planner (T3) ──
const NON_REGULAR_RE = /\b(?:intern|interns|internship|part[- ]?time|seasonal|temporary|temp|volunteer|volunteering|during school|co-?op|summer|externship|practicum|student worker|work[- ]study)\b/i;
/** A regular job: not an internship, part-time, seasonal, temporary or volunteer role. */
export function isRegularRole(e) {
  return !NON_REGULAR_RE.test(`${e.title || ''} ${e.company || ''} ${e.employmentType || ''} ${e.location || ''}`);
}
const familyOf = (title) => detectRoleFamily(String(title || '')).family;
/** The person's own phrase and their role name the same work ("CPA" ~ "Senior Staff Accountant"; not "Sous chef" ~
 * "Kitchen Manager"). A generic phrase ("Warehouse professional") counts when it shares the role's field. */
function sameWork(phrase, title) {
  const h1 = headWord(phrase), h2 = headWord(title);
  if (h1 && h2 && (h1 === h2 || (HEAD_SYNONYMS[h1] || []).includes(h2) || (HEAD_SYNONYMS[h2] || []).includes(h1))) return true;
  if (h1 && GENERIC_HEADS.has(h1)) {
    const f1 = familyOf(phrase), f2 = familyOf(title);
    return contentStems(phrase).some((st) => contentStems(title).includes(st)) || (f1 !== 'general' && f1 === f2);
  }
  return false;
}
// "SOUS CHEF" is shouted by a template, not a name: "Sous Chef"; an acronym stays ("CPA", "RN")
const fixCaps = (t) => String(t || '').split(/(\s+)/).map((w) => (/^[A-Z]{4,}$/.test(w) || (/^[A-Z]{2,}$/.test(w) && /[A-Z]{3,}\s+[A-Z]{3,}/.test(t)) ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join('').replace(/\s*,\s*.*$/, '').trim();
export const FIRST_PERSON_RE = /\b(?:I|I'm|I’m|I've|I’ve|I'd|me|my|mine|we|our|us)\b/;
// a plain word capitalised only because a list or a line started with it ("Sales, onboarding and HubSpot") is written
// lower-case mid-sentence; a tool, a product or an acronym keeps its letters
const listCase = (p) => (/^[A-Z][a-z]+(?:[\s-][a-z]+)*$/.test(p) && !isTool(p.toLowerCase()) && !/^(?:English|Spanish|French|German|Mandarin|Excel|Word|Outlook|Epic|Cerner|Python|Java|Go|Ruby|Rust|Swift|Kotlin|Salesforce|HubSpot|Canva|Figma)$/.test(p) ? p.toLowerCase() : p);
// "Forklift certified (OSHA, renewed 2024) — renewed |" → "Forklift certified"
const cleanCredential = (c) => String(c || '').replace(/\s*\([^)]*\)/g, '').split(/\s+[—–|-]\s+|\s*\|\s*/)[0].replace(/[,;:\s|—–-]+$/, '').replace(/\b(?:renewed|expires?|exp\.?|issued)\b.*$/i, '').trim();
const SUMMARY_CONNECTIVES = ['with', 'years', 'of', 'experience', 'most', 'recently', 'at', 'experienced', 'in', 'and', 'credentials', 'currently', 'since', 'until', 'holds', 'day', 'to', 'work', 'includes', 'hands', 'on', 'student', 'graduating', 'background', 'brings', 'skilled', 'the', 'a', 'an', 'now'];
// the year only: a month name the résumé spells another way ("Mar", "03/") would be a word it never wrote
const monthYear = (d) => { const m = String(d || '').match(/^(\d{4})/); return m ? m[1] : ''; };
const hashOf = (s) => { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };

/**
 * The summary, its shape chosen from the case — student / returning after a gap / adjacent move / junior / senior —
 * in one voice (no pronoun, implied first person), normal casing. Returns { text, shape, recent }.
 */
export function summaryPlan({ base, identity, own, latest, years, field, fieldPrep, picks, creds, now = new Date(), offField = false, seed = '' }) {
  if (!identity) return { text: '', shape: 'none', recent: '' };
  const co = latest && latest.company ? cleanCompany(latest.displayCompany || latest.company) : '';
  const current = !!latest && (latest.end === 'present' || (!latest.end && latest.start));
  const titleIsIdentity = !!latest && ((sameWork(identity, latest.title || '') && headWord(identity) === headWord(latest.title || '')) || cleanTitle(latest.displayTitle || latest.title || '').toLowerCase() === String(identity).toLowerCase());
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const endedLongAgo = !!latest && !current && latest.end && latest.end !== 'present' && (() => { const [y, m] = latest.end.split('-').map(Number); const [ny, nm] = nowKey.split('-').map(Number); return (ny - y) * 12 + (nm - (m || 12)) > 9; })();
  const edu = (base.education || []).find((e) => /expected|anticipated|candidate/i.test(e.dateText || '') || (e.end && e.end > nowKey));
  const student = !!edu && !(base.experience || []).some((e) => isRegularRole(e) && !isGapNote(e));
  const tail = field ? (/ing$/.test(fieldPrep) ? ` ${fieldPrep} ${field}` : ` in ${field}`) : '';
  const yrs = years != null && years >= 1 ? (field && /ing$/.test(fieldPrep) ? ` with ${years}+ years${tail}` : ` with ${years}+ years of experience${tail}`) : (field ? ` with experience${tail}` : '');
  const where = co ? (titleIsIdentity ? `at ${co}` : `${cleanTitle(latest.displayTitle || latest.title)} at ${co}`) : '';
  let shape;
  let first;
  if (student) {
    shape = 'student';
    const what = edu.field ? cap(edu.field.toLowerCase()) : edu.degree;
    first = `${what} student at ${edu.school}${edu.end ? `, graduating ${monthYear(edu.end)}` : ''}.`;
  } else if (endedLongAgo) {
    shape = 'returning';
    first = `${identity}${yrs}${co ? `, most recently ${where} until ${monthYear(latest.end)}` : ''}.`;
  } else if (offField) {
    shape = 'adjacent';
    first = `${identity}${yrs}${where ? `, ${current ? 'currently' : 'most recently'} ${where}` : ''}.`;
  } else if (years != null && years < 3 && latest && latest.start && current && co) {
    shape = 'junior';
    first = `${identity} ${where} since ${monthYear(latest.start)}.`;
  } else {
    shape = 'senior';
    first = `${identity}${yrs}${where ? `, ${current ? 'currently' : 'most recently'} ${where}` : ''}.`;
  }
  const parts = [first];
  // one item alone must say something specific ("wound care"), never a single generic word ("cleaning")
  const enough = picks.length >= 2 || (picks.length === 1 && picks[0].split(/\s+/).length >= 2);
  const credTail = creds.length ? `${creds.length > 1 ? `${creds.slice(0, -1).join(', ')} and ${creds[creds.length - 1]}` : creds[0]}` : '';
  if (enough) {
    const lead = shape === 'adjacent' ? 'Brings' : shape === 'student' ? 'Experience with' : picks.length < 2 ? 'Experienced in' : ['Experienced in', 'Skilled in', 'Work includes'][hashOf(seed) % 3];
    parts.push(`${lead} ${listJoin(picks)}${credTail ? `; holds ${credTail}` : ''}.`);
  } else if (credTail) {
    parts.push(`Holds ${credTail}.`);
  }
  const text = parts.join(' ').replace(/\.\./g, '.').replace(/\s{2,}/g, ' ').trim();
  return { text, shape, recent: where };
}

// the -ing form of the person's own verb ("Run" → "running", "Handle" → "handling", "Plan" → "planning")
function gerund(base) {
  const b = String(base || '').toLowerCase();
  if (/ie$/.test(b)) return `${b.slice(0, -2)}ying`;
  if (/[^aeiou]e$/.test(b) && !/(?:ee|ye|oe)$/.test(b)) return `${b.slice(0, -1)}ing`;
  if (/^(?:run|plan|ship|stop|shop|swap|chat|set|cut|get|put|sit|win|map|tap|log|tag|scan|staff)$/.test(b) && !/ff$/.test(b)) return `${b}${b.slice(-1)}ing`;
  return `${b}ing`;
}
const SAYS_STOPS = new Set(['with', 'from', 'that', 'this', 'your', 'their', 'have', 'will', 'work', 'able', 'ability', 'skills', 'experience', 'other', 'such', 'including', 'team', 'within', 'across', 'ensure', 'support', 'perform', 'provide', 'maintain', 'responsible', 'using', 'every', 'each']);
const sStems = (t) => [...new Set(contentStems(t).filter((w) => w.length >= 3 && !SAYS_STOPS.has(w) && !/^(?:the|and|for|our|you|any|all|its|can|may|are|has|was|who|not|but|per|etc|get|use)$/.test(w)))];
const sharesWords = (a, b) => { const A = sStems(a), B = new Set(sStems(b)); const n = A.filter((w) => B.has(w)).length; return n >= 2 || (n >= 1 && A.length <= 3); };
/**
 * The summary from the person's own lines (round 6). Scope ("Shift Supervisor at Dutch Bros Coffee since 2022"), the
 * line that proves the posting's first duty as a clause ("running the afternoon shift, 6 to 8 broistas, …"), the next one
 * or two such lines as written, and the pluses they hold that the posting names. Every word from the résumé except the
 * -ing of their own verb. → { text, added: [inflected words], statements: [ids] } | null
 */
export function lineSummary({ base, verdict, latest, prefer = null }) {
  const sts = (Array.isArray(verdict && verdict.statements) ? verdict.statements : []).filter((s) => s && s.display !== false && (s.status === 'shown' || s.status === 'partly'));
  if (!sts.length || !latest || !latest.bullets || !latest.bullets.length) return null;
  const flat = (x) => cleanLine(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // the statements whose proof is NOT already in the role's first lines come first: a summary that repeats the top bullets
  // adds nothing to the first read
  const top = new Set(latest.bullets.slice(0, 3).map((b) => flat(b.text)));
  const buried = (s) => (s.evidence || []).some((e) => e && e.line && !top.has(flat(e.line)) && latest.bullets.some((b) => flat(b.text) === flat(e.line)));
  const rank = (s) => (prefer && prefer.has(s.id) ? 2 : 0) + (buried(s) ? 1 : 0);
  const ordered = [...sts].sort((a, b) => rank(b) - rank(a));
  const lines = [];
  const used = [];
  for (const s of ordered) {
    if (s.kind !== 'duty' && s.kind !== 'requirement') continue;
    const ev = (s.evidence || []).map((e) => e && e.line).filter(Boolean);
    const b = latest.bullets.find((x) => ev.some((l) => flat(l) === flat(x.text)) && sharesWords(s.text, x.text));
    if (!b || lines.includes(b)) continue;
    const w0 = cleanLine(b.text).split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, '');
    if (!(KNOWN_VERBS.has(w0) || baseFromPast(w0, KNOWN_VERBS))) continue;
    lines.push(b); used.push(s.id);
    if (lines.length >= 3) break;
  }
  if (!lines.length) return null;
  // chosen buried-first, SAID in the posting's order: the line for what the posting lists first opens the summary
  const order = new Map(sts.map((s, i) => [s.id, i]));
  const pairsLU = lines.map((b, i) => ({ b, id: used[i] })).sort((x, y) => order.get(x.id) - order.get(y.id));
  lines.splice(0, lines.length, ...pairsLU.map((x) => x.b)); used.splice(0, used.length, ...pairsLU.map((x) => x.id));
  const co = cleanCompany(latest.displayCompany || latest.company || '');
  const title = cleanTitle(latest.displayTitle || latest.title || '');
  if (!title || !co) return null;
  const current = latest.end === 'present' || (!latest.end && latest.start);
  const yr = String(current ? latest.start || '' : latest.end || '').slice(0, 4);
  const scope = `${title} at ${co}${/^\d{4}$/.test(yr) ? ` ${current ? 'since' : 'until'} ${yr}` : ''}`;
  const added = [];
  const clause = (t) => {
    const ws = cleanLine(t).replace(/[.;]+$/, '').split(/\s+/);
    const w0 = ws[0].toLowerCase().replace(/[^a-z-]/g, '');
    const base0 = KNOWN_VERBS.has(w0) ? w0 : baseFromPast(w0, KNOWN_VERBS);
    const g = gerund(base0); added.push(g);
    // a second verb joined by "and" takes the same form ("counting the drawers and doing the nightly deposit")
    const rest = ws.slice(1).map((x, i, arr) => {
      const lw = x.toLowerCase().replace(/[^a-z]/g, '');
      const prev = i > 0 ? arr[i - 1] : '';
      // a verb in the same series takes the same form: after "and", or after a comma when an object or particle follows
      // ("closing the store 4 nights a week, counting down registers and locking up")
      const next = String(arr[i + 1] || '').toLowerCase().replace(/[^a-z]/g, '');
      const inSeries = prev.toLowerCase() === 'and' || (/,$/.test(prev) && /^(?:up|down|out|off|in|over|the|a|an|all|every|each|new|our|their|its)$/.test(next));
      const verbish = KNOWN_VERBS.has(lw) || (/^(?:lock|unlock|count|set|cash|clean|restock|stock|prep)$/.test(lw) && /^(?:up|down|out|off|the|a|an|all|every|each|new)$/.test(next));
      if (i > 0 && inSeries && verbish && !/^(?:the|a|an)$/.test(lw)) { const gg = gerund(lw); added.push(gg); return x.replace(new RegExp(escapeRegExp(x.replace(/[^A-Za-z]/g, '')), ''), gg); }
      return x;
    });
    return [g, ...rest].join(' ');
  };
  // COMPOSED, never pasted (director, round 6): each line's act in summary register — its verb as a gerund, joined with
  // the others ("Training every new hire on …, and handling customer complaints and remakes.") — every other word the line's
  const parts = [`${scope}, ${clause(lines[0].text)}.`];
  if (lines.length > 1) {
    const acts = lines.slice(1).map((b) => clause(b.text));
    parts.push(`${cap(acts.length === 2 ? `${acts[0]}, and ${acts[1]}` : acts.length > 2 ? `${acts.slice(0, -1).join('; ')}; and ${acts[acts.length - 1]}` : acts[0])}.`);
  }
  // pluses and credentials they hold that a displayed statement names (as the résumé writes them)
  const items = (base.skills || []).flatMap((g) => g.items || []).concat((base.certifications || []).map((c) => String(c.text || c.name || '')));
  const plus = [];
  for (const s of sts) {
    if (!/\b(?:plus|preferred|card|certif\w*|licen[cs]e|bilingual|spanish|french|fluent|language)\b/i.test(s.text)) continue;
    const said = new Set(sStems(lines.map((l) => l.text).join(' ')));
    const one = (a, x) => { const A = sStems(a), X = sStems(x); return X.some((w) => w.length >= 5 && A.includes(w)); };
    // a plus already said in the lines ("Toast POS" after "…the POS (Toast)") is not repeated
    const it = items.find((x) => x && (sharesWords(s.text, x) || one(s.text, x)) && !plus.includes(x) && !sStems(x).every((w) => said.has(w)));
    if (it) plus.push(it.replace(/[.;\s]+$/, ''));
    if (plus.length >= 2) break;
  }
  if (plus.length) {
    const pl = plus.join('; ');
    // a short plus ("Bilingual Spanish") is no sentence of its own: it closes the last one
    // a short plus is the closing line as the résumé writes it ("Bilingual Spanish."), the one fragment a summary allows
    parts.push(`${cap(pl)}.`);
  }
  const text = parts.join(' ').replace(/\s{2,}/g, ' ').trim();
  return { text, added, statements: used };
}

/** Every clause grammatical enough to send: no fragment, no pronoun, no shouting, balanced brackets, no debris. */
export function validateSummary(text) {
  const t = String(text || '').trim();
  const problems = [];
  if (!t) return { ok: false, problems: ['empty'] };
  const sentences = t.split(/(?<=[.!?])\s+/);
  for (const x of sentences) {
    const words = x.replace(/[.!?]$/, '').split(/\s+/).filter(Boolean);
    if (words.length < 4 && !/^Holds\s/.test(x) && !(sentences.length >= 2 && x === sentences[sentences.length - 1] && words.length >= 2 && /^[A-Z]/.test(x))) problems.push(`fragment: "${x}"`);
    if (!/^[A-Z0-9]/.test(x)) problems.push(`no capital: "${x}"`);
    if (!/[.!?]$/.test(x)) problems.push(`no stop: "${x}"`);
  }
  if (FIRST_PERSON_RE.test(t)) problems.push('first person');
  if (/\b[A-Z]{3,}\s+[A-Z]{3,}\b/.test(t)) problems.push('all caps');
  const bal = (o, c) => (t.split(o).length - 1) === (t.split(c).length - 1);
  if (!bal('(', ')') || !bal('[', ']') || (t.split('"').length - 1) % 2) problems.push('unbalanced');
  if (/[|]|[\s,;:—–-]+[.!?](?:\s|$)|[,;:]\s*$|\s[—–-]\s*$/.test(t)) problems.push('dangling separator');
  if (/\b(\w+)\s+\1\b/i.test(t)) problems.push('doubled word');
  if (/\b(?:location|branch|store #?\d+|unit #?\d+)\.\s/i.test(t) && /^[A-Z][a-z]+ location\./.test(t)) problems.push('parse debris');
  return { ok: problems.length === 0, problems };
}

function endKey(e) {
  const end = String(e.end || '');
  if (!end && !e.start) return '0000-00';
  if (end === 'present' || (!end && e.start)) return '9999-12';
  return end.length === 4 ? `${end}-12` : end;
}

/** The latest-ending role (ties: one with verdict evidence first, then the person's own order). */
export function latestRole(base, verdict) {
  const roles = base.experience.filter((e) => !isGapNote(e) && (e.title || e.company));
  let best = null;
  for (const e of roles) {
    const k = endKey(e);
    if (!best) { best = e; continue; }
    const bk = endKey(best);
    if (k > bk || (k === bk && (verdict.roleWeight.get(e.id) || 0) > (verdict.roleWeight.get(best.id) || 0))) best = e;
  }
  return best;
}

/** The résumé's own words for a matched requirement, or the posting's label when the evidence line carries
 * every one of its words (rule 2). Searched in the body only — bullets, titles, skills, certifications. */
export function ownPhrase(row, bodyText) {
  for (const p of [row.label, ...(row.postingPhrases || [])]) {
    const s = String(p || '').trim();
    if (s.length < 2) continue;
    const re = new RegExp(`(?<![A-Za-z0-9])(${escRe(s).replace(/\\? /g, '[\\s-]+')}(?:e?s)?)(?![A-Za-z0-9])`, 'i');
    const m = bodyText.match(re);
    if (m) return m[1].replace(/\s+/g, ' ');
  }
  if (row.evidence) {
    // the evidence line's own casing ("Proficient in Microsoft Office." → "Microsoft Office")
    const re = new RegExp(`(?<![A-Za-z0-9])(${escRe(String(row.label)).replace(/\\? /g, '[\\s-]+')}(?:e?s)?)(?![A-Za-z0-9])`, 'i');
    const m = row.evidence.match(re);
    if (m) return m[1];
    if (stemsCovered(row.label, row.evidence)) return row.label;
  }
  return null;
}
// the person's casing: a lowercase use anywhere wins ("patient education"), else as written ("Excel", "Dentrix")
// the résumé's own casing: a lowercase use anywhere wins ("patient education"); else the casing the résumé writes it in
// ("Excel", "Dentrix"); a capital that only comes from starting a line ("Wound care, ostomy care…") is not the word's own
const keepCase = (phrase, body) => {
  const all = [...body.matchAll(new RegExp(`(^|[^A-Za-z0-9])(${escRe(phrase)})(?![A-Za-z0-9])`, 'gim'))];
  if (!all.length) return phrase;
  if (all.some((m) => m[2] === m[2].toLowerCase())) return phrase.toLowerCase();
  const mid = all.find((m) => m[1] && m[1] !== '\n');
  const own = (mid || all[0])[2];
  return !mid && /^[A-Z][a-z]+(?:[\s-][a-z0-9]+)*$/.test(own) ? own.charAt(0).toLowerCase() + own.slice(1) : own;
};

/** How many of the verdict's matched requirements a summary names (the same count for old and new). */
export function namedRequirements(text, verdict) {
  const t = String(text || '');
  if (!t.trim()) return [];
  return verdict.matched.filter((r) => !r.soft && r.label && stemsCovered(r.label, t)).map((r) => r.label);
}

// a diagnosis is who you cared for, not what you are experienced in ("Experienced in … CHF")
const DIAGNOSIS_RE = /^(?:chf|copd|diabetes|stroke|sepsis|pneumonia|dementia|hypertension|cancer|covid|asthma|mi|cva|dvt|uti|ckd|esrd|afib|tbi)$/i;
const CERT_WORD = /\b(?:licen[cs]e[ds]?|certif\w*|registered|cpr|bls|acls|pals|nihss|osha|cdl|cpa|ccrn|tncc|nrp|servsafe|forklift|epa|nfpa|journeyman|master)\b/i;
function credentialsNamed(base, verdict) {
  const out = [];
  const want = [...verdict.matched.filter((r) => CERT_WORD.test(r.label)).map((r) => r.label), ...verdict.constraints.filter((c) => (c.kind === 'certification' || c.kind === 'license') && c.status === 'met').map((c) => c.label)];
  if (!want.length) return out;
  for (const c of base.certifications) {
    const text = String(c.text || c.name || '').replace(/\s*\((?:[^)]*(?:association|academy|institute|council|red cross|issued|board)[^)]*)\)/gi, '').replace(/[,\s]*(?:19|20)\d{2}\s*$/, '').trim();
    // a credential in progress ("CPA Candidate", "CPA Exam: 2 of 4 parts") is never "held"
    if (!text || /\b(?:candidate|exam|pursuing|in progress|expected|eligible|working toward)\b/i.test(String(c.text || c.name || ''))) continue;
    if (want.some((w) => stemsCovered(w.replace(/\b(?:certification|certificate|certified|license|licence|licensure|required|preferred|current|active|valid)\b/gi, '').trim() || w, text))) out.push(text);
  }
  return [...new Set(out)];
}

/**
 * @returns {{ mode: 'replace'|'add'|'keep'|'trim', text: string, before: string, named: string[], namedBefore: string[], why: string, sources: object }}
 */
export function composeVerdictSummary(base, verdict, { relevantIds = null, now = new Date(), yearsCeiling = null, postingText = '', prefer = null, force = false } = {}) {
  CASE_TEXT = serializeToText(base);
  const before = String(base.basics.summary || '').trim();
  const beforeSentences = before.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  // an objective sentence that names what THIS posting offers (its schedule, setting, level or field — "a night-shift
  // role" for a night-shift RN posting) is the one sentence that matches the job: it stays (round 3)
  const SCHED = /\b(?:night|nights|overnight|day|days|evening|evenings|weekend|weekends|remote|hybrid|on-?site|part[- ]time|full[- ]time|travel|per diem|prn)\b/gi;
  const OBJ_FILLER = new Set(['looking', 'seeking', 'search', 'role', 'position', 'opportunity', 'opportunities', 'job', 'grow', 'growth', 'room', 'where', 'can', 'help', 'want', 'next', 'new', 'team', 'company', 'trusted', 'valued', 'skills', 'career', 'challenging', 'rewarding', 'chance', 'contribute']);
  const titleLine = String(postingText || '').split('\n')[0] || '';
  const postingSched = new Set((String(postingText || '').match(SCHED) || []).map((x) => x.toLowerCase().replace(/s$/, '').replace(/[- ]/g, '')));
  const matchesPosting = (x) => {
    const sched = (x.match(SCHED) || []).map((m) => m.toLowerCase().replace(/s$/, '').replace(/[- ]/g, ''));
    if (sched.some((m) => postingSched.has(m))) return true;
    const st = contentStems(x).filter((w) => !OBJ_FILLER.has(w) && w.length > 2);
    return st.some((w) => contentStems(titleLine).includes(w));
  };
  const keptObjective = beforeSentences.filter((x) => JOB_SEARCH_RE.test(x) && matchesPosting(x));
  const jobSearch = beforeSentences.filter((s) => JOB_SEARCH_RE.test(s) && !keptObjective.includes(s));
  const namedBefore = namedRequirements(before, verdict);
  const roles = base.experience.filter((e) => !isGapNote(e));
  const relevant = new Set(relevantIds ? [...relevantIds] : roles.filter((e) => (verdict.roleWeight.get(e.id) || 0) > 0).map((e) => e.id));
  for (const e of roles) if ((verdict.roleWeight.get(e.id) || 0) > 0) relevant.add(e.id);

  // identity: the person's CURRENT (or latest-ending) regular role — never an internship, a part-time or seasonal job
  // when a later or current regular one exists (an "Accounting Intern with 6+ years" summary on a staff accountant's
  // résumé, T3). Their own phrase stays only when it names the same work as that role.
  const regular = roles.filter((e) => isRegularRole(e));
  const pool = regular.length ? regular : roles;
  const latestReg = pool.length ? pool.reduce((best, e) => (!best || endKey(e) > endKey(best) ? e : best), null) : null;
  let own = ownIdentity(base);
  const offField = !!(own && postingText && !contentStems(own.phrase).some((st) => contentStems(postingText).includes(st)));
  if (own && latestReg && !sameWork(own.phrase, latestReg.title)) own = null;
  // the role the identity rests on is a weak parse call (doc.meta.fidelity.uncertain): say less — no title, no years
  const uncertainLines = ((base.meta && base.meta.fidelity && base.meta.fidelity.uncertain) || []).map((u) => String(u.line || '').toLowerCase());
  const shaky = !!latestReg && uncertainLines.some((l) => l && latestReg.title && l.includes(String(latestReg.title).toLowerCase()));
  const identity = own ? fixCaps(own.phrase) : latestReg && !shaky ? fixCaps(cleanTitle(latestReg.displayTitle || latestReg.title)) : '';
  const head = headWord(identity);
  // years: the regular roles in the same line of work (same role word, or the same family as the identity role); a
  // role without dates makes the figure uncertain, and then the summary does not say one
  let years = null;
  if (identity && latestReg) {
    const fam = familyOf(latestReg.title);
    const syn = head && !GENERIC_HEADS.has(head) ? new RegExp(`\\b(?:${[head, ...(HEAD_SYNONYMS[head] || [])].map(escRe).join('|')})s?\\b`, 'i') : null;
    const line = pool.filter((e) => e === latestReg || (syn && syn.test(e.title || '')) || (fam !== 'general' && familyOf(e.title) === fam));
    if (line.every((e) => e.start)) {
      const months = coveredMonths(line, now);
      years = months >= 12 ? Math.floor(months / 12) : null;
      const st = statedYears([base.basics.summary, base.basics.headline].filter(Boolean).join(' '));
      // the person's own figure wins when it is lower, or when the dated months fall short of it by under a year (Maria
      // states "9 years at Target"; her dated Target roles add up to 8.9)
      if (years != null && st != null && (st < years || (st > years && st - months / 12 < 1))) years = st;
    }
  }
  // one years figure per package: never more than the verdict's own count ("You show 5.6 years")
  if (years != null && yearsCeiling != null && years > Math.floor(yearsCeiling)) years = Math.floor(yearsCeiling) >= 1 ? Math.floor(yearsCeiling) : null;
  const latest = latestReg || latestRole(base, verdict);
  // the person's own "experience in med-surg and telemetry" rides along when this posting asks for those words
  let field = '';
  let fieldPrep = 'in';
  if (own && own.source === 'summary' && postingText) {
    const fm = String(base.basics.summary).split(/(?<=[.!?])\s+/)[0].match(/\b(?:experience|background|years?)\s+(in|with|across|supporting|serving|leading|managing|building|running)\s+([^.;,]+?)(?:[.;,]|$)/i);
    // a gerund tail is who they are ("supporting executives and busy offices") and always rides along; a field ("in
    // home health and med-surg") rides along when this posting shares one of its words
    if (fm && fm[2].split(/\s+/).length <= 7 && !FIRST_PERSON_RE.test(fm[2]) && contentStems(fm[2]).length && (/ing$/i.test(fm[1]) || contentStems(fm[2]).some((st) => st.length > 2 && contentStems(postingText).includes(st)))) { field = fm[2].trim(); fieldPrep = fm[1].toLowerCase(); }
  }
  // the heaviest matched requirements, in the résumé's own words
  // the work only: bullets, titles, unqualified skills — never a certification's issuer ("American Heart
  // Association") and never a skill the person marks as partial ("TypeScript (working)")
  const QUAL = /\((?:working|basic|some|familiar|familiarity|learning|beginner|exposure|novice|limited)\b[^)]*\)/i;
  const body = [...base.experience.flatMap((e) => [e.title, ...e.bullets.map((b) => b.text)]), ...base.skills.map((g) => `Skills: ${g.items.filter((it) => !QUAL.test(it)).join(', ')}`), ...base.projects.flatMap((p) => [p.name, ...p.bullets.map((b) => b.text)])].filter(Boolean).map(cleanLine).join('\n');
  const identityStems = new Set([...contentStems(identity), ...contentStems(field)]);
  const picks = [];
  const pickStems = [];
  // the posting's most important requirement first (a required duty before a required tool before a preferred one)
  // round 5: the statements NOT otherwise in the first read are named first (`prefer` = their ids)
  const pref = (r) => (prefer && r.statementId && prefer.has(r.statementId) ? 1 : 0);
  for (const r of [...verdict.matched].sort((a, b) => pref(b) - pref(a) || reqRank(b) - reqRank(a) || b.weight - a.weight)) {
    if (picks.length >= 4) break;
    if (r.soft || r.inferred || r.via === 'related' || r.via === 'title' || r.via === 'field' || qualifiedProof(r.label, r.evidence) || CERT_WORD.test(r.label) || DIAGNOSIS_RE.test(r.label) || GENERIC_REQ.has(r.label.toLowerCase())) continue;
    if (r.where !== 'bullet' && r.where !== 'role' && r.where !== 'skills' && !r.surfaced) continue;
    if (r.where === 'skills' && !stemsCovered(r.label, body)) continue;
    const phrase = ownPhrase(r, body);
    if (!phrase || phrase.length > 40 || phrase.split(/\s+/).length > 5) continue;
    const st = contentStems(phrase);
    if (!st.length || st.every((s) => identityStems.has(s))) continue;
    if (pickStems.some((ps) => st.every((s) => ps.includes(s)) || ps.every((s) => st.includes(s)))) continue;
    picks.push(listCase(keepCase(phrase, body))); pickStems.push(st);
  }
  const creds = credentialsNamed(base, verdict).map(cleanCredential).filter(Boolean);
  const plan = summaryPlan({ base, identity, own, latest, years, field, fieldPrep, picks, creds, now, offField, seed: postingText });
  // round 6: built from the person's own strongest LINES for what the posting lists first (scope → the duties it leads
  // with → the pluses they hold), never "Skilled in A, B and C"
  const fromLines = latestReg ? lineSummary({ base, verdict, latest: latestReg, prefer }) : null;
  let composed = fromLines ? fromLines.text : plan.text;
  // grounded: every word is the résumé's, a posting label proven by its own line, or a connective
  const vocab = [serializeToText(base), ...verdict.matched.map((r) => r.label)].join('\n');
  const fw = composed ? passesFirewall(vocab, composed, [...SUMMARY_CONNECTIVES, String(years || ''), ...((fromLines && fromLines.added) || [])]) : { ok: false };
  if (!fw.ok) composed = '';
  const valid = composed ? validateSummary(composed) : { ok: false, problems: ['empty'] };
  if (!valid.ok) composed = '';
  const recent = plan.recent;
  // the why for a summary built from the person's lines: the statements its lines now evidence, by their place in the posting
  const lineWhy = (hadOne) => {
    if (!fromLines || !composed || composed !== fromLines.text) return '';
    const disp = (Array.isArray(verdict.statements) ? verdict.statements : []).filter((s) => s && s.display !== false);
    const pos = fromLines.statements.map((id) => disp.findIndex((s) => s.id === id)).filter((i) => i >= 0);
    if (!pos.length) return '';
    const short = (t) => String(t || '').split(/[:;,(—–]/)[0].trim().replace(/[.\s]+$/, '');
    const names = fromLines.statements.map((id) => short((disp.find((s) => s.id === id) || {}).text)).filter(Boolean).map((x) => `"${x.charAt(0).toLowerCase()}${x.slice(1)}"`);
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const m = Math.max(...pos) + 1;
    return `${hadOne ? 'Your summary is rebuilt' : 'You had no summary; this one is built'} from your own lines and opens with ${listJoin(names)} — ${words[pos.length - 1] || pos.length} of the first ${words[m - 1] || m} things they list.`;
  };
  const named = namedRequirements(composed, verdict);
  const sources = { field, shape: plan.shape, validation: valid,
    identity, identitySource: own ? own.source : (latestReg ? 'current or latest regular role' : null), years, recent: latest ? { itemId: latest.id, title: latest.title, company: latest.company } : null, requirements: picks, credentials: creds, firewall: fw };

  // decide
  // the first-read planner asks for the composed text itself, to measure it (it is used only when it puts more of the
  // posting's statements in the first read than the person's own)
  // …but never over a summary with substance (round 5 read: Tasha's specific marketing summary was swapped for "Campus
  // Ambassador … Experienced in customer service" to win one first-read line)
  if (force) {
    const thin = !before || substanceWords(beforeSentences) < 15 || beforeSentences.some((x) => CLICHE_RE.test(x)) || beforeSentences.some((x) => !JOB_SEARCH_RE.test(x) && (/^[a-z]/.test(x) || (x.replace(/[.!?]$/, '').split(/\s+/).length <= 2 && !/\d|\b[A-Z]{2,}\b/.test(x))));
    const pitch = keptObjective.length && !jobSearch.length && substanceWords(beforeSentences) >= 5;
    return composed && thin && !pitch ? { mode: before ? 'replace' : 'add', text: composed, before, named, namedBefore, sources, why: '' } : null;
  }
  if (!before) {
    if (composed && (named.length >= 2 || (fromLines && fromLines.statements.length >= 2))) return { mode: 'add', text: composed, before, named, namedBefore, sources, why: lineWhy(false) || `You had no summary. They ask for ${nameList(named.slice(0, 4))}; this one opens with that, every word from your résumé.` };
    return { mode: 'keep', text: '', before, named: [], namedBefore, sources, why: 'No summary was added: there was not enough the posting asks for that your résumé already shows to say it in one.' };
  }
  // A summary with substance stays in the person's words (only a job-hunting line leaves); a thin or cliché one
  // ("Team player who works well under pressure", "Hard working and dependable … looking for a lead role") is
  // rewritten when the new one names more of what the posting asks for.
  const substance = substanceWords(beforeSentences);
  if (composed && offField && namedBefore.length === 0 && named.length >= 2) {
    return { mode: 'replace', text: composed, before, named, namedBefore, sources, why: `Your summary is about ${ownIdentity(base).phrase.toLowerCase()} work and names nothing ${postingText ? 'this posting' : 'the posting'} asks for. They ask for ${nameList(named.slice(0, 4))}; this one leads with that, every word from your résumé.` };
  }
  // parse debris in the person's summary (a sentence starting in lower case, a two-word fragment like "Southpark
  // location.") makes it thin: it is not something they would send
  const debris = beforeSentences.some((x) => !JOB_SEARCH_RE.test(x) && (/^[a-z]/.test(x) || (x.replace(/[.!?]$/, '').split(/\s+/).length <= 2 && !/\d|\b[A-Z]{2,}\b/.test(x))));
  // a summary with substance whose objective names what this very posting offers is the person's own pitch: it stays,
  // however many more labels a line-built one would name (round 3 rule, kept in round 6)
  if (keptObjective.length && !jobSearch.length && substance >= 5 && !debris) return { mode: 'keep', text: before, before, named: namedBefore, namedBefore, sources, why: `Your summary stays as you wrote it — its line "${keptObjective[0].slice(0, 60).replace(/[\s.,;]+$/, '')}${keptObjective[0].length > 60 ? '…' : ''}" is exactly what this posting offers.` };
  if (composed && ((named.length > namedBefore.length && (substance < 15 || named.length >= namedBefore.length + 3)) || (substance < 5 && named.length >= namedBefore.length && named.length >= 1) || (debris && named.length >= Math.max(1, namedBefore.length)))) {
    // one sentence of the person's summary rides along when it states a fact the new one does not (a licence,
    // a language, a number) — never a job-hunting line and never one that repeats the opener
    const FACT_RE = /\b(?:licen[cs]e[ds]?|certif\w*|exam|bilingual|fluent|spanish|french|mandarin|portuguese|vietnamese|tagalog|arabic|korean|\$\d|\d+%|\d[\d,.]*\s*(?:b|m|k)\b)/i;
    const carry = beforeSentences.find((s) => !JOB_SEARCH_RE.test(s) && !FIRST_PERSON_RE.test(s) && validateSummary(s).ok && FACT_RE.test(s) && !stemsCovered(s, composed) && (s.match(/\d[\d,.]*/g) || [s]).some((n) => !composed.includes(n)) && !(identity && s.toLowerCase().startsWith(identity.toLowerCase())));
    // an objective ("looking for / seeking / to obtain") is never the tail of a composed summary (round 4); the one old
    // sentence that may ride along states a FACT about the person
    const text = [composed, carry].filter(Boolean).join(' ');
    const nowNamed = namedRequirements(text, verdict);
    const fresh = nowNamed.filter((x) => !namedBefore.includes(x));
    const jsAt = jobSearch.length ? jobSearch[0].slice(jobSearch[0].search(JOB_SEARCH_RE)).replace(/^\W+/, '') : '';
    const oldFault = jobSearch.length ? ` and spent words on what you want next ("${jsAt.split(/\s+/).slice(0, 5).join(' ').replace(/[.,;:!]+$/, '')}${jsAt.split(/\s+/).length > 5 ? '…' : ''}")` : beforeSentences.some((x) => CLICHE_RE.test(x)) ? ' and leaned on phrases any applicant could write' : '';
    const why = `They ask for ${nameList(nowNamed.slice(0, 4))}. Your summary ${namedBefore.length ? `named only ${nameList(namedBefore.slice(0, 3))}` : 'named none of it'}${oldFault}. This one ${recent && latest ? `leads with your ${latest.end === 'present' ? 'current' : 'latest'} job at ${cleanCompany(latest.displayCompany || latest.company)} and ` : ''}names ${nameList((fresh.length ? fresh : nowNamed).slice(0, 4))} — every word from your résumé.`;
    return { mode: 'replace', text, before, named: nowNamed, namedBefore, sources: { ...sources, carried: carry || null }, why: lineWhy(true) || why };
  }
  const trimmed = beforeSentences.filter((x) => !jobSearch.includes(x)).join(' ');
  if (jobSearch.length && jobSearch.length < beforeSentences.length && substance >= 5 && !/^[a-z]/.test(trimmed) && trimmed.split(/\s+/).length >= 4) {
    const text = trimmed;
    return { mode: 'trim', text, before, named: namedBefore, namedBefore, sources, why: `${namedBefore.length ? `Your summary already names ${nameList(namedBefore.slice(0, 3))}, which this posting asks for, so it stays in your words` : 'Your summary stays in your words'}; only "${jobSearch[0].slice(0, 60).replace(/[\s.,;]+$/, '')}${jobSearch[0].length > 60 ? '…' : ''}" is left out, because it says what you want rather than what you bring${keptObjective.length ? `; "${keptObjective[0].slice(0, 50).replace(/[\s.,;]+$/, '')}…" stays, because it is what this posting offers` : ''}.` };
  }
  if (jobSearch.length && jobSearch.length === beforeSentences.length && substance < 5) {
    return { mode: 'trim', text: '', before, named: [], namedBefore, sources, why: `Your summary was only about what you want next ("${beforeSentences[0].slice(0, 60)}${beforeSentences[0].length > 60 ? '…' : ''}"), and your résumé shows too little of what this posting asks for${verdict.unmet.find((r) => !r.soft && r.importance === 'required') ? ` (it asks for ${showLabel(verdict.unmet.find((r) => !r.soft && r.importance === 'required').label, CASE_TEXT)})` : ''} to write a better one, so it is left off and your experience opens the page.` };
  }
  if (keptObjective.length && !jobSearch.length) return { mode: 'keep', text: before, before, named: namedBefore, namedBefore, sources, why: `Your summary stays as you wrote it — its line "${keptObjective[0].slice(0, 60).replace(/[\s.,;]+$/, '')}${keptObjective[0].length > 60 ? '…' : ''}" is exactly what this posting offers.` };
  return { mode: 'keep', text: before, before, named: namedBefore, namedBefore, sources, why: namedBefore.length ? `Your summary already names ${nameList(namedBefore.slice(0, 3))}, which this posting asks for; a rewritten one would not name more, so it stays as you wrote it.` : composed ? 'A rewritten summary would not name more of what this posting asks for than yours, so yours stays as you wrote it.' : 'Your own summary stays as you wrote it: there is not enough this posting asks for on your résumé to write a better one.' };
}
