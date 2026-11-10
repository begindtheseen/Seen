// The employer's name as a person writes it — ONE helper every tool imports (director, 2026-11-10: tools printed ATS
// board slugs as the employer: "Bjakcareer asks for…", "Why do you want to work at Akidolabs?", "at Csmcy", "TPG
// Careers Page").
//
//   employerDisplayName({ company, postingText, title }) → string
//
// 1. Strips board decorations ("Careers Page", "Careers", "Jobs", "Career Opportunities", "Hiring").
// 2. A name that already reads as a name (has a space or mixed case, e.g. "Northwestern Medicine", "ConvenientMD") is
//    kept as given.
// 3. A slug (one lower-case or all-caps word, "akidolabs", "csmcy", "bjakcareer") is replaced by the name the posting
//    itself uses — a capitalised run of 1–5 words whose letters, joined and lower-cased, equal the slug (or the slug
//    minus a "careers"/"jobs"/"hr" tail): "About Akido Labs", "Akido Labs is…", "at Columbia Shipmanagement" only when
//    the letters match.
// 4. Nothing reliable → '' so the caller says "this employer". Never a guessed capitalisation of a slug.
const DECOR_RE = /\s*(?:[-–|]\s*)?\b(?:careers?\s+page|career\s+opportunities|careers?|jobs|job\s+board|hiring|recruiting|talent)\s*$/i;

export function employerDisplayName({ company = '', postingText = '' } = {}) {
  let name = String(company || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) name = name.replace(DECOR_RE, '').trim();
  if (!name) return '';
  const isSlug = !/\s/.test(name) && (/^[a-z0-9]+$/.test(name) || /^[A-Z0-9]+$/.test(name)) && name.length > 3;
  if (!isSlug) return name;
  const want = name.toLowerCase().replace(/(?:careers?|jobs|hr|st|group|inc|llc)$/, '');
  const text = String(postingText || '');
  const re = /\b([A-Z][\w&'’.-]*(?:\s+(?:&\s+)?[A-Z][\w&'’.-]*){0,4})/g;
  let m;
  const candidates = new Map();
  while ((m = re.exec(text)) !== null) {
    const words = m[1].split(/\s+/);
    // every prefix of the run ("Akido Labs is" → "Akido", "Akido Labs")
    for (let a = 0; a < words.length; a++) for (let n = a + 1; n <= words.length; n++) {
      const cand = words.slice(a, n).join(' ').replace(/[’'.,]+$/, '');
      const letters = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (letters && (letters === name.toLowerCase() || (want.length >= 3 && letters === want))) candidates.set(cand, (candidates.get(cand) || 0) + 1);
    }
  }
  if (!candidates.size) return '';
  // the spelling the posting uses most; a spaced, mixed-case one wins a tie ("Akido Labs" over "AkidoLabs")
  return [...candidates.entries()].sort((a, b) => b[1] - a[1] || Number(/\s/.test(b[0])) - Number(/\s/.test(a[0])))[0][0];
}
