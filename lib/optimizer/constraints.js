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
import { hasStemmed } from './lemma.js';
import { credentialHeld } from './credentials.js';
import { DEGREE_LABEL } from './postingSections.js';
import { domainOfYearsSentence, relevantExperienceYears } from './extractResumeFacts.js';

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
  [/food\s+handler|servsafe/i, [/\bfood\s+handler/i, /\bservsafe\b/i, /\bfood\s+(?:safety\s+)?manager\s+certif/i]],
  [/forklift/i, [/forklift[^.\n]{0,40}certif/i, /certified[^.\n]{0,20}forklift/i, /forklift[^.\n]{0,15}licen[sc]e/i]],
  [/teaching\s+licen|teacher\s+certif/i, [/teaching\s+licen[sc]/i, /teacher\s+(?:licen[sc]|certif)/i, /licensed\s+teacher/i, /initial\s+professional\s+licen[sc]e/i]],
  [/driver'?s?\s+licen/i, [/driver'?s?\s+licen[sc]e/i, /\bcdl\b/i]],
];
const IN_PROGRESS_RE = /^[^.\n]{0,30}\b(?:exam|candidate|eligible|in\s+progress|pursuing|sitting|track|coursework)\b/i;
export function certHeld(resumeText, value, label) {
  // a credential mentioned as in progress ("the CPA exam", "CPA candidate") is not held
  const text = String(resumeText || '').replace(/\b([A-Z]{2,6})\b(?=[^.\n]{0,30}\b(?:exam|candidate|eligible|in\s+progress|pursuing|sitting|track|coursework)\b)/g, (x) => ' '.repeat(x.length));
  if (hasStemmed(text, value)) return true;
  for (const [want, ways] of CERT_SYNONYMS) if (want.test(`${value} ${label}`) && ways.some((re) => re.test(text))) return true;
  const marks = String(label || value).match(/\b(?:[A-Z]{2,6}|\d{2,4})\b/g) || [];
  if (!marks.length) return false;
  return marks.every((mk) => {
    const re = new RegExp(`(?<![A-Za-z0-9])${mk}(?![A-Za-z0-9])`, /\d/.test(mk) ? '' : '');
    let m; const g = new RegExp(re.source, 'g');
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
export function evaluateConstraints(jobFacts, resumeFacts, resumeText = '', { jobFamily = null } = {}) {
  const out = [];
  const text = String(resumeText || '');
  const deg = resumeDegree(resumeFacts);
  const totalY = years(resumeFacts, 'experience:total');
  const mgmtY = years(resumeFacts, 'experience:management');
  const gpaFact = resumeFacts.find((f) => f.factType === 'gpa');
  const seniority = resumeFacts.filter((f) => f.factType === 'seniority').map((f) => f.label);
  const leadRank = seniority.some((l) => ['lead', 'director', 'executive'].includes(l));

  for (const c of jobFacts.filter((f) => f.factType === 'constraint')) {
    const base = { kind: c.kind, label: c.label, gate: !!c.gate, importance: c.importance, evidence: c.evidence || '', items: c.items || null };
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
        // "3+ years in email marketing operations, CRM administration…" is about THOSE roles:
        // Tasha's barista and campus jobs were counted toward it ("You show 3.2 years", 2026-10-25).
        const domain = c.management ? [] : domainOfYearsSentence(c.sentence || c.evidence || '');
        const rel = domain.length ? relevantExperienceYears(text, domain, { jobFamily }) : null;
        const have = c.management ? mgmtY : (rel ? rel.years : totalY);
        const what = rel ? 'related ' : (c.management ? 'supervisory ' : '');
        // Years counted in a FIELD the sentence did not let us measure ("4+ years of HVAC service
        // experience"): the total meets it only when the résumé names that field; otherwise it is a
        // question, never "met" on a barista's years for a social-media posting.
        if (c.field && !c.management && !rel && have + 0.25 >= c.value) {
          const words = String(c.field).toLowerCase().split(/[^a-z0-9+#&]+/).filter((w) => w.length >= 3 && !/^(?:and|the|for|with|or|experience|operations|administration|center|role|roles)$/.test(w));
          const named = words.some((w) => hasStemmed(text, w));
          out.push({ ...base, status: named ? 'met' : 'ask', message: named
            ? `You show ${fmtYears(have)} of experience, including ${c.field} (asks ${c.value}+).`
            : `The posting asks for ${c.value}+ years of ${c.field} experience. Your résumé shows ${fmtYears(have)} in all but does not name ${c.field} — count only those years.` });
          break;
        }
        const status = have + 0.25 >= c.value ? 'met' : 'unmet';
        out.push({ ...base, status, domain: domain.length ? domain : undefined, message: status === 'met'
          ? `You show ${fmtYears(have)} of ${what}experience (asks ${c.value}+).`
          : `Requires ${c.value}+ years of ${c.management ? 'management/supervisory ' : rel ? 'related ' : ''}experience; your résumé shows ${have ? fmtYears(have) : 'none'}${rel && have ? ' in related roles' : ''}.` });
        break;
      }
      case 'management': {
        const status = mgmtY > 0 || leadRank ? 'met' : 'unmet';
        out.push({ ...base, status, message: status === 'met' ? 'Your résumé shows supervisory experience.' : 'Requires people-management experience; your résumé shows no supervisory role or bullet.' });
        break;
      }
      case 'seniority': {
        const status = leadRank || mgmtY >= 2 ? 'met' : 'unmet';
        out.push({ ...base, status, message: status === 'met' ? `Your titles reach the ${c.label}.` : `This is a ${c.label}; your résumé shows no supervisory or management role.` });
        break;
      }
      case 'certification': {
        const held = hasStemmed(text, c.value) || !!credentialHeld(text, c.label || c.value) || certHeld(text, c.value, c.label);
        const status = held ? 'met' : (c.gate ? 'unmet' : 'ask');
        out.push({ ...base, status, message: status === 'met' ? `Your résumé lists ${c.label}.`
          : status === 'unmet' ? `Requires ${article(c.label)}${c.label}; your résumé does not list one.`
          : `The posting asks for ${c.label}. Do you have it? Add it under Certifications only if you do.` });
        break;
      }
      case 'language': {
        const want = String(c.value || '').toLowerCase();
        // "bilingual English/Spanish" is met by a résumé that names every non-English language it
        // asks for ("Bilingual English/Spanish" on Maria's résumé read as "ask", 2026-10-25).
        const LANGS = /\b(spanish|french|german|mandarin|chinese|cantonese|japanese|korean|vietnamese|tagalog|arabic|russian|portuguese|italian|hindi|punjabi|urdu|polish|haitian creole|creole|asl|american sign language|somali|farsi|persian|hmong)\b/gi;
        const asked = [...new Set([...`${c.label || ''} ${want}`.matchAll(LANGS)].map((m) => m[1].toLowerCase()))];
        const status = want === 'english' && !asked.length ? 'met'
          : (asked.length ? asked.every((l) => new RegExp(`(?<![a-z])${l}(?![a-z])`, 'i').test(text)) : hasStemmed(text, want)) ? 'met' : 'ask';
        out.push({ ...base, gate: false, status, message: status === 'met' ? `Your résumé mentions ${want === 'english' ? 'English' : c.label}.` : `The posting asks for ${c.label}. Add it only if you speak it.` });
        break;
      }
      case 'schedule': {
        const hasLine = AVAILABILITY_RE.test(text);
        const partTime = (c.items || []).some((i) => /part-time|seasonal|temporary/.test(i));
        const conflict = partTime && FULL_TIME_RE.test(text);
        const pt = (c.items || []).filter((i) => /part-time|seasonal|temporary/.test(i)).join('/');
        out.push({ ...base, gate: false, status: hasLine && !conflict ? 'met' : 'ask', conflict,
          short: conflict ? `this job is ${pt} and your résumé asks for full-time work` : undefined,
          message: conflict
            ? `This job is ${(c.items || []).filter((i) => /part-time|seasonal|temporary/.test(i)).join('/')}; your résumé says you want full-time work. Change that line if part-time works for you.`
            : `This job needs: ${c.label}. Can you work that? If yes, add an availability line under your header.` });
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
  return out;
}

/** The unmet hard gates, most decisive first (credential/years/seniority before the rest). */
export function failedGates(evaluated) {
  const order = { degree: 0, years: 1, seniority: 2, management: 3, certification: 4 };
  return (evaluated || []).filter((c) => c.gate && c.status === 'unmet' && GATE_KINDS.has(c.kind)).sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}
