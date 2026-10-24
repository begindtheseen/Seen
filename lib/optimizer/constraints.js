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
import { DEGREE_LABEL } from './postingSections.js';

export const GATE_CAP = 35;
export const GATE_KINDS = new Set(['degree', 'years', 'management', 'seniority', 'certification']);

const AVAILABILITY_RE = /\b(?:availab(?:le|ility)|open\s+availability|weekends?|nights?|evenings?|overnight|holidays?|any\s+shift|flexible\s+schedule)\b/i;
const FULL_TIME_RE = /\bfull[\s-]*time\b/i;

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
export function evaluateConstraints(jobFacts, resumeFacts, resumeText = '') {
  const out = [];
  const text = String(resumeText || '');
  const deg = resumeDegree(resumeFacts);
  const totalY = years(resumeFacts, 'experience:total');
  const mgmtY = years(resumeFacts, 'experience:management');
  const gpaFact = resumeFacts.find((f) => f.factType === 'gpa');
  const seniority = resumeFacts.filter((f) => f.factType === 'seniority').map((f) => f.label);
  const leadRank = seniority.some((l) => ['lead', 'director', 'executive'].includes(l));

  for (const c of jobFacts.filter((f) => f.factType === 'constraint')) {
    const base = { kind: c.kind, label: c.label, gate: !!c.gate, importance: c.importance, evidence: c.evidence || '' };
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
        } else message = `Your ${DEGREE_LABEL[deg] || 'education'} meets the education requirement.`;
        out.push({ ...base, status, message });
        break;
      }
      case 'years': {
        const have = c.management ? mgmtY : totalY;
        const status = have + 0.25 >= c.value ? 'met' : 'unmet';
        out.push({ ...base, status, message: status === 'met'
          ? `You show ${fmtYears(have)} of ${c.management ? 'supervisory ' : ''}experience (asks ${c.value}+).`
          : `Requires ${c.value}+ years of ${c.management ? 'management/supervisory ' : ''}experience; your résumé shows ${fmtYears(have)}.` });
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
        const status = hasStemmed(text, c.value) ? 'met' : (c.gate ? 'unmet' : 'ask');
        out.push({ ...base, status, message: status === 'met' ? `Your résumé lists ${c.label}.` : `The posting asks for ${c.label}. Do you have it? Add it under Certifications only if you do.` });
        break;
      }
      case 'language': {
        const want = String(c.value || '').toLowerCase();
        const status = want === 'english' ? 'met' : (hasStemmed(text, want) ? 'met' : 'ask');
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
