// Does the résumé hold a named credential? — ONE answer for the fit check, Optimize and the Studio.
//
// The Pro-tools harness (2026-10-25) found a "BSN, RN" told "Requires an RN license; your résumé
// does not list one", an HVAC tech holding "EPA Section 608 Universal" told EPA 608 was "fatally"
// missing, and a CDL/CPA lost the same way: constraints.js searched for the posting's literal phrase
// ("RN license"), and the Studio's coveredByCert dropped every token under four letters (RN, EPA,
// 608, CPA, CDL) before it looked.
//
// A credential is held when its CORE words (the name minus "license", "certification", "card"…)
// all appear in the résumé, or one of its synonyms does. Short licence acronyms count on their own
// ("RN" next to a name is the licence); a common noun ("forklift", "food handler") counts only with
// a certificate word on the same line — driving a forklift is not a forklift certification.
import { tokenize, stemWord } from './lemma.js';

const GENERIC = new Set(['license', 'licens', 'licence', 'licensure', 'licensur', 'certification', 'certif', 'certificat', 'certificate', 'certified', 'card', 'permit', 'valid', 'current', 'active', 'state', 'credential', 'registration', 'registr', 'required', 'requir', 'preferred', 'prefer', 'or', 'and', 'a', 'an', 'the', 'of', 'in', 'with']
  .map(stemWord));

// canonical core (space-joined stems) → phrases that prove it
const SYNONYMS = {
  rn: ['registered nurse'],
  lpn: ['licensed practical nurse', 'lvn'],
  lvn: ['licensed vocational nurse', 'lpn'],
  cna: ['certified nursing assistant', 'nursing assistant certification'],
  cdl: ['commercial driver', "commercial driver's license"],
  cpa: ['certified public accountant'],
  bls: ['basic life support'],
  acls: ['advanced cardiac life support'],
  pals: ['pediatric advanced life support'],
  'epa 608': ['section 608', 'epa section 608', 'epa-608'],
  'food handler': ['food handler', 'food handlers', 'servsafe food handler', 'food safety certification'],
  servsafe: ['servsafe'],
  pmp: ['project management professional'],
};
const ACRONYM_RE = /^[a-z]{2,5}\d*$/;
const CERT_CUE = /certif|licen[cs]|\bcard\b|permit|certified|\bcert\b|accredit/i;

function coreStems(name) {
  return tokenize(String(name || '')).map((t) => t.stem).filter((s) => s && !GENERIC.has(s));
}

/** Lines of the text containing every one of the stems. */
function linesWithAll(text, stems) {
  return String(text || '').split(/\n/).filter((line) => {
    const have = new Set(tokenize(line).map((t) => t.stem));
    return stems.every((s) => have.has(s));
  });
}

/**
 * @param {string} resumeText
 * @param {string} credential the posting's name for it ("RN license", "EPA 608 certification")
 * @returns {string|null} the résumé line that proves it, or null
 */
export function credentialHeld(resumeText, credential) {
  const text = String(resumeText || '');
  const core = coreStems(credential);
  if (!core.length) return null;
  const key = core.join(' ');
  const acronymOnly = core.every((s) => ACRONYM_RE.test(s) || /^\d+$/.test(s)) && core.some((s) => ACRONYM_RE.test(s));
  // the credential's own words
  const lines = linesWithAll(text, core);
  // an acronym licence must be written as the acronym ("RN"), not as a lowercase word inside prose
  const acronymLine = acronymOnly ? lines.find((l) => core.filter((s) => ACRONYM_RE.test(s)).every((s) => new RegExp(`(?<![A-Za-z])${s}(?![A-Za-z])`, 'i').test(l) && new RegExp(`(?<![A-Za-z])${s.toUpperCase()}(?![A-Za-z])`).test(l))) : null;
  if (acronymLine) return acronymLine.trim();
  if (!acronymOnly) {
    const cued = lines.find((l) => CERT_CUE.test(l));
    if (cued) return cued.trim();
  }
  for (const syn of SYNONYMS[key] || []) {
    const st = coreStems(syn);
    const hit = st.length ? linesWithAll(text, st)[0] : null;
    if (hit) return hit.trim();
  }
  return null;
}
