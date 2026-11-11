// Structured posting constraints vs the résumé — the HARD GATES a recruiter or an ATS knock-out
// question applies before any keyword is read (2026-10-24 ATS audit, D3; recruiter R1/R5/R6).
//
// Each constraint from postingSections.extractConstraints is judged against the résumé facts:
//   status 'met'      — the résumé states it (degree rank, measured years, a named certification…)
//   status 'unmet'    — the résumé shows it is not met (an Associate of Arts against a required
//                       Bachelor's; 0 supervisory years against "6+ years managing a team")
//   status 'ask'      — the résumé cannot say either way (availability, lifting, age, a GPA it does
//                       not list): a yes/no for the person, never a "missing keyword"
// A constraint with gate:true whose status is 'unmet' and whose kind is a credential, years,
// management or seniority requirement caps the fit score (GATE_CAP) and is the first line of
// every explanation. Nothing here invents a fact: 'ask' is the honest answer when the résumé is
// silent.
import { escapeRegExp } from '../text/escapeRegExp.js';
import { hasStemmed } from './lemma.js';
import { credentialHeld } from './credentials.js';
import { DEGREE_LABEL } from './postingSections.js';
import { yearsDomain, yearsDomainClause, NOT_PEOPLE_MANAGER_TITLE_RE } from './extractResumeFacts.js';
import { US_STATES, STATE_ABBR } from './postingSections.js';
import { experienceProfile } from '../resume/years.js';
import { roleField, titleField, fieldLabel, areAdjacent, postingField, FIELDS, roleDuties, isNewGradPosting } from './fieldMatch.js';
import { vocabularyAliases } from './hourlyVocabulary.js';
import { tokenize } from './lemma.js';
import { notYetHeld } from './lineProof.js';
import { occupationOf, hasOccupationData } from '../occupations/index.js';
import { expand as tradeExpand } from '../text/tradeTalk.js';
import { stem as morphStem } from '../text/morph.js';

// How a credential reads in a sentence: a bare acronym is a certification ("CPR certification", not "a CPR").
function credentialName(label) {
  const l = String(label || '').trim();
  return /^(?:CPR|BLS|ACLS|PALS|NRP|TNCC|NIHSS|OSHA\s*\d+|EPA\s*608)$/i.test(l) ? `${l} certification` : l;
}
// The US states a résumé's license lines name ("Arizona Journeyman Electrician", "RN — Michigan", "AZ RN #12345").
// The résumé's own name for the license on its license line ("Arizona Journeyman Electrician" → "Journeyman Electrician").
function licenseWords(resumeText, value) {
  const re = /journeyman|master|electric/i.test(value) ? /\b((?:journeyman|master)(?:\s+electrician|\s+plumber)?)\b/i : /\b(RN|registered\s+nurse|LPN|LVN)\b/i;
  for (const line of String(resumeText || '').split(/\n/)) { const m = line.match(re); if (m && /licen|journeyman|master|\bRN\b|#/i.test(line)) return m[1].replace(/^\w/, (c) => c.toUpperCase()); }
  return '';
}
// ONE licence name, two spellings (G6 addendum c): the practitioner's noun and the practice's noun name the same licence
// ("Cosmetologist License" = "cosmetology license"), and a state code on a licence line is the state's name ("MN" =
// "Minnesota"). Practitioner / practice pairs are listed (lib/text/morph leaves agent nouns out on purpose and tradeTalk
// has no licence entries); comparison only, never printed.
const LICENCE_NOUNS = [
  [/\bcosmetolog(?:ist|y|ists)\b/gi, 'cosmetology'], [/\belectric(?:ian|ians|al)\b/gi, 'electrical'],
  [/\b(?:a?esthetician|a?estheticians|a?esthetics)\b/gi, 'esthetics'], [/\bbarber(?:s|ing)?\b/gi, 'barbering'],
  [/\bplumb(?:er|ers|ing)\b/gi, 'plumbing'], [/\bmanicurist|nail\s+technician|nail\s+technology\b/gi, 'nail technology'],
  [/\bmassage\s+therapist|massage\s+therapy\b/gi, 'massage therapy'], [/\bpharmacist|pharmacy\b/gi, 'pharmacy'],
];
export function licenceForm(text) {
  let t = String(text || '').replace(/\s*\([A-Z0-9]{1,3}\)(?=\s+[a-z])/gi, '');
  for (const [re, to] of LICENCE_NOUNS) t = t.replace(re, to);
  return t.split(/\n/).map((line) => (/licen[sc]|certif|journeyman|#/i.test(line) ? line.replace(/(?<![A-Za-z])([A-Z]{2})(?![A-Za-z])/g, (m, ab) => STATE_ABBR[ab] || m) : line)).join('\n');
}
/** The sentence that follows `quote` in the posting (same line or paragraph), or ''. */
function nextSentence(jobText, quote) {
  const t = String(jobText || ''); const q = String(quote || '').trim();
  if (!q) return '';
  const i = t.indexOf(q.slice(0, 80));
  if (i < 0) return '';
  let rest = t.slice(i + Math.min(q.length, 80));
  // the quote may stop short of its own sentence's end: step past it unless the quote already ended one
  if (!/[.!?]\s*$/.test(q.slice(0, 80))) { const end = rest.search(/[.!?](?:\s|$)/); if (end < 0) return ''; rest = rest.slice(end + 1); }
  // only a sentence on the same line continues it — a new bullet or paragraph is another requirement
  if (/^[ \t]*(?:\n|$)/.test(rest)) return '';
  return (rest.replace(/^\s+/, '').split(/(?<=[.!?])\s|\n/)[0] || '').slice(0, 240);
}
/** The résumé's own words for an item (G6 gate rows quote the résumé, not the posting): the first list piece — a line
 *  split at commas / semicolons / pipes / bullets outside parentheses — that passes `test`, without a "Licenses:" label. */
export function resumeItem(resumeText, test) {
  for (const line of String(resumeText || '').split(/\n/)) {
    if (!test(line)) continue;
    const pieces = []; let cur = '', depth = 0;
    for (const ch of line) {
      if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && /[,;|•·]/.test(ch)) { pieces.push(cur); cur = ''; } else cur += ch;
    }
    pieces.push(cur);
    const hit = pieces.map((x) => x.replace(/^[\s\-–—*]+/, '').replace(/^[A-Za-z][A-Za-z &/]{1,30}:\s*/, '').replace(/[\s.]+$/, '').trim()).find((x) => x && test(x));
    if (hit) return hit;
  }
  return '';
}
// the posting's name is said beside the résumé's only when the résumé's words leave out one of its real words
// ("Spanish (fluent) — the bilingual English/Spanish they ask for"); "food handlers card" needs no link to "Food handler card"
function needsLink(item, postingName) {
  const have = new Set(tokenize(licenceForm(item)).map((t) => t.stem));
  return tokenize(licenceForm(postingName)).map((t) => t.stem).filter((x) => x.length > 2 && !/^(?:licen|licens|certif|certific|card|the|and|or|a|an|of|is|plus|prefer|requir|current|activ|valid|state)/.test(x)).some((x) => !have.has(x));
}
function listedSentence(item, postingName) {
  return `Your résumé lists ${item}${needsLink(item, postingName) ? ` — the ${String(postingName).replace(/^an?\s+/i, '')} they ask for` : ''}.`;
}
// ── Strict items the posting reader does not read (G7) ──────────────────────────────────────────────────────────────
// The title is part of the posting: its conditions ("(Part-Time, Evenings)", "3+ Years Required", "(Licensed Insurance
// Agent Required)") are statements like any other. A licence sentence the reader's credential list does not know
// ("Active Iowa Property & Casualty license required") is still a licence ask. "Within the past two years" / "recent
// experience required" is a recency ask.
const LICENCE_ASK_RE = /\blicen[sc]e[ds]?\b|\bcertific(?:ate|ation)\b/i;
const MUST_RE = /\b(?:required|requires?|must|mandatory|need(?:ed)?|necessary)\b/i;
const STATE_ALT = () => new RegExp(`\\b(${US_STATES.join('|')})\\b`);
/** The posting's sentences, each with the next sentence on the same line ("… certification. Must be obtained within 30
 *  days of hire" — the second sentence qualifies the first). */
function postingSentences(jobText) {
  return String(jobText || '').split(/\n+/).flatMap((l) => {
    const parts = l.replace(/^[\s•\-*·–]+/, '').split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim());
    return parts.map((x, i) => ({ s: x, next: parts[i + 1] || '' }));
  }).filter((x) => x.s && x.s.length < 260);
}
function stateIn(sentence) {
  const m = sentence.match(STATE_ALT());
  if (m) return m[1];
  const ab = (sentence.match(/(?<![A-Za-z])([A-Z]{2})(?![A-Za-z])/g) || []).find((x) => STATE_ABBR[x] && !/^(?:OR|IN|ME|OK|HI|AS)$/.test(x));
  return ab ? STATE_ABBR[ab] : null;
}
function licenceAsk(sentence, fromTitle) {
  if (!LICENCE_ASK_RE.test(sentence) || /\bdriver'?s?\b/i.test(sentence) || /\b(?:diploma|GED|degree|high\s+school|institution|transcript)\b/i.test(sentence) || !(fromTitle || MUST_RE.test(sentence)) || CREDENTIAL_OPTIONAL_RE.test(sentence) || CREDENTIAL_PROSPECTIVE_RE.test(sentence) || OBTAIN_LATER_RE.test(sentence)) return null;
  // a certificate is asked only in so many words ("… certificate required"); a licence by any must-wording
  const kindWord = /\blicen[sc]/i.test(sentence) ? 'license' : /\bcertificate\b/i.test(sentence) ? 'certificate' : 'certification';
  if (kindWord !== 'license' && !/\b(?:required|must\s+(?:have|hold|possess))\b/i.test(sentence)) return null;
  const anyOf = ((sentence.match(/\(([^()]*)\)/) || [])[1] || '').split(/\s*(?:,|\bor\b|\/)\s*/).map((x) => x.trim()).filter((x) => /^[A-Z][A-Z&-]{1,6}$/.test(x));
  const state = stateIn(sentence);
  let label = '';
  const lic = sentence.match(/\blicensed\s+((?:[A-Za-z&]+\s+){0,3}?[A-Za-z&]+?)(?=\s+(?:required|requires?|must|is|are|with|in|for|\(|$)|[,.;)]|$)/i);
  const pre = sentence.replace(/\([^()]*\)/g, ' ').match(/((?:[A-Za-z&][\w&-]*\s+){1,5}?)(?:licen[sc]e|certificate|certification)\b/i);
  if (lic && kindWord === 'license') label = `${lic[1]} license`;
  else if (pre) label = `${pre[1].trim()} ${kindWord}`;
  label = label.replace(/^(?:(?:an?|the|active|current|valid|unrestricted|unencumbered|state|must|have|hold|possess|required|requires?)\s+)+/i, '').replace(new RegExp(`^(?:${US_STATES.join('|')})\\s+`, 'i'), '').replace(/\s+/g, ' ').trim();
  if (!label || /^(?:licen|certific)/i.test(label)) label = anyOf.length ? `${anyOf.join(' or ')} ${kindWord}` : '';
  if (/^[A-Z][a-z]+\b/.test(label) && !/^(?:Property|Life|Health|Casualty)\b/.test(label)) label = label.charAt(0).toLowerCase() + label.slice(1);
  if (anyOf.length && !anyOf.some((a) => label.includes(a))) label = `${label} (${anyOf.join(' or ')})`;
  // a label of generic words only ("professional license", "applicable state licensure") names no credential
  if (!label || !label.split(/\s+/).some((w) => !/^(?:professional|state|applicable|appropriate|required|valid|relevant|any|all|necessary|current|active|proper|such|other|similar|equivalent|license|licensed|licensure|certificate|certification|and|or|of|the|a|an|as|in|for|with|and\/or)$/i.test(w.replace(/[(),]/g, '')))) return null;
  return { factType: 'constraint', kind: 'certification', label: `${state ? `${state} ` : ''}${label}`, value: label.toLowerCase(), state, anyOf: anyOf.length ? anyOf : null, gate: true, importance: 'required', evidence: sentence, statementId: null, synthetic: true };
}
const TITLE_SCHEDULE = [[/\bpart[\s-]*time\b|\bPT\b/i, 'part-time'], [/\bfull[\s-]*time\b|\bFT\b/i, 'full-time'], [/\bseasonal\b/i, 'seasonal'], [/\btemp(?:orary)?\b/i, 'temporary'], [/\bPRN\b|\bper\s+diem\b/i, 'PRN'], [/\bevenings?\b/i, 'evenings'], [/\bnights?\b|\bovernights?\b|\bnoc\b/i, 'nights'], [/\bweekends?(?:\s+only)?\b/i, 'weekends'], [/\b(\d{1,2})\s*(?:hrs?|hours)(?:\s*(?:\/|per|a)\s*(?:wk|week))?\b/i, (m) => `${m[1]} hours per week`]];
function titleFacts(jobTitle, readFacts) {
  const t = String(jobTitle || '');
  const out = [];
  // the condition part of the title: parentheticals and what follows a dash / pipe / comma
  const cond = [...t.matchAll(/\(([^()]+)\)/g)].map((m) => m[1]).concat((t.match(/\s[-–—|,]\s*(.+)$/) || [])[1] || []).join(', ');
  if (!cond) return out;
  const items = [];
  for (const [re, lab] of TITLE_SCHEDULE) { const m = cond.match(re); if (m) items.push(typeof lab === 'function' ? lab(m) : lab); }
  if (items.length) {
    const prev = readFacts.find((f) => f.kind === 'schedule');
    if (prev) { for (const it of items) if (!(prev.items || []).includes(it)) (prev.items = prev.items || []).push(it); prev.label = prev.items.join(', '); }
    else out.push({ factType: 'constraint', kind: 'schedule', label: items.join(', '), value: items.join('|'), items, gate: false, importance: 'required', evidence: t, statementId: null, synthetic: true });
  }
  const y = cond.match(/\b(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i);
  if (y && !readFacts.some((f) => f.kind === 'years' && Number(f.value) >= Number(y[1]))) out.push({ factType: 'constraint', kind: 'years', label: `${y[1]}+ years of experience`, value: Number(y[1]), gate: true, importance: 'required', evidence: t, statementId: null, synthetic: true, titleYears: true });
  const lic = licenceAsk(cond, true);
  if (lic && !readFacts.some((f) => f.kind === 'certification' && hasStemmed(String(f.label || ''), lic.value))) out.push({ ...lic, evidence: t });
  return out;
}
const RECENCY_RE = /\b(?:within\s+the\s+(?:past|last)\s+(\d+|one|two|three|four|five|six|twelve|eighteen|24)\s+(years?|months?)|(?:current\s+or\s+)?recent\s+((?:[\w-]+\s+){0,4}?)experience(?:\s+(?:is\s+)?required)?|current\s+or\s+recent)\b/i;
const NUM_WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12, eighteen: 18 };
function recencyFact(sentence) {
  const m = sentence.match(RECENCY_RE);
  if (!m || !/\bexperience\b|\bworked\b/i.test(sentence)) return null;
  const n = m[1] ? (NUM_WORD[m[1].toLowerCase()] || Number(m[1])) : 2;
  const window = m[2] && /month/i.test(m[2]) ? n / 12 : n;
  // the work it is about: the words before "experience" (or the sentence head before the recency words)
  const subj = (m[3] && m[3].trim()) || (sentence.replace(RECENCY_RE, ' ').match(/((?:[A-Za-z][\w&/-]*\s+){1,4}?)experience\b/i) || [])[1]
    || sentence.slice(0, m.index).replace(/\b(?:must|have|has|with|requires?|required|minimum|of|at\s+least|\d+\+?\s*years?)\b/gi, ' ');
  const subject = String(subj || '').replace(/^(?:(?:current|recent|or|and|the|a|an|prior|previous|hands-on|direct|relevant)\s+)+/i, '').replace(/\s+/g, ' ').trim();
  return { factType: 'constraint', kind: 'recency', label: sentence.length > 90 ? `${sentence.slice(0, 87).replace(/\s+\S*$/, '')}…` : sentence, value: window, subject, gate: true, importance: 'required', evidence: sentence, statementId: null, synthetic: true };
}
function strictExtras(readFacts, jobText, jobTitle) {
  const out = [...titleFacts(jobTitle, readFacts)];
  const quoted = new Set(readFacts.map((f) => String(f.evidence || '').slice(0, 60)));
  for (const { s, next } of postingSentences(jobText)) {
    if (quoted.has(s.slice(0, 60)) && readFacts.some((f) => f.kind === 'certification' && String(f.evidence || '').slice(0, 60) === s.slice(0, 60))) continue;
    const lic = OBTAIN_LATER_RE.test(next) || CREDENTIAL_PROSPECTIVE_RE.test(next) ? null : licenceAsk(s, false);
    if (lic && !readFacts.concat(out).some((f) => f.kind === 'certification' && (String(f.evidence || '').slice(0, 60) === s.slice(0, 60) || hasStemmed(String(f.label || ''), lic.value) || hasStemmed(lic.label, String(f.value || ''))))) out.push(lic);
    const sy = s.match(/^(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s+(?!of\b|experience\b|in\b|as\b|with\b|working\b|required\b)([a-z][a-z/&\s-]{2,40}?)\s*(?:experience)?\.?$/i);
    if (sy && s.split(/\s+/).length <= 7 && !readFacts.concat(out).some((f) => f.kind === 'years' && String(f.evidence || '').slice(0, 40) === s.slice(0, 40))) out.push({ factType: 'constraint', kind: 'years', label: `${sy[1]}+ years of ${sy[2].trim()}`, value: Number(sy[1]), field: sy[2].trim(), gate: true, importance: 'required', evidence: `${sy[1]}+ years of ${sy[2].trim()} experience`, posting_quote: s, statementId: null, synthetic: true });
    const cl = clearanceFact(s);
    if (cl && !out.some((f) => f.kind === 'clearance')) out.push(cl);
    const el = eligibilityFact(s);
    if (el && !out.some((f) => f.kind === 'eligibility')) out.push(el);
    const rec = recencyFact(s);
    if (rec && !out.some((f) => f.kind === 'recency')) out.push(rec);
  }
  return out;
}
// ── Security clearance (G7) ─────────────────────────────────────────────────────────────────────────────────────
// Levels: public trust 1 · confidential 1 · secret 2 · top secret 3 · TS/SCI 4. A higher clearance meets a lower ask;
// interim is partly; inactive / expired is not current; "ability to obtain" is a question.
const CLEAR_LEVELS = [[/\bTS\s*\/\s*SCI\b|\btop\s+secret\s*\/\s*SCI\b/i, 4, 'TS/SCI'], [/\btop\s+secret\b|\bTS\b(?=\s+(?:security\s+)?clearance|\s*$|\s*[,;)])/i, 3, 'Top Secret'], [/\bsecret\b/i, 2, 'Secret'], [/\bconfidential\b/i, 1, 'Confidential'], [/\bpublic\s+trust\b/i, 1, 'Public Trust']];
function clearanceLevel(text) { for (const [re, n, name] of CLEAR_LEVELS) if (re.test(text)) return { n, name }; return null; }
function clearanceFact(sentence) {
  if (!/\bclearance\b|\bTS\s*\/\s*SCI\b|\bpublic\s+trust\b/i.test(sentence)) return null;
  const lv = clearanceLevel(sentence);
  if (!lv) return null;
  const pref = CREDENTIAL_OPTIONAL_RE.test(sentence);
  const later = OBTAIN_LATER_RE.test(sentence) || /\b(?:able|ability|eligible|eligibility)\s+to\s+(?:obtain|get|be\s+granted)\b|\bclearable\b/i.test(sentence);
  return { factType: 'constraint', kind: 'clearance', label: `${/\bactive\b/i.test(sentence) ? 'an active ' : 'a '}${lv.name} clearance${/\bor\s+higher\b/i.test(sentence) ? ' or higher' : ''}`, value: lv.n, levelName: lv.name, later, gate: !pref && !later, importance: pref ? 'preferred' : 'required', evidence: sentence, statementId: null, synthetic: true };
}
function gradeClearance(c, ctx) {
  const lines = String(ctx.text || '').split(/\n/).filter((l) => /\bclearance\b|\bTS\s*\/\s*SCI\b|\bpublic\s+trust\b|\b(?:top\s+)?secret\b/i.test(l) && !/^\s*[•\-*]?\s*(?:handled|protected|classified\s+information)/i.test(l));
  let best = null, line = '';
  for (const l of lines) { const lv = clearanceLevel(l); if (lv && (!best || lv.n > best.n)) { best = lv; line = l.trim(); } }
  const ask = c.label;
  if (c.later) return { status: 'ask', grade: best ? 'met' : 'cannot_tell', caps: false, factor: 1, sentence: best ? `Your résumé lists ${resumeItem(line, (x) => !!clearanceLevel(x)) || best.name}; they ask that you can obtain ${ask.replace(/^an?\s+/i, 'a ')}.` : `They ask that you can obtain ${ask.replace(/^an?\s+/i, 'a ')}; résumés rarely say. Say so if you are eligible.` };
  if (!best) return { status: 'unmet', grade: 'not_shown', caps: false, factor: 0.5, sentence: `They require ${ask}; your résumé does not list a clearance.` };
  const item = resumeItem(line, (x) => !!clearanceLevel(x)) || best.name;
  if (lapsedLine(line, ctx.now)) return { status: 'unmet', grade: 'not_shown', caps: false, factor: 0.55, line, sentence: `They require ${ask}; your résumé lists "${item}", which is not current.` };
  if (best.n < Number(c.value)) return { status: 'unmet', grade: 'not_shown', caps: false, factor: 0.55, line, sentence: `They require ${ask}; your résumé lists ${item}, a lower level.` };
  if (/\binterim\b/i.test(line)) return { status: 'unmet', grade: 'partly', caps: false, factor: 0.85, line, sentence: `They require ${ask}; your résumé lists an interim ${best.name} clearance (${item}).` };
  return { status: 'met', grade: 'met', caps: false, factor: 1, line, why: 'This line shows it.', sentence: `Your résumé lists ${item}${best.n > Number(c.value) ? ` — above the ${c.levelName} they ask for` : ''}.` };
}
// ── Work eligibility (G7) ───────────────────────────────────────────────────────────────────────────────────────
// Authorisation to work / citizenship is something a résumé does not state by nature: asked, never failed — unless the
// résumé itself says it needs sponsorship (or names another country's permit only) where the posting says none is offered.
const ELIG_ASK_RE = /\b(?:authori[sz]ed\s+to\s+work|work\s+authori[sz]ation|eligib\w*\s+to\s+work|right\s+to\s+work|(?:U\.?S\.?|United\s+States)\s+citizen(?:ship)?|without\s+(?:visa\s+)?sponsorship|sponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided)|(?:will|can)\s+not\s+sponsor|unable\s+to\s+sponsor)\b/i;
function eligibilityFact(sentence) {
  if (!ELIG_ASK_RE.test(sentence) || /\bclearance\b/i.test(sentence)) return null;
  const citizen = /\bcitizen(?:ship)?\b/i.test(sentence);
  const noSponsor = /\bsponsor/i.test(sentence) && /\b(?:without|not|no|unable|cannot|can\s+not|will\s+not)\b/i.test(sentence);
  return { factType: 'constraint', kind: 'eligibility', label: citizen ? 'U.S. citizenship' : 'authorization to work in the U.S.', value: citizen ? 'citizen' : 'authorized', noSponsor, gate: true, importance: 'required', evidence: sentence, statementId: null, synthetic: true };
}
function gradeEligibility(c, ctx) {
  const t = String(ctx.text || '');
  const needsSponsor = /\b(?:require[sd]?|need[sd]?|will\s+need)\s+(?:visa\s+|H-?1B\s+)?sponsorship\b|\bF-?1\s+(?:OPT|visa|student)\b|\bH-?1B\b(?!\s+(?:not\s+required|transfer\s+not))/i.test(t);
  const expired = /\b(?:work\s+permit|EAD|visa|work\s+authori[sz]ation)\b[^.\n]{0,30}\b(?:expired|expires?\s+(?:in\s+)?(?:19|20)\d\d)\b/i.test(t) && lapsedLine((t.match(/[^\n]*\b(?:work\s+permit|EAD|visa|work\s+authori[sz]ation)\b[^\n]*/i) || [''])[0], ctx.now);
  const citizenLine = (t.match(/[^\n]*\b(?:U\.?S\.?|United\s+States|American)\s+citizen(?:ship)?\b[^\n]*/i) || [])[0];
  const authLine = citizenLine || (t.match(/[^\n]*\b(?:authori[sz]ed\s+to\s+work\s+in\s+the\s+(?:U\.?S\.?|United\s+States)|green\s+card|permanent\s+resident|no\s+sponsorship\s+(?:required|needed))\b[^\n]*/i) || [])[0];
  const otherCountry = !authLine && /\b(?:authori[sz]ed\s+to\s+work|work\s+permit|permanent\s+resident|citizen)\b[^.\n]{0,24}\b(?:in\s+)?(?:Canada|Mexico|the\s+UK|United\s+Kingdom|India|EU|Germany|Australia)\b/i.test(t);
  if (expired) return { status: 'unmet', grade: 'not_shown', caps: false, factor: 0.5, sentence: `They require ${c.label}; your résumé says your work authorization has expired.` };
  if (needsSponsor && (c.noSponsor || c.value === 'citizen')) return { status: 'unmet', grade: 'not_shown', caps: false, factor: 0.5, sentence: `They require ${c.label}${c.noSponsor ? ' without sponsorship' : ''}; your résumé says you need visa sponsorship.` };
  if (c.value === 'citizen' && authLine && !citizenLine) return { status: 'ask', grade: 'cannot_tell', caps: false, factor: 0.95, sentence: `They require U.S. citizenship; your résumé says "${authLine.trim()}", which is not citizenship. Say which applies.` };
  if (authLine) return { status: 'met', grade: 'met', caps: false, factor: 1, line: authLine.trim(), why: 'This line shows it.', sentence: `Your résumé lists "${authLine.trim().replace(/^[•\-*\s]+/, '')}".` };
  if (otherCountry) return { status: 'unmet', grade: 'not_shown', caps: false, factor: 0.6, sentence: `They require ${c.label}; your résumé names work authorization for another country only.` };
  return { status: 'ask', grade: 'cannot_tell', caps: false, factor: 1, byNature: true, sentence: `They require ${c.label}; résumés rarely say. Be ready to confirm it.` };
}
/** Recency: the latest role that does the work must have ended within the window (G7). */
function gradeRecency(c, ctx) {
  const { profile, jobField, now } = ctx;
  const nowY = now.getFullYear() + now.getMonth() / 12;
  const items = subjectItems(c.subject || '');
  const test = items.length ? subjectTest(items) : null;
  const occ = c.subject && hasOccupationData() ? occupationOf(c.subject) : null;
  const sameOcc = (r) => !!occ && occ.confidence !== 'guess' && (occupationOf(r.title) || {}).code === occ.code;
  const doesIt = (r) => !!r.title && ((test && (test(r.title) || (r.bullets || []).some(test))) || (!!jobField && r.field === jobField) || sameOcc(r));
  const roles = (profile.roles || []).filter(doesIt);
  const what = c.subject || (jobField ? fieldLabel(jobField) : 'this work');
  const win = Number(c.value) || 2;
  const winText = win < 1 ? `${Math.round(win * 12)} months` : `${win === 1 ? 'year' : `${win} years`}`;
  if (!roles.length) return { status: 'ask', grade: 'cannot_tell', caps: false, factor: 0.9, sentence: `They ask for recent ${what} experience (within the past ${winText}); no job on your résumé names that work.` };
  const endOf = (r) => (r.to == null ? nowY : Math.floor(r.to / 12) + (r.to % 12) / 12);
  const latest = roles.reduce((a, r) => (endOf(r) > endOf(a) ? r : a), roles[0]);
  const gap = nowY - endOf(latest);
  if (gap <= win + 0.1) return { status: 'met', grade: 'met', caps: false, factor: 1, sentence: `Your ${what} work is recent (${roleList([latest])}); they ask for it within the past ${winText}.` };
  return { status: 'unmet', grade: 'not_shown', caps: false, factor: 0.6, sentence: `Your most recent ${what} work ended about ${Math.round(gap)} years ago (${roleList([latest])}); they ask for it within the past ${winText}.` };
}
// Licence families, lowest rung first: holding a lower rung is not the licence asked for; a higher one meets it (G7)
const LICENCE_LADDERS = [
  [/\b(?:LSW|LMSW|LBSW)\b|\blicensed\s+(?:master|bachelor)\s+social\s+worker\b/i, /\b(?:LCSW|LISW|LICSW|LCSW-C|LISW-S)\b|\bindependent\s+clinical\b|\bclinical\s+social\s+work\s+licen/i],
  [/\b(?:RDA|CDA)\b|\b(?:registered|certified)\s+dental\s+assistant\b/i, /\b(?:RDH)\b|\bdental\s+hygien/i],
  [/\b(?:CNA|STNA)\b|\bcertified\s+nursing\s+assistant\b/i, /\b(?:LPN|LVN)\b|\blicensed\s+(?:practical|vocational)\s+nurse\b/i, /\bRN\b|\bregistered\s+nurse\b/i, /\b(?:NP|APRN|CRNP|FNP|ACNP)\b|\bnurse\s+practitioner\b/i],
  [/\b(?:PTA)\b|\bphysical\s+therapist\s+assistant\b/i, /\b(?:PT|DPT)\b|\bphysical\s+therapist\b(?!\s+assistant)/i],
  [/\b(?:COTA)\b|\boccupational\s+therapy\s+assistant\b/i, /\b(?:OTR|OT)\b|\boccupational\s+therapist\b/i],
  [/\bapprentice\s+electrician\b|\belectrical\s+apprentice\b/i, /\bjourneyman\b|\bjourney[\s-]level\b/i, /\bmaster\s+electrician\b/i],
  [/\bA\s*&\s*P\b|\bairframe\s+(?:and|&)\s+powerplant\b/i, /\binspection\s+authorization\b|\bIA\b/],
];
function licenceRung(asked, resumeText) {
  for (const ladder of LICENCE_LADDERS) {
    const want = ladder.findIndex((re) => re.test(asked));
    if (want < 0) continue;
    // the rung asked for is the HIGHEST rung the ask names (an ask that names a lower rung as an option accepts it)
    let hi = want; ladder.forEach((re, i) => { if (re.test(asked)) hi = Math.min(hi, i); });
    const lines = String(resumeText || '').split(/\n/);
    let best = -1, held = '';
    for (const l of lines) ladder.forEach((re, i) => { const m = l.match(re); if (m && i > best && /licen|certif|\b[A-Z]{2,5}\b|registered|journeyman|master|#/i.test(l)) { best = i; held = m[0]; } });
    if (best < 0) return null;
    return best >= hi ? { atLeast: true, held } : { lower: true, held };
  }
  return null;
}
const LAPSED_RE = /\b(?:expired|lapsed|inactive|not\s+current|no\s+longer\s+(?:active|current|valid)|retired\s+status|revoked|suspended)\b/i;
function lapsedLine(line, now) {
  const l = String(line || '');
  if (LAPSED_RE.test(l) && !/\b(?:re-?activated|renewed|reinstated)\b/i.test(l)) return true;
  const m = l.match(/\b(?:exp(?:ires?|ired|iration|\.)?|valid\s+(?:through|until|thru))\s*:?\s*(?:(\d{1,2})\s*\/\s*)?((?:19|20)\d\d)\b/i);
  if (!m) return false;
  const y = Number(m[2]) + (m[1] ? (Number(m[1]) - 1) / 12 : 11 / 12);
  return y < now.getFullYear() + now.getMonth() / 12;
}
function licenseStates(resumeText, value) {
  const kindWord = /journeyman|master|electric/i.test(value) ? /journeyman|master|electrician|electrical/i : /\brn\b|nurs/i.test(value) ? /\bRN\b|nurs|licen/i : /licen/i;
  const states = new Set();
  for (const line of String(resumeText || '').split(/\n/)) {
    if (!kindWord.test(line) || !/licen|journeyman|master|\bRN\b|certif/i.test(line)) continue;
    for (const st of US_STATES) if (new RegExp(`\\b${st}\\b`).test(line)) states.add(st);
    if (/\b(?:District\s+of\s+Columbia|D\.C\.)/.test(line) || (/(?<![A-Za-z])DC(?![A-Za-z])/.test(line) && /licen|\bRN\b|#/i.test(line))) states.add('District of Columbia');
    for (const [ab, st] of Object.entries(STATE_ABBR)) if (new RegExp(`(?<![A-Za-z])${ab}(?![A-Za-z])`).test(line) && /licen|journeyman|\bRN\b|#/i.test(line)) states.add(st);
  }
  return [...states];
}
// college attended (a degree, coursework, an enrolment) implies the high-school diploma a posting asks for
// (a job title "Warehouse Associate" / "Sales Associate" is not a degree: only "Associate's" or "Associate degree / of …")
const COLLEGE_RE = /\b(?:college|university|community\s+college|coursework|credits?\s+toward|associate(?:'s|’s|\s+degree|\s+of\s+(?:arts|science|applied))|bachelor'?s?|a\.a\.s?\.?|b\.s\.|b\.a\.)(?![a-z])/i;

// ── The degree the résumé actually lists (G2) ─────────────────────────────────────────────────────────────────
// Every education sentence names the person's OWN degree, as the résumé writes it ("your B.S. in Accountancy"), never a
// rank label ("Your Bachelor's degree meets…" was printed for an Associate Degree in Nursing; "your high school diploma"
// for a résumé that lists only college coursework).
const DOTTED_VOWEL_SOUND = /^[AEFHILMNORSX]\./;
function anA(phrase) { const p = String(phrase || ''); return DOTTED_VOWEL_SOUND.test(p) || /^[AEFHILMNORSX][A-Z0-9]/.test(p) ? 'an' : /^[aeiou]/i.test(p) ? 'an' : 'a'; }
function degreeFieldOn(line, label) {
  const l = String(line || '');
  const i = l.toLowerCase().indexOf(String(label || '').toLowerCase());
  if (i < 0) return '';
  const rest = l.slice(i + String(label).length).replace(/^[\s,:]*(?:degree\s+)?(?:(?:in|of)\s+)?/i, '');
  const f = (rest.split(/\s+[—–|-]\s+|,|\(|\bfrom\b|\b(?:19|20)\d\d\b|\s{2,}/)[0] || '').trim().replace(/[.;:]+$/, '');
  return /^[A-Za-z][A-Za-z &/'-]{1,48}$/.test(f) && !/^[A-Z]{2,4}$/.test(f) && !/\b(?:university|college|school|institute|academy)\b/i.test(f) ? f : '';
}
// A degree abbreviation names its subject ("BSN" is nursing, "MSW" social work) — G5: a BSN was read as "a degree
// without its subject" and passed a social-work degree ask
const ABBR_SUBJECTS = [[/^b\.?\s?s\.?\s?n\.?$|^m\.?\s?s\.?\s?n\.?$|^adn$/i, 'Nursing'], [/^(?:bsw|msw)$/i, 'Social Work'], [/^(?:bba|m\.?b\.?a\.?)$/i, 'Business'], [/^bsee$/i, 'Electrical Engineering'], [/^bsme$/i, 'Mechanical Engineering'], [/^bsce$/i, 'Civil Engineering'], [/^bscs$/i, 'Computer Science'], [/^(?:bfa|mfa)$/i, 'Fine Arts'], [/^mph$/i, 'Public Health'], [/^mpa$/i, 'Public Administration'], [/^(?:b\.?\s?ed\.?|m\.?\s?ed\.?)$/i, 'Education']];
function abbrSubject(label) { const hit = ABBR_SUBJECTS.find(([re]) => re.test(String(label || '').trim())); return hit ? hit[1] : ''; }
export function resumeEducation(text, facts, rank) {
  const eds = (facts || []).filter((f) => f.factType === 'education' && f.rank).sort((a, b) => b.rank - a.rank);
  // the education line that names its subject wins over a credential suffix in the header ("Samantha Reyes, BSN, RN")
  const withField = eds.filter((f) => degreeFieldOn(f.evidenceText, f.label));
  const top = withField.find((f) => f.rank === rank) || eds.find((f) => f.rank === rank) || withField[0] || eds[0] || null;
  if (top && top.rank >= 2) {
    const label = /^associate\s+degree$/i.test(top.label) ? 'Associate degree' : top.label.replace(/^bachelor'?s?$/i, "Bachelor's degree").replace(/^master'?s?$/i, "Master's degree");
    const written = degreeFieldOn(top.evidenceText, top.label);
    const field = written || abbrSubject(top.label);
    // an abbreviation already says its subject ("a BSN", never "a BSN in Nursing")
    const phrase = `${label}${written && !/\bin\s/i.test(label) ? ` in ${written}` : ''}`;
    return { rank: top.rank, label, field, phrase: `${anA(phrase)} ${phrase}`, own: phrase, line: top.evidenceText || '' };
  }
  if (rank >= 1 && COLLEGE_RE.test(String(text || '')) && !(top && top.rank >= 2)) {
    const line = String(text || '').split(/\n/).find((l) => COLLEGE_RE.test(l)) || '';
    // a certificate or program from a college is named as the résumé names it ("HVAC Technology Certificate")
    const cred = (line.trim().split(/\s+[—–|-]\s+|,\s+/).find((x) => /\b(?:certificate|diploma|program|training)\b/i.test(x)) || '').trim();
    const own = cred && cred.length <= 60 ? cred : 'college coursework';
    return { rank: 1, label: own, field: '', phrase: cred ? `${anA(cred)} ${cred} but no degree` : 'college coursework but no degree', own, line: line.trim(), college: true };
  }
  if (top && top.rank === 1) return { rank: 1, label: 'high school diploma', field: '', phrase: 'a high school diploma', own: 'high school diploma', line: top.evidenceText || '' };
  return { rank: 0, label: '', field: '', phrase: 'no degree', own: '', line: '' };
}
// The subjects a posting names for its degree ("Bachelor's degree in Information Systems, Computer Science or Life
// Sciences", "(business, marketing, experience design or related field)").
export function postingDegreeFields(quote) {
  const q = String(quote || '');
  const m = q.match(/\b(?:degree|bachelor'?s?|master'?s?|associate'?s?|B\.?S\.?|B\.?A\.?|diploma)\b[^.;\n(]{0,24}?\b(?:in|of)\s+([^.;\n]{3,160})/i)
    || q.match(/\b(?:degree|bachelor'?s?|master'?s?|associate'?s?)\b[^.;\n(]{0,12}\(([^)]{3,160})\)/i);
  if (!m) return { fields: [], related: false };
  let list = m[1].replace(/\b(?:required|preferred|is\s+a\s+plus|strongly\s+preferred)\b.*$/i, '').replace(/\s+(?:with|and\s+\d|plus|from|at|or\s+(?:equivalent|\d|higher)).*$/i, '');
  const related = /\b(?:related|similar|relevant|comparable|equivalent)\s+(?:field|discipline|area|major|subject|technical\s+field|degree)s?\b|\bor\s+related\b/i.test(m[1]);
  list = list.replace(/,?\s*(?:or|and)?\s*(?:an?\s+)?(?:other\s+)?(?:closely\s+)?(?:related|similar|relevant|comparable|equivalent)\s+(?:\w+\s+)?(?:field|discipline|area|major|subject)s?\b.*$/i, '').replace(/\s+or\s+related\b.*$/i, '');
  list = list.replace(/\b(?:program|programs|degree|from\s+an?\s+accredited.*)$/i, '');
  const fields = list.split(/,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+|\s*\/\s*/).map((x) => x.trim().replace(/^(?:an?|the)\s+/i, '').replace(/[.)]+$/, '')).filter((x) => x && x.length <= 40 && /^[A-Za-z]/.test(x) && !/\b(?:experience|years?|field|degree|equivalent|bachelor|associate|master|science\s+in|arts\s+in|program)\b/i.test(x));
  return { fields: fields.slice(0, 6), related };
}
// Subject families: a degree in a clearly related subject meets a named-subject ask (G5). No generic "science" or
// "studies" entry — "Health Sciences" is not "Computer Science".
const DEGREE_FAMILIES = [
  /\b(?:engineering|computer\s+science|software|computer\s+engineering|information\s+(?:systems|technology|science)|data\s+science|mathematics|math|applied\s+math\w*|statistics|physics|computing|informatics|electrical|mechanical|aerospace|industrial|chemical\s+engineering|technical)\b|\b(?:IT|IS|CS|EE|ME)\b/,
  /\b(?:nursing|health\s+sciences?|public\s+health|kinesiology|exercise\s+science|nutrition|dietetics|respiratory|radiolog\w*|medical\s+technology|health\s+administration|healthcare)\b/i,
  /\b(?:biology|biological|chemistry|biochem\w*|life\s+sciences?|microbiology|neuroscience|physiology|pharmac\w*|molecular|genetics)\b/i,
  /\b(?:business|finance|financial|accounting|accountancy|economics|commerce|management|administration|supply\s+chain|operations|marketing|hospitality\s+management)\b/i,
  /\b(?:marketing|communications?|journalism|advertising|public\s+relations|media|english)\b/i,
  /\b(?:design|graphic|fine\s+arts?|art|human[- ]computer|experience\s+design|architecture|interior)\b/i,
  /\b(?:education|teaching|early\s+childhood|child\s+development|elementary|special\s+education|curriculum)\b/i,
  /\b(?:social\s+work|psychology|counsel\w*|sociology|human\s+services|criminal\s+justice|behavio\w+\s+science|marriage\s+and\s+family|family\s+therapy)\b/i,
  /\b(?:human\s+resources|organizational|industrial\s+relations|labor\s+relations|business)\b/i,
];
const sameWords = (a, b) => { const st = (x) => new Set(tokenize(String(x)).map((t) => t.stem).filter((y) => y.length > 1 && !/^(?:and|of|the|in|scienc|studi|art)$/.test(y))); const A = st(a), B = st(b); return [...A].some((x) => B.has(x) || (x.length >= 6 && [...B].some((y) => y.length >= 6 && y.slice(0, 6) === x.slice(0, 6)))); };
export function degreeFieldFits(resumeField, posting) {
  const want = posting.fields || [];
  if (!want.length) return 'none';
  if (!resumeField) return 'unknown';
  if (want.some((w) => sameWords(w, resumeField))) return 'same';
  if (want.some((w) => DEGREE_FAMILIES.some((g) => g.test(w) && g.test(resumeField)))) return 'neighbour';
  return 'other';
}
const isEduYears = (a) => !!a && !a.degree && /\b(?:college|university|coursework|credits?|undergraduate|post-?secondary|higher\s+education)\b/i.test(`${a.field || ''} ${a.from || ''}`);

export const GATE_CAP = 35;
// A years ask met by roles doing exactly the asked work but short of the figure: from this share of it (and at least one
// year) a recruiter calls it close — "about 4 years closing Enterprise deals; they ask for 5+" is PARTLY. Below it the gap is
// real (not shown). Roles of another kind of work never lend years at all (G5, director 2026-11-10).
export const NEAR_YEARS_SHARE = 0.7;
export const TENURE_RE = /\b(?:after|upon\s+completion\s+of|following|once\s+you(?:'ve|\s+have)?\s+complete[d]?|eligible\s+after)\s+(?:\(?\d+\)?|one|two|three|four|five|six|ninety|thirty|sixty)\s+(?:full\s+)?(?:years?|months?|days?)\b(?:\s+of\s+(?:continuous\s+)?(?:service|employment|tenure))?|\b(?:years?|months?|days?)\s+of\s+(?:continuous\s+)?(?:service|employment|tenure)\b|\b(?:401\s*\(?k\)?|pto|sabbatical|vest(?:ing|ed)|parental\s+leave|tuition\s+reimbursement|raise|bonus)\b[^.;]{0,60}\bafter\b/i;
// "CPA candidacy desirable but not required", "CPA preferred", "CDL is a plus", "SAP TM certification is highly desirable"
export const CREDENTIAL_OPTIONAL_RE = /\bnot\s+(?:required|necessary|mandatory)\b|\b(?:desirable|desired|preferred|a\s+plus|nice[\s-]to[\s-]have|bonus|an\s+advantage|advantageous|helpful|beneficial)\b/i;
// "CPA eligible", "CPA candidacy", "CPA or working toward it", "active progress toward it", "within 12 months of hire",
// "active or pending", "or have submitted application for licensure"
export const CREDENTIAL_PROSPECTIVE_RE = /\b(?:candidacy|candidates?\s+for|eligib(?:le|ility)(?!\s+requirements?)|working\s+towards?|(?:active\s+)?progress\s+towards?|pursuing|pending|submitted\s+(?:an\s+)?application|within\s+(?:\d+|one|two|three|six|nine|twelve|eighteen|thirty|sixty|ninety)\s+(?:days?|weeks?|months?|years?)\s+of\s+(?:hire|hiring|employment|start(?:ing)?|joining))\b/i;
export const OBTAIN_LATER_RE = /\b(?:obtain|obtained|acquire|acquired|earn|earned|complete|completed)\b[^.;\n]{0,60}\bwithin\s+(?:\d+|thirty|sixty|ninety|one|two|three|six)\s+(?:days?|weeks?|months?)\b|\bwilling(?:ness)?\s+to\s+(?:obtain|get|earn)\b|\bability\s+to\s+obtain\b|\b(?:able|eligible)\s+to\s+obtain\b|\bobtain\s+(?:upon|after)\s+hire\b/i;
export const GATE_KINDS = new Set(['degree', 'years', 'management', 'seniority', 'certification']);

const AVAILABILITY_RE = /\b(?:availab(?:le|ility)|open\s+availability|weekends?|nights?|evenings?|overnight|holidays?|any\s+shift|flexible\s+schedule)\b/i;
const FULL_TIME_RE = /\bfull[\s-]*time\b/i;

// "a food handler card", "an RN license", "an OSHA 10" — an acronym is read letter by letter.
function article(label) {
  const l = String(label || '');
  if (/^(?:an?|the)\s/i.test(l)) return '';
  if (/^[AEFHILMNORSX][A-Z0-9]/.test(l)) return 'an ';
  return /^[aeiou]/i.test(l) ? 'an ' : 'a ';
}
// Does the résumé hold a license/certification? By the posting's own words, a synonym, or the
// credential's acronym/number ("RN" for "RN license" — "Rebecca Thornton, BSN, RN"; "EPA" + "608" for
// "EPA 608 Universal" — "EPA Section 608 Universal"). An acronym next to "exam", "candidate" or
// "pursuing" is a credential in progress, not held ("sitting for the CPA exam").
const CERT_SYNONYMS = [
  [/\brn\b|registered\s+nurse/i, [/\bRN\b/, /\bregistered\s+nurse\b/i]],
  // ServSafe Manager (a food protection manager certificate) is a higher credential: a Food Handler card
  // does not meet it, while a manager certificate does meet a food-handler ask.
  [/servsafe\s+manager|food\s+(?:protection|safety)\s+manager|\bcfpm\b/i, [/\bservsafe\s+manager/i, /\bfood\s+(?:protection|safety)\s+manager/i, /\bCFPM\b/]],
  [/food\s+handler|servsafe(?!\s+manager)/i, [/\bfood\s+handler/i, /\bservsafe\b/i, /\bfood\s+(?:safety\s+)?manager\s+certif/i]],
  // a credential asked as a CLASS is held through its instance (G5, A1): "food safety certification" ← ServSafe
  [/food\s+safety\s+(?:certif\w*|card|permit|training)|food\s+safety\s+manager/i, [/\bservsafe\b/i, /\bfood\s+handler/i, /\bfood\s+(?:protection|safety)\s+manager/i, /\bHACCP\b/, /\bCFPM\b/]],
  [/forklift|powered\s+industrial\s+truck/i, [/forklift[^.\n]{0,40}certif/i, /certified[^.\n]{0,20}forklift/i, /forklift[^.\n]{0,15}licen[sc]e/i, /^\s*certifications?\s*:?[^\n]*\bforklift\b/im, /\bpowered\s+industrial\s+truck/i]],
  [/forklift/i, [/forklift[^.\n]{0,40}certif/i, /certified[^.\n]{0,20}forklift/i, /forklift[^.\n]{0,15}licen[sc]e/i]],
  [/teaching\s+licen|teacher\s+certif/i, [/teaching\s+licen[sc]/i, /teacher\s+(?:licen[sc]|certif)/i, /licensed\s+teacher/i, /initial\s+professional\s+licen[sc]e/i]],
  // an RN license is a higher license than an LPN / LVN one: it meets an "LPN/LVN license" ask
  [/\b(?:LPN|LVN|licensed\s+(?:practical|vocational)\s+nurse)\b/i, [/\bLPN\b/, /\bLVN\b/, /\bRN\b/, /\bregistered\s+nurse\b/i, /\blicensed\s+(?:practical|vocational)\s+nurse\b/i]],
  [/\bnurs\w*\s+licen/i, [/\bRN\b/, /\bLPN\b/, /\bLVN\b/, /\bregistered\s+nurse\b/i, /\blicensed\s+(?:practical|vocational)\s+nurse\b/i]],
  [/\bcpr\b/i, [/\bCPR\b/, /\bBLS\b/, /\bbasic\s+life\s+support\b/i, /\bACLS\b/, /\bPALS\b/]],
  [/driver'?s?\s+licen/i, [/driver'?s?\s+licen[sc]e/i, /\bcdl\b/i]],
];
const IN_PROGRESS_RE = /^[^.\n]{0,30}\b(?:exam|candidate|eligible|in\s+progress|pursuing|sitting|track|coursework)\b/i;
// A credential mentioned as in progress ("the CPA exam", "CPA candidate") is not held: it is blanked
// out before ANY held-credential check reads the text.
export const withoutInProgress = (resumeText) => String(resumeText || '').replace(/\b([A-Z]{2,6})\b(?=[^.\n]{0,30}\b(?:exam|candidate|eligible|in\s+progress|pursuing|sitting|track|coursework)\b)/g, (x) => ' '.repeat(x.length));
export function certHeld(resumeText, value, label) {
  const text = withoutInProgress(resumeText);
  if (hasStemmed(text, value)) return true;
  for (const [want, ways] of CERT_SYNONYMS) if (want.test(`${value} ${label}`) && ways.some((re) => re.test(text))) return true;
  const marks = String(label || value).match(/\b(?:[A-Z]{2,6}|\d{2,4})\b/g) || [];
  if (!marks.length) return false;
  return marks.every((mk) => {
    // The mark is letters/digits by construction, but it came from the posting: escape it before it is a pattern.
    const esc = escapeRegExp(mk);
    let m; const g = new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'g');
    while ((m = g.exec(text)) !== null) if (!IN_PROGRESS_RE.test(text.slice(m.index + mk.length))) return true;
    return false;
  });
}
/** Every résumé mention of the credential's words is a junior role ("Physical Therapist Assistant", "Pharmacy Technician
 *  … Pharmacist"?): the words followed by Assistant / Aide / Technician / Tech, or the junior acronym (PTA, COTA, LPTA). */
function juniorOnly(resumeText, value) {
  const core = String(value || '').replace(/\b(?:license|licence|certification|certificate|active|current|valid|state|registered|\(?[A-Z]{2,5}\)?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (core.split(/\s+/).length < 2) return false;
  const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(core)}(?![A-Za-z])(\\s+(?:assistant|aide|technician|tech)\\b)?`, 'gi');
  let m, junior = '', senior = false;
  while ((m = re.exec(String(resumeText || ''))) !== null) { if (!m[1]) senior = true; else junior = junior || m[0]; }
  return junior && !senior ? junior.replace(/\s+/g, ' ').trim() : '';
}
/** A degree the résumé says is still being earned ("B.S. Data Analytics — Ohio State, expected May 2027"), or null. */
function inProgressDegree(resumeText) {
  for (const raw of String(resumeText || '').split(/\n/)) {
    const line = raw.trim();
    if (!/\b(?:expected|anticipated|in\s+progress|candidate|pursuing|currently\s+enrolled|class\s+of)\b/i.test(line)) continue;
    const m = line.match(/\b(B\.?\s?S\.?N?\.?|B\.?\s?A\.?|B\.?B\.?A\.?|Bachelor(?:'s)?(?:\s+of\s+\w+)?|A\.?A\.?S?\.?|Associate(?:'s)?(?:\s+degree)?|M\.?\s?S\.?|M\.?\s?A\.?|MBA|Master(?:'s)?(?:\s+of\s+\w+)?)(?=[\s,]|$)/);
    if (!m) continue;
    const rank = /^(?:M|Master)/i.test(m[1]) ? 4 : /^(?:A\.?A|Associate)/i.test(m[1]) ? 2 : 3;
    const field = (line.slice(m.index + m[1].length).replace(/^[\s,:]*(?:degree\s+)?(?:in|of)?\s*/i, '').split(/\s+[—–|-]\s+|,|\(|\bexpected\b|\b(?:19|20)\d\d\b/i)[0] || '').trim();
    const when = (line.match(/\b(?:expected|anticipated|class\s+of)\s*:?\s*((?:[A-Z][a-z]+\.?\s+)?(?:19|20)\d\d)/i) || [])[1] || null;
    const label = m[1].replace(/\s+/g, '');
    return { rank, line, when, phrase: `${anA(label)} ${label}${field && /^[A-Za-z][A-Za-z &/-]{1,40}$/.test(field) ? ` in ${field}` : ''}` };
  }
  return null;
}
/** The education line that shows a degree of `rank`: that level exactly, else the lowest higher one ("a bachelor's degree
 *  implies it"), else null. */
function degreeCite(resumeText, facts, rank) {
  const eds = (facts || []).filter((f) => f.factType === 'education' && f.rank && f.evidenceText);
  const exact = eds.find((f) => f.rank === rank);
  if (exact) return { line: exact.evidenceText.trim(), why: 'This line shows it.' };
  const higher = eds.filter((f) => f.rank > rank).sort((a, b) => a.rank - b.rank)[0];
  if (higher) return { line: higher.evidenceText.trim(), why: `${String(DEGREE_LABEL[higher.rank] || 'a degree').replace(/^\w/, (x) => x.toUpperCase())} implies it.` };
  if (rank <= 1) { const col = String(resumeText || '').split(/\n/).find((l) => COLLEGE_RE.test(l)); if (col) return { line: col.trim(), why: 'College coursework implies it.' }; }
  return null;
}
/** The résumé line that shows a held credential: its own words, its acronym, or a synonym the posting accepts. */
function certLine(resumeText, value, label) {
  let lines = String(resumeText || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
  const marks = String(label || value).match(/\b(?:[A-Z]{2,6}|\d{2,4})\b/g) || [];
  const syn = CERT_SYNONYMS.filter(([want]) => want.test(`${value} ${label}`)).flatMap(([, ways]) => ways);
  // a header never shows a certification: a role header (it has dates) or the name / contact lines at the top (G5)
  const head = new Set(lines.slice(0, 3).filter((l) => !/licen|certif|\bcerts?\b/i.test(l)));
  lines = lines.filter((l) => !head.has(l) && !(/(?:19|20)\d\d\s*(?:-|–|—|to)\s*(?:(?:19|20)\d\d|present|now|current)/i.test(l) && /\s[—–|-]\s/.test(l) && !/licen|certif/i.test(l)));
  return lines.find((l) => hasStemmed(l, String(value || '')) && !notYetHeld(l, String(value || '')))
    || lines.find((l) => hasStemmed(licenceForm(l), licenceForm(String(value || ''))) && !notYetHeld(l, String(value || '')))
    || lines.find((l) => marks.length && marks.every((mk) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(mk)}(?![A-Za-z0-9])`).test(l)))
    || lines.find((l) => syn.some((re) => re.test(l))) || null;
}
// The license a degree sentence also requires, judged on the résumé's license lines.
const LICENSE_FOR = [
  [/social\s+work/i, 'social work license', /\b(?:LCSW|LMSW|LISW|LSW|LICSW|licensed\s+(?:clinical\s+)?social\s+worker)\b/i],
  [/counsel/i, 'counseling license', /\b(?:LPC|LPCC|LMHC|licensed\s+(?:professional\s+)?counselor)\b/i],
  [/marriage|family\s+therapy/i, 'marriage and family therapy license', /\b(?:LMFT|licensed\s+marriage)\b/i],
  [/nursing/i, 'nursing license', /\b(?:RN|LPN|LVN|registered\s+nurse|nursing\s+licen[sc]e)\b/],
  [/psycholog/i, 'psychology license', /\blicensed\s+psychologist\b|\bpsychologist\s+licen[sc]e\b/i],
  [/pharmac/i, 'pharmacist license', /\b(?:RPh|PharmD|licensed\s+pharmacist|pharmacist\s+licen[sc]e)\b/i],
];
function impliedLicense(c, jobFacts, resumeText) {
  const q = String(c.evidence || '');
  if (!/\blicen[sc](?:ed|e|ure)\b/i.test(q)) return null;
  if ((jobFacts || []).some((f) => f.factType === 'constraint' && f.kind === 'certification' && ((c.statementId && f.statementId === c.statementId) || f.evidence === c.evidence))) return null;
  const spec = LICENSE_FOR.find(([re]) => re.test(q));
  if (!spec) return null;
  const held = spec[2].test(withoutInProgress(resumeText));
  const sentence = held ? `Your résumé lists a ${spec[1]}.` : `This sentence also requires a ${spec[1]}; your résumé does not list one.`;
  return { kind: 'certification', label: spec[1], value: spec[1], implied: true, status: held ? 'met' : 'unmet', message: sentence, sentence, grade: held ? 'met' : 'not_shown', caps: false, factor: held ? 1 : 0.6, gate: false };
}
// The not-yet-held phrase when EVERY résumé line that names the credential qualifies it ("CPA Candidate"), else null.
// A firm name in a role header ("Henley & Moss CPAs") is never a mention.
export function credentialPending(resumeText, label, value) {
  const marks = [...new Set([...String(label || '').matchAll(/\b[A-Z]{2,6}\b/g), ...String(value || '').matchAll(/\b[A-Z]{2,6}\b/g)].map((m) => m[0]))];
  const words = String(value || label || '').trim();
  const tokens = [...marks, ...(words.length >= 4 && !marks.includes(words) ? [words] : [])].filter((t) => !/^(?:US|USA|OR|AND|THE)$/.test(t)).slice(0, 4);
  if (!tokens.length) return null;
  let phrase = null;
  for (const raw of String(resumeText || '').split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    for (const tok of tokens) {
      const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(tok)}(?![A-Za-z0-9])`, /^[A-Z0-9]+$/.test(tok) ? '' : 'i');
      const m = line.match(re);
      if (!m) continue;
      // a role header's employer part ("Staff Accountant — Henley & Moss CPA Group") names a firm, not the person
      const sep = line.search(/\s[—–|]\s/);
      if (sep > 0 && m.index > sep && /\b(?:19|20)\d\d\b|present/i.test(line)) continue;
      const nh = notYetHeld(line, tok);
      if (!nh) return null;
      phrase = phrase || nh;
    }
  }
  return phrase;
}
function resumeDegree(facts) {
  return facts.filter((f) => f.factType === 'education').reduce((m, f) => Math.max(m, f.rank || 0), 0);
}
function years(facts, key) {
  const f = facts.find((x) => x.factType === 'experience' && x.normalizedLabel === key);
  return f ? f.value : 0;
}
function fmtYears(y) {
  if (!y) return 'none';
  const r = Math.round(y * 10) / 10;
  return `${r} year${r === 1 ? '' : 's'}`;
}

/**
 * @param {object[]} jobFacts  extractJobFacts output (constraint + seniority facts are read)
 * @param {object[]} resumeFacts extractResumeFacts output
 * @param {string} resumeText
 * @returns {{ kind, label, status, gate, importance, message, evidence }[]}
 */
export function evaluateConstraints(jobFacts, resumeFacts, resumeText = '', { jobFamily = null, jobTitle = '', jobText = '', jobField: jobFieldKey = null, now = new Date() } = {}) {
  void jobFamily;
  const out = [];
  const text = String(resumeText || '');
  // a diploma gate is met by any college coursework or degree (judge optimize #4: "Requires a high school diploma" for
  // someone with college coursework → 35)
  const deg = Math.max(resumeDegree(resumeFacts), COLLEGE_RE.test(text) ? 1 : 0);
  const totalY = years(resumeFacts, 'experience:total');
  const mgmtY = years(resumeFacts, 'experience:management');
  const gpaFact = resumeFacts.find((f) => f.factType === 'gpa');
  const seniority = resumeFacts.filter((f) => f.factType === 'seniority').map((f) => f.label);
  const leadRank = seniority.some((l) => ['lead', 'director', 'executive'].includes(l));
  void leadRank;
  // ONE experience profile for every years / management gate: dated roles, each with its field and its people evidence
  const profile = experienceProfile(text, { now, fieldOf: roleField });
  const jobField = jobFieldKey || postingField(jobTitle || '', '');
  const ctx = { text, profile, jobField, jobTitle, totalY: profile.totalYears || totalY, now, degreeRank: deg, edu: resumeEducation(text, resumeFacts, deg), newGrad: isNewGradPosting(jobTitle, jobText) };

  const readFacts = jobFacts.filter((f) => f.factType === 'constraint');
  for (let c of [...readFacts, ...strictExtras(readFacts, jobText, jobTitle)]) {
    // posting_quote: the posting's own sentence a gate stands on — no hard gate is ever shown without one
    const base = { kind: c.kind, label: c.label, gate: !!c.gate, importance: c.importance, evidence: c.evidence || '', posting_quote: c.evidence || '', statementId: c.statementId || null, items: c.items || null, value: c.value ?? null };
    switch (c.kind) {
      case 'degree': {
        const alts = c.alternatives && c.alternatives.length ? c.alternatives : [{ degree: c.value, years: 0, management: false }];
        const edu = resumeEducation(text, resumeFacts, deg);
        const primary = Math.max(0, ...alts.map((a) => a.degree || 0));
        const needLabel = DEGREE_LABEL[primary] || 'a degree';
        // an alternative is met when the résumé holds the degree AND its years; "2 years of college" by an Associate degree
        const altMet = (a) => isEduYears(a) ? deg >= 2 : (!a.degree || deg >= a.degree) && (!a.years || (a.management ? mgmtY : totalY) + 0.25 >= a.years);
        const byDegree = alts.find((a) => a.degree && altMet(a));
        const byYears = !byDegree ? alts.find((a) => !a.degree && !isEduYears(a) && a.years && altMet(a)) : null;
        const byCollege = !byDegree && !byYears ? alts.find((a) => isEduYears(a) && altMet(a)) : null;
        // a degree still being earned meets an ask stated as "pursuing / graduating by …", or any degree ask in a posting written
        // for new graduates (G6): in progress IS the requirement there
        const pend = inProgressDegree(text);
        const acceptsPending = /\b(?:pursuing|graduat\w*\s+(?:by|in|between|no\s+later)|currently\s+enrolled|enrolled\s+in|expected\s+graduation|class\s+of\s+20\d\d|working\s+toward|in\s+progress)\b/i.test(String(c.evidence || '')) || ctx.newGrad;
        if (!alts.some((a) => a.degree && altMet(a)) && pend && acceptsPending && pend.rank >= Math.max(1, ...alts.map((a) => a.degree || 0))) {
          const sentence = `You're finishing ${pend.phrase}${pend.when ? ` (expected ${pend.when})` : ''}; they accept a degree in progress.`;
          out.push({ ...base, status: 'met', message: sentence, sentence, grade: 'met', caps: false, factor: 1, line: pend.line, why: 'In progress, which the posting accepts.' });
          break;
        }
        const metAlt = byDegree || byYears || byCollege;
        const degreeOk = alts.some((a) => !a.degree || deg >= a.degree);
        let status = metAlt ? 'met' : 'unmet';
        let message;
        let extra = {};
        if (status === 'met' && c.gpa) {
          status = gpaFact ? (gpaFact.value >= c.gpa ? 'met' : 'unmet') : 'ask';
          const g = Number(c.gpa).toFixed(1);
          message = gpaFact ? `GPA ${gpaFact.value} against a ${g} minimum.` : `The posting asks for a ${g}+ GPA — your résumé does not list one. Add it only if it is ${g} or higher.`;
        } else if (status === 'unmet') {
          message = degreeOk
            ? `Requires ${c.label}; your résumé shows ${(alts[0].management ? mgmtY : totalY) ? `${fmtYears(alts[0].management ? mgmtY : totalY)} of` : 'no'} ${alts[0].management ? 'supervisory ' : ''}experience.`
            : `Requires ${alts.some((a) => a.years) ? c.label : `${needLabel}${c.gpa ? ` (GPA ${Number(c.gpa).toFixed(1)}+)` : ''}`}; your résumé lists ${pend ? `${pend.phrase}${pend.when ? `, expected ${pend.when}` : ' (in progress)'}` : edu.phrase}${alts.some((a) => a.management) ? ` and ${mgmtY ? fmtYears(mgmtY) + ' of' : 'no'} supervisory experience` : ''}.`;
        } else if (byYears) {
          // met through the years they accept instead of the degree: say that, never "your diploma meets it"
          const y = byYears.management ? mgmtY : totalY;
          message = `They accept ${byYears.years} years of ${byYears.management ? 'supervisory ' : ''}experience in place of the degree; your résumé shows ${about(y)}.`;
          extra = { grade: 'met', caps: false, factor: 1, via: 'years' };
        } else if (byCollege) {
          message = `They accept ${byCollege.years} years of college in place of ${needLabel}; your ${edu.own} covers that.`;
          extra = { grade: 'met', caps: false, factor: 1, via: 'college' };
        } else {
          // met by the degree: the subject they name is checked too ("a degree in IS, CS or Life Sciences" is not met by a
          // B.S. in Accountancy)
          const pf = postingDegreeFields(c.evidence || '');
          // the degree of the level asked is the one named (a B.A. for "Bachelor's (any field)", not the M.S. above it),
          // unless only the higher one fits the subject
          const atLevel = resumeFacts.some((f) => f.factType === 'education' && f.rank === (byDegree.degree || primary)) ? resumeEducation(text, resumeFacts, byDegree.degree || primary) : edu;
          const pick = degreeFieldFits(atLevel.field, pf) !== 'other' || degreeFieldFits(edu.field, pf) === 'other' ? atLevel : edu;
          const fits = degreeFieldFits(pick.field, pf);
          const subjects = pf.related ? pf.fields.slice(0, 3).join(', ') : joinOr(pf.fields.slice(0, 3));
          if (fits === 'other') {
            // an unrelated subject is part of the way only when the posting accepts a related field or equivalent
            // experience AND the person works in the posting's field; otherwise the degree asked is not shown (G5)
            const pref = c.importance && c.importance !== 'required';
            const lenient = pf.related || /\bequivalent\b/i.test(String(c.evidence || ''));
            const inField = !!jobField && profile.roles.some((r) => r.field === jobField);
            const part = lenient && inField;
            message = part ? `You have ${edu.phrase}; they ask for ${subjects} or a related field.` : `They ask for a degree in ${subjects}${pf.related ? ' or a related field' : ''}; you list ${edu.phrase}.`;
            extra = { grade: part ? 'partly' : 'not_shown', caps: false, factor: pref ? 0.97 : part ? 0.85 : 0.75, fieldAsked: pf.fields, fieldHave: edu.field };
            status = pref ? 'ask' : 'unmet';
          } else if (fits === 'unknown') {
            message = `They ask for a degree in ${subjects}${pf.related ? ' or a related field' : ''}; your résumé lists ${edu.phrase} without its subject — add it.`;
            extra = { grade: 'partly', caps: false, factor: 0.95, fieldAsked: pf.fields };
            status = 'ask';
          } else {
            message = `Your ${pick.own || String(DEGREE_LABEL[deg] || 'education').replace(/^(?:an?|the)\s+/i, '')} meets the education requirement${fits === 'neighbour' ? ` (they ask for ${subjects} or a related field)` : ''}.`;
          }
          // a met degree carries the résumé line that shows it — the exact level asked first ("Bachelor's (any field)" cites
          // the bachelor's line, not the master's beside it), else the higher degree that implies it (G5, B)
          // a high-school ask is shown by the high-school line itself, named as written ("Dobson High School, 2018")
          if ((byDegree.degree || primary) <= 1) { const hsF = resumeFacts.find((f) => f.factType === 'education' && f.rank === 1 && f.evidenceText); if (hsF) { const ln = hsF.evidenceText.trim(); message = `Your résumé lists ${ln.replace(/,?\s+((?:19|20)\d\d)\s*$/, ', $1').replace(/^EDUCATION:?\s*/i, '')}.`; } }
          const cite = pick !== atLevel ? (pick.line ? { line: pick.line.trim(), why: 'This line shows it.' } : null) : degreeCite(text, resumeFacts, byDegree.degree || primary);
          if (cite) extra = { ...extra, line: cite.line, why: cite.why };
        }
        out.push({ ...base, status, message, ...(extra.grade ? { ...extra, sentence: message } : {}), ...(extra.line ? { line: extra.line, why: extra.why } : {}) });
        // a sentence that requires BOTH a license and the degree is two gates: the license is judged too, on the same
        // statement, when the reader did not read it as its own row (G5 — "licensed by the Board of Social Work Examiners,
        // has a Bachelor's degree in social work")
        const lic = impliedLicense(c, jobFacts, text);
        if (lic) out.push({ ...base, ...lic });
        break;
      }
      case 'years': {
        // a figure no job asks for is the company's history ("BAYADA is celebrating 50 years"), never a requirement
        if (!(Number(c.value) > 0) || Number(c.value) > 25) break;
        // G4: tenure with the employer ("401k match after one year of service", "sabbatical after 4 years of service",
        // "PTO after 90 days of employment") is a benefit, never a requirement
        if (TENURE_RE.test(String(c.sentence || c.evidence || '')) || TENURE_RE.test(String(c.label || ''))) break;
        // a posting for new graduates expects no years: "0–1 years, internships count" is never a years gate (G6)
        if (ctx.newGrad && Number(c.value) <= 1) break;
        // "Bachelor's degree or 8 years of equivalent experience": the years are an ALTERNATIVE to the degree, judged once
        // by the degree row — a separate years row failed people who hold the degree; "2 years of college" is schooling
        { const alts = c.alternatives || []; const substitute = alts.some((a) => a && a.degree > 0 && !a.years) && alts.some((a) => a && !a.degree && a.years); if (substitute || isEduYears(alts[0]) || /\b(?:college|university|coursework|credits?)\b/i.test(String(c.field || ''))) break; }
        // a "management" flag on a sentence whose object is a thing ("infrastructure management or backend software
        // development") is a years-in-field requirement, not people management
        const ph = domainPhrase(c);
        // "2+ years supervising warehouse teams": managing people IN an area — the area is checked too (G4)
        const ys = yearsSubject(c);
        const area = !!(ys && /^(?:supervis|manag|lead)/i.test(ys.lead) && ph && ph !== 'managing people' && phraseStems(ph).some((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)));
        if (area) c = { ...c, field: `${ys.lead} ${ph}` };
        // with an area, the years grader's leadership path judges both the managing and the area
        const people = !area && c.management && (!ph || ph === 'managing people' || peopleManagement(c.sentence || c.evidence || ph));
        // "skills typically attained with 1 year of…", "or an equivalent combination": a guide, not a gate
        const pref = (c.importance && c.importance !== 'required') || /\btypically\s+(?:attained|acquired|gained|obtained)|\bequivalent\s+combination\b/i.test(String(c.sentence || c.evidence || ''));
        out.push({ ...base, ...(people ? gradeManagement({ ...c, _preferred: pref }, ctx) : gradeYears({ ...c, management: false, _preferred: pref }, ctx)) });
        break;
      }
      case 'management':
      case 'seniority': {
        // "Responsible for managing patient health records", "manage multiple tasks": managing a thing is not a team (G5)
        // "work with minimum supervision", "under general supervision": being supervised is not supervising
        if (c.kind === 'management' && /\b(?:minimum|minimal|little|limited|no|without|general|close|direct)\s+supervision\b|\bunder\s+(?:the\s+)?(?:\w+\s+)?supervision\b|\bindependently\b/i.test(String(c.evidence || '')) && !/\b(?:supervis(?:e|ed|ing)\s+(?:a\s+)?(?:team|staff|\d))/i.test(String(c.evidence || ''))) break;
        if (c.kind === 'management' && !peopleManagement(String(c.evidence || c.label || '')) && !/\b(?:team|staff|people|employees|direct\s+reports|crew|associates|supervis\w*|lead(?:ing|ership)?)\b/i.test(String(c.evidence || ''))) break;
        out.push({ ...base, ...gradeManagement({ ...c, _preferred: c.importance && c.importance !== 'required' }, ctx) });
        break;
      }
      case 'certification': {
        // G4: a credential is a gate only when the posting requires HOLDING it. Optional wording ("desirable", "not
        // required", "a plus") makes it preferred; prospective wording ("CPA eligible", "candidacy", "or working toward",
        // "within 12 months of hire", "pending") is a question — or met by a candidate — never a not-met gate.
        if (CREDENTIAL_OPTIONAL_RE.test(String(c.evidence || '')) && !CREDENTIAL_PROSPECTIVE_RE.test(String(c.evidence || ''))) { c = { ...c, importance: 'preferred', gate: false }; base.importance = 'preferred'; base.gate = false; }
        if (CREDENTIAL_PROSPECTIVE_RE.test(String(c.evidence || ''))) {
          const nm = credentialName(c.label);
          const sureP = withoutInProgress(text);
          const heldP = hasStemmed(sureP, String(c.value || '')) || !!credentialHeld(sureP, c.value || c.label) || certHeld(text, c.value, c.label);
          const pend = credentialPending(text, c.label, c.value);
          if (heldP || pend) {
            const sentence = pend ? `They accept ${String(c.label || nm).replace(/^an?\s+/i, '')} candidacy; you list "${pend}".` : `Your résumé lists ${nm}.`;
            out.push({ ...base, gate: false, status: 'met', message: sentence, sentence, grade: 'met', caps: false, factor: 1, ...(pend ? { pending: pend } : {}), prospective: true });
          } else {
            const sentence = `They accept someone working toward ${article(nm)}${nm}; your résumé doesn't say you are. Add it if you are eligible or studying for it.`;
            out.push({ ...base, gate: false, importance: CREDENTIAL_OPTIONAL_RE.test(String(c.evidence || '')) ? 'preferred' : base.importance, status: 'ask', message: sentence, sentence, grade: 'cannot_tell', caps: false, factor: 0.95, prospective: true });
          }
          break;
        }
        // a credential the employer lets you earn after hire ("obtain … within 30 days of hire", "or willingness to
        // obtain") is a question, never a gate
        // …also when the sentence right after the credential says so ("(BCAT) certification. Must be obtained within 30 days
        // of hire") — G6: a credential the employer lets you earn is left open, never called missing
        if (OBTAIN_LATER_RE.test(String(c.evidence || '')) || OBTAIN_LATER_RE.test(nextSentence(jobText, c.evidence))) {
          const nm = credentialName(c.label);
          const sentence = `They ask you to get ${article(nm)}${nm} after you start, so it is not a requirement to apply; say so if you already hold it.`;
          out.push({ ...base, gate: false, importance: 'preferred', status: 'ask', message: sentence, sentence, grade: 'cannot_tell', caps: false, factor: 1, obtainLater: true });
          break;
        }
        const sure = withoutInProgress(text);
        const coreValue = String(c.value || '').replace(new RegExp(`^(?:${US_STATES.join('|')})\\s+`, 'i'), '');
        // a lower licence of the same family is not the one asked for (LMSW for a clinical licence, RDA for an RDH) — G7
        const rung = licenceRung(`${c.label || ''} ${c.value || ''} ${c.evidence || ''}`, sure);
        if (rung && rung.lower) {
          const nmL = credentialName(c.label);
          const sentence = `They ask for ${article(nmL)}${nmL}; your résumé lists ${rung.held}, a lower licence in the same family.`;
          out.push({ ...base, status: c.gate || c.importance === 'required' ? 'unmet' : 'ask', message: sentence, sentence, grade: 'not_shown', caps: false, factor: 0.55, lowerRung: rung.held, namedMissing: true });
          break;
        }
        if (!Array.isArray(c.anyOf)) {
          const alts = ((String(c.evidence || '').match(/\(([^()]*\bor\b[^()]*)\)/) || [])[1] || '').split(/\s*(?:,|\bor\b|\/)\s*/).map((x) => x.trim()).filter((x) => /^[A-Z][A-Z&-]{1,6}$/.test(x));
          if (alts.length >= 2) c = { ...c, anyOf: alts };
        }
        let held = (Array.isArray(c.anyOf) && c.anyOf.some((a) => !!credentialHeld(sure, a) || certHeld(text, a, a))) || (rung && rung.atLeast)
          || hasStemmed(sure, coreValue) || !!credentialHeld(sure, coreValue || c.label) || certHeld(text, coreValue, c.label)
          || (!!coreValue && hasStemmed(licenceForm(sure), licenceForm(coreValue)))
          || (/journeyman|master/i.test(coreValue) && /\bjourneyman\b|\bmaster\s+electrician\b/i.test(sure) && (!/master/i.test(coreValue) || /journeyman/i.test(coreValue)))
          // "Residential Electrician Certification or higher": a journeyman / master electrician holds a higher class (G4)
          || (/\b(?:residential|general|electrician|electrical)\b[^.]{0,30}\b(?:certification|certificate|license)\b/i.test(coreValue) && /\bor\s+higher\b/i.test(String(c.evidence || '')) && /\bjourneyman\b|\bmaster\s+electrician\b/i.test(sure));
        // a junior credential is not the senior one: "Physical Therapist Assistant (PTA)" does not hold a "Physical Therapist"
        // license (G5)
        const junior = held && juniorOnly(text, coreValue || c.label);
        if (junior) {
          held = false;
          const nmJ = credentialName(c.label);
          const sentence = `They ask for ${article(nmJ)}${nmJ}; you list ${junior}, a different credential.`;
          out.push({ ...base, status: c.gate || c.importance === 'required' ? 'unmet' : 'ask', message: sentence, sentence, grade: 'not_shown', caps: !!c.gate, factor: 0.5, junior: true });
          break;
        }
        const name = credentialName(c.label);
        // held means stated as CURRENT: a licence line that says expired / lapsed / inactive (or an expiry date already past)
        // is not held — the sentence says what the résumé states (G7)
        const heldLine = held ? (certLine(text, coreValue, c.label) || (Array.isArray(c.anyOf) ? c.anyOf.map((a) => certLine(text, a, a)).find(Boolean) : null)) : null;
        if (heldLine && lapsedLine(heldLine, ctx.now)) {
          const item = resumeItem(heldLine, (x) => lapsedLine(x, ctx.now) || !!certLine(x, coreValue, c.label)) || heldLine.trim();
          const sentence = `They ask for ${/\b(?:active|current|valid)\b/i.test(String(c.evidence || '')) ? 'an active ' : article(name)}${name.replace(/^an?\s+/i, '')}; your résumé lists "${item}", which is not current.`;
          out.push({ ...base, status: c.gate || c.importance === 'required' ? 'unmet' : 'ask', message: sentence, sentence, grade: 'not_shown', caps: !!c.gate, factor: 0.5, lapsed: item, namedMissing: true });
          break;
        }
        // a license the posting ties to a state is compared with the state on the résumé's license line: "Texas
        // Journeyman required — your résumé shows an Arizona Journeyman license" is a real, specific gate
        const juris = c.state || (/\b(?:DC|D\.C\.|District\s+of\s+Columbia)\b/.test(String(c.evidence || '')) ? 'District of Columbia' : null);
        const noCompact = /\bcompact\s+(?:licen[sc]es?\s+)?(?:is\s+|are\s+)?not\s+accepted\b|\bno\s+compact\b|\bnot\s+(?:a\s+)?compact\b/i.test(String(c.evidence || ''));
        if (juris && !c.state) c = { ...c, state: juris };
        if (noCompact) c = { ...c, compact: false };
        if (held && c.state) {
          const states = licenseStates(text, coreValue);
          if (states.length && !states.includes(c.state)) {
            const status = c.compact ? 'ask' : (c.gate ? 'unmet' : 'ask');
            out.push({ ...base, status, state: c.state, resumeStates: states, message: status === 'unmet'
              ? `Requires ${article(name)}${name}; your résumé shows ${states.length === 1 ? `${article(states[0]).trim()} ${states[0]}` : states.join(' / ')}${licenseWords(text, coreValue) ? ` ${licenseWords(text, coreValue)}` : ''} license.`
              : `The posting asks for ${article(name)}${name}${c.compact ? ' (a compact license may count)' : ''}; your résumé shows ${states.join(' / ')}. Say whether you hold or can transfer it.` });
            break;
          }
          if (!states.length) {
            out.push({ ...base, status: 'ask', state: c.state, message: `The posting asks for ${article(name)}${name}. Your résumé does not say which state your license is from — add the state if it is ${c.state}.` });
            break;
          }
        }
        // held by the old test, but every line that names it says it is not held yet ("CPA Candidate", "CPA exam — REG in
        // progress", "pursuing PMP"): never met — what is listed, and that the credential itself is not (G2, A1)
        const pending = held ? credentialPending(text, c.label, coreValue) : null;
        // a posting that asks for the candidacy itself ("CPA candidacy desirable", "CPA eligible") is met by a candidate
        const asksCandidacy = /\b(?:candidacy|candidate|eligib\w*|pursuing|working\s+towards?|progress\s+towards?)\b/i.test(String(c.evidence || ''));
        if (pending && !asksCandidacy) {
          const pref = (c.importance && c.importance !== 'required') || /\bnot\s+required\b|\b(?:desirable|desired|preferred|a\s+plus|nice\s+to\s+have|bonus)\b/i.test(String(c.evidence || ''));
          const kindWord = OCCUPATION_LICENCE_RE.test(String(c.label || '')) ? 'license' : 'certification';
          const sentence = `They ask for ${article(name)}${name}; you list "${pending}", so the ${kindWord} itself isn't on your résumé yet.`;
          out.push({ ...base, ...(pref ? { importance: 'preferred', gate: false } : {}), status: pref ? 'ask' : 'unmet', message: sentence, sentence, grade: 'partly', caps: false, factor: pref ? 0.95 : (c.gate ? 0.7 : 0.8), pending });
          break;
        }
        if (pending && asksCandidacy) {
          const sentence = `They accept ${String(c.label || name).replace(/^an?\s+/i, '')} candidacy; you list "${pending}".`;
          out.push({ ...base, status: 'met', message: sentence, sentence, grade: 'met', caps: false, factor: 1, pending });
          break;
        }
        // an ordinary driver's licence is something a résumé does not state by nature: asked, never failed (a CDL is a
        // credential and stays one) — G7
        // …unless driving IS the job (a driver / delivery / courier title): there the licence is the credential
        if (!held && /\bdriver'?s?\b[^.]{0,12}\blicen[sc]e\b/i.test(`${c.label} ${c.value}`) && !/\b(?:CDL|commercial|class\s+[ABC])\b/i.test(`${c.label} ${c.value} ${c.evidence || ''}`) && !/\b(?:driver|delivery|courier|chauffeur|truck|van|route|dispatch|transport)\b/i.test(String(ctx.jobTitle || ''))) {
          const sentence = `They ask for ${article(name)}${name}; résumés rarely list one. Say so if you have it.`;
          out.push({ ...base, gate: false, status: 'ask', message: sentence, sentence, grade: 'cannot_tell', caps: false, factor: 1, byNature: true });
          break;
        }
        const status = held ? 'met' : (c.gate ? 'unmet' : 'ask');
        const shownLine = held ? certLine(text, coreValue, c.label) : null;
        // the résumé's words for it, as written (G6): "Your résumé lists food handlers card (Maricopa County)."
        const item = shownLine ? resumeItem(shownLine, (x) => !!certLine(x, coreValue, c.label) || hasStemmed(licenceForm(x), licenceForm(coreValue)) || !!credentialHeld(x, coreValue || c.label)) : '';
        const prefC = !!(c.importance && c.importance !== 'required');
        // a NAMED credential the résumé does not name is not shown — a plus or a requirement; "cannot tell" is kept for what a
        // résumé leaves open by nature (G6: the headline's "the one thing they'd like that you don't list" and the line
        // must come from the same row)
        out.push({ ...base, ...(shownLine ? { line: shownLine, why: 'This line shows it.' } : {}), status, ...(status === 'ask' ? { namedMissing: true } : {}), message: status === 'met' ? (item ? listedSentence(item, name) : `Your résumé lists ${name}.`)
          : status === 'unmet' || !prefC ? `Requires ${article(name)}${name}; your résumé does not list it.`
          : 'Not on your résumé. It is a plus, not a requirement.' });
        break;
      }
      case 'clearance': {
        const g = gradeClearance(c, ctx);
        out.push({ ...base, ...g, message: g.sentence });
        break;
      }
      case 'eligibility': {
        const g = gradeEligibility(c, ctx);
        out.push({ ...base, ...g, message: g.sentence });
        break;
      }
      case 'recency': {
        const g = gradeRecency(c, ctx);
        out.push({ ...base, ...g, message: g.sentence });
        break;
      }
      case 'language': {
        const want = String(c.value || '').toLowerCase();
        // "bilingual English/Spanish" is met by a résumé that names every non-English language it
        // asks for ("Bilingual English/Spanish" on Maria's résumé read as "ask", 2026-10-25).
        const LANGS = /\b(spanish|french|german|mandarin|chinese|cantonese|japanese|korean|vietnamese|tagalog|arabic|russian|portuguese|italian|hindi|punjabi|urdu|polish|haitian creole|creole|asl|american sign language|somali|farsi|persian|hmong)\b/gi;
        const asked = [...new Set([...`${c.label || ''} ${want}`.matchAll(LANGS)].map((m) => m[1].toLowerCase()))];
        // a language written in itself ("español", "Bilingüe") is that language (G5)
        const NATIVE = { spanish: /\b(?:espa(?:ñ|n)ol|biling(?:ü|u)e)\b/i, french: /\bfran(?:ç|c)ais\b/i, portuguese: /\bportugu(?:ê|e)s\b/i, german: /\bdeutsch\b/i };
        let status = want === 'english' && !asked.length ? 'met'
          : (asked.length ? asked.every((l) => new RegExp(`(?<![a-z])${escapeRegExp(l)}(?![a-z])`, 'i').test(text) || (NATIVE[l] && NATIVE[l].test(text))) : hasStemmed(text, want)) ? 'met' : 'ask';
        // "Spanish (conversational)" is not bilingual (round 9): a posting that asks for bilingual or
        // fluent is met only by a résumé that says so
        const level = asked.length ? (text.match(new RegExp(`[^\\n,;•]{0,24}(?<![a-z])${escapeRegExp(asked[0])}(?![a-z])[^\\n,;•]{0,24}`, 'i')) || [''])[0] : '';
        const weak = /\b(?:conversational|basic|beginner|some|elementary|limited|learning)\b/i.test(level);
        if (status === 'met' && weak && /\b(?:bilingual|fluent|fluency|native)\b/i.test(`${c.label} ${want}`)) status = 'partial';
        // a language the posting REQUIRES ("Bilingual Spanish required", "must speak") is a requirement like any other: unmet
        // is not shown and refuses; "a plus" never does (G7)
        const langRequired = c.importance === 'required' && /\b(?:required|must|mandatory|necessary|needed)\b/i.test(String(c.evidence || '')) && !CREDENTIAL_OPTIONAL_RE.test(String(c.evidence || ''));
        if (status === 'ask' && langRequired && want !== 'english') {
          const sentence = `They require ${c.label}; your résumé doesn't list ${asked.length ? joinList(asked.map((l) => l.charAt(0).toUpperCase() + l.slice(1))) : c.label}.`;
          out.push({ ...base, gate: true, status: 'unmet', message: sentence, sentence, grade: 'not_shown', caps: false, factor: 0.45 });
          break;
        }
        const langItems = status === 'met' && asked.length ? asked.map((l) => resumeItem(text, (x) => new RegExp(`(?<![a-z])${escapeRegExp(l)}(?![a-z])`, 'i').test(x) || !!(NATIVE[l] && NATIVE[l].test(x)))).filter(Boolean) : [];
        out.push({ ...base, gate: false, status, message: status === 'met' ? (langItems.length === asked.length && asked.length ? listedSentence(joinList(langItems), String(c.label || want)) : `Your résumé mentions ${want === 'english' ? 'English' : c.label}.`)
          : status === 'partial' ? `The posting asks for ${c.label}; your résumé says ${level.trim()}. Say exactly that — don't upgrade it.`
          : `The posting asks for ${c.label}. Add it only if you speak it.` });
        break;
      }
      case 'schedule': {
        // every item the posting needs has to be on the résumé's availability line ("Available weekends" does
        // not cover holidays or nights — round 9)
        const missing = (c.items || []).filter((i) => !/part-time|seasonal|temporary|full-time|hours|shift/.test(i) && !new RegExp(`\\b${escapeRegExp(String(i).replace(/s$/, ''))}`, 'i').test(text));
        const hasLine = AVAILABILITY_RE.test(text) && !missing.length;
        const partTime = (c.items || []).some((i) => /part-time|seasonal|temporary/.test(i));
        const conflict = partTime && FULL_TIME_RE.test(text);
        const pt = (c.items || []).filter((i) => /part-time|seasonal|temporary/.test(i)).join('/');
        out.push({ ...base, gate: false, status: hasLine && !conflict ? 'met' : 'ask', conflict,
          short: conflict ? `this job is ${pt} and your résumé asks for full-time work` : undefined,
          message: conflict
            ? `This job is ${(c.items || []).filter((i) => /part-time|seasonal|temporary/.test(i)).join('/')}; your résumé says you want full-time work. Change that line if part-time works for you.`
            : hasLine && !conflict ? `This job needs ${c.label}; your availability line covers it.`
            : `This job needs ${c.label}. If you can work that, add an availability line under your header.` });
        break;
      }
      case 'physical':
        out.push({ ...base, gate: false, status: 'ask', message: `Physical requirement: ${c.label}. Add "Able to ${c.label.split(', ')[0]}" only if true.` });
        break;
      case 'age':
        out.push({ ...base, gate: false, status: 'ask', message: `You must be ${c.label} for this job.` });
        break;
      case 'background':
        out.push({ ...base, gate: false, status: 'ask', message: `The employer runs a ${c.label}.` });
        break;
      default:
        break;
    }
  }
  // the license a job turns on, when the posting's own reading did not list it ("A current nursing license in good standing")
  const lic = occupationLicense(jobField, jobTitle, jobText, text, out);
  if (lic) out.push(lic);
  for (const row of out) {
    if (!row.grade) {
      const g = gradeOther(row, ctx);
      if (row.importance && row.importance !== 'required') { g.caps = false; g.factor = 1 - (1 - (Number.isFinite(g.factor) ? g.factor : 1)) * 0.3; }
      Object.assign(row, g);
    }
    if (!row.statementStatus) row.statementStatus = STATEMENT_STATUS[row.grade] || 'cannot_tell';
  }
  // One row per message: a posting that states the same requirement twice (a summary line and a
  // bullet) showed it twice in one list (Maria, round 3). The first row keeps its place and gate.
  const seen = new Set();
  return out.filter((c) => { const k = `${c.kind}|${c.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ── One definition of a failed hard gate (G7) ───────────────────────────────────────────────────────────────────
// A row REFUSES when the posting requires it (a gate, or required importance), it is a strict kind, the posting sentence
// it stands on is known, and the résumé does not show it (not_shown). Partly, cannot_tell and preferred rows never
// refuse. `caps` (the résumé positively shows it is not met) decides only how far the SCORE falls (failedGates below);
// every refusing row is in `hard_gates`, so callers (matched jobs, screens) obey the same rows the score obeys.
export const STRICT_KINDS = new Set(['degree', 'years', 'management', 'seniority', 'certification', 'language', 'clearance', 'eligibility', 'recency']);
export function isHardGateFailed(c) {
  if (!c || !STRICT_KINDS.has(c.kind) || (c.importance && c.importance !== 'required')) return false;
  if (!(c.gate || c.importance === 'required')) return false;
  if (!String(c.posting_quote || c.evidence || '').trim()) return false;
  return c.grade === 'not_shown' || (c.status === 'unmet' && c.caps === true);
}
const GATE_ORDER = { degree: 0, certification: 1, years: 2, recency: 3, seniority: 4, management: 5, language: 6 };
/** Every unmet hard gate, most decisive first — the list callers must obey. */
export function refusingGates(evaluated) {
  return (evaluated || []).filter(isHardGateFailed).sort((a, b) => ((b.caps ? 1 : 0) - (a.caps ? 1 : 0)) || ((GATE_ORDER[a.kind] ?? 9) - (GATE_ORDER[b.kind] ?? 9)));
}
/** The unmet hard gates that CAP the score, most decisive first (credential/years/seniority before the rest). */
export function failedGates(evaluated) {
  const order = { degree: 0, years: 1, seniority: 2, management: 3, certification: 4 };
  // invariant: a hard gate needs the posting sentence it stands on; a gate without one is never applied
  // a gate caps the score only when the résumé POSITIVELY shows it is not met (`caps`, set by the graders below):
  // partial, undated or arguable evidence lowers the score instead (`factor`) and never prints "shows none"
  return (evaluated || []).filter((c) => (c.gate || c.importance === 'required') && c.status === 'unmet' && c.caps === true && GATE_KINDS.has(c.kind) && String(c.posting_quote || c.evidence || '').trim()).sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}

// ── Evidence-graded gates (G 2026-11-10) ─────────────────────────────────────────────────────────────────────
// Every judged constraint carries:
//   grade:    'met' | 'partly' | 'not_shown' | 'cannot_tell'
//   computed: the figure the résumé supports (years), or null;  needed: the posting's figure, or null
//   counted:  [{ title, span, years, line? }] — the résumé roles / lines that were counted, with the dates used
//   caps:     true only when the résumé positively shows the requirement is not met (the score is capped at GATE_CAP)
//   factor:   0..1 — how much the gap lowers the score when it does not cap (1 = no effect)
//   sentence: the plain sentence (also `message`, which every surface already prints)
// `status` keeps its old meaning for every consumer: met | unmet (a real gap) | ask (the person can answer it) |
// partial (language only).
const round1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
function yrs(y) {
  const r = round1(y);
  if (r < 1) return r > 0 ? 'under a year' : 'no time';
  return `${r % 1 === 0 ? r : r} year${r === 1 ? '' : 's'}`;
}
// "3.5 years" stays 3.5 (rounding it to "about 4" made a staff accountant look like he met a 4-year ask); whole-ish
// figures read "about 6 years"
// year-only dates ("2019 – 2020") are estimates: their total is said as "about N"
function aboutR(y, roles) { return (roles || []).some((r) => r.approx) && round1(y) >= 2 ? `about ${Math.round(round1(y))} years` : about(y); }
function about(y) { const r = round1(y); const frac = r % 1; return r < 1 ? 'under a year' : r < 2 ? yrs(r) : frac >= 0.3 && frac <= 0.7 && r < 10 ? `${r} years` : `about ${Math.round(r)} years`; }
const askOf = (need, what, lead) => `${need}+ ${Number(need) === 1 ? 'year' : 'years'} ${lead || 'of'} ${what}`;
// Every role a years figure counted is named (a figure is the sum of exactly the roles listed — coordinator G2 item 1);
// past four, the rest are counted as "and N other jobs".
const tidyTitle = (t) => String(t || '').replace(/\s*\([^()]*\)/g, '').replace(/\s*\(.*$/, '').trim();
function roleList(roles, max = 4) {
  const titled = roles.filter((r) => r.title);
  // a title's aside ("(part time, during school)") is dropped, closed or not
  const tidy = (t) => String(t).replace(/\s*\([^()]*\)/g, '').replace(/\s*\(.*$/, '').trim();
  const named = titled.slice(0, max).map((r) => `${tidy(r.title)}${r.span ? `, ${r.span}` : ''}`);
  const more = titled.length - named.length;
  return `${named.join('; ')}${more > 0 ? `; and ${more} other job${more === 1 ? '' : 's'}` : ''}`;
}
const counted = (roles) => roles.slice(0, 6).map((r) => ({ title: r.title || null, span: r.span || null, years: r.years, field: r.field || null }));
// Stems that name no work on their own ("control" in "inventory control", "high-volume", "fast-paced").
const WEAK_DOMAIN = new Set(['control', 'manag', 'management', 'servic', 'service', 'support', 'system', 'process', 'technic', 'technical', 'general', 'team', 'high', 'volum', 'volume', 'fast', 'pace', 'paced', 'base', 'based', 'hand', 'squar', 'square', 'foot', 'feet', 'environ', 'center', 'centr', 'large', 'larg', 'small', 'busi', 'busy', 'complex', 'complex', 'commerci', 'commercial', 'oper', 'operat', 'operations', 'role', 'lead', 'senior', 'similar', 'divers', 'multi', 'site', 'fulli', 'new', 'client', 'facing', 'face', 'enterpris', 'like',
  // G3: words that name no kind of work on their own — a "Guest EXPERIENCE Team Lead" who does people MANAGEMENT is not
  // "infrastructure management or backend software development experience"
  // job nouns that name no kind of work ("sales role", "technician role", "in a … setting")
  'rol', 'roles', 'position', 'positions', 'job', 'jobs', 'sett', 'setting', 'capacity', 'worker', 'workers', 'technician', 'specialist', 'professional',
  'experienc', 'experience', 'develop', 'development', 'profession', 'professional', 'environment', 'work', 'data', 'product', 'driven', 'drive', 'business', 'skill', 'skills', 'solution', 'solutions', 'industri', 'industry', 'program', 'project', 'customer', 'global', 'strong', 'relev', 'relat', 'year']);
let ALIAS_STEMS = null;
function aliasStems() {
  if (ALIAS_STEMS) return ALIAS_STEMS;
  const byCanon = new Map();
  for (const [alias, canon] of Object.entries(vocabularyAliases())) {
    const st = tokenize(alias).map((t) => t.stem).filter((x) => x.length > 1);
    if (!st.length || st.length > 3) continue;
    byCanon.set(canon, [...(byCanon.get(canon) || []), st]);
  }
  ALIAS_STEMS = byCanon;
  return byCanon;
}
/** The domain of a years requirement as a line test: its specific stems, and every surface of a vocabulary skill it names
 *  ("inventory control" → cycle counts, stock counts, inventory…). */
function domainTest(stems, { strict = false } = {}) {
  const specific = stems.filter((x) => !WEAK_DOMAIN.has(x));
  const phrases = [];
  // strict (a specialty): only the subject's own words — a vocabulary alias widens "chiller" to all of HVAC (G7)
  if (stems.length && !strict) {
    const set = new Set(stems);
    for (const variants of aliasStems().values()) {
      if (variants.some((v) => v.every((x) => set.has(x)) && v.some((x) => !WEAK_DOMAIN.has(x)))) phrases.push(...variants);
    }
  }
  // a line names the work by its head noun (the last specific word: "credentialing" in "provider enrollment and
  // credentialing"), by two of its specific words, or by a vocabulary surface — "assisted providers" alone is not
  // provider enrollment (G 2026-11-10)
  const head = specific[specific.length - 1];
  return (line) => {
    const have = new Set(tokenize(String(line || '')).map((t) => t.stem));
    if (phrases.some((v) => v.every((x) => have.has(x)))) return true;
    // generic words never carry a match alone: with no specific word there is nothing a line can name (G3 — the old
    // "two of zero specific words" test passed EVERY line)
    if (!specific.length) return false;
    const hits = specific.filter((x) => have.has(x)).length;
    return have.has(head) || (specific.length >= 2 && hits >= 2);
  };
}
/** The posting's object of a years requirement, as words a person would say ("inventory control", "SaaS sales"). */
// "1–3 years in loan processing", "1+ year working with children and adolescent patients", "6+ years in semiconductor
// photolithography operations": the subject after the years, when the sentence has no "experience" word (G2, A3 — these
// fell to the whole-career path)
// …and a gerund subject: "2+ years supervising warehouse teams", "5+ years closing complex Enterprise deals" (G4)
const SUBJECT_AFTER_YEARS_RE = /\b(?:years?|yrs?)\b[^.;\n]{0,30}?\b(working\s+(?:with|in|as|on)|work(?:ed)?\s+(?:with|in|as)|in|with|as\s+an?|as|doing|supporting|within|serving|(?:supervis|manag|lead|clos|sell|run|build|develop|design|teach|train|operat|install|repair|maintain|coordinat|recruit)[a-z]*ing)\s+([^.;\n]{3,140})/i;
function yearsSubject(c) {
  const sent = String(c.sentence || c.evidence || '');
  const m = sent.match(SUBJECT_AFTER_YEARS_RE);
  if (!m) return null;
  const subject = m[2].replace(/\s+(?:is|are|preferred|required|strongly|a\s+plus|highly)\b.*$/i, '').trim();
  if (/^(?:the|this|a|an)\s+(?:field|industry|role|position)\b|^(?:a\s+)?(?:similar|related|relevant|comparable)\b/i.test(subject)) return null;
  return { lead: m[1].toLowerCase().replace(/\s+/g, ' '), subject };
}
function domainLead(c) {
  const sent = String(c.sentence || c.evidence || '').replace(/\bwithin\s+the\s+(?:past|last)\b[^.;]*/gi, '');
  if (yearsDomainClause(sent)) {
    const m = sent.match(/\b(experience|work(?:ing)?)\s+(in|with|as|on|doing|across|supporting|within)\s/i);
    if (!m) return 'of';
    const prep = m[2].toLowerCase();
    if (/^work/i.test(m[1])) return `${m[1].toLowerCase()} ${prep}`;
    return /^(?:with|as|doing|supporting)$/.test(prep) ? `of experience ${prep}` : prep;
  }
  const s2 = yearsSubject(c);
  return s2 ? s2.lead : 'of';
}
function domainPhrase(c) {
  // the reader carries the subject on the alternative ("5+ years of office management" → field "office management") — G5
  const altField = (c.alternatives || []).map((a) => a && !a.degree && a.field).find((f) => f && !/^(?:equivalent|related|relevant|similar)$/i.test(String(f).trim()));
  let raw = String(c.field || altField || yearsDomainClause(c.sentence || c.evidence || '') || (yearsSubject(c) || {}).subject || '').trim();
  // a parenthetical is an aside; an unclosed one (cut by the sentence end) is dropped with everything after it
  // …but a parenthetical LIST of fields is the subject's alternatives ("related office experience (legal, paralegal,
  // finance, or accounting)" — G4)
  const parenList = (String(c.sentence || c.evidence || '').match(/\(([^()]{3,120}(?:,|\bor\b)[^()]{2,120})\)/) || [])[1];
  raw = raw.replace(/\s*\([^()]*\)/g, ' ').replace(/\s*[(\[].*$/, '').trim();
  // a parenthetical that is a preference ("(Home Health, Med-Surg, ICU, or Acute Care preferred)") is not the subject
  if (parenList && !/\d|\$|e\.g\.|i\.e\.|such\s+as|\b(?:preferred|a\s+plus|ideally|desired|desirable|helpful)\b/i.test(parenList)) {
    const alts = parenList.split(/,\s*(?:or\s+|and\s+)?|\s+or\s+/i).map((x) => x.trim()).filter((x) => x && x.split(/\s+/).length <= 3);
    if (alts.length >= 2) return alts.slice(0, 4).join(' or ');
  }
  raw = raw.replace(/^(?:experience\s+(?:in|with|as|doing)\s+)?(?:an?\s+|the\s+)?/i, '').replace(/\s+experience$/i, '');
  // "experience leading or managing…" → "leading or managing…"; "closing B2B deals as an Account Executive or in a similar
  // role" → the role clause is not the subject (G5)
  raw = raw.replace(/^experience\s+/i, '').replace(/\s+as\s+(?:an?\s+|the\s+)?[A-Z][^,;.]*$/, '').replace(/\s+(?:or|and)\s+in\s*$/i, '').replace(/\s+as\s+an?\s*$/i, '');
  // "…backend software development experience in a fast-paced, product-driven environment": the subject ends before
  // "experience" and before a setting ("in a … environment") — the sentence never ends on a dangling "in" (G3)
  raw = raw.replace(/\s+(?:roles?|positions?|jobs?|capacity|settings?)\b(?=\s*$|\s+(?:in|within|at)\b)/i, '').replace(/\s+experience\b.*$/i, '').replace(/\s+(?:in|within|at)\s+(?:an?|the)\s+[^,.;]*?(?:environment|setting|industry|company|organization|startup|team|culture)s?\b.*$/i, '').trim();
  raw = raw.replace(/^(?:(?:proven|demonstrated|working|strong|solid|deep|hands-on|direct|prior|relevant|professional|progressive)\s+)*(?:knowledge|understanding|familiarity|experience|expertise|proficiency)\s+(?:of|with|in)\s+/i, '');
  // qualifiers in front of the subject ("current or recent hands-on medical") are not the subject — G5
  raw = raw.replace(/^(?:(?:current|recent|prior|previous|hands-on|direct|relevant|related|professional|practical|progressive|paid)(?:\s*(?:,|or|and|\/)\s*|\s+))+/i, '');
  raw = raw.replace(/^either\s+/i, '').replace(/\band\s*\/\s*or\b/gi, 'or').replace(/\s*\/\s*/g, ' or ').replace(/\s+/g, ' ').replace(/[\s,;:.]+$/, '');
  // a list of fields offered as a choice: keep at most the first two ("email marketing operations or CRM administration");
  // otherwise the object ends at the first comma / "including" ("software design and development, including building…")
  const isChoice = /,\s*or\s|\sor\s/i.test(raw);
  if (!isChoice) raw = raw.split(/,|\s+(?:including|with|where|while|that|which|and\s+(?:a|an|the)\s)\b/i)[0].trim();
  const items = isChoice ? raw.split(/,\s*(?:or\s+|and\s+)?|\s+or\s+/i).map((x) => x.trim()).filter(Boolean) : [raw];
  let phrase = items.length > 2 ? `${items[0]} or ${items[1]}` : items.join(' or ');
  if (phrase.split(/\s+/).length > 8) phrase = phrase.split(/\s+/).slice(0, 8).join(' ');
  if (/^(?:management|supervisory|managerial|leadership|people management)(?:\s+or\s+(?:management|supervisory|leadership))?$/i.test(phrase)) return 'managing people';
  // a phrase of qualifiers only ("relevant", "professional") names no object
  // a phrase that ends on a modifier names no work ("client-centric", "customer-facing", "data-driven"): the reader cut it
  if (/(?:-centric|-facing|-oriented|-based|-driven|-focused|-related|\bfast-paced|\bhigh-volume)$/i.test(phrase)) return '';
  if (!phraseStems(phrase).length || /^(?:(?:job[- ]related|related|relevant|similar|applicable|comparable|professional|industry|work|hands-on|direct|prior|paid|progressive|proven|demonstrated|demonstrable|solid|strong|successful|significant|extensive|previous|recent)\s*)+(?:industry|field|work|roles?|positions?|settings?|environments?|areas?|capacity)?$/i.test(phrase)) return '';
  return phrase;
}
// A subject that is a field's own bare noun ("building software", "in nursing", "selling … sales") names that field (G4)
const BARE_FIELDS = [[/^(?:\w+\s+){0,2}(?:software|web\s+applications?|backend\s+systems?|code)$/i, 'software'], [/^(?:\w+\s+)?nursing$/i, 'nursing'], [/^(?:\w+\s+)?(?:accounting|bookkeeping)$/i, 'accounting'], [/^(?:\w+\s+)?marketing$/i, 'marketing'], [/^(?:\w+\s+)?(?:b2b\s+|saas\s+)?sales$/i, 'sales'], [/^(?:\w+\s+)?retail$/i, 'retail'], [/^(?:\w+\s+)?construction$/i, 'construction'], [/^(?:\w+\s+)?(?:customer\s+(?:service|support))$/i, 'support'], [/^(?:\w+\s+)?teaching$/i, 'education'], [/^(?:\w+\s+)?hospitality$/i, 'hospitality'], [/^(?:\w+\s+)?warehouse$/i, 'warehouse'], [/^(?:general\s+)?(?:administrative|clerical|office\s+administration|administrative\s+support|office\s+support)(?:\s+(?:support|work|experience))?$/i, 'front_office']];
const SETTING_FIELDS = [[/\b(?:customer|guest|client)[- ](?:facing|service|focused)\b/i, ['support', 'retail', 'food', 'hospitality', 'sales']], [/\b(?:culinary|kitchen|restaurant|food\s+service|hospitality\s+kitchen)\b/i, 'food'], [/\b(?:retail|store)\b/i, 'retail'], [/\b(?:warehouse|distribution|fulfil?lment)\b/i, 'warehouse'], [/\b(?:hospital|clinical|healthcare|acute\s+care)\b/i, 'nursing'], [/\b(?:call\s+center|contact\s+center)\b/i, 'support'], [/\b(?:construction|job\s*site)\b/i, 'construction'], [/\b(?:classroom|school)\b/i, 'education']];
// words that say only WHERE work is done (G6 addendum b); "commercial" is already a weak word
const SETTING_WORD_RE = /^(?:residential|industrial|institutional|municipal|multi-?family|light|heavy|school|schools|district|public|private|government|non-?profit|in-?home|home|field|on-?site|salon|salons|spa|resort|commercial)$/i;
function settingWordsOf(q) { return String(q || '').split(/\s+/).filter((w) => w && SETTING_WORD_RE.test(w) && !LEVEL_QUAL_RE.test(w)).map((w) => w.toLowerCase()); }
// a level in front of the field ("journey-level HVAC", "senior nursing") says how far up, not a narrower kind of work (G7)
const LEVEL_QUAL_RE = /^(?:journey(?:man)?(?:-level)?|journey-?level|level|senior|junior|lead|entry(?:-level)?|mid(?:-level)?|master|apprentice|experienced|skilled|certified|licensed)$/i;
function settingOnly(q) {
  const ws = String(q || '').split(/\s+/).filter((w) => w && tokenize(w).some((t) => !WEAK_DOMAIN.has(t.stem) && t.stem.length > 2));
  return ws.length > 0 && ws.every((w) => SETTING_WORD_RE.test(w) || LEVEL_QUAL_RE.test(w));
}
/** The occupation a years subject names by its head noun ("school administration" → K–12 education administrators), or,
 *  for a subject that is only a setting ("salon"), the posting's own occupation. Null when the knowledge is not loaded. */
function subjectOccupation(phrase, jobTitle) {
  if (!hasOccupationData()) return null;
  const p = String(phrase || '').trim();
  if (p.split(/\s+/).every((w) => SETTING_WORD_RE.test(w))) { const o = occupationOf(String(jobTitle || '')); return o && o.confidence !== 'guess' ? o.code : null; }
  const o = occupationOf(p);
  if (!o || o.confidence === 'guess') return null;
  const head = morphStem((p.match(/[A-Za-z]+/g) || []).pop() || '');
  return head && (String(o.title || '').match(/[A-Za-z]+/g) || []).some((w) => morphStem(w) === head) ? o.code : null;
}
function bareField(phrase) { const t = String(phrase || '').trim(); const hit = BARE_FIELDS.find(([re]) => re.test(t)); return hit ? hit[1] : null; }
/** The specific stems of a subject phrase. */
// "M&A" is two one-letter tokens a stemmer drops: compare it as the words it stands for, on both sides (G6 addendum a)
// …and a practitioner's noun is the practice it names ("Framing Carpenter" does carpentry; a Welder welds) — G7
const PRACTICE_NOUNS = [[/\bcarpenters?\b/gi, 'carpentry'], [/\bplumbers?\b/gi, 'plumbing'], [/\bwelders?\b/gi, 'welding'], [/\bmasons?\b/gi, 'masonry'], [/\broofers?\b/gi, 'roofing'], [/\bmachinists?\b/gi, 'machining'], [/\blandscapers?\b/gi, 'landscaping'], [/\bbookkeepers?\b/gi, 'bookkeeping'], [/\bpainters?\b/gi, 'painting'], [/\bbakers?\b/gi, 'baking'], [/\bphlebotomists?\b/gi, 'phlebotomy'], [/\bcosmetologists?\b/gi, 'cosmetology'], [/\bdrywallers?\b/gi, 'drywall']];
const subjectLine = (l) => { let t = String(l || '').replace(/\bM\s*&\s*A\b/g, 'mergers acquisitions').replace(/\bmergers\s+(?:and|&)\s+acquisitions\b/gi, 'mergers acquisitions'); for (const [re, to] of PRACTICE_NOUNS) t = t.replace(re, to); return t; };
function phraseStems(phrase) {
  phrase = subjectLine(String(phrase || '').replace(/\bbusiness[\s-]to[\s-]business\b/gi, 'B2B'));
  const viaYears = yearsDomain(`5 years of ${phrase} experience`).stems;
  if (viaYears.length) return viaYears;
  return [...new Set(tokenize(String(phrase || '')).map((t) => t.stem).filter((x) => x.length > 2 && !/^(?:and|the|for|with|or|of|in)$/.test(x)))].slice(0, 8);
}
/** The alternatives a subject phrase offers ("loan processing or mortgage operations" → two), each with its stems. */
function subjectItems(phrase) {
  return String(phrase || '').split(/\s+or\s+|,\s*/i).map((x) => x.trim()).filter(Boolean).slice(0, 3).map((x) => ({ text: x, stems: phraseStems(x) })).filter((x) => x.stems.length);
}
// People nouns name WHO, not the work: "children and adolescent patients" is shown by a line about children, never by any
// line with "patients" on it (an RN's whole career was counted for "1+ year working with children" — G2, A3)
const PEOPLE_STEMS = new Set(tokenize('patients customers clients guests members users people individuals persons staff employees stakeholders consumers visitors residents associates workers crew crews teammates hourly').map((t) => t.stem));
/** A line test for a years subject: any alternative named by its head noun, two of its specific words, or a vocabulary
 *  surface; a people noun counts only when the alternative has no other specific word. */
// Trade names a résumé uses for a subject the posting names by its class ("personal lines" ← auto / home / renters /
// umbrella policies) — G5
const SUBJECT_ALIASES = [
  [/(?:^|\s)personal\s+lines?$/i, ['auto policies', 'home policies', 'homeowners', 'renters', 'umbrella', 'personal auto', 'auto, home']],
  [/(?:^|\s)commercial\s+lines?$/i, ['commercial policies', 'business owners', 'general liability', 'workers comp', 'commercial auto']],
  [/^(?:intelligence|intel)(?:\s+analysis)?$/i, ['sigint', 'humint', 'osint', 'all-source', 'intsum', 'intsums', 'mi brigade', 'military intelligence', 'threat reports', 'intelligence']],
  [/^outbound$/i, ['cold calling', 'cold call', 'prospecting', 'outreach', 'sdr', 'bdr', 'outbound']],
  [/^inbound$/i, ['inbound', 'call center', 'incoming calls', 'inbound calls']],
  [/^enterprise$/i, ['enterprise', 'fortune 500', 'large accounts', 'strategic accounts']],
  [/^(?:b2b|business[\s-]to[\s-]business)$/i, ['b2b', 'business-to-business', 'saas', 'small businesses', 'enterprise']],
  [/(?:^|\s)(?:b2b|business[\s-]to[\s-]business)\s+sales$/i, ['b2b', 'business-to-business', 'saas sales', 'enterprise sales', 'account executive']],
];
function subjectTest(items, { strict = false } = {}) {
  const tests = items.map((it) => {
    const specific = it.stems.filter((x) => !WEAK_DOMAIN.has(x));
    const work = specific.filter((x) => !PEOPLE_STEMS.has(x));
    const alias = (SUBJECT_ALIASES.find(([re]) => re.test(it.text.trim())) || [null, []])[1].map((a) => tokenize(a).map((t) => t.stem).filter((x) => x.length > 1));
    const viaAlias = (line) => { const have = new Set(tokenize(String(line || '')).map((t) => t.stem)); return alias.some((v) => v.length && v.every((x) => have.has(x))); };
    if (!work.length) { const d = domainTest(it.stems, { strict }); return (line) => d(line) || viaAlias(line); }
    // a compound noun ("B2B sales", "court records", "semiconductor photolithography") needs every specific word on the
    // line — "age-restricted sales" is not B2B sales; a list ("provider enrollment and credentialing") keeps its head
    if (work.length >= 2 && !/\band\b|&|,/.test(it.text)) {
      return (line) => { const have = new Set(tokenize(String(line || '')).map((t) => t.stem)); return work.every((x) => have.has(x)) || viaAlias(line); };
    }
    const inner = domainTest(work, { strict });
    return (line) => inner(line) || viaAlias(line);
  });
  return (line) => { const l = subjectLine(line); return tests.some((t) => t(l)); };
}

// "infrastructure management", "inventory management": managing a thing, not people
const THING_MANAGEMENT_RE = /\b(?:office|front\s+office|practice|records|clinic|store\s+operations|brand|product\s+marketing|marketing|channel|category|social\s+media|community|partner|partnership|program|portfolio|lifecycle|infrastructure|project|program|inventory|property|account|product|data|risk|case|change|configuration|vendor|supply\s+chain|asset|records?|document|content|campaign|category|revenue|portfolio|knowledge|release|incident|quality|time|stakeholder|relationship|systems?|database|cloud|network|fleet|facilit(?:y|ies)|event|budget|contract|pipeline|territory|client|customer)\s+management\b/gi;
const peopleManagement = (phrase) => LEAD_PHRASE_RE.test(String(phrase || '').replace(THING_MANAGEMENT_RE, ' '));
const LEAD_PHRASE_RE = /\b(?:leadership|leading|lead\s+role|supervis\w*|managing\s+(?:people|a\s+team|teams|staff|employees)|people\s+management|management)\b/i;
function gradeYears(c, ctx) {
  const need = Number(c.value);
  const { profile, jobField, now } = ctx;
  void now;
  let phrase = domainPhrase(c);
  // "4+ years of experience in a leadership role within a Shipping Operations environment" is people management first;
  // a setting the sentence names after it ("1+ year of leadership experience in a culinary environment") is kept (G5)
  const settingM = String(c.evidence || c.sentence || '').match(/\b(?:in|within)\s+(?:an?|the)\s+([a-z][\w\s&-]{2,40}?)\s+(?:environment|setting|industry|operation|facility)s?\b/i);
  if ((phrase === 'managing people' || (phrase && peopleManagement(phrase))) && settingM && !new RegExp(escapeRegExp(settingM[1]), 'i').test(phrase)) phrase = `${phrase === 'managing people' ? 'leadership' : phrase} in a ${settingM[1]} environment`;
  // leading people IN a setting: "1+ year of experience leading a shift or crew in a restaurant, coffee shop or other food
  // service setting" — the setting list is met by ANY one item: the role's own words (title, employer, lines), its field,
  // or the field of another role at the same employer (Dutch Bros Coffee: barista → food service). Said in the posting's
  // words (G5, worked example 1).
  const ev = String(c.evidence || c.sentence || '');
  const leadM = ev.match(/\b(?:leading|supervising|managing|running|overseeing)\s+((?:an?\s+|the\s+)?[a-z][\w\s/-]{1,40}?)\s+(?:in|at|within)\s+(?:an?\s+|the\s+)?([^.;()]{3,120})/i);
  const settingRaw = leadM ? leadM[2] : (settingM ? settingM[1] : '');
  if (settingRaw && (phrase === 'managing people' || (phrase && peopleManagement(phrase)) || leadM)) {
    const row = gradeManagement({ ...c, kind: 'years' }, ctx);
    const settings = settingRaw.replace(/\s+(?:settings?|environments?|industry|operations?|facilit(?:y|ies))\b.*$/i, '').split(/,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/i)
      .map((x) => x.trim().replace(/^(?:other|similar|any|an?|the)\s+/i, '').replace(/^(?:other|similar)\s+/i, '')).filter((x) => x && x.length <= 40);
    const obj = leadM ? leadM[1].split(/\s+or\s+/i)[0].trim() : 'people';
    // an adjective setting keeps its noun: "a culinary environment", not "a culinary"
    const settingNoun = (settingRaw.match(/\b(settings?|environments?|industry|operations?|facilit(?:y|ies))\b/i) || [null, 'environment'])[1].replace(/s$/, '');
    const say = (it) => (/^[a-z-]+(?:ary|al|ic|ical|ive|-facing|-focused|-paced|-driven|-based)$/i.test(it) ? `${it} ${settingNoun}` : it);
    if (row.grade === 'met' && settings.length) {
      const employer = (r) => { const h = String(r.header || ''); const t = String(r.title || ''); const rest = h.indexOf(t) >= 0 ? h.slice(h.indexOf(t) + t.length) : h; return rest.replace(/^[\s,—–|-]+/, '').split(/\s+-\s+|,\s+|\s{2,}|\s+(?:19|20)\d\d/)[0].trim(); };
      const sameEmployerFields = (r) => { const e = employer(r).toLowerCase(); return e ? profile.roles.filter((x) => x !== r && employer(x).toLowerCase() === e).map((x) => x.field) : []; };
      // the item the role's own words name wins ("coffee shop" ← Dutch Bros Coffee), then one its field covers
      const byWords = (r, it) => { const words = phraseStems(it).filter((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)); const have = new Set(tokenize(`${r.title} ${r.header} ${(r.bullets || []).join(' ')}`).map((t) => t.stem)); return words.some((x) => have.has(x)); };
      const byField = (r, it) => { const f = [titleField(it), bareField(it), ...[].concat((SETTING_FIELDS.find(([re]) => re.test(it)) || [])[1] || [])].filter(Boolean); return f.some((x) => r.field === x || sameEmployerFields(r).includes(x)); };
      const hitItem = (r) => settings.find((it) => byWords(r, it)) || settings.find((it) => byField(r, it));
      const where = profile.management.roles.map((r) => ({ r, it: hitItem(r) })).filter((x) => x.it);
      if (where.length) {
        const first = where[0];
        const yrsHere = profile.yearsWhere((r) => where.some((w) => w.r === r));
        const froms = where.map((w) => w.r.from).filter((x) => x != null);
        const since = froms.length ? Math.floor(Math.min(...froms) / 12) : null;
        const emp = employer(first.r);
        const titles = [...new Set(where.map((w) => tidyTitle(w.r.title)).filter(Boolean))].slice(0, 2);
        const sentence = `${joinList(titles.length ? titles : [tidyTitle(first.r.title)])}${emp ? ` at ${emp}` : ''}${since ? ` since ${since}` : ''} — ${aboutR(yrsHere.years, yrsHere.roles)} leading ${obj} in ${/^[aeiou]/i.test(say(first.it)) ? 'an' : 'a'} ${say(first.it)}; they ask for ${need}.`;
        return finish({ _preferred: !!c._preferred, ...row, computed: yrsHere.years, counted: counted(yrsHere.roles), sentence });
      }
      const fields = [...new Set(profile.management.roles.map((r) => fieldLabel(r.field)).filter(Boolean))];
      return finish({ _preferred: !!c._preferred, ...row, grade: 'partly', factor: 0.85, sentence: `You show ${aboutR(row.computed, profile.management.roles)} leading people (${roleList(profile.management.roles)})${fields.length ? `, in ${joinList(fields.slice(0, 2))}` : ''}; they ask for ${need}+ years of it in ${joinOr(settings.map((x) => `${/^[aeiou]/i.test(x) ? 'an' : 'a'} ${x}`))}. Say what carries over.` });
    }
    return row;
  }
  // leading people with no setting named: the management grader alone
  if (phrase && (phrase === 'managing people' || peopleManagement(phrase))) {
    // managing people IN an area with no setting word ("2+ years supervising warehouse teams"): the area is checked too
    const row = gradeManagement({ ...c, kind: 'years' }, ctx);
    const rest = phrase.replace(LEAD_PHRASE_RE, ' ').replace(/\b(?:supervis\w*|manag\w*|lead\w*|running|overseeing|role|roles|position|capacity|experience|within|in|an?|the|of|environment|setting)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const st = rest ? phraseStems(rest).filter((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)) : [];
    if (row.grade === 'met' && st.length) {
      const test = domainTest(st);
      const setField = titleField(rest) || bareField(rest) || [].concat((SETTING_FIELDS.find(([re]) => re.test(rest)) || [])[1] || [])[0] || null;
      const where = profile.management.roles.filter((r) => test(r.title) || test(r.header) || r.bullets.some(test) || (setField && r.field === setField));
      if (!where.length) {
        const fields = [...new Set(profile.management.roles.map((r) => fieldLabel(r.field)).filter(Boolean))];
        return finish({ _preferred: !!c._preferred, ...row, grade: 'partly', factor: 0.85, sentence: `You show ${aboutR(row.computed, profile.management.roles)} leading people (${roleList(profile.management.roles)})${fields.length ? `, in ${joinList(fields.slice(0, 2))}` : ''}; they ask for ${need}+ years of it in ${rest}. Say what carries over.` });
      }
    }
    return row;
  }
  const stems = phrase ? phraseStems(phrase) : [];
  const items = phrase ? subjectItems(phrase) : [];
  const lead = domainLead(c);
  const generic = !stems.length && !/\b(?:relevant|related|similar|this\s+field|the\s+field|industry|comparable)\b/i.test(String(c.sentence || c.evidence || ''));
  const total = profile.totalYears || ctx.totalY || 0;
  const roles = profile.roles;
  // the field the requirement is about: the field its words name, else (no object) the posting's own field
  // (a domain word the posting's own title carries — "software" in "Senior Software Engineer I" — is the posting's field)
  const titleStems = new Set(tokenize(String(ctx.jobTitle || '')).map((t) => t.stem));
  // a phrase names a field only through a field's own title words — never through the role-family guesser ("children and
  // adolescent patients" is not patient-care work)
  const phraseField = phrase ? (FIELDS.some((f) => f.title.test(phrase)) ? titleField(phrase) : null) || bareField(phrase) || (stems.some((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x) && titleStems.has(x)) ? jobField : null) : null;
  const reqField = phraseField || (!stems.length ? jobField : null);
  // a role is in the field by its title or by what its bullets do (a Process Assistant whose lines are pick/stow is warehouse
  // work — G5)
  // by its title, or — only when the title places it nowhere — by what its bullets do; a placed role in another field (a
  // cashier's "age-restricted sales") never counts as years of the asked work (G5, A4)
  const isFieldRole = (r) => !!reqField && (r.field === reqField || (!r.field && roleDuties(r).includes(reqField)) || (!!r.title && !!(FIELDS.find((x) => x.key === reqField) || {}).title && (FIELDS.find((x) => x.key === reqField) || {}).title.test(r.title) && areAdjacent(r.field, reqField)));
  // a SPECIALTY in front of the field ("cath lab or interventional radiology nursing", "commercial chiller HVAC"): the
  // specialty must be on the résumé — being in the field is not enough (G5)
  const fieldRe = reqField && (FIELDS.find((f) => f.key === reqField) || {}).title;
  // the qualifier of an item = the item minus the field phrase the field's pattern finds in it ("backend software
  // development" → "backend"); a SPECIALTY only when some item has one
  const qualifierOf = (t) => { if (!fieldRe) return ''; const m = String(t).match(new RegExp(fieldRe.source, 'i')); if (!m) return ''; const q = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim(); return phraseStems(q).some((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)) ? q : ''; };
  // a modifier listed before the field's noun qualifies that noun ("corporate/M&A paralegal" = corporate paralegal or M&A
  // paralegal), unless it names a field of its own ("sales or marketing") — G6 addendum a
  const headM = fieldRe && items.length >= 2 ? items.map((it) => it.text.match(new RegExp(fieldRe.source, 'i'))).find(Boolean) : null;
  const itemsF = headM ? items.map((it) => (fieldRe.test(it.text) || it.text.split(/\s+/).length > 1 || titleField(it.text) || bareField(it.text) ? it : { text: `${it.text} ${headM[0]}`, stems: phraseStems(`${it.text} ${headM[0]}`) })) : items;
  // a qualifier that only says WHERE the work is done ("residential", "school", "salon") is a setting, not a narrower
  // subject: the field's years count and the setting is reported as not stated (G6 addendum b); any other qualifier is a
  // specialty the résumé must name (addendum a)
  const quals = itemsF.map((it) => qualifierOf(it.text)).filter(Boolean);
  const specQuals = quals.filter((q) => !settingOnly(q));
  // a subject placed in the field only through the posting's own title words ("commercial chiller and rooftop unit
  // service" for a Commercial HVAC Technician, "finish carpentry") names no field noun of its own: it is a kind of work
  // inside the field, a specialty the résumé must name (G7, matcher class 1)
  const viaTitleOnly = !!(phrase && phraseField && !(FIELDS.some((f) => f.title.test(phrase))) && !bareField(phrase));
  const qualSpecialty = !!(phrase && phraseField && fieldRe && fieldRe.test(phrase) && specQuals.length);
  const specialty = qualSpecialty || !!(viaTitleOnly && !settingOnly(phrase));
  // a qualifier on the field's noun is shown by one line that names it; a whole kind of work placed only through the
  // title needs a role whose title, or a third of its lines, names it (the ordinary rule) — one "coached students" line
  // is not years of career coaching
  const oneLine = qualSpecialty;
  const settingWords = !specialty && phrase && phraseField && fieldRe && quals.length ? [...new Set(quals.flatMap(settingWordsOf))] : [];
  // the field's word in the subject is a specific trade inside a broad field ("HVAC service" inside maintenance and repair):
  // a field role counts only when its own words name it — a Lube Technician is not HVAC service (G7, matcher class 1)
  const headWord = phrase && fieldRe ? (phrase.match(new RegExp(fieldRe.source, 'i')) || [''])[0] : '';
  const porter = (x) => (String(x).match(/[A-Za-z]+/g) || []).map((w) => morphStem(w.toLowerCase()));
  const headSpecific = !!headWord && !!reqField && !porter(fieldLabel(reqField)).some((t) => porter(headWord).includes(t));
  // …by the word itself or its trade-talk equal ("Registered Nurse" names RN)
  const headEquals = headSpecific ? tradeExpand(headWord).filter((e) => !/instance/i.test(e.kind)).flatMap((e) => e.shows).filter((x) => String(x).length > 2) : [];
  const namesHead = (r) => [r.title, r.header, ...(r.bullets || [])].some((l) => hasStemmed(String(l || ''), headWord) || headEquals.some((x) => hasStemmed(String(l || ''), x)));
  const isField = (r) => !specialty && isFieldRole(r) && (!headSpecific || namesHead(r));
  const testItems = specialty ? itemsF.map((it) => { const t = qualifierOf(it.text) || it.text; return { text: t, stems: phraseStems(t) }; }).filter((x) => x.stems.length) : items;
  const baseTest = testItems.length ? subjectTest(testItems, { strict: specialty }) : domainTest(stems);
  // a specialty is also named by its trade-talk equal ("neonatal intensive care" for NICU) — never by a class's instance
  const equals = specialty ? testItems.flatMap((it) => tradeExpand(it.text).filter((e) => !/instance/i.test(e.kind)).flatMap((e) => e.shows)).filter((x) => String(x).trim().length > 2).map((x) => new RegExp(`(?<![A-Za-z])${escapeRegExp(String(x).trim()).replace(/\s+/g, '[\\s-]+')}(?![A-Za-z])`, 'i')) : [];
  // the equal is matched as the whole phrase, never by one of its words ("business to business" is not "Meta Business Suite")
  const test = equals.length ? (line) => baseTest(line) || equals.some((re) => re.test(String(line || ''))) : baseTest;
  const share = (r) => (r.bullets.length ? r.bullets.filter(test).length / r.bullets.length : 0);
  // a role placed in a field that is neither the subject's field nor next to it never counts by its words: a retail
  // lead's lines do not prove years of software development (G3; known-different ⇒ no years-in-field row met)
  // when the subject names no field ("1+ year of medical experience"), the posting's own field guards it: a role in a known,
  // unrelated field never counts by a shared word — an electrician's "a 4-story medical office building" is not medical
  // experience (G5 CI)
  const guardField = reqField || jobField || null;
  const outside = (r) => !!guardField && !!r.field && r.field !== guardField && !areAdjacent(r.field, guardField);
  // a specialty is shown by one line that names it; a whole subject by a third of a role's lines (or its title)
  // a specialty may be named by a role next to the field or unplaced ("Project Logistics Coordinator" for construction
  // logistics), never by a role in a known, unrelated field — an accountant "closing" the books does not close sales (G5 CI #1)
  // …or a role in any field whose own line names the whole multi-word specialty ("ambassador for new hires" names
  // "new hires"); a single shared word never crosses a field (G7)
  const wholePhrase = (r) => specialty && testItems.some((it) => it.text.trim().split(/\s+/).length >= 2 && [r.title, ...(r.bullets || [])].some((l) => new RegExp(`(?<![A-Za-z])${escapeRegExp(it.text.trim()).replace(/\s+/g, '\\s+')}(?![A-Za-z])`, 'i').test(String(l || ''))));
  const specOk = (r) => !r.field || r.field === reqField || areAdjacent(r.field, reqField) || wholePhrase(r);
  const textHit = (r) => (specialty ? specOk(r) : !outside(r)) && stems.length && (test(r.title) || test(String(r.header || '').split(/\s+[—–|]\s+/)[0]) || (r.bullets.length >= 1 && (oneLine ? r.bullets.some(test) : share(r) >= 1 / 3)));
  // when some role names the subject itself, those roles are the count — a field role that never names it is not
  // ("4+ years in court records": the Records Custodian, not the law-firm File Clerk — G5)
  const namesField = !!phrase && (FIELDS.some((f) => f.title.test(phrase)) || !!bareField(phrase));
  const anyText = !!phrase && !namesField && roles.some((r) => r.title && textHit(r));
  // a subject that IS a field ("sales or business development") is met only by roles in that field (or unplaced roles
  // whose lines do it) — never by a cashier's "age-restricted sales" line (G5, A4)
  // per alternative: an alternative that names a field ("customer service") is met only by roles in that field; another
  // alternative ("office management") by any role whose words name it (G5)
  // a role whose title names the field counts even when a ladder word places it next door ("Call Center Trainer",
  // "Customer Service Team Lead" for customer-service years); a cashier's "age-restricted sales" line never names sales
  const titleNames = (r, f) => { const re = (FIELDS.find((x) => x.key === f) || {}).title; return !!re && re.test(String(r.title || '')); };
  const altOk = (r) => (equals.length > 0 && specialty && (test(r.title) || r.bullets.some(test))) || testItems.some((it) => { const f = FIELDS.some((x) => x.title.test(it.text)) ? titleField(it.text) : bareField(it.text); if (f && r.field && r.field !== f && !titleNames(r, f)) return false; return subjectTest([it])(r.title) || subjectTest([it])(String(r.header || '').split(/\s+[—–|]\s+/)[0]) || (r.bullets.length >= 1 && (oneLine ? r.bullets.some(subjectTest([it], { strict: true })) : r.bullets.filter(subjectTest([it], { strict: specialty })).length / r.bullets.length >= 1 / 3)); });
  // a specialty is named by the role's own words whatever field its title sits in ("Project Logistics Coordinator" shows
  // construction logistics) — G5
  // a subject whose head noun is an occupation ("school administration") is met by the roles in that occupation; a subject
  // that is only a setting ("salon experience") by the roles in the posting's own occupation (G6 addendum b)
  const occCode = !specialty && !phraseField && phrase ? subjectOccupation(phrase, ctx.jobTitle) : null;
  const occRole = (r) => !!occCode && !!r.title && (occupationOf(r.title) || {}).code === occCode;
  const named = (r) => (anyText ? textHit(r) : isField(r) || (textHit(r) && (specialty ? specOk(r) : !outside(r)) && altOk(r))) || occRole(r);
  // scope: 'generic' (any work), 'field' (the posting's / a known field's years), 'subject' (a named kind of work)
  const scope = generic ? 'generic' : reqField && (!phrase || phraseField) ? 'field' : 'subject';
  if (generic) {
    // "5+ years of experience": every dated month counts
    const ok = total + 0.25 >= need;
    return finish({ _preferred: !!c._preferred, scope, grade: ok ? 'met' : total >= need * 0.75 ? 'partly' : 'not_shown', computed: total, needed: need, counted: counted(roles.filter((r) => r.months)), caps: !ok && total < need * 0.5 && !profile.undated,
      factor: ok ? 1 : Math.max(0.6, 0.6 + 0.4 * (total / need)),
      sentence: ok ? `You show ${about(total)} of work in all; they ask for ${need}+.` : `They ask for ${need}+ years of experience; the dated jobs on your résumé add up to ${about(total)}.` });
  }
  let what = phrase || (reqField ? fieldLabel(reqField) : 'this work');
  // a bare adjective is said with its noun: "medical" → "medical experience"
  if (/^[a-z-]+(?:al|ic|ical|ive|ary)$/i.test(what)) what = `${what} experience`;
  // "warehouse or similar environment" is a place: "working in a warehouse or similar environment"
  let leadW = lead;
  if ((/\b(?:environment|setting|facility|industry|capacity|atmosphere)s?$/i.test(what) || (phrase && what === phrase && phrase.split(/\s+/).every((w) => SETTING_WORD_RE.test(w)))) && /^(?:of|in)$/.test(lead)) { leadW = 'working in'; if (!/^(?:an?|the)\s/i.test(what) && !/s$/i.test(what)) what = `${/^[aeiou]/i.test(what) ? 'an' : 'a'} ${what}`; }
  const ask = askOf(need, what, leadW);
  // only titled roles are counted, so the figure is the sum of the roles the sentence names
  const hit = profile.yearsWhere((r) => !!r.title && named(r));
  const H = hit.years;
  const dutyRoles = roles.filter((r) => r.title && !named(r) && !outside(r) && !(namesField && r.field && r.field !== reqField) && stems.length && r.bullets.some(test));
  const D = profile.yearsWhere((r) => dutyRoles.includes(r)).years;
  const adjRoles = roles.filter((r) => !named(r) && !dutyRoles.includes(r) && reqField && r.field && areAdjacent(r.field, reqField));
  const A = profile.yearsWhere((r) => adjRoles.includes(r)).years;
  const adjFields = fieldsPhrase(adjRoles.map((r) => fieldLabel(r.field)));
  // roles counted only because they sit in the field (their words never name the subject) are said as the field:
  // a Marketing Coordinator has "6.5 years in marketing", not "6.5 years in brand management"
  const countedWhat = (rs) => (phrase && reqField && rs.length && rs.every((r) => isField(r) && !(test(r.title) || r.bullets.some(test))) ? fieldLabel(reqField) : what);
  const subjectStems = [...new Set(items.flatMap((it) => it.stems).filter((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)))];
  const base = { scope, reqField: reqField || null, subjectStems: subjectStems.length ? subjectStems : undefined, computed: H, needed: need, counted: counted(hit.roles), domain: stems.length ? stems : undefined, lookedFor: items.length ? items.map((x) => x.text) : undefined };
  // the setting the posting names, when no counted role says it: reported, never a zero (G6 addendum b)
  const unstated = settingWords.filter((w) => !hit.roles.some((r) => [r.title, r.header, ...r.bullets].some((l) => new RegExp(`\\b${escapeRegExp(w)}\\b`, 'i').test(String(l || '')))));
  const settingNote = unstated.length && hit.roles.length ? ` Your résumé doesn't say ${joinList(unstated)}.` : '';
  if (H + 0.25 >= need) return finish({ _preferred: !!c._preferred, ...base, ...(settingNote ? { qualifierNotStated: unstated } : {}), grade: 'met', caps: false, factor: 1, sentence: `You show ${H < need ? `close to ${yrs(need)}` : aboutR(H, hit.roles)} ${leadW === 'of' ? 'of ' : `${leadW} `}${countedWhat(hit.roles)} (${roleList(hit.roles)}); they ask for ${need}+.${settingNote}` });
  // the roles next to it are named by their FIELD, never listed as if they were counted (a years sentence lists only
  // roles whose title or bullets contain the subject — G2, F)
  const extra = D > 0 ? ` Your duties as ${roleList(dutyRoles, 1)} include ${what} too — if that work counts, say so plainly in the role.`
    : A > 0 ? ` ${about(A).replace(/^\w/, (x) => x.toUpperCase())} in ${adjFields} sits next to it — make the overlap explicit.` : '';
  if (H > 0) {
    const r = H / need;
    const reach = H + D + A * 0.5;
    // positively short: even every dated month of work would not reach half the ask
    const caps = total < need * 0.5 && !profile.undated;
    // roles of the RIGHT kind, short of the ask: close (≥ NEAR_YEARS_SHARE of it, at least a year) is partly, further off is
    // not shown — the true figure either way (G5, director's corrected rule)
    return finish({ _preferred: !!c._preferred, ...base, grade: H >= need * NEAR_YEARS_SHARE && H >= 1 ? 'partly' : 'not_shown', caps, factor: Math.max(0.55, Math.min(0.97, 0.55 + 0.45 * Math.min(1, reach / need))),
      sentence: caps
        ? `They ask for ${ask}; your résumé shows ${about(H)} of it (${roleList(hit.roles)}), and ${about(total)} of work in all.`
        // ONE shape for an unmet years ask: what you have (and where), then what they ask (G5 CI #4)
        : `Your résumé shows ${aboutR(H, hit.roles)} ${leadW === 'of' ? 'of ' : `${leadW} `}${countedWhat(hit.roles)} (${roleList(hit.roles)}); they ask for ${need}+.${extra}`, shortfall: Number((1 - r).toFixed(2)) });
  }
  if (specialty && reqField) {
    const fyHit = profile.yearsWhere((r) => !!r.title && isFieldRole(r));
    const fy = fyHit.years;
    const spec = joinOr(testItems.map((x) => x.text));
    // years in the field, but no job names the specialty: partly, with the true figure for the field and the specialty
    // said as not shown — never the field's years credited to the specialty, never a zero for the field (G6 addendum a)
    const near = fy > 0 && fy + 0.25 >= need * NEAR_YEARS_SHARE;
    return finish({ _preferred: !!c._preferred, ...base, computed: 0, grade: near ? 'partly' : 'not_shown', caps: false, counted: [], factor: near ? 0.8 : 0.65, specialty: true, ...(fy > 0 ? { fieldYears: Number(fy.toFixed(1)), specialtyOnly: true } : {}),
      sentence: fy > 0 ? `Your résumé shows ${aboutR(fy, fyHit.roles)} in ${fieldLabel(reqField)} (${roleList(fyHit.roles)}), but no job on it names ${spec}; they ask for ${ask}.` : `They ask for ${ask}; no job on your résumé mentions ${spec}.` });
  }
  if (D > 0) {
    return finish({ _preferred: !!c._preferred, ...base, grade: 'not_shown', caps: false, counted: counted(dutyRoles), factor: 0.8,
      sentence: `No job title on your résumé names ${what}, but your duties as ${roleList(dutyRoles, 1)} include it; they ask for ${ask}. Make that work explicit in the role.` });
  }
  if (A > 0) {
    // the field next to it counts at half: plenty of it (an electrician's 9 years against "5+ years of maintenance")
    // costs little, a short stint costs more
    return finish({ _preferred: !!c._preferred, ...base, grade: 'not_shown', caps: false, counted: [], nearest: { field: adjFields, years: A }, factor: Math.round((0.7 + 0.2 * Math.min(1, (A * 0.5) / need)) * 100) / 100,
      sentence: `They ask for ${ask}; no job on your résumé is ${what}, and the nearest is ${about(A)} of ${adjFields}. Make the overlap explicit if the work was the same.` });
  }
  // nothing names the subject, but the person has worked in the posting's own field long enough: the subject is
  // something the résumé's words cannot confirm either way ("technical products", "children and adolescent patients"), so
  // it is asked, not failed — and no role is listed as if it had been counted
  const fieldYears = jobField ? profile.yearsWhere((r) => r.field === jobField).years : 0;
  if (fieldYears >= need * 0.75 && fieldYears > 0) {
    const looked = items.length ? joinList(items.map((x) => x.text)) : what;
    return finish({ _preferred: !!c._preferred, ...base, computed: 0, grade: 'cannot_tell', caps: false, counted: [], factor: 0.88,
      sentence: `They ask for ${ask}; your ${about(fieldYears)} in ${fieldLabel(jobField)} may cover it, but no job on your résumé mentions ${looked}. If one did, say so in that job.` });
  }
  // nothing names the work: it caps only when the résumé positively shows other work (every dated month is placed in
  // another field) or the whole history is too short
  const fields = [...new Set(roles.filter((r) => r.field && r.months).map((r) => fieldLabel(r.field)))];
  const allPlaced = roles.length > 0 && roles.every((r) => !r.months || r.field) && !profile.undated;
  const caps = (total < need * 0.5 && !profile.undated) || (allPlaced && !!reqField && fields.length > 0);
  return finish({ _preferred: !!c._preferred, ...base, computed: 0, counted: [], grade: 'not_shown', caps, factor: 0.65,
    sentence: caps && fields.length && total >= need * 0.5
      ? `They ask for ${ask}; your ${Math.round(total)} years of work are in ${fieldsPhrase(fields)}.`
      : caps ? `They ask for ${ask}; the dated jobs on your résumé add up to ${about(total)} in all.`
        : roles.some((r) => r.months) && roles.every((r) => !r.months || outside(r))
          // every dated job is in a known, unrelated field: say it plainly, never "if one of your jobs involved it"
          ? `Your résumé shows no ${what}; they ask for ${need}+ ${Number(need) === 1 ? 'year' : 'years'}.`
          : `They ask for ${ask}; no job on your résumé names that work. If one of your jobs involved it, say so in that job.` });
}
/** "electrical and warehouse work" — field labels in a sentence, a shared trailing "work" said once. */
function fieldsPhrase(labels) {
  const ls = [...new Set(labels.filter(Boolean))].slice(0, 2);
  if (ls.length === 2 && / work$/.test(ls[0]) && / work$/.test(ls[1])) return `${ls[0].replace(/ work$/, '')} and ${ls[1]}`;
  return joinList(ls);
}
function joinOr(items) { return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`; }
function joinList(items) { return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`; }

const RUNG_RE = /\b(?:lead|senior|sr\.?|II|III|IV|chief|head|master|journey(?:man)?)\b/i;
const PEOPLE_TITLE_RE = /\b(?:manager|supervisor|director|superintendent|foreman|forewoman|chief\s+of|head\s+of|vp|vice\s+president)\b/i;
/** A posting title that is a lead / senior rung of an occupation the person works in (lib/occupations, exact / close):
 *  the roles in it, their years, and whether one of them is already at a senior rung. Null otherwise. */
function ownTradeStep(jobTitle, profile) {
  const t = String(jobTitle || '').replace(/\s*[(\-–—|].*$/, '').trim();
  if (!t || !RUNG_RE.test(t) || PEOPLE_TITLE_RE.test(t) || !hasOccupationData()) return null;
  const po = occupationOf(t);
  if (!po || po.confidence === 'guess') return null;
  const roles = (profile.roles || []).filter((r) => { if (!r.title) return false; const o = occupationOf(r.title); return !!o && o.confidence !== 'guess' && o.code === po.code; });
  if (!roles.length) return null;
  return { title: t, roles, years: profile.yearsWhere((r) => roles.includes(r)).years, senior: roles.some((r) => RUNG_RE.test(r.title) && !/\bapprentice\b/i.test(r.title)) };
}
function gradeManagement(c, ctx) {
  const { profile } = ctx;
  const need = c.kind === 'years' ? Number(c.value) : null;
  const M = profile.management.years;
  const mRoles = profile.management.roles;
  const duty = profile.management.dutyRoles;
  const total = profile.totalYears || ctx.totalY || 0;
  const what = 'managing people';
  const sub = subCondition(c);
  const base = { computed: M, needed: need, counted: counted(mRoles.length ? mRoles : duty) };
  const lead = (roles) => roleList(roles);
  let row, step;
  if (M > 0 && (need == null || M + 0.25 >= need)) {
    row = { grade: 'met', caps: false, factor: 1, sentence: need ? `You show ${about(M)} ${what} (${lead(mRoles)}); they ask for ${need}+.` : `Your résumé shows you leading people (${lead(mRoles)}).` };
  } else if (c.kind === 'seniority' && (step = ownTradeStep(ctx.jobTitle, profile))) {
    // a lead / senior rung of the person's own occupation is a level step, not years of managing people (G7, matcher 7)
    row = { grade: step.senior ? 'met' : 'partly', caps: false, factor: step.senior ? 1 : step.years >= 3 ? 0.92 : 0.8, counted: counted(step.roles),
      sentence: step.senior ? `You already work at a senior level in this trade (${lead(step.roles)}); ${step.title} is the same line of work.`
        : `${step.title} is a step up in your own line of work, not a people-manager job; you show ${aboutR(step.years, step.roles)} in it (${lead(step.roles)}).` };
  } else if (M > 0) {
    const caps = total < need * 0.75 && !profile.undated;
    row = { grade: 'partly', caps, factor: Math.max(0.6, Math.min(0.95, 0.6 + 0.4 * (M / need))), sentence: `Your résumé shows ${about(M)} ${what} (${lead(mRoles)}); they ask for ${need}+.` };
  } else if (duty.length) {
    const line = String(duty[0].mgmt.duty[0] || '').replace(/^[\s•\-*·–]+/, '').replace(/[.;]\s*$/, '');
    // lead duties are real, but a whole work history shorter than the years of managing asked for cannot meet it
    // lead duties stand in for a year or two of managing; against several years of it they are a long way short
    row = { grade: 'partly', caps: (need != null && total + 0.25 < need && !profile.undated) || (c.kind === 'seniority' && Number(c.value) >= 5), factor: need != null && need >= 3 ? 0.6 : 0.75, counted: counted(duty),
      sentence: `Your résumé shows lead duties ("${line.length > 70 ? `${line.slice(0, 67).replace(/\s+\S*$/, '')}…` : line}") but no role where you managed people${need ? `; they ask for ${need}+ years of it` : ''}. If you supervised anyone, say how many and for how long.` };
  } else if (c.kind === 'seniority' && /\b(?:staff|principal|senior|sr\.?|lead)\s+(?:\w+\s+){0,2}(?:engineer|developer|scientist|architect|analyst|designer|researcher)\b/i.test(String(ctx.jobTitle || '')) && !/\b(?:manager|director|head)\b/i.test(String(ctx.jobTitle || ''))) {
    // a staff / principal individual contributor: a level (judged by the level rule), not a team to run (G5)
    row = { grade: 'cannot_tell', caps: false, factor: 1, sentence: `This is a ${String(ctx.jobTitle).replace(/\s*[-–—|(].*$/, '').trim()} role — a senior individual-contributor level, not a people-manager one.` };
  } else if (c.kind === 'seniority' && NOT_PEOPLE_MANAGER_TITLE_RE.test(String(ctx.jobTitle || ''))) {
    // "Account Manager", "Product Manager": a level in the title, not a team to run
    row = { grade: 'cannot_tell', caps: false, factor: 1, sentence: `The title says ${String(c.label || 'manager-level').replace(/^an?\s+/i, '')}, but this job manages accounts or work, not people.` };
  } else if (c.kind === 'seniority') {
    // a director-level role needs someone who has run people; a manager-level title alone does not prove the level
    row = { grade: 'not_shown', caps: Number(c.value) >= 5, factor: 0.75, sentence: `This is a ${String(c.label || 'management-level role').replace(/^an?\s+/i, '')}; no role or line on your résumé shows you leading people. If you have, add it.` };
  } else {
    // only a stated number of years managing caps: a "management experience" line with no figure lowers the score
    row = { grade: 'not_shown', caps: need != null, factor: 0.6, sentence: need ? `They ask for ${need}+ years ${what}; your résumé shows ${about(total)} of work and no role or duty leading others.` : `They ask for experience ${what}; no role or line on your résumé shows you leading others.` };
  }
  if (sub && row.grade === 'met') {
    const sNeed = sub.years;
    const sLead = /\b(?:senior|lead|manag|supervis|principal|staff)/i.test(sub.of);
    const S = sLead ? profile.yearsWhere((r) => r.mgmt.strong || /\b(?:senior|sr\.?|lead|principal|staff|manager)\b/i.test(r.title || '')).years : M;
    if (S + 0.25 < sNeed) row = { ...row, grade: 'partly', factor: Math.min(row.factor, 0.85), sentence: `${row.sentence.replace(/\.$/, '')}; they also ask for ${sNeed} of those years ${sub.of}, and your résumé shows ${about(S)}.` };
  }
  return finish({ _preferred: !!c._preferred, ...base, ...(need != null ? { scope: 'management' } : {}), ...row });
}
// "10+ years …, with at least 4 in a senior or lead capacity": { years: 4, of: 'in a senior or lead capacity' }
function subCondition(c) {
  const sub = c.sub;
  if (!sub) return null;
  if (Array.isArray(sub)) { const x = sub[0]; return x && x.min ? { years: Number(x.min), of: String(x.text || '').replace(/^\d+\+?\s*(?:years?|yrs?)\s*/i, '') } : null; }
  return sub.years ? { years: Number(sub.years), of: String(sub.of || '') } : null;
}
function finish(row) {
  if (row && row._preferred) {
    // a preferred requirement can lower the score a little; it never caps it or sinks it
    row = { ...row, caps: false, factor: 1 - (1 - (Number.isFinite(row.factor) ? row.factor : 1)) * 0.3 };
  }
  // a partial showing under half the ask is still a real gap (status unmet) — it just does not cap the score
  const short = row.needed ? (Number(row.computed) || 0) / row.needed < 0.5 : false;
  const status = row.grade === 'met' ? 'met' : row.grade === 'cannot_tell' ? 'ask' : row.grade === 'partly' && !row.caps && !short ? 'ask' : 'unmet';
  const { _preferred, ...clean } = row;
  void _preferred;
  return { ...clean, status, message: row.sentence, statementStatus: STATEMENT_STATUS[row.grade] || 'cannot_tell' };
}
// how a graded constraint reads as a statement status (statements.js speaks in shown / partly / not_shown / cannot_tell)
const STATEMENT_STATUS = { met: 'shown', partly: 'partly', not_shown: 'not_shown', cannot_tell: 'cannot_tell' };
// The licenses a job TURNS ON: not having one is a positive "not met" for a person outside that field.
const OCCUPATION_LICENCE_RE = /\b(?:real\s+estate\s+licen\w*|insurance\s+(?:producer\s+)?licen\w*|cosmetology\s+licen\w*|RN|registered\s+nurse|LPN|LVN|nursing\s+licen|journeyman|master\s+electrician|electrical\s+licen|CDL|commercial\s+driver|CPA|certified\s+public\s+accountant|teaching\s+licen|teacher\s+certif|pharmacist|physician|medical\s+licen|bar\s+(?:admission|licen)|admitted\s+to\s+(?:the|practice)|licensed\s+(?:clinical|professional|practical|vocational|electrician|plumber|social)|PE\s+licen|professional\s+engineer|dental\s+hygien|LCSW|LPC|LMFT|BCBA|NP\b|nurse\s+practitioner|CRNA)\b/i;
// Fields whose job IS a license: the title names the licensed role, so the license is required whether or not the posting
// spells it out. Held = the résumé names it anywhere.
const LICENSED_TITLES = [
  { field: 'nursing', title: /\b(?:registered\s+nurse|RN|LPN|LVN|licensed\s+(?:practical|vocational)\s+nurse|nurse\s+practitioner)\b/i, held: /\b(?:RN|LPN|LVN|registered\s+nurse|licensed\s+(?:practical|vocational)\s+nurse|NP|APRN|nursing\s+licen[sc]e)\b/, label: 'a nursing license (RN or LPN)' },
  { field: 'electrical', title: /\b(?:journeyman|master\s+electrician|licensed\s+electrician)\b/i, held: /\b(?:journeyman|master\s+electrician|electrical\s+licen[sc]e|licensed\s+electrician)\b/i, label: 'a journeyman electrician license' },
];
function occupationLicense(jobField, jobTitle, jobText, resumeText, rows) {
  const spec = LICENSED_TITLES.find((x) => x.field === jobField && x.title.test(String(jobTitle || '')));
  if (!spec || spec.held.test(withoutInProgress(resumeText))) return null;
  if (rows.some((r) => r.kind === 'certification' && /licen|\bRN\b|LPN|journeyman|master/i.test(String(r.label || '')))) return null;
  const quote = (String(jobText || '').match(/[^.\n]{0,160}\blicen[sc]\w*[^.\n]{0,120}/i) || [String(jobTitle || '')])[0].trim();
  const sentence = `This job requires ${spec.label}; your résumé does not list one.`;
  return { kind: 'certification', label: spec.label, gate: true, importance: 'required', evidence: quote, posting_quote: quote, statementId: null, items: null, status: 'unmet', message: sentence, implied: true };
}

/** Grade fields for the rows the switch above judged by status (degree, certification, language, schedule, …). */
function gradeOther(row, ctx) {
  const { profile, jobField } = ctx;
  if (row.kind === 'degree') {
    if (row.status === 'met') return { grade: 'met', caps: false, factor: 1, sentence: row.message };
    if (row.status === 'ask') return { grade: 'cannot_tell', caps: false, factor: 0.97, sentence: row.message };
    const eduSection = /\n\s*(?:education|academic)/i.test(`\n${ctx.text}`);
    const want = Number(row.value) || 0;  // the lowest degree any alternative accepts (the constraint's value)
    const have = ctx.degreeRank || 0;
    const equivalent = /equivalent/i.test(String(row.label || ''));
    if (!eduSection && !have) return { grade: 'cannot_tell', caps: false, factor: 0.9, status: 'ask', sentence: `${row.message.replace(/\.$/, '')}. If you have schooling, add an education section.`, message: `${row.message.replace(/\.$/, '')}. If you have schooling, add an education section.` };
    const gap = want - have;
    if (gap <= 0) {
      // the degree is met; the years it is paired with ("Bachelor's + 6 years of management") are judged by the years row
      const sentence = `Your ${(ctx.edu && ctx.edu.rank >= have && ctx.edu.own) || String(DEGREE_LABEL[have] || 'education').replace(/^(?:an?|the)\s+/i, '')} meets the education part of this requirement; the years it pairs with are judged on their own.`;
      return { grade: 'partly', caps: false, factor: 1, status: 'met', sentence, message: sentence };
    }
    // a listed degree below the one required (no "or equivalent") is a positive "not met": an ATS knock-out question
    const caps = gap >= 1 && !equivalent && !!row.gate && (have > 0 || eduSection);
    return { grade: caps || gap >= 2 ? 'not_shown' : 'partly', caps, factor: gap >= 2 ? 0.7 : 0.85, sentence: row.message };
  }
  if (row.kind === 'certification') {
    if (row.status === 'met') return { grade: 'met', caps: false, factor: 1, sentence: row.message };
    if (row.state && row.resumeStates && row.resumeStates.length) {
      // the license is held in another state: a real, specific gate when the posting requires it (an Arizona
      // journeyman license is not a Texas one); a compact / "or eligible" ask is a question
      // G3: the same license from another state is a real gap (a new exam or a transfer), not a positive "not met" of the
      // trade — it lowers the score, it does not cap it
      // G7: a licence for another jurisdiction than the one the posting names is not the licence asked for — not shown
      // (a compact / "or eligible" ask stays a question); it lowers the score, it does not cap it
      return row.status === 'unmet' ? { grade: 'not_shown', caps: false, factor: 0.6, sentence: row.message } : { grade: 'cannot_tell', caps: false, factor: 0.9, sentence: row.message };
    }
    // a license the posting says is required (status 'ask' only because the reader did not mark the line a gate)
    const requiredLicense = row.status === 'ask' && !row.prospective && OCCUPATION_LICENCE_RE.test(String(row.label || '')) && /\b(?:required|must)\b/i.test(String(row.posting_quote || '')) && !CREDENTIAL_OPTIONAL_RE.test(String(row.posting_quote || '')) && !CREDENTIAL_PROSPECTIVE_RE.test(String(row.posting_quote || ''));
    if (row.status === 'ask' && row.namedMissing && !requiredLicense) return { grade: 'not_shown', caps: false, factor: 0.9, sentence: row.message };
    if (row.status === 'ask' && !requiredLicense) return { grade: 'cannot_tell', caps: false, factor: row.gate ? 0.93 : 1, sentence: row.message };
    // unmet: an occupation license held by someone outside the field caps; anything else is a gap to answer
    // …or the credential the posting's own TITLE names ("Certified Patient Care Assistant CNA LNA")
    const marks = String(row.label || '').match(/\b[A-Z]{2,6}\b/g) || [];
    const inTitle = marks.some((mk) => new RegExp(`(?<![A-Za-z])${escapeRegExp(mk)}(?![A-Za-z])`).test(String(ctx.jobTitle || '')));
    const occupational = (OCCUPATION_LICENCE_RE.test(`${row.label || ''} ${row.posting_quote || ''}`.slice(0, 300)) && OCCUPATION_LICENCE_RE.test(String(row.label || ''))) || inTitle;
    // the person's own job title implies the license (a Registered Nurse holds an RN license; an electrician's journeyman
    // card) — being in the same broad field does not (a SaaS account executive holds no real estate license)
    const IMPLIES = [[/\bRN\b|nurs/i, /\bnurse\b|\bRN\b/i], [/journeyman|master\s+electrician|electrical\s+licen/i, /electrician/i], [/teach/i, /teacher/i], [/\bCPA\b|public\s+accountant/i, /\bCPA\b/]];
    const inField = profile.roles.some((r) => IMPLIES.some(([lab, title]) => lab.test(String(row.label || '')) && title.test(String(r.title || r.header || ''))));
    if (requiredLicense) { const m = `This job requires ${String(row.label).replace(/^an?\s+/i, 'a ')}; your résumé does not list one.`; return inField ? { grade: 'cannot_tell', caps: false, factor: 0.85, status: 'ask', sentence: row.message } : { grade: 'not_shown', caps: true, factor: 0.5, status: 'unmet', sentence: m, message: m }; }
    // a certificate the posting's title names (CNA) is earned by training inside the field: someone already in it is
    // asked, not capped
    const sameField = !!jobField && profile.roles.some((r) => r.field === jobField || (r.field && areAdjacent(r.field, jobField)));
    if (occupational && !inField && !(inTitle && !OCCUPATION_LICENCE_RE.test(String(row.label || '')) && sameField)) return { grade: 'not_shown', caps: true, factor: 0.5, sentence: row.message };
    return { grade: 'not_shown', caps: false, factor: occupational ? 0.75 : 0.9, sentence: inField && occupational ? `${row.message.replace(/\.$/, '')} — add it if you hold it.` : row.message };
  }
  if (row.kind === 'language') {
    if (row.status === 'met') return { grade: 'met', caps: false, factor: 1, sentence: row.message };
    if (row.status === 'partial') return { grade: 'partly', caps: false, factor: 0.8, sentence: row.message };
    // a language the job is done in (required) that the résumé never mentions weighs heavily, but it is not proof
    return { grade: 'cannot_tell', caps: false, factor: row.importance === 'required' && /\b(?:must|fluent|fluently|bilingual|required)\b/i.test(String(row.posting_quote || '')) ? 0.45 : 0.95, sentence: row.message };
  }
  if (row.conflict) return { grade: 'not_shown', caps: false, factor: 0.9, sentence: row.message };
  return { grade: row.status === 'met' ? 'met' : 'cannot_tell', caps: false, factor: 1, sentence: row.message };
}

/** The score effect of the graded constraints: a cap (GATE_CAP) when any capping gate fails, and the product of factors. */
export function constraintEffect(evaluated) {
  const rows = evaluated || [];
  const capping = failedGates(rows);
  // the weakest gap counts in full; each further gap adds less (two partial gates are not twice as damning as one)
  const fs = rows.filter((c) => !c.caps).map((c) => (Number.isFinite(c.factor) ? c.factor : 1)).filter((f) => f < 1).sort((a, b) => a - b);
  const factor = fs.length ? fs[0] * fs.slice(1).reduce((p, f) => p * Math.pow(f, 0.4), 1) : 1;
  return { cap: capping.length ? GATE_CAP : null, factor: Math.max(0.35, factor), capping };
}
