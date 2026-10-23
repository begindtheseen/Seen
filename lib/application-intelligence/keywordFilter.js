// Keyword chip gate — the ONE rule for "is this phrase a keyword a person could add to a
// résumé?" Applied where open-vocabulary phrases are born (jobParserV2.extractOpenSkills) AND
// where they are shown as "missing keywords" (atsSimulator), so a sentence tail like "are met"
// (from "…ensure customer requirements are met") can never become a chip again.
//
// A usable keyword:
//   • is at least 3 letters long and contains a letter,
//   • is not a stopword / auxiliary / pronoun / bare determiner,
//   • contains no auxiliary or modal verb at all ("are met", "will be", "has been"),
//   • is not a lone past participle or gerund fragment ("documented", "ensuring"), and
//   • is not entirely function words.
// Short dictionary aliases (sql, crm, pos, sap, aws…) pass because they are letters-only
// tokens of 3+ characters — the length rule is the only thing that touches them.

const AUX = new Set([
  'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'has', 'have', 'had', 'having',
  'do', 'does', 'did', 'doing', 'done',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
]);

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto', 'upon', 'about', 'as', 'than', 'via', 'per',
  'it', 'its', 'they', 'them', 'their', 'our', 'your', 'you', 'we', 'us', 'he', 'she', 'his', 'her', 'who', 'whom', 'which', 'that', 'this', 'these', 'those',
  'all', 'any', 'each', 'every', 'some', 'such', 'other', 'another', 'various', 'both', 'either', 'neither',
  'not', 'no', 'yes', 'also', 'too', 'very', 'more', 'most', 'less', 'least', 'well', 'etc',
  'when', 'where', 'while', 'if', 'then', 'there', 'here', 'how', 'why', 'what',
  'met', 'needed', 'required', 'able', 'ability', 'plus', 'strong', 'excellent', 'good', 'solid',
]);

// A lone "-ed" / "-ing" word with nothing else is a verb fragment, not a skill ("documented",
// "ensuring"). Words a résumé legitimately lists as a skill in that shape are allowed through.
const VERB_FRAGMENT_OK = new Set(['marketing', 'accounting', 'merchandising', 'onboarding', 'training', 'reporting', 'scheduling', 'shipping', 'receiving', 'engineering', 'consulting', 'nursing', 'purchasing', 'recruiting', 'staffing', 'advertising', 'bookkeeping', 'underwriting', 'welding', 'plumbing', 'roofing', 'landscaping', 'cleaning', 'coaching', 'teaching', 'tutoring', 'billing', 'coding', 'testing', 'auditing', 'forecasting', 'budgeting', 'licensing', 'leasing', 'dispatching', 'detailing', 'painting', 'printing', 'packaging', 'manufacturing', 'machining', 'framing', 'drafting', 'writing', 'editing', 'photography', 'catering', 'bartending', 'housekeeping', 'fundraising', 'networking', 'sourcing', 'planning', 'lending', 'banking', 'modeling', 'rendering', 'animation', 'sewing', 'baking', 'cooking', 'cashiering', 'stocking', 'picking', 'packing', 'loading', 'driving', 'forklift']);

export function isUsableKeyword(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return false;
  if (!/[a-z]/i.test(s)) return false;
  // Under 3 characters is never a chip ("is", "ab"). "c#" is the one 2-character token a
  // résumé legitimately lists, so it is allowed by name.
  if (s.replace(/\s/g, '').length < 3 && s !== 'c#') return false;
  const words = s.split(' ');
  if (words.some(w => AUX.has(w))) return false;
  if (words.every(w => FUNCTION_WORDS.has(w))) return false;
  if (FUNCTION_WORDS.has(words[0]) && words.length === 1) return false;
  if (words.length === 1 && /^[a-z]+(ed|ing)$/.test(s) && !VERB_FRAGMENT_OK.has(s) && s.length > 4) return false;
  return true;
}

// Convenience: filter + dedupe, preserving order.
export function usableKeywords(list) {
  const seen = new Set();
  const out = [];
  for (const k of list || []) {
    const s = String(k || '').trim();
    if (!s || !isUsableKeyword(s)) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
