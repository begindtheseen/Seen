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
  { names: ['AP', 'A/P', 'accounts payable'], proofs: ['AP', 'accounts payable', 'A/P'], kind: 'skill', source: 'accounting abbreviation' },
  { names: ['AR', 'A/R', 'accounts receivable'], proofs: ['AR', 'accounts receivable', 'A/R'], kind: 'skill', source: 'accounting abbreviation' },
  { names: ['GAAP', 'generally accepted accounting principles'], proofs: ['GAAP', 'generally accepted accounting principles'], kind: 'skill', source: 'accounting abbreviation' },
  { names: ['GL', 'general ledger'], proofs: ['general ledger', 'GL'], kind: 'skill', source: 'accounting abbreviation' },
  { names: ['P&L', 'profit and loss'], proofs: ['P&L', 'profit and loss', 'income statement'], kind: 'skill', source: 'accounting abbreviation (the P&L is the income statement)' },
  { names: ['ERP', 'ERP systems', 'ERP system'], proofs: ['ERP', 'NetSuite', 'SAP', 'Oracle Financials', 'Oracle ERP', 'Oracle Fusion', 'Microsoft Dynamics', 'Dynamics 365', 'Sage Intacct', 'Sage 100', 'Sage X3', 'Workday Financials', 'QuickBooks Enterprise', 'Acumatica', 'Epicor', 'Infor ERP'], kind: 'tool', source: 'each product is an ERP' },
  // software — a framework's ".js" name is the framework (React is React.js; Next.js is written "Next" or "NextJS")
  { names: ['React.js', 'ReactJS', 'React'], proofs: ['React', 'React.js', 'ReactJS'], kind: 'tool', source: 'product name (the same library)' },
  { names: ['Next.js', 'NextJS'], proofs: ['Next.js', 'NextJS'], kind: 'tool', source: 'product name' },
  { names: ['Node.js', 'NodeJS', 'Node'], proofs: ['Node.js', 'NodeJS', 'Node'], kind: 'tool', source: 'product name (the same runtime)' },
  { names: ['Vue.js', 'VueJS', 'Vue'], proofs: ['Vue', 'Vue.js', 'VueJS'], kind: 'tool', source: 'product name' },
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
    proofs: ['EMR', 'EHR', 'electronic medical record', 'electronic health record', 'Epic', 'Cerner', 'Meditech', 'athenaOne', 'HCHB', 'Homecare Homebase', 'athenahealth', 'eClinicalWorks', 'PointClickCare', 'NextGen', 'Allscripts', 'Kareo'], kind: 'tool', source: 'each product is an EHR' },
  { names: ['patient care', 'direct patient care', 'bedside care'], proofs: [['patient', 'care'], ['care', 'patient']], kind: 'field', source: 'the same words on one line ("Provide care for 4-5 telemetry patients")' },
  { names: ['ECG', 'EKG', 'electrocardiogram', 'electrocardiograms', '12-lead ECG', '12-lead EKG'], proofs: ['ECG', 'EKG', 'electrocardiogram', '12-lead'], kind: 'skill', source: 'ECG and EKG are the same test (EKG from the German spelling)' },
  { names: ['IV therapy', 'IV', 'intravenous therapy', 'IV insertion', 'IV starts'], proofs: ['IV', 'intravenous', 'IV drips', 'IV therapy'], kind: 'skill', source: 'clinical abbreviation' },
  { names: ['POS', 'point of sale', 'POS system', 'POS systems'], proofs: ['POS', 'point of sale', 'point-of-sale', 'cash register', 'Square POS', 'Clover', 'Toast POS', 'Aloha', 'Micros', 'Lightspeed POS', 'NCR Aloha'], kind: 'tool', source: 'retail abbreviation; each product is a POS' },
  { names: ['HIPAA'], proofs: ['HIPAA'], kind: 'skill', source: 'law name' },
  // software — CI products ARE continuous integration
  { names: ['CI', 'continuous integration', 'CI/CD'], proofs: ['CI', 'CI/CD', 'continuous integration', 'GitHub Actions', 'Jenkins', 'CircleCI', 'GitLab CI', 'Buildkite', 'Travis CI'], kind: 'skill', source: 'each product is a CI system' },
  // office
  { names: ['Microsoft Office Suite', 'Microsoft Office', 'MS Office', 'Office 365', 'Microsoft 365'], proofs: ['Microsoft Office', 'MS Office', 'Office 365', 'Microsoft 365', 'Microsoft Office Suite'], kind: 'tool', source: 'product names' },
  { names: ['slide decks', 'slide deck', 'presentation decks', 'PowerPoint presentations'], proofs: ['PowerPoint', 'Google Slides', 'Keynote', 'slide deck'], kind: 'skill', source: 'each product makes slide decks' },
  { names: ['travel coordination', 'travel arrangements', 'travel booking', 'coordinate travel'], proofs: [['travel', 'manag'], ['travel', 'coordin'], ['travel', 'arrang'], ['travel', 'book'], ['travel', 'plan']], kind: 'skill', source: 'arranging travel, said the person\'s way' },
  { names: ['scheduling'], proofs: ['scheduling', ['calendar', 'manag']], kind: 'skill', source: 'calendar management is scheduling' },
  // warehouse
  { names: ['WMS', 'warehouse management system', 'warehouse management systems'], proofs: ['WMS', 'warehouse management system', 'Manhattan', 'Manhattan WMS', 'Blue Yonder', 'JDA', 'HighJump', 'Korber', 'SAP EWM', 'SAP WM', 'Infor WMS', 'Oracle WMS'], kind: 'tool', source: 'each product is a WMS' },
  { names: ['KPI', 'KPIs', 'key performance indicators'], proofs: ['KPI', 'KPIs', 'key performance indicator'], kind: 'skill', source: 'abbreviation' },
  { names: ['SOP', 'SOPs', 'standard operating procedures'], proofs: ['SOP', 'SOPs', 'standard operating procedure'], kind: 'skill', source: 'abbreviation' },
  // instance ⇒ class (coordinator, 2026-11-10): each product IS one of the category the posting names
  { names: ['CRM', 'CRM software', 'CRM systems', 'CRM system', 'CRM tools', 'customer relationship management'], proofs: ['CRM', 'Salesforce', 'HubSpot', 'Zendesk', 'Zoho', 'Pipedrive', 'Microsoft Dynamics', 'Dynamics 365', 'Freshsales', 'Insightly', 'Keap', 'Salesforce Service Cloud', 'customer relationship management'], kind: 'tool', source: 'each product is a CRM' },
  { names: ['ticketing system', 'ticketing systems', 'ticketing tools', 'ticketing software', 'help desk software', 'helpdesk software', 'ticketing'], proofs: ['Zendesk', 'Jira', 'ServiceNow', 'Freshdesk', 'Jira Service Management', 'Help Scout', 'Kayako', 'ticketing system', 'ticketing'], kind: 'tool', source: 'each product is a ticketing system' },
  { names: ['ATS', 'applicant tracking system', 'applicant tracking systems'], proofs: ['ATS', 'applicant tracking', 'Greenhouse ATS', 'Lever ATS', 'Workday Recruiting', 'iCIMS', 'Taleo', 'SmartRecruiters', 'Jobvite', 'BambooHR', 'Ashby'], kind: 'tool', source: 'each product is an ATS' },
  { names: ['LMS', 'learning management system', 'learning management systems'], proofs: ['LMS', 'learning management system', 'Canvas LMS', 'Blackboard', 'Moodle', 'Docebo', 'Cornerstone OnDemand', 'TalentLMS', 'Schoology', 'D2L'], kind: 'tool', source: 'each product is an LMS' },
  { names: ['CAD', 'CAD software', 'computer-aided design', 'computer aided design'], proofs: ['CAD', 'AutoCAD', 'SolidWorks', 'Revit', 'Autodesk Inventor', 'CATIA', 'PTC Creo', 'Fusion 360', 'Siemens NX', 'MicroStation', 'computer-aided design'], kind: 'tool', source: 'each product is CAD software' },
  { names: ['cloud', 'cloud platforms', 'cloud platform', 'cloud services', 'cloud infrastructure', 'cloud computing', 'public cloud'], proofs: ['AWS', 'Amazon Web Services', 'Azure', 'GCP', 'Google Cloud', 'cloud'], kind: 'tool', source: 'each is a public cloud' },
  { names: ['version control', 'source control', 'version control systems'], proofs: ['Git', 'GitHub', 'GitLab', 'Bitbucket', 'SVN', 'Subversion', 'Mercurial', 'version control'], kind: 'tool', source: 'each is version control' },
  { names: ['spreadsheets', 'spreadsheet', 'spreadsheet software', 'spreadsheet tools'], proofs: ['Excel', 'Google Sheets', 'spreadsheet', 'Smartsheet'], kind: 'tool', source: 'each is spreadsheet software' },
  { names: ['presentation tools', 'presentation software', 'presentations software'], proofs: ['PowerPoint', 'Google Slides', 'Keynote', 'Prezi', 'Canva'], kind: 'tool', source: 'each is presentation software' },
  // duty-level sameness: the duty said the way the person's line says it
  { names: ['agent performance improvement', 'agent performance', 'performance coaching', 'coaching agents', 'agent coaching'], proofs: ['1:1s', '1:1', 'one-on-ones', 'call reviews', 'call review', 'QA scores', 'quality scores', 'coaching', 'coached'], kind: 'duty', source: 'how a support lead improves agent performance' },
  { names: ['live call monitoring', 'call monitoring', 'monitor calls', 'call quality monitoring'], proofs: ['call reviews', 'call review', 'call monitoring', 'monitored calls', 'listened to calls', 'QA reviews'], kind: 'duty', source: 'reviewing calls is call monitoring' },
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

// An INSTANCE proves its CLASS (director, 2026-11-10, R2): a résumé that says "forklift, reach truck, pallet jack" shows
// "warehouse equipment"; "RF scanner" shows scanning; "Epic" shows an EHR (that one lives in FIELD_ALIASES above).
// Used by the statement judge (judgeStatement.js) on whole posting lines. `names` = how a posting writes the class;
// `instances` = what on ONE résumé line is a member of it. Members only — never a neighbouring skill.
export const INSTANCE_CLASSES = [
  { id: 'warehouse-equipment', names: /\b(?:warehouse|material[- ]handling|materials[- ]handling|powered\s+industrial|industrial|moving|lifting|mhe)\s+(?:equipment|vehicles?|trucks?|machinery)\b|\bpowered\s+industrial\s+trucks?\b|\bPITs?\b|\bMHE\b|\blift\s+equipment\b/i,
    instances: [/\bfork\s?lifts?\b/i, /\breach\s+trucks?\b/i, /\bpallet\s+jacks?\b/i, /\border\s+pickers?\b/i, /\bscissor\s+lifts?\b/i, /\bcherry\s+pickers?\b/i, /\bclamp\s+trucks?\b/i, /\btuggers?\b/i, /\bhand\s+trucks?\b/i, /\bstand-up\b|\bsit-down\b/i, /\bboom\s+lifts?\b/i, /\bhoists?\b/i, /\bcranes?\b/i], source: 'each is material handling equipment (OSHA powered industrial trucks + hand equipment)' },
  { id: 'scanning', names: /\b(?:scan(?:ning|s|ned)?|scanners?|rf\s+(?:guns?|devices?|scanners?)|barcod\w*)\b/i,
    instances: [/\bRF\b/, /\bscan(?:ner|ners|ning|ned|s)?\b/i, /\bbar\s?codes?\b/i, /\bscan\s+guns?\b/i, /\bhand-?helds?\b/i], source: 'an RF / barcode scanner is how a warehouse scans' },
  { id: 'hand-tools', names: /\bhand\s+tools?\b/i,
    instances: [/\bwrench(?:es)?\b/i, /\bscrewdrivers?\b/i, /\bpliers\b/i, /\bhammers?\b/i, /\bsockets?\s+(?:sets?|wrench)/i, /\bhand\s+tools?\b/i], source: 'each is a hand tool' },
  { id: 'power-tools', names: /\bpower\s+tools?\b/i,
    instances: [/\bpower\s+tools?\b/i, /\b(?:power|cordless|hammer)\s+drills?\b/i, /\bimpact\s+(?:drivers?|wrench(?:es)?)\b/i, /\b(?:circular|miter|reciprocating|table|band)\s+saws?\b/i, /\bangle\s+grinders?\b/i, /\bnail\s+guns?\b/i, /\bsanders?\b/i], source: 'each is a power tool' },
  { id: 'test-meters', names: /\b(?:electrical\s+)?(?:test\s+(?:equipment|instruments?)|meters|gauges)\b/i,
    instances: [/\bmulti-?meters?\b/i, /\bvolt-?meters?\b/i, /\bammeters?\b/i, /\bmeggers?\b/i, /\boscilloscopes?\b/i, /\bclamp\s+meters?\b/i, /\bamp\s+clamps?\b/i, /\binsulation\s+testers?\b/i], source: 'each is electrical test equipment' },
  { id: 'kitchen-equipment', names: /\b(?:kitchen|cooking|food\s+service)\s+equipment\b/i,
    instances: [/\bfryers?\b/i, /\bgrills?\b/i, /\bflat-?tops?\b/i, /\bovens?\b/i, /\bslicers?\b/i, /\bmixers?\b/i, /\bsteamers?\b/i], source: 'each is kitchen equipment' },
  { id: 'office-equipment', names: /\boffice\s+equipment\b/i,
    instances: [/\bcopiers?\b/i, /\bprinters?\b/i, /\bscanners?\b/i, /\bfax\b/i, /\bmulti-?line\s+phones?\b/i], source: 'each is office equipment' },
  { id: 'programming-language', names: /\b(?:programming|coding|scripting)\s+languages?\b/i,
    instances: [/\bPython\b/, /\bJava\b/, /\bGo(?:lang)?\b(?=[\s,).;]|$)/, /\bRust\b/, /\bC\+\+/, /\bC#/, /\bJavaScript\b/, /\bTypeScript\b/, /\bRuby\b/, /\bPHP\b/, /\bKotlin\b/, /\bSwift\b/, /\bScala\b/, /\bPerl\b/, /\bR\b(?=\s*[,(]|\s+programming)/, /\bMATLAB\b/i], source: 'each is a programming language' },
  { id: 'cash-handling', names: /\bcash\s+(?:handling|registers?|drawers?)\b|\bhandl(?:e|ing)\s+cash\b|\bpoint[- ]of[- ]sale\b|\bPOS\b/i,
    instances: [/\bcash(?:ier)?\b/i, /\bregisters?\b/i, /\bPOS\b/, /\bpoint[- ]of[- ]sale\b/i, /\btills?\b/i], source: 'a cashier handles cash at the register' },
];
