// The words a beginner meets in an oilfield, trades, driving, warehouse, care or IT-support posting, each with ONE short,
// neutral definition — what the card or licence IS, who issues it and what it lets you do. Read by the "Before you apply"
// block of a listing (components/jobs/BeforeYouApply.tsx via lib/jobs/beforeYouApply.js): a term is explained only when
// the posting itself uses it (`termsIn`).
//
// Rules for an entry:
//   • a definition says what the thing is, never what this employer wants (that is the posting's own line);
//   • no prices, pass rates, wages or durations that change unless the rule behind them is named in the comment beside
//     it with the date it was checked;
//   • a card from a course is a card, never "certified" (an OSHA 10 / 30 card is proof of a course — OSHA's own words);
//   • the basis (the regulation or the body that runs the credential) sits in the comment, so anyone can check it.
//
// Pure — no imports. Tests: lib/jobs/beforeYouApply.test.mjs.

/** @typedef {{ key: string, term: string, re: RegExp, def: string }} GlossaryEntry */

/** @type {GlossaryEntry[]} */
export const GLOSSARY = [
  // Basis: SafeLand USA (industry-run basic orientation for US onshore oil & gas, safelandusa.com) and PEC Safety's
  // "PEC Basic Orientation" (formerly PEC SafeLand), which meets the SafeLand USA standard. Both are one-day courses
  // (checked 2026-11-14).
  {
    key: 'safeland',
    term: 'SafeLand / PEC Basic Orientation',
    re: /\bsafe\s*-?\s*land(?:\s+usa)?\b|\bPEC\s+(?:basic|safeland|core|safety|orientation)\b|\bPEC\b(?=[^.\n]{0,40}\b(?:orientation|card|certif\w*|training)\b)/i,
    def: 'A one-day safety orientation for onshore oil and gas sites. Many operators require it before you can work on their locations. You get a card when you finish.',
  },
  // Basis: ANSI/ASSP Z390.1 (Accepted Practices for Hydrogen Sulfide Safety Training Programs), which recommends a
  // yearly refresher.
  {
    key: 'h2s',
    term: 'H2S',
    re: /\bH2S\b/,
    def: 'Hydrogen sulfide, a toxic gas found at some oil and gas sites. "H2S training" is a short course on spotting it and what to do; you get a card, usually renewed every year.',
  },
  // Basis: OSHA Outreach Training Program (osha.gov/training/outreach). OSHA states the course completion card is not a
  // certification and does not license anyone to do a job.
  {
    key: 'osha10',
    term: 'OSHA 10',
    re: /\bOSHA[\s-]*10\b/i,
    def: 'A 10-hour safety course for entry-level workers under OSHA\'s Outreach program. You get a Department of Labor card that shows you took the course — it is a card, not a certification or a license.',
  },
  {
    key: 'osha30',
    term: 'OSHA 30',
    re: /\bOSHA[\s-]*30\b/i,
    def: 'A 30-hour version of OSHA\'s Outreach safety course, usually for leads and supervisors. Like OSHA 10, it gives a course card — not a certification or a license.',
  },
  // Basis: TSA, Transportation Worker Identification Credential (49 CFR Part 1572; 33 CFR 101.514).
  {
    key: 'twic',
    term: 'TWIC',
    re: /\bTWIC\b/,
    def: 'Transportation Worker Identification Credential: an ID card issued by the TSA after a background check. It is needed to enter secure areas of ports, vessels and some refineries without an escort.',
  },
  // Basis: FMCSA, 49 CFR 383.91 (commercial motor vehicle groups A, B, C).
  {
    key: 'cdl_a',
    term: 'CDL Class A',
    re: /\bCDL[\s-]*(?:class\s*)?A\b|\bclass\s*A\s+(?:CDL|commercial|licen[sc]e|driver)/i,
    def: 'A commercial driver\'s license for vehicle combinations over 26,000 lbs where the towed unit is over 10,000 lbs — a tractor-trailer, for example. A Class A holder may also drive most Class B and C vehicles.',
  },
  {
    key: 'cdl_b',
    term: 'CDL Class B',
    re: /\bCDL[\s-]*(?:class\s*)?B\b|\bclass\s*B\s+(?:CDL|commercial|licen[sc]e|driver)/i,
    def: 'A commercial driver\'s license for a single vehicle over 26,000 lbs, towing 10,000 lbs or less — a straight truck, dump truck or vacuum truck, for example.',
  },
  // Basis: FMCSA, 49 CFR 383.93 (H hazardous materials, N tank vehicle, T double/triple trailers, X tank + hazmat). The
  // H and X endorsements also need a TSA security threat assessment (49 CFR 1572).
  {
    key: 'endorsements',
    term: 'CDL endorsements (H, N, T, X)',
    // an endorsement beside a CDL / hazmat / tanker word, or named by its letter — never "endorsement" in another sense
    re: /\b(?:haz\s*-?\s*mat|tanker|tank\s+vehicle|doubles?\s*\/\s*triples?|[HNTX])\s+endorsements?\b|\bendorsements?\s*[(:]?\s*[HNTX]\b|\bCDL\b[^.\n]{0,40}\bendorsements?\b|\bendorsements?\b[^.\n]{0,40}\b(?:CDL|haz\s*-?\s*mat|tanker)\b/i,
    def: 'Extra tests added to a CDL: H for hazardous materials, N for tank vehicles, T for double or triple trailers, and X for tank plus hazardous materials. H and X also need a TSA background check.',
  },
  // Basis: FMCSA, 49 CFR 391.41–391.45 (physical qualification; the certificate is valid up to 24 months) and the
  // National Registry of Certified Medical Examiners (49 CFR 390.101).
  {
    key: 'dot_medical',
    term: 'DOT medical card',
    re: /\bDOT\s+(?:medical|physical|med(?:ical)?\s+card)\b|\bmedical\s+examiner['’]?s?\s+(?:card|certificate)\b|\bDOT\s+card\b/i,
    def: 'A medical examiner\'s certificate from a physical exam by an examiner on the FMCSA National Registry. Commercial drivers must carry one; it is valid for up to 24 months.',
  },
  // Basis: EPA, Clean Air Act Section 608, 40 CFR Part 82 Subpart F (Types I, II, III and Universal; the certification
  // does not expire).
  {
    key: 'epa608',
    term: 'EPA 608',
    re: /\bEPA\s*(?:section\s*)?608\b|\bEPA\s+(?:type\s+(?:I{1,3}|[123])|universal)\b|\bsection\s+608\b/i,
    def: 'EPA Section 608 technician certification, required to work on equipment that holds refrigerant (air conditioning and refrigeration). It comes as Type I, II, III or Universal and does not expire.',
  },
  // Basis: OSHA, 29 CFR 1910.178(l) (powered industrial truck operator training: the employer trains and evaluates each
  // operator on the trucks and conditions of that workplace; re-evaluated at least every three years).
  {
    key: 'forklift',
    term: 'Forklift certification',
    re: /\bforklift\s+(?:certification|certificate|certified|card|licen[sc]e|operator\s+certification|training)\b|\bcertifi\w*\s+(?:to\s+operate\s+)?(?:a\s+)?forklifts?\b|\bpowered\s+industrial\s+truck\b/i,
    def: 'Under OSHA\'s rule, each employer trains and evaluates its own forklift operators on its own equipment. A card from a school or an earlier job does not carry over on its own — the new employer still checks you out.',
  },
  // Basis: 42 CFR 483.152 (nurse aide training: at least 75 clock hours, 16 of them supervised practical training) and
  // 42 CFR 483.156 (the state nurse aide registry).
  {
    key: 'cna',
    term: 'CNA',
    re: /\bCNA\b|\bcertified\s+nurs(?:ing|e)\s+(?:assistant|aide)\b/i,
    def: 'Certified Nursing Assistant: you finish a state-approved training program (at least 75 hours under federal rules) and pass the state exam, then you are listed on the state\'s nurse aide registry.',
  },
  // Basis: National Registry of Emergency Medical Technicians (nremt.org); licensing itself is done by each state's EMS
  // office.
  {
    key: 'nremt',
    term: 'NREMT',
    re: /\bNREMT\b|\bnational\s+registry\b(?=[^.\n]{0,40}\b(?:emt|paramedic|emergency\s+medical)\b)/i,
    def: 'The National Registry of Emergency Medical Technicians runs the national certification exam for EMTs and paramedics. Most states use it as part of licensing; the job also needs the state\'s own EMS license.',
  },
  // Basis: Pharmacy Technician Certification Board (ptcb.org); whether a technician must be certified is set by each
  // state's board of pharmacy.
  {
    key: 'ptcb',
    term: 'PTCB / CPhT',
    re: /\bPTCB\b|\bCPhT\b|\bPTCE\b/,
    def: 'The Pharmacy Technician Certification Board gives the CPhT credential after its exam. Some states require pharmacy technicians to be certified; others do not.',
  },
  // Basis: CompTIA (comptia.org): A+ is two exams (Core 1 and Core 2), valid three years, renewable by continuing
  // education.
  {
    key: 'comptia_a',
    term: 'CompTIA A+',
    re: /\bCompTIA\s+A\+|\bA\+\s+certif\w*/i,
    def: 'An entry-level IT support certification from CompTIA: two exams on hardware, operating systems, networking and troubleshooting. It is valid for three years and renewed with continuing education.',
  },
];

/**
 * The glossary entries a posting uses, in glossary order (each once).
 * @param {string} text the posting's title and/or description
 * @returns {Array<{ key: string, term: string, def: string }>}
 */
export function termsIn(text) {
  const t = String(text || '');
  if (!t) return [];
  return GLOSSARY.filter((g) => g.re.test(t)).map(({ key, term, def }) => ({ key, term, def }));
}

/** One entry by key, or null. */
export function glossaryEntry(key) {
  const g = GLOSSARY.find((x) => x.key === key);
  return g ? { key: g.key, term: g.term, def: g.def } : null;
}
