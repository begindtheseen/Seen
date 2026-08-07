// Resume Intelligence Engine — STRUCTURED EXTRACTORS (Phases 2/3).
//
// The genuinely-good deterministic extractors the audit said to KEEP: education level, years of
// experience, licenses & certifications (\b-anchored dictionary), physical demands, shift/schedule,
// and pre-employment screening (background check, drug screen, 18+/21+ gates). Each is a pure
// \b-anchored regex over supplied text and returns a STRUCTURED object (not a bare string), so the
// canonical profiles can attach category/confidence. Owned by this engine (no dependency on the
// legacy jobInsights) so the old modules can be retired without breaking the canonical path. NO AI.

// Years of experience — the smallest "N+ years" figure sitting near experience context.
export function extractYears(text) {
  const re = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b([^.]{0,40})/gi;
  let m, best = null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (!(n >= 1 && n <= 40)) continue;
    const ctx = (m[2] || '') + ' ' + text.slice(Math.max(0, m.index - 30), m.index);
    if (!/experien|\bexp\b|background|industry|relevant|working|professional/i.test(ctx)) continue;
    if (best === null || n < best) best = n;
  }
  return best; // number | null
}

// Highest degree the JD actually names.
export function extractEducation(text) {
  if (/\bmaster'?s?\b(?:\s+degree|\s+of|\s+in)?|\bmba\b|\bm\.s\.|\bm\.a\.|graduate\s+degree/i.test(text)) return "Master's degree";
  if (/\bbachelor'?s?\b|\bb\.s\.|\bb\.a\.|undergraduate\s+degree|4[- ]year\s+degree|college\s+degree/i.test(text)) return "Bachelor's degree";
  if (/\bassociate'?s?\s+degree|\bassociate\s+degree|\ba\.a\.|\ba\.s\.\s+degree/i.test(text)) return "Associate's degree";
  if (/high[- ]school|\bged\b|\bhs\s+diploma\b|high\s+school\s+diploma/i.test(text)) return 'High school diploma / GED';
  return null;
}

// Licenses & certifications — \b-anchored dictionary; specific variants precede general forms.
const CERT_TERMS = [
  [/valid\s+driver'?s?\s+licen[cs]e/i, "Valid driver's license"],
  [/\bdriver'?s?\s+licen[cs]e/i, "Driver's license"],
  [/clean\s+(?:driving\s+record|mvr|motor\s+vehicle\s+record)/i, 'Clean driving record'],
  [/class\s*a\s*cdl|\bcdl\b[^.]{0,20}class\s*a/i, 'CDL Class A'],
  [/class\s*b\s*cdl|\bcdl\b[^.]{0,20}class\s*b/i, 'CDL Class B'],
  [/\bcdl\b/i, 'CDL'],
  [/forklift\s+(?:certif|licen|operat)/i, 'Forklift certification'],
  [/\bosha\s*10\b/i, 'OSHA 10'],
  [/\bosha\s*30\b/i, 'OSHA 30'],
  [/\bosha\b/i, 'OSHA certification'],
  [/servsafe/i, 'ServSafe certification'],
  [/food\s+handler'?s?\s*(?:card|permit|certif)?/i, "Food handler's card"],
  [/\btips\s+certif|\btips\s+certified|tips\s+alcohol/i, 'TIPS certification'],
  [/\bbls\b/i, 'BLS'],
  [/\bacls\b/i, 'ACLS'],
  [/\bpals\b/i, 'PALS'],
  [/\bcpr\b/i, 'CPR certification'],
  [/\brn\s+licen[cs]e|registered\s+nurse\s+licen[cs]e|\brn\b(?=[^.]{0,15}licen)/i, 'RN license'],
  [/\bcna\b/i, 'CNA license'],
  [/\blvn\b|\blpn\b/i, 'LVN/LPN license'],
  [/\btwic\b/i, 'TWIC card'],
  [/security\s+guard\s+(?:card|licen)|\bguard\s+card\b/i, 'Security guard card'],
  [/cosmetology\s+(?:licen|certif)/i, 'Cosmetology license'],
  [/\bepa\s*608\b|epa\s+(?:universal|certif)/i, 'EPA 608 certification'],
  [/\base\s+certif|\base\b(?=[^.]{0,15}certif)/i, 'ASE certification'],
  [/\bpmp\b/i, 'PMP certification'],
  [/\bcpa\b/i, 'CPA license'],
];
export function extractCertifications(text) {
  const out = [];
  const seen = new Set();
  for (const [re, display] of CERT_TERMS) {
    if (out.length >= 6) break;
    if (re.test(text) && !seen.has(display)) { out.push(display); seen.add(display); }
  }
  if (seen.has("Valid driver's license")) {
    const i = out.indexOf("Driver's license");
    if (i !== -1) out.splice(i, 1);
  }
  return out;
}

// Physical demands.
export function extractPhysical(text) {
  const out = [];
  const lift = text.match(/lift(?:ing)?\s*(?:up\s+to\s*)?(\d{2,3})\s*(?:lbs?|pounds)/i);
  if (lift) out.push(`Lift ${lift[1]} lbs`);
  if (/stand(?:ing)?\s+for\s+(?:long|extended)|on\s+your\s+feet|prolonged\s+standing|duration\s+of\s+(?:a\s+)?shift/i.test(text)) out.push('Stand for long periods');
  if (/repetitive\s+(?:motion|movement|task|bending)|bending,?\s+twisting/i.test(text)) out.push('Repetitive physical tasks');
  return out;
}

// Schedule / shift.
const SHIFT_TERMS = [
  [/\b(?:1st|first)\s+shift/i, '1st shift'], [/\b(?:2nd|second)\s+shift/i, '2nd shift'],
  [/\b(?:3rd|third)\s+shift/i, '3rd shift'], [/\bnight\s+shift/i, 'Night shift'],
  [/\bovernight\b|\bgraveyard\b/i, 'Overnight shift'], [/\bswing\s+shift/i, 'Swing shift'],
];
const SCHEDULE_TYPE = [
  [/\bpart[\s-]?time\b/i, 'Part-time'], [/\bfull[\s-]?time\b/i, 'Full-time'],
  [/\bseasonal\b/i, 'Seasonal'], [/\btemp(?:orary)?\b/i, 'Temporary'],
];
export function extractSchedule(text) {
  const out = [];
  for (const [re, label] of SHIFT_TERMS) if (re.test(text)) out.push(label);
  if (/\bweekends?\b[^.]{0,25}(?:required|availab|must|mandatory)|(?:available|work|must\s+work)[^.]{0,15}weekends?\b/i.test(text)) out.push('Weekend availability');
  for (const [re, label] of SCHEDULE_TYPE) if (re.test(text) && !out.includes(label)) out.push(label);
  return out;
}

// Pre-employment screening / hard eligibility gates.
export function extractScreening(text) {
  const out = [];
  if (/background\s+(?:check|screen|investigation)/i.test(text)) out.push('Background check');
  if (/drug\s+(?:test|screen)/i.test(text)) out.push('Drug screening');
  if (/security\s+clearance|clearance\s+required|\b(?:secret|ts\/sci)\s+clearance/i.test(text)) out.push('Security clearance');
  if (/authorized\s+to\s+work|work\s+authorization|eligible\s+to\s+work/i.test(text)) out.push('Work authorization');
  const age = text.match(/\b(?:must\s+be\s+(?:at\s+least\s+)?)?(18|21)\s*(?:\+|years?|or\s+older|and\s+over|and\s+older)\b/i);
  if (age) out.push(`Must be ${age[1]}+`);
  return out;
}
