// Field-standard aliases — the ONE table of "these words name the same requirement" that the verdict uses when the
// posting and the résumé write a requirement differently (2026-11-10 judge, optimize #3c / #4, prep D10).
//
// Why: "AP" was missing for an accountant whose line says "Accounts payable processing"; "electrical codes" was
// missing for an electrician whose skills say "NEC"; "Homecare Homebase" was missing while "HCHB" was matched; an RN
// holding BLS was hard-gated on "CPR". The stemmer cannot know these; a person in the field always does.
//
// Rules for an entry (keep it this way):
//   • `names` — how a POSTING may write the requirement (matched against the requirement's label / phrases);
//   • `proofs` — what on ONE résumé line proves it: a phrase (matched by word stems, contiguous), an ACRONYM (matched
//     as a whole word, case-sensitive), or an array of stems that must all sit on the same line;
//   • every entry names its source: a field-standard abbreviation, a certification body's own wording, or a product
//     that IS an instance of the category (Epic is an EHR). Never a "related" skill — related is not the same thing.
//   • proving is one-way where the field is: BLS proves CPR (BLS is AHA's CPR certification), CPR does not prove BLS.

export const FIELD_ALIASES = [
  // accounting — standard ledger abbreviations (AICPA / any AP-AR job ladder)
  { names: ['AP', 'accounts payable'], proofs: ['AP', 'accounts payable', 'A/P'], kind: 'skill', source: 'accounting abbreviation' },
  { names: ['AR', 'accounts receivable'], proofs: ['AR', 'accounts receivable', 'A/R'], kind: 'skill', source: 'accounting abbreviation' },
  { names: ['GAAP', 'generally accepted accounting principles'], proofs: ['GAAP', 'generally accepted accounting principles'], kind: 'skill', source: 'accounting abbreviation' },
  { names: ['GL', 'general ledger'], proofs: ['general ledger', 'GL'], kind: 'skill', source: 'accounting abbreviation' },
  { names: ['P&L', 'profit and loss'], proofs: ['P&L', 'profit and loss', 'income statement'], kind: 'skill', source: 'accounting abbreviation (the P&L is the income statement)' },
  { names: ['ERP', 'ERP systems', 'ERP system'], proofs: ['ERP', 'NetSuite', 'SAP', 'Oracle Financials', 'Microsoft Dynamics', 'Sage Intacct', 'Workday Financials'], kind: 'tool', source: 'each product is an ERP' },
  // trades — NFPA 70 is the National Electrical Code
  { names: ['NEC', 'National Electrical Code', 'electrical code', 'electrical codes', 'NFPA 70'], proofs: ['NEC', 'National Electrical Code', 'NFPA 70', 'electrical code'], kind: 'skill', source: 'NFPA 70 = NEC' },
  { names: ['PPE', 'personal protective equipment'], proofs: ['PPE', 'personal protective equipment'], kind: 'skill', source: 'OSHA abbreviation' },
  { names: ['HVAC', 'heating, ventilation and air conditioning'], proofs: ['HVAC', 'heating, ventilation and air conditioning', 'HVAC-R', 'HVACR'], kind: 'skill', source: 'trade abbreviation' },
  // nursing / clinical — AHA course names; EHR products
  { names: ['CPR', 'CPR certification', 'CPR certified'], proofs: ['CPR', 'BLS', 'Basic Life Support', 'ACLS', 'PALS'], kind: 'credential', source: 'AHA: BLS/ACLS/PALS include CPR certification' },
  { names: ['BLS', 'Basic Life Support'], proofs: ['BLS', 'Basic Life Support'], kind: 'credential', source: 'AHA course name' },
  { names: ['ACLS', 'Advanced Cardiac Life Support'], proofs: ['ACLS', 'Advanced Cardiac Life Support'], kind: 'credential', source: 'AHA course name' },
  { names: ['PALS', 'Pediatric Advanced Life Support'], proofs: ['PALS', 'Pediatric Advanced Life Support'], kind: 'credential', source: 'AHA course name' },
  { names: ['RN', 'registered nurse'], proofs: ['RN', 'registered nurse'], kind: 'credential', source: 'licence abbreviation' },
  { names: ['LPN', 'licensed practical nurse', 'LVN', 'licensed vocational nurse'], proofs: ['LPN', 'LVN', 'licensed practical nurse', 'licensed vocational nurse'], kind: 'credential', source: 'licence abbreviation (LVN is the CA/TX name for LPN)' },
  { names: ['CNA', 'certified nursing assistant'], proofs: ['CNA', 'certified nursing assistant'], kind: 'credential', source: 'certification abbreviation' },
  { names: ['HCHB', 'Homecare Homebase'], proofs: ['HCHB', 'Homecare Homebase'], kind: 'tool', source: 'product abbreviation' },
  { names: ['EMR', 'EHR', 'EMR systems', 'EHR systems', 'electronic medical records', 'electronic health records', 'electronic medical record', 'electronic health record', 'electronic records'],
    proofs: ['EMR', 'EHR', 'electronic medical record', 'electronic health record', 'Epic', 'Cerner', 'Meditech', 'HCHB', 'Homecare Homebase', 'athenahealth', 'eClinicalWorks', 'PointClickCare', 'NextGen', 'Allscripts', 'Kareo'], kind: 'tool', source: 'each product is an EHR' },
  { names: ['patient care', 'direct patient care', 'bedside care'], proofs: [['patient', 'care'], ['care', 'patient']], kind: 'field', source: 'the same words on one line ("Provide care for 4-5 telemetry patients")' },
  { names: ['HIPAA'], proofs: ['HIPAA'], kind: 'skill', source: 'law name' },
  // software — CI products ARE continuous integration
  { names: ['CI', 'continuous integration', 'CI/CD'], proofs: ['CI', 'CI/CD', 'continuous integration', 'GitHub Actions', 'Jenkins', 'CircleCI', 'GitLab CI', 'Buildkite', 'Travis CI'], kind: 'skill', source: 'each product is a CI system' },
  // office
  { names: ['Microsoft Office Suite', 'Microsoft Office', 'MS Office', 'Office 365', 'Microsoft 365'], proofs: ['Microsoft Office', 'MS Office', 'Office 365', 'Microsoft 365', 'Microsoft Office Suite'], kind: 'tool', source: 'product names' },
  { names: ['slide decks', 'slide deck', 'presentation decks', 'PowerPoint presentations'], proofs: ['PowerPoint', 'Google Slides', 'Keynote', 'slide deck'], kind: 'skill', source: 'each product makes slide decks' },
  { names: ['travel coordination', 'travel arrangements', 'travel booking', 'coordinate travel'], proofs: [['travel', 'manag'], ['travel', 'coordin'], ['travel', 'arrang'], ['travel', 'book'], ['travel', 'plan']], kind: 'skill', source: 'arranging travel, said the person\'s way' },
  { names: ['scheduling'], proofs: ['scheduling', ['calendar', 'manag']], kind: 'skill', source: 'calendar management is scheduling' },
  // warehouse
  { names: ['WMS', 'warehouse management system', 'warehouse management systems'], proofs: ['WMS', 'warehouse management system', 'Manhattan WMS', 'Blue Yonder', 'HighJump', 'SAP EWM'], kind: 'tool', source: 'each product is a WMS' },
  { names: ['KPI', 'KPIs', 'key performance indicators'], proofs: ['KPI', 'KPIs', 'key performance indicator'], kind: 'skill', source: 'abbreviation' },
  { names: ['SOP', 'SOPs', 'standard operating procedures'], proofs: ['SOP', 'SOPs', 'standard operating procedure'], kind: 'skill', source: 'abbreviation' },
];

// Fundamentals a practitioner of a field is tested on, not asked to list (the Interview Prep rule, moved into the
// verdict so every tool agrees — prepLocal.js "Expected of every engineer and tested in the coding round").
export const FIELD_FUNDAMENTALS = [
  { families: ['software_engineering', 'data_analytics'], re: /^(?:algorithms?|data structures?|computer science(?: fundamentals)?|cs fundamentals|coding|problem[- ]solving|software design)$/i },
];

// A requirement a person's own job TITLE shows ("software engineering" for a Software Engineer, "patient care" for a
// Registered Nurse). Matched only on the title segment of a role header (never the employer), labelled via 'title'.
export const TITLE_PROVES = [
  { req: /^(?:software (?:engineering|development)|software engineer(?:ing)?|programming|coding|software design)$/i,
    title: /\b(?:software|backend|back-end|front-?end|full[- ]?stack|platform|web|mobile|ios|android|devops|site reliability|application|systems)\s+(?:engineer|developer)\b|\bprogrammer\b|\bsoftware\s+(?:\w+\s+)?engineer\b/i },
  { req: /^(?:patient care|direct patient care|bedside care|nursing(?: care| practice)?|clinical nursing)$/i, title: /\b(?:[Rr]egistered [Nn]urse|[Nn]urse|RN|LPN|LVN|[Nn]ursing [Aa]ssistant|CNA|[Pp]atient [Cc]are [Tt]ech(?:nician)?)\b/ },
  { req: /^(?:electrical(?: systems| work| installation| wiring| construction)?|wiring|electrical maintenance)$/i, title: /\belectrician\b/i },
  { req: /^(?:accounting|general accounting|corporate accounting|bookkeeping)$/i, title: /\b(?:accountant|bookkeeper|controller|accounting (?:manager|specialist|clerk))\b/i },
];
