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
import { roleField, titleField, fieldLabel, areAdjacent, postingField } from './fieldMatch.js';
import { vocabularyAliases } from './hourlyVocabulary.js';
import { tokenize } from './lemma.js';

// How a credential reads in a sentence: a bare acronym is a certification ("CPR certification", not "a CPR").
function credentialName(label) {
  const l = String(label || '').trim();
  return /^(?:CPR|BLS|ACLS|PALS|NRP|TNCC|NIHSS|OSHA\s*\d+|EPA\s*608)$/i.test(l) ? `${l} certification` : l;
}
// The US states a résumé's licence lines name ("Arizona Journeyman Electrician", "RN — Michigan", "AZ RN #12345").
// The résumé's own name for the licence on its licence line ("Arizona Journeyman Electrician" → "Journeyman Electrician").
function licenceWords(resumeText, value) {
  const re = /journeyman|master/i.test(value) ? /\b((?:journeyman|master)(?:\s+electrician|\s+plumber)?)\b/i : /\b(RN|registered\s+nurse|LPN|LVN)\b/i;
  for (const line of String(resumeText || '').split(/\n/)) { const m = line.match(re); if (m && /licen|journeyman|master|\bRN\b|#/i.test(line)) return m[1].replace(/^\w/, (c) => c.toUpperCase()); }
  return '';
}
function licenceStates(resumeText, value) {
  const kindWord = /journeyman|master|electric/i.test(value) ? /journeyman|master|electrician|electrical/i : /\brn\b|nurs/i.test(value) ? /\bRN\b|nurs|licen/i : /licen/i;
  const states = new Set();
  for (const line of String(resumeText || '').split(/\n/)) {
    if (!kindWord.test(line) || !/licen|journeyman|master|\bRN\b|certif/i.test(line)) continue;
    for (const st of US_STATES) if (new RegExp(`\\b${st}\\b`).test(line)) states.add(st);
    for (const [ab, st] of Object.entries(STATE_ABBR)) if (new RegExp(`(?<![A-Za-z])${ab}(?![A-Za-z])`).test(line) && /licen|journeyman|\bRN\b|#/i.test(line)) states.add(st);
  }
  return [...states];
}
// college attended (a degree, coursework, an enrolment) implies the high-school diploma a posting asks for
const COLLEGE_RE = /\b(?:college|university|community\s+college|coursework|credits?\s+toward|associate'?s?|bachelor'?s?|a\.a\.s?\.?|b\.s\.|b\.a\.)\b/i;

export const GATE_CAP = 35;
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
// Does the résumé hold a licence/certification? By the posting's own words, a synonym, or the
// credential's acronym/number ("RN" for "RN license" — "Rebecca Thornton, BSN, RN"; "EPA" + "608" for
// "EPA 608 Universal" — "EPA Section 608 Universal"). An acronym next to "exam", "candidate" or
// "pursuing" is a credential in progress, not held ("sitting for the CPA exam").
const CERT_SYNONYMS = [
  [/\brn\b|registered\s+nurse/i, [/\bRN\b/, /\bregistered\s+nurse\b/i]],
  // ServSafe Manager (a food protection manager certificate) is a higher credential: a Food Handler card
  // does not meet it, while a manager certificate does meet a food-handler ask.
  [/servsafe\s+manager|food\s+(?:protection|safety)\s+manager|\bcfpm\b/i, [/\bservsafe\s+manager/i, /\bfood\s+(?:protection|safety)\s+manager/i, /\bCFPM\b/]],
  [/food\s+handler|servsafe(?!\s+manager)/i, [/\bfood\s+handler/i, /\bservsafe\b/i, /\bfood\s+(?:safety\s+)?manager\s+certif/i]],
  [/forklift/i, [/forklift[^.\n]{0,40}certif/i, /certified[^.\n]{0,20}forklift/i, /forklift[^.\n]{0,15}licen[sc]e/i]],
  [/teaching\s+licen|teacher\s+certif/i, [/teaching\s+licen[sc]/i, /teacher\s+(?:licen[sc]|certif)/i, /licensed\s+teacher/i, /initial\s+professional\s+licen[sc]e/i]],
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
  const ctx = { text, profile, jobField, jobTitle, totalY: profile.totalYears || totalY, now, degreeRank: deg };

  for (const c of jobFacts.filter((f) => f.factType === 'constraint')) {
    // posting_quote: the posting's own sentence a gate stands on — no hard gate is ever shown without one
    const base = { kind: c.kind, label: c.label, gate: !!c.gate, importance: c.importance, evidence: c.evidence || '', posting_quote: c.evidence || '', statementId: c.statementId || null, items: c.items || null, value: c.value ?? null };
    switch (c.kind) {
      case 'degree': {
        const alts = c.alternatives && c.alternatives.length ? c.alternatives : [{ degree: c.value, years: 0, management: false }];
        // met when ANY alternative is met (degree AND its years, when the alternative names years)
        const metAlt = alts.find((a) => (!a.degree || deg >= a.degree) && (!a.years || (a.management ? mgmtY : totalY) >= a.years));
        const degreeOk = alts.some((a) => !a.degree || deg >= a.degree);
        let status = metAlt ? 'met' : 'unmet';
        let message;
        if (status === 'met' && c.gpa) {
          status = gpaFact ? (gpaFact.value >= c.gpa ? 'met' : 'unmet') : 'ask';
          const g = Number(c.gpa).toFixed(1);
          message = gpaFact ? `GPA ${gpaFact.value} against a ${g} minimum.` : `The posting asks for a ${g}+ GPA — your résumé does not list one. Add it only if it is ${g} or higher.`;
        } else if (status === 'unmet') {
          const need = DEGREE_LABEL[Math.min(...alts.filter((a) => a.degree).map((a) => a.degree))] || 'a degree';
          message = degreeOk
            ? `Requires ${c.label}; your résumé shows ${(alts[0].management ? mgmtY : totalY) ? `${fmtYears(alts[0].management ? mgmtY : totalY)} of` : 'no'} ${alts[0].management ? 'supervisory ' : ''}experience.`
            : `Requires ${alts.some((a) => a.years) ? c.label : `${need}${c.gpa ? ` (GPA ${Number(c.gpa).toFixed(1)}+)` : ''}`}; your résumé lists ${deg ? DEGREE_LABEL[deg] : 'no degree'}${alts.some((a) => a.management) ? ` and ${mgmtY ? fmtYears(mgmtY) + ' of' : 'no'} supervisory experience` : ''}.`;
        } else message = `Your ${String(DEGREE_LABEL[deg] || 'education').replace(/^(?:an?|the)\s+/i, '')} meets the education requirement.`;
        out.push({ ...base, status, message });
        break;
      }
      case 'years': {
        // a figure no job asks for is the company's history ("BAYADA is celebrating 50 years"), never a requirement
        if (!(Number(c.value) > 0) || Number(c.value) > 25) break;
        // a "management" flag on a sentence whose object is a thing ("infrastructure management or backend software
        // development") is a years-in-field requirement, not people management
        const ph = domainPhrase(c);
        const people = c.management && (!ph || ph === 'managing people' || peopleManagement(c.sentence || c.evidence || ph));
        const pref = c.importance && c.importance !== 'required';
        out.push({ ...base, ...(people ? gradeManagement({ ...c, _preferred: pref }, ctx) : gradeYears({ ...c, management: false, _preferred: pref }, ctx)) });
        break;
      }
      case 'management':
      case 'seniority': {
        out.push({ ...base, ...gradeManagement({ ...c, _preferred: c.importance && c.importance !== 'required' }, ctx) });
        break;
      }
      case 'certification': {
        const sure = withoutInProgress(text);
        const coreValue = String(c.value || '').replace(new RegExp(`^(?:${US_STATES.join('|')})\\s+`, 'i'), '');
        const held = hasStemmed(sure, coreValue) || !!credentialHeld(sure, coreValue || c.label) || certHeld(text, coreValue, c.label)
          || (/journeyman|master/i.test(coreValue) && /\bjourneyman\b|\bmaster\s+electrician\b/i.test(sure) && (!/master/i.test(coreValue) || /journeyman/i.test(coreValue)));
        const name = credentialName(c.label);
        // a licence the posting ties to a state is compared with the state on the résumé's licence line: "Texas
        // Journeyman required — your résumé shows an Arizona Journeyman licence" is a real, specific gate
        if (held && c.state) {
          const states = licenceStates(text, coreValue);
          if (states.length && !states.includes(c.state)) {
            const status = c.compact ? 'ask' : (c.gate ? 'unmet' : 'ask');
            out.push({ ...base, status, state: c.state, resumeStates: states, message: status === 'unmet'
              ? `Requires ${article(name)}${name}; your résumé shows ${states.length === 1 ? `${article(states[0]).trim()} ${states[0]}` : states.join(' / ')}${licenceWords(text, coreValue) ? ` ${licenceWords(text, coreValue)}` : ''} licence.`
              : `The posting asks for ${article(name)}${name}${c.compact ? ' (a compact licence may count)' : ''}; your résumé shows ${states.join(' / ')}. Say whether you hold or can transfer it.` });
            break;
          }
          if (!states.length) {
            out.push({ ...base, status: 'ask', state: c.state, message: `The posting asks for ${article(name)}${name}. Your résumé does not say which state your licence is from — add the state if it is ${c.state}.` });
            break;
          }
        }
        const status = held ? 'met' : (c.gate ? 'unmet' : 'ask');
        out.push({ ...base, status, message: status === 'met' ? `Your résumé lists ${name}.`
          : status === 'unmet' ? `Requires ${article(name)}${name}; your résumé does not list it.`
          : `The posting asks for ${name}. Do you have it? Add it under Certifications only if you do.` });
        break;
      }
      case 'language': {
        const want = String(c.value || '').toLowerCase();
        // "bilingual English/Spanish" is met by a résumé that names every non-English language it
        // asks for ("Bilingual English/Spanish" on Maria's résumé read as "ask", 2026-10-25).
        const LANGS = /\b(spanish|french|german|mandarin|chinese|cantonese|japanese|korean|vietnamese|tagalog|arabic|russian|portuguese|italian|hindi|punjabi|urdu|polish|haitian creole|creole|asl|american sign language|somali|farsi|persian|hmong)\b/gi;
        const asked = [...new Set([...`${c.label || ''} ${want}`.matchAll(LANGS)].map((m) => m[1].toLowerCase()))];
        let status = want === 'english' && !asked.length ? 'met'
          : (asked.length ? asked.every((l) => new RegExp(`(?<![a-z])${escapeRegExp(l)}(?![a-z])`, 'i').test(text)) : hasStemmed(text, want)) ? 'met' : 'ask';
        // "Spanish (conversational)" is not bilingual (round 9): a posting that asks for bilingual or
        // fluent is met only by a résumé that says so
        const level = asked.length ? (text.match(new RegExp(`[^\\n,;•]{0,24}(?<![a-z])${escapeRegExp(asked[0])}(?![a-z])[^\\n,;•]{0,24}`, 'i')) || [''])[0] : '';
        const weak = /\b(?:conversational|basic|beginner|some|elementary|limited|learning)\b/i.test(level);
        if (status === 'met' && weak && /\b(?:bilingual|fluent|fluency|native)\b/i.test(`${c.label} ${want}`)) status = 'partial';
        out.push({ ...base, gate: false, status, message: status === 'met' ? `Your résumé mentions ${want === 'english' ? 'English' : c.label}.`
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
  // the licence a job turns on, when the posting's own reading did not list it ("A current nursing license in good standing")
  const lic = occupationLicence(jobField, jobTitle, jobText, text, out);
  if (lic) out.push(lic);
  for (const row of out) if (!row.grade) {
    const g = gradeOther(row, ctx);
    if (row.importance && row.importance !== 'required') { g.caps = false; g.factor = 1 - (1 - (Number.isFinite(g.factor) ? g.factor : 1)) * 0.3; }
    Object.assign(row, g, { statementStatus: STATEMENT_STATUS[g.grade] || 'cannot_tell' });
  }
  // One row per message: a posting that states the same requirement twice (a summary line and a
  // bullet) showed it twice in one list (Maria, round 3). The first row keeps its place and gate.
  const seen = new Set();
  return out.filter((c) => { const k = `${c.kind}|${c.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The unmet hard gates, most decisive first (credential/years/seniority before the rest). */
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
function about(y) { const r = round1(y); return r < 1 ? 'under a year' : r < 2 ? yrs(r) : `about ${Math.round(r)} years`; }
function roleList(roles, max = 2) {
  const named = roles.filter((r) => r.title || r.header).slice(0, max).map((r) => `${r.title || String(r.header).split(/\s+[—–|]\s+/)[0]}${r.span ? `, ${r.span}` : ''}`);
  return named.join('; ');
}
const counted = (roles) => roles.slice(0, 6).map((r) => ({ title: r.title || null, span: r.span || null, years: r.years }));
// Stems that name no work on their own ("control" in "inventory control", "high-volume", "fast-paced").
const WEAK_DOMAIN = new Set(['control', 'manag', 'management', 'servic', 'service', 'support', 'system', 'process', 'technic', 'technical', 'general', 'team', 'high', 'volum', 'volume', 'fast', 'pace', 'paced', 'base', 'based', 'hand', 'squar', 'square', 'foot', 'feet', 'environ', 'center', 'centr', 'large', 'larg', 'small', 'busi', 'busy', 'complex', 'complex', 'commerci', 'commercial', 'oper', 'operat', 'operations', 'role', 'lead', 'senior', 'similar', 'divers', 'multi', 'site', 'fulli', 'new', 'client', 'facing', 'face', 'enterpris', 'like']);
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
function domainTest(stems) {
  const specific = stems.filter((x) => !WEAK_DOMAIN.has(x));
  const phrases = [];
  if (stems.length) {
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
    const hits = specific.filter((x) => have.has(x)).length;
    return (head && have.has(head)) || hits >= Math.min(2, specific.length) || phrases.some((v) => v.every((x) => have.has(x)));
  };
}
/** The posting's object of a years requirement, as words a person would say ("inventory control", "SaaS sales"). */
function domainPhrase(c) {
  let raw = String(c.field || yearsDomainClause(c.sentence || c.evidence || '') || '').trim();
  raw = raw.replace(/^(?:experience\s+(?:in|with|as|doing)\s+)?(?:an?\s+|the\s+)?/i, '').replace(/\s+experience$/i, '');
  raw = raw.replace(/^(?:(?:proven|demonstrated|working|strong|solid|deep|hands-on|direct|prior|relevant|professional|progressive)\s+)*(?:knowledge|understanding|familiarity|experience|expertise|proficiency)\s+(?:of|with|in)\s+/i, '');
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
  if (!yearsDomain(`5 years of ${phrase} experience`).stems.length || /^(?:job[- ]related|related|relevant|similar|applicable|comparable)$/i.test(phrase)) return '';
  return phrase;
}

// "infrastructure management", "inventory management": managing a thing, not people
const THING_MANAGEMENT_RE = /\b(?:infrastructure|project|program|inventory|property|account|product|data|risk|case|change|configuration|vendor|supply\s+chain|asset|records?|document|content|campaign|category|revenue|portfolio|knowledge|release|incident|quality|time|stakeholder|relationship|systems?|database|cloud|network|fleet|facilit(?:y|ies)|event|budget|contract|pipeline|territory|client|customer)\s+management\b/gi;
const peopleManagement = (phrase) => LEAD_PHRASE_RE.test(String(phrase || '').replace(THING_MANAGEMENT_RE, ' '));
const LEAD_PHRASE_RE = /\b(?:leadership|leading|lead\s+role|supervis\w*|managing\s+(?:people|a\s+team|teams|staff|employees)|people\s+management|management)\b/i;
function gradeYears(c, ctx) {
  const need = Number(c.value);
  const { profile, jobField, now } = ctx;
  void now;
  const phrase = domainPhrase(c);
  // "4+ years of experience in a leadership role within a Shipping Operations environment" is people management first
  if (phrase && phrase !== 'managing people' && peopleManagement(phrase)) {
    const row = gradeManagement({ ...c, kind: 'years' }, ctx);
    const rest = phrase.replace(LEAD_PHRASE_RE, ' ').replace(/\b(?:role|roles|position|capacity|experience|within|in|an?|the|of|environment|setting)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const st = rest ? yearsDomain(`${need} years of ${rest} experience`).stems.filter((x) => !WEAK_DOMAIN.has(x)) : [];
    if (row.grade === 'met' && st.length) {
      const test = domainTest(st);
      const where = profile.management.roles.filter((r) => test(r.title) || test(r.header) || r.bullets.some(test));
      if (!where.length) {
        const fields = [...new Set(profile.management.roles.map((r) => fieldLabel(r.field)).filter(Boolean))];
        return finish({ _preferred: !!c._preferred, ...row, grade: 'partly', factor: 0.85, sentence: `You show ${about(row.computed)} leading people (${roleList(profile.management.roles)})${fields.length ? `, in ${joinList(fields.slice(0, 2))}` : ''}; they ask for ${need}+ years of it in ${rest}. Say what carries over.` });
      }
    }
    return row;
  }
  const dom = phrase ? yearsDomain(`${need} years of ${phrase} experience`) : { stems: [], words: [] };
  const stems = dom.stems;
  const generic = !stems.length && !/\b(?:relevant|related|similar|this\s+field|the\s+field|industry|comparable)\b/i.test(String(c.sentence || c.evidence || ''));
  const total = profile.totalYears || ctx.totalY || 0;
  const roles = profile.roles;
  // the field the requirement is about: the field its words name, else (no object) the posting's own field
  // (a domain word the posting's own title carries — "software" in "Senior Software Engineer I" — is the posting's field)
  const titleStems = new Set(tokenize(String(ctx.jobTitle || '')).map((t) => t.stem));
  const phraseField = phrase ? titleField(phrase) || (stems.some((x) => !WEAK_DOMAIN.has(x) && titleStems.has(x)) ? jobField : null) : null;
  const reqField = phraseField || (!stems.length ? jobField : null);
  const isField = (r) => !!reqField && r.field === reqField;
  const test = domainTest(stems);
  const share = (r) => (r.bullets.length ? r.bullets.filter(test).length / r.bullets.length : 0);
  const named = (r) => isField(r) || (stems.length && (test(r.title) || test(String(r.header || '').split(/\s+[—–|]\s+/)[0]) || (r.bullets.length >= 1 && share(r) >= 1 / 3)));
  if (generic) {
    // "5+ years of experience": every dated month counts
    const ok = total + 0.25 >= need;
    return finish({ _preferred: !!c._preferred, grade: ok ? 'met' : total >= need * 0.75 ? 'partly' : 'not_shown', computed: total, needed: need, counted: counted(roles.filter((r) => r.months)), caps: !ok && total < need * 0.5 && !profile.undated,
      factor: ok ? 1 : Math.max(0.6, 0.6 + 0.4 * (total / need)),
      sentence: ok ? `You show ${about(total)} of work in all; they ask for ${need}+.` : `They ask for ${need}+ years of experience; the dated jobs on your résumé add up to ${about(total)}.` });
  }
  const hit = profile.yearsWhere(named);
  const H = hit.years;
  const dutyRoles = roles.filter((r) => !named(r) && stems.length && r.bullets.some(test));
  const D = profile.yearsWhere((r) => dutyRoles.includes(r)).years;
  const adjRoles = roles.filter((r) => !named(r) && !dutyRoles.includes(r) && reqField && r.field && areAdjacent(r.field, reqField));
  const A = profile.yearsWhere((r) => adjRoles.includes(r)).years;
  const what = phrase || (reqField ? fieldLabel(reqField) : 'this work');
  const base = { computed: H, needed: need, counted: counted(hit.roles), domain: stems.length ? stems : undefined };
  if (H + 0.25 >= need) return finish({ _preferred: !!c._preferred, ...base, grade: 'met', caps: false, factor: 1, sentence: `You show ${H < need ? `close to ${yrs(need)}` : about(H)} of ${what} (${roleList(hit.roles)}); they ask for ${need}+.` });
  const extra = D > 0 ? ` Your duties as ${roleList(dutyRoles, 1)} include ${what} too — if that work counts, say so plainly in the role.`
    : A > 0 ? ` Your ${about(A)} in ${fieldsPhrase(adjRoles.map((r) => fieldLabel(r.field)))} (${roleList(adjRoles, 1)}) sits next to it — make the overlap explicit.` : '';
  if (H > 0) {
    const r = H / need;
    const reach = H + D + A * 0.5;
    const grade = 'partly';
    // positively short: even every dated month of work would not reach half the ask
    const caps = total < need * 0.5 && !profile.undated;
    return finish({ _preferred: !!c._preferred, ...base, grade, caps, factor: Math.max(0.55, Math.min(0.97, 0.55 + 0.45 * Math.min(1, reach / need))),
      sentence: caps
        ? `They ask for ${need}+ years of ${what}; your résumé shows ${about(H)} of it (${roleList(hit.roles)}), and ${about(total)} of work in all.`
        : `Your résumé shows ${about(H)} of ${what} (${roleList(hit.roles)}); they ask for ${need}+.${extra}`, shortfall: Number((1 - r).toFixed(2)) });
  }
  if (D > 0 || A > 0) {
    return finish({ _preferred: !!c._preferred, ...base, grade: 'partly', caps: false, counted: counted([...dutyRoles, ...adjRoles]), factor: D > 0 ? 0.8 : 0.7,
      sentence: D > 0
        ? `No job title on your résumé names ${what}, but your duties as ${roleList(dutyRoles, 1)} include it; they ask for ${need}+ years. Make that work explicit in the role.`
        : `They ask for ${need}+ years of ${what}; the nearest on your résumé is ${about(A)} of ${fieldsPhrase(adjRoles.map((r) => fieldLabel(r.field)))} (${roleList(adjRoles, 1)}). Make the overlap explicit if the work was the same.` });
  }
  // nothing names the object, but the person has worked in the posting's own field long enough: the object is something
  // the résumé's words cannot confirm ("technical products"), so it is asked, not failed
  const fieldYears = jobField ? profile.yearsWhere((r) => r.field === jobField).years : 0;
  if (fieldYears >= need * 0.75 && fieldYears > 0) {
    const fr = roles.filter((r) => r.field === jobField);
    return finish({ _preferred: !!c._preferred, ...base, computed: fieldYears, grade: 'partly', caps: false, counted: counted(fr), factor: 0.88,
      sentence: `They ask for ${need}+ years of ${what}; you show ${about(fieldYears)} in ${fieldLabel(jobField)} (${roleList(fr, 1)}), but your résumé doesn't say it was ${what}. If it was, say so in the role.` });
  }
  // nothing names the work: it caps only when the résumé positively shows other work (every dated month is placed in
  // another field) or the whole history is too short
  const fields = [...new Set(roles.filter((r) => r.field && r.months).map((r) => fieldLabel(r.field)))];
  const allPlaced = roles.length > 0 && roles.every((r) => !r.months || r.field) && !profile.undated;
  const caps = (total < need * 0.5 && !profile.undated) || (allPlaced && !!reqField && fields.length > 0);
  return finish({ _preferred: !!c._preferred, ...base, grade: 'not_shown', caps, factor: 0.65,
    sentence: caps && fields.length && total >= need * 0.5
      ? `They ask for ${need}+ years of ${what}; your ${Math.round(total)} years of work are in ${fieldsPhrase(fields)}.`
      : caps ? `They ask for ${need}+ years of ${what}; the dated jobs on your résumé add up to ${about(total)} in all.`
        : `They ask for ${need}+ years of ${what}; no job on your résumé names that work. If one of your jobs involved it, say so in that job.` });
}
/** "electrical and warehouse work" — field labels in a sentence, a shared trailing "work" said once. */
function fieldsPhrase(labels) {
  const ls = [...new Set(labels.filter(Boolean))].slice(0, 2);
  if (ls.length === 2 && / work$/.test(ls[0]) && / work$/.test(ls[1])) return `${ls[0].replace(/ work$/, '')} and ${ls[1]}`;
  return joinList(ls);
}
function joinList(items) { return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`; }

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
  let row;
  if (M > 0 && (need == null || M + 0.25 >= need)) {
    row = { grade: 'met', caps: false, factor: 1, sentence: need ? `You show ${about(M)} ${what} (${lead(mRoles)}); they ask for ${need}+.` : `Your résumé shows you leading people (${lead(mRoles)}).` };
  } else if (M > 0) {
    const caps = total < need * 0.75 && !profile.undated;
    row = { grade: 'partly', caps, factor: Math.max(0.6, Math.min(0.95, 0.6 + 0.4 * (M / need))), sentence: `Your résumé shows ${about(M)} ${what} (${lead(mRoles)}); they ask for ${need}+.` };
  } else if (duty.length) {
    const line = String(duty[0].mgmt.duty[0] || '').replace(/^[\s•\-*·–]+/, '').replace(/[.;]\s*$/, '');
    // lead duties are real, but a whole work history shorter than the years of managing asked for cannot meet it
    row = { grade: 'partly', caps: (need != null && total + 0.25 < need && !profile.undated) || (c.kind === 'seniority' && Number(c.value) >= 5), factor: 0.75, counted: counted(duty),
      sentence: `Your résumé shows lead duties ("${line.length > 70 ? `${line.slice(0, 67).replace(/\s+\S*$/, '')}…` : line}") but no role where you managed people${need ? `; they ask for ${need}+ years of it` : ''}. If you supervised anyone, say how many and for how long.` };
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
  return finish({ _preferred: !!c._preferred, ...base, ...row });
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
// The licences a job TURNS ON: not having one is a positive "not met" for a person outside that field.
const OCCUPATION_LICENCE_RE = /\b(?:real\s+estate\s+licen\w*|insurance\s+(?:producer\s+)?licen\w*|cosmetology\s+licen\w*|RN|registered\s+nurse|LPN|LVN|nursing\s+licen|journeyman|master\s+electrician|electrical\s+licen|CDL|commercial\s+driver|CPA|certified\s+public\s+accountant|teaching\s+licen|teacher\s+certif|pharmacist|physician|medical\s+licen|bar\s+(?:admission|licen)|admitted\s+to\s+(?:the|practice)|licensed\s+(?:clinical|professional|practical|vocational|electrician|plumber|social)|PE\s+licen|professional\s+engineer|dental\s+hygien|LCSW|LPC|LMFT|BCBA|NP\b|nurse\s+practitioner|CRNA)\b/i;
// Fields whose job IS a licence: the title names the licensed role, so the licence is required whether or not the posting
// spells it out. Held = the résumé names it anywhere.
const LICENSED_TITLES = [
  { field: 'nursing', title: /\b(?:registered\s+nurse|RN|LPN|LVN|licensed\s+(?:practical|vocational)\s+nurse|nurse\s+practitioner)\b/i, held: /\b(?:RN|LPN|LVN|registered\s+nurse|licensed\s+(?:practical|vocational)\s+nurse|NP|APRN|nursing\s+licen[sc]e)\b/, label: 'a nursing licence (RN or LPN)' },
  { field: 'electrical', title: /\b(?:journeyman|master\s+electrician|licensed\s+electrician)\b/i, held: /\b(?:journeyman|master\s+electrician|electrical\s+licen[sc]e|licensed\s+electrician)\b/i, label: 'a journeyman electrician licence' },
];
function occupationLicence(jobField, jobTitle, jobText, resumeText, rows) {
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
      const sentence = `Your ${String(DEGREE_LABEL[have] || 'education').replace(/^(?:an?|the)\s+/i, '')} meets the education part of this requirement; the years it pairs with are judged on their own.`;
      return { grade: 'partly', caps: false, factor: 1, status: 'met', sentence, message: sentence };
    }
    // a listed degree below the one required (no "or equivalent") is a positive "not met": an ATS knock-out question
    const caps = gap >= 1 && !equivalent && !!row.gate && (have > 0 || eduSection);
    return { grade: caps || gap >= 2 ? 'not_shown' : 'partly', caps, factor: gap >= 2 ? 0.7 : 0.85, sentence: row.message };
  }
  if (row.kind === 'certification') {
    if (row.status === 'met') return { grade: 'met', caps: false, factor: 1, sentence: row.message };
    if (row.state && row.resumeStates && row.resumeStates.length) {
      // the licence is held in another state: a real, specific gate when the posting requires it (an Arizona
      // journeyman licence is not a Texas one); a compact / "or eligible" ask is a question
      return row.status === 'unmet' ? { grade: 'not_shown', caps: true, factor: 0.6, sentence: row.message } : { grade: 'cannot_tell', caps: false, factor: 0.9, sentence: row.message };
    }
    // a licence the posting says is required (status 'ask' only because the reader did not mark the line a gate)
    const requiredLicence = row.status === 'ask' && OCCUPATION_LICENCE_RE.test(String(row.label || '')) && /\b(?:required|must)\b/i.test(String(row.posting_quote || ''));
    if (row.status === 'ask' && !requiredLicence) return { grade: 'cannot_tell', caps: false, factor: row.gate ? 0.93 : 1, sentence: row.message };
    // unmet: an occupation licence held by someone outside the field caps; anything else is a gap to answer
    // …or the credential the posting's own TITLE names ("Certified Patient Care Assistant CNA LNA")
    const marks = String(row.label || '').match(/\b[A-Z]{2,6}\b/g) || [];
    const inTitle = marks.some((mk) => new RegExp(`(?<![A-Za-z])${escapeRegExp(mk)}(?![A-Za-z])`).test(String(ctx.jobTitle || '')));
    const occupational = (OCCUPATION_LICENCE_RE.test(`${row.label || ''} ${row.posting_quote || ''}`.slice(0, 300)) && OCCUPATION_LICENCE_RE.test(String(row.label || ''))) || inTitle;
    // the person's own job title implies the licence (a Registered Nurse holds an RN licence; an electrician's journeyman
    // card) — being in the same broad field does not (a SaaS account executive holds no real estate licence)
    const IMPLIES = [[/\bRN\b|nurs/i, /\bnurse\b|\bRN\b/i], [/journeyman|master\s+electrician|electrical\s+licen/i, /electrician/i], [/teach/i, /teacher/i], [/\bCPA\b|public\s+accountant/i, /\bCPA\b/]];
    const inField = profile.roles.some((r) => IMPLIES.some(([lab, title]) => lab.test(String(row.label || '')) && title.test(String(r.title || r.header || ''))));
    if (requiredLicence) { const m = `This job requires ${String(row.label).replace(/^an?\s+/i, 'a ')}; your résumé does not list one.`; return inField ? { grade: 'cannot_tell', caps: false, factor: 0.85, status: 'ask', sentence: row.message } : { grade: 'not_shown', caps: true, factor: 0.5, status: 'unmet', sentence: m, message: m }; }
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
