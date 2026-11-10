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
  { names: ['PTA', 'physical therapist assistant', 'physical therapy assistant'], proofs: ['PTA', 'physical therapist assistant', 'physical therapy assistant'], kind: 'credential', source: 'licence abbreviation (APTA)' },
  { names: ['OTA', 'COTA', 'occupational therapy assistant', 'certified occupational therapy assistant'], proofs: ['OTA', 'COTA', 'occupational therapy assistant', 'occupational therapist assistant'], kind: 'credential', source: 'licence abbreviation (NBCOT)' },
  { names: ['LPN', 'licensed practical nurse', 'LVN', 'licensed vocational nurse'], proofs: ['LPN', 'LVN', 'licensed practical nurse', 'licensed vocational nurse'], kind: 'credential', source: 'licence abbreviation (LVN is the CA/TX name for LPN)' },
  { names: ['CNA', 'certified nursing assistant'], proofs: ['CNA', 'certified nursing assistant'], kind: 'credential', source: 'certification abbreviation' },
  { names: ['HCHB', 'Homecare Homebase'], proofs: ['HCHB', 'Homecare Homebase'], kind: 'tool', source: 'product abbreviation' },
  { names: ['EMR', 'EHR', 'EMR systems', 'EHR systems', 'electronic medical records', 'electronic health records', 'electronic medical record', 'electronic health record', 'electronic records'],
    proofs: ['EMR', 'EHR', 'electronic medical record', 'electronic health record', 'Kinnser', 'WellSky', 'Axxess', 'Brightree', 'Alora', 'KanTime', 'Homecare Homebase', 'Meditech Expanse', 'Epic Hyperspace', 'Cerner PowerChart', 'Sunrise', 'NextGen', 'Practice Fusion', 'Greenway', 'ModMed', 'WebPT', 'Net Health', 'TherapyNotes', 'SimplePractice', 'Kareo', 'AdvancedMD', 'Practice Fusion', 'Allscripts', 'drchrono', 'Netsmart', 'MatrixCare', 'Epic', 'Cerner', 'Meditech', 'athenaOne', 'HCHB', 'Homecare Homebase', 'athenahealth', 'eClinicalWorks', 'PointClickCare', 'NextGen', 'Allscripts', 'Kareo'], kind: 'tool', source: 'each product is an EHR' },
  { names: ['patient care', 'direct patient care', 'bedside care'], proofs: [['patient', 'care'], ['care', 'patient']], kind: 'field', source: 'the same words on one line ("Provide care for 4-5 telemetry patients")' },
  { names: ['ECG', 'EKG', 'electrocardiogram', 'electrocardiograms', '12-lead ECG', '12-lead EKG'], proofs: ['ECG', 'EKG', 'electrocardiogram', '12-lead'], kind: 'skill', source: 'ECG and EKG are the same test (EKG from the German spelling)' },
  { names: ['IV therapy', 'IV', 'intravenous therapy', 'IV insertion', 'IV starts'], proofs: ['IV', 'intravenous', 'IV drips', 'IV therapy'], kind: 'skill', source: 'clinical abbreviation' },
  { names: ['POS', 'point of sale', 'POS system', 'POS systems'], proofs: ['POS', 'point of sale', 'point-of-sale', 'cash register', 'Square POS', 'Clover', 'Toast POS', 'Aloha', 'Micros', 'Lightspeed POS', 'NCR Aloha'], kind: 'tool', source: 'retail abbreviation; each product is a POS' },
  { names: ['HIPAA'], proofs: ['HIPAA'], kind: 'skill', source: 'law name' },
  // software — CI products ARE continuous integration
  { names: ['CI', 'continuous integration', 'CI/CD'], proofs: ['CI', 'CI/CD', 'continuous integration', 'GitHub Actions', 'Jenkins', 'CircleCI', 'GitLab CI', 'Buildkite', 'Travis CI'], kind: 'skill', source: 'each product is a CI system' },
  // office
  { names: ['Microsoft Office Suite', 'Microsoft Office', 'MS Office', 'Office 365', 'Microsoft 365'], proofs: ['Microsoft Office', 'MS Office', 'Office 365', 'Microsoft 365', 'Microsoft Office Suite'], kind: 'tool', source: 'product names' },
  { names: ['computer skills', 'computer software', 'computer programs', 'technology skills', 'basic technology skills', 'computer literacy', 'computer literate', 'computer proficiency'], proofs: ['Excel', 'Microsoft Office', 'MS Office', 'Microsoft Word', 'PowerPoint', 'Outlook', 'Google Workspace', 'Google Sheets', 'G Suite', 'QuickBooks', 'SAP', 'Salesforce', 'POS', 'Procore', 'NetSuite', 'Workday', 'Zendesk', 'computer'], kind: 'tool', source: 'office software is what a posting means by computer skills' },
  { names: ['Microsoft Project', 'MS Project'], proofs: ['Microsoft Project', 'MS Project'], kind: 'tool', source: 'product name' },
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
  // a job title is the field's own work: a barista or cashier has retail / customer-service / hospitality experience
  { req: /^(?:retail|customer service|customer-facing|hospitality|guest service|front of house)(?: experience| work| background)?$/i, title: /\b(?:barista|cashier|server|waiter|waitress|host(?:ess)?|bartender|crew member|sales associate|retail associate|store associate|busser|front desk|guest service|customer service|shift (?:lead|supervisor)|store manager|assistant manager)\b/i },
  { req: /^(?:food service|restaurant|kitchen|food preparation|hospitality)(?: experience| work| background)?$/i, title: /\b(?:line cook|prep cook|cook|chef|sous chef|kitchen (?:lead|manager)|barista|server|crew member|dishwasher)\b/i },
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
  { id: 'cash-handling', names: /\bcash(?:\/money)?\s+(?:handling|registers?|drawers?)\b|\bhandl(?:e|ing)\s+cash\b|\bpoint[- ]of[- ]sale\b|\bPOS\b/i,
    instances: [/\bcash(?:ier)?\b/i, /\bregisters?\b/i, /\bPOS\b/, /\bpoint[- ]of[- ]sale\b/i, /\btills?\b/i], source: 'a cashier handles cash at the register' },
];

// ── SAME THING, BY STRUCTURE (engineer V, 2026-11-10) ─────────────────────────────────────────────────────────────
// The statement judge (judgeStatement.js) reads a requirement and each résumé line as ACTION + OBJECT (+ qualifiers) and
// matches them separately. These tables say which word forms are the same action / the same object, so "Present
// findings" is shown by "Presented churn findings to the VP", "Educate patients" by "patient teaching at every visit",
// and "Keep the warehouse clean" by "Kept work area clean and followed 5S".
// Rules for an entry (closed list, reviewed by reading each member as "would a recruiter say these are the same?"):
//   • `forms` — single words in ANY word class (verb, noun, agent noun, gerund): stemmed by the judge, so list the
//     forms whose stems differ (teach / taught / teacher). `phrases` — multi-word forms, matched contiguously.
//   • a family is ONE kind of doing. Neighbouring kinds are separate families joined by `near` only when a posting
//     coordinates them ("Train and coach new cooks" is one activity), never for a single verb.
//   • an action alone never proves anything (the judge needs the object too), so a family may be broad within its kind.
export const ACTION_FAMILIES = [
  { id: 'teach', forms: 'teach teaches taught teaching educate educates educated educating education educator instruct instructs instructed instructing instruction instructor train trains trained training trainer onboard onboards onboarded onboarding tutor tutors tutored tutoring precept precepts precepted precepting preceptor preceptorship orient orients oriented orientation', near: ['coach', 'facilitate', 'hire'], source: 'teaching, training, onboarding and precepting are one kind of doing' },
  { id: 'coach', forms: 'coach coaches coached coaching mentor mentors mentored mentoring mentorship guidance', phrases: ['1:1', '1:1s', 'one-on-one', 'one-on-ones', 'one on one', 'one on ones', 'performance feedback', 'feedback sessions', 'performance reviews', 'gave feedback', 'give feedback', 'giving feedback'], near: ['teach'], source: 'coaching is given in 1:1s, feedback and reviews' },
  { id: 'present', forms: 'present presents presented presenting presentation presentations presenter', phrases: ['briefed', 'walked leadership through'], source: 'present / presentation / presenter' },
  { id: 'create', forms: 'plan plans planned planning create creates created creating author authors authored authoring write writes wrote written writing draft drafts drafted drafting develop develops developed developing build builds built building design designs designed designing produce produces produced producing', near: ['update'], source: 'making a document, plan, course or tool' },
  { id: 'update', forms: 'update updates updated updating improve improves improved improving revise revises revised revising rewrite rewrote rebuilt rebuild refresh refreshed', near: ['create'], source: 'improving a thing that exists' },
  { id: 'clean', forms: 'clean cleans cleaned cleaning sanitize sanitizes sanitized sanitizing sanitation sanitary housekeeping tidy', phrases: ['5S', '5-S', 'clean-as-you-go', 'clean as you go'], source: 'cleaning, sanitising, 5S' },
  { id: 'organize', forms: 'organize organizes organized organizing organise organised organising arrange arranged', phrases: ['5S', '5-S'], source: '5S is sort / set in order / shine / standardise / sustain' },
  { id: 'lead', forms: 'lead leads led leading supervise supervises supervised supervising supervisor oversee oversees oversaw overseeing', phrases: ['in charge of', 'shift lead', 'team lead'], source: 'leading people or a shift' },
  { id: 'inspect', forms: 'inspect inspects inspected inspecting inspection check checks checked checking verify verifies verified verifying taste tastes tasted tasting audit audits audited auditing', phrases: ['quality check', 'quality checks', 'spot check', 'spot checks', 'QA'], source: 'checking a thing against a standard' },
  { id: 'track', near: ['document', 'report', 'inspect', 'count'], forms: 'track tracks tracked tracking monitor monitors monitored monitoring log logs logged logging trend trended trending', phrases: ['follow up', 'followed up', 'follow-up', 'follow-ups'], source: 'keeping watch on a measure over time' },
  { id: 'report', near: ['present', 'escalate', 'track'], forms: 'report reports reported reporting', source: 'report / reporting' },
  { id: 'escalate', forms: 'escalate escalates escalated escalating escalation escalations', source: 'escalate / escalation' },
  { id: 'coordinate', forms: 'coordinate coordinates coordinated coordinating coordination liaise liaised liaison align aligns aligned aligning sync synced', phrases: ['worked with', 'work with', 'working with', 'partnered with', 'partner with'], source: 'coordinate / liaise' },
  { id: 'assess', near: ['inspect'], forms: 'assess assesses assessed assessing assessment assessments evaluate evaluates evaluated evaluating evaluation triage triaged triaging', source: 'assess / evaluate / triage' },
  { id: 'hire', forms: 'hire hires hired hiring interview interviews interviewed interviewing recruit recruits recruited recruiting', source: 'bringing people onto a team' },
  { id: 'analyze', near: ['collect'], forms: 'analyze analyzes analyzed analyzing analyse analysed analysing analysis analyses analytics', source: 'analyse / analysis' },
  { id: 'count', forms: 'count counts counted counting reconcile reconciles reconciled reconciling reconciliation', phrases: ['cycle count', 'cycle counts', 'cycle counting', 'physical inventory', 'physical inventories', 'stock count', 'stock counts', 'inventory count', 'inventory counts'], source: 'counting stock and reconciling it to the records' },
  { id: 'store', near: ['organize'], forms: 'stored storing stock stocks stocked stocking restock restocked restocking replenish replenished replenishing shelve shelved shelving slot slotted slotting', phrases: ['put away', 'put-away', 'putaway', 'put aways'], source: 'putting goods where they belong' },
  { id: 'resolve', near: ['troubleshoot'], forms: 'resolve resolves resolved resolving resolution fix fixed fixing', phrases: ['handle complaints', 'handled complaints', 'handle customer complaints', 'handled customer complaints', 'handle guest complaints', 'handled guest complaints', 'handle escalations', 'handled escalations', 'handle escalated'], source: 'resolve / resolution' },
  { id: 'troubleshoot', near: ['resolve'], forms: 'troubleshoot troubleshoots troubleshooted troubleshooting diagnose diagnoses diagnosed diagnosing diagnosis debug debugged debugging isolate isolated', phrases: ['root cause', 'root-cause', 'root caused'], source: 'finding why something fails' },
  { id: 'sell', forms: 'sell sells sold selling sales salesperson upsell upsold upselling', phrases: ['full-cycle sales', 'closed deals', 'close deals', 'closing deals'], source: 'selling' },
  { id: 'collect', near: ['analyze'], forms: 'collect collects collected collecting gather gathered gathering extract extracted extracting capture captured capturing', phrases: ['pull data', 'pulled data', 'pull test data', 'pulled test data', 'data into'], source: 'getting the data' },
  { id: 'automate', forms: 'automate automates automated automating automation', source: 'automate / automation' },
  { id: 'teardown', forms: 'teardown teardowns disassemble disassembled disassembling disassembly', phrases: ['tear down', 'tore down', 'tearing down', 'torn down'], source: 'taking a unit apart to inspect it' },
  { id: 'recommend', forms: 'recommend recommends recommended recommending recommendation recommendations advise advised advising propose proposed proposal', source: 'recommending a course of action' },
  { id: 'negotiate', forms: 'negotiate negotiates negotiated negotiating negotiation negotiations', source: 'negotiate / negotiation' },
  { id: 'test', forms: 'test tests tested testing tester', phrases: ['ran tests', 'run tests', 'test runs'], source: 'testing hardware or software' },
  { id: 'document', forms: 'document documents documented documenting documentation chart charted charting', source: 'documenting / charting' },
  { id: 'order', forms: 'order orders ordered ordering reorder reordered purchase purchased purchasing procure procured procurement', source: 'ordering supplies' },
  { id: 'facilitate', forms: 'facilitate facilitates facilitated facilitating facilitator', phrases: ['led sessions', 'led workshops', 'ran workshops', 'ran sessions', 'ran classes', 'taught classes'], near: ['teach'], source: 'running a session or class' },
  { id: 'enforce', forms: 'enforce enforces enforced enforcing', phrases: ['held the team to', 'hold the team to'], source: 'making others keep a standard' },
];
// A verb that adds nothing before an action noun ("Deliver new-hire training" = train new hires, "Conduct
// assessments" = assess, "Provide feedback" = give feedback). Only light when the object's head names an action.
export const LIGHT_VERBS = new Set(['place', 'deliver', 'provide', 'conduct', 'perform', 'give', 'hold', 'run', 'carry', 'do', 'make', 'complete', 'facilitate', 'lead', 'host', 'offer']);
// Things written two ways (symmetric: either side proves the other). Each `forms` is a single word, `phrases` multi-word.
export const SAME_THING = [
  { id: 'new-hires', forms: 'new-hire new-hires newhire trainee trainees nesting', phrases: ['new hire', 'new hires', 'new agents', 'new employees', 'new associates', 'new staff', 'new team members', 'new reps', 'new representatives', 'new cooks', 'new line cooks', 'new nurses', 'new graduate nurses', 'new grads', 'new teachers', 'new technicians', 'new cashiers', 'new crew members', 'new starters', 'new-hire class', 'onboarding class'], source: 'people new to the job' },
  { id: 'findings', forms: 'findings insights', phrases: ['analysis results', 'recommendations'], source: 'what an analysis found' },
  { id: 'inventory-records', forms: '', phrases: ['inventory records', 'inventory accuracy', 'stock records', 'stock levels', 'inventory levels', 'inventory audits', 'stock audits', 'mini-audits', 'cycle count', 'cycle counts', 'physical inventory', 'stock counts', 'inventory counts', 'inventory reconciliation', 'inventory audits'], source: 'counts are how inventory records are kept accurate' },
  { id: 'call-review', forms: '', phrases: ['call review', 'call reviews', 'call monitoring', 'call listening', 'call calibration', 'call calibrations', 'call audits', 'QA reviews', 'quality reviews', 'monitored calls', 'listened to calls'], source: 'reviewing recorded or live calls' },
  { id: 'one-on-one', forms: '', phrases: ['1:1', '1:1s', 'one-on-one', 'one-on-ones', 'one on one', 'one on ones'], source: 'a one-on-one meeting' },
  { id: 'training-materials', forms: 'playbook playbooks curriculum curricula', phrases: ['training materials', 'training material', 'training content', 'training documentation', 'training guides', 'training manuals', 'training decks', 'job aids', 'job aid', 'help center articles', 'help-center articles', 'help articles', 'knowledge base articles', 'knowledge-base articles', 'knowledge base', 'how-to guides', 'quick reference guides', 'quick-reference guides', 'reference guides', 'lesson plans', 'training modules'], source: 'documents written so someone can learn the job' },
  { id: 'elearning', forms: 'e-learning elearning', phrases: ['online courses', 'online modules', 'e-learning modules', 'e-learning courses', 'Articulate Storyline', 'Articulate Rise', 'SCORM'], source: 'self-paced online training' },
  { id: 'patient-education', forms: '', phrases: ['patient teaching', 'patient education', 'family teaching', 'family education', 'discharge teaching', 'discharge education', 'health teaching', 'health education'], source: 'teaching patients and families is patient education' },
  { id: 'food-quality', forms: '', phrases: ['food quality', 'plate presentation', 'line checks', 'line check', 'taste every', 'tasted every', 'checked every plate', 'check every plate', 'quality of every plate'], source: 'checking the food before it goes out' },
  { id: 'lead-line', forms: 'expedite expedited expediting expo expeditor', phrases: ['lead the line', 'led the line', 'run the line', 'ran the line', 'run the pass', 'ran the pass', 'running the pass', 'call tickets', 'called tickets', 'calling tickets', 'keep tickets moving', 'kept tickets moving'], source: 'kitchen: running service from the pass' },
  { id: 'safety-hazards', forms: 'hazard hazards', phrases: ['safety hazards', 'unsafe conditions', 'near misses', 'near-miss', 'near-misses', 'safety issues', 'safety concerns', 'safety incidents'], source: 'unsafe conditions to report' },
  { id: 'schedule', forms: 'schedule schedules look-ahead look-aheads lookahead lookaheads timeline timelines calendar calendars', phrases: ['look ahead', 'look aheads'], source: 'a dated plan of when things happen (construction calls it a look-ahead)' },
  { id: 'freight', forms: 'freight transportation transport trucking shipping shipments carrier carriers LTL FTL flatbed drayage hauling', source: 'moving goods by carrier' },
  { id: 'spend', forms: 'expense expenses spend spending cost costs budget budgets', source: 'money spent' },
  { id: 'treatment-plans', forms: '', phrases: ['treatment plans', 'treatment plan', 'care plans', 'care plan', 'plan of care', 'plans of care', 'therapy plans', 'therapy plan'], source: 'the plan a clinician writes for a patient' },
  { id: 'predictive-models', forms: '', phrases: ['predictive models', 'predictive model', 'predictive modeling', 'machine learning models', 'machine learning model', 'ML models', 'ML model', 'lead-scoring model', 'lead scoring model', 'propensity model', 'propensity models', 'churn model', 'churn models', 'classification model', 'classification models', 'regression model', 'regression models', 'logistic regression', 'gradient boosting', 'random forest', 'XGBoost', 'forecasting model', 'forecast model'], source: 'a model that predicts an outcome' },
  { id: 'segmentation', forms: 'segmentation clustering k-means', phrases: ['customer segments', 'customer segmentation'], source: 'grouping customers' },
  { id: 'prospecting', forms: 'prospecting prospect prospects outbound', phrases: ['business development', 'pipeline building', 'pipeline generation', 'cold calling', 'cold calls', 'cold outreach', 'meetings booked', 'booked meetings', 'lead generation'], source: 'finding new buyers' },
  { id: 'crm-records', forms: '', phrases: ['CRM records', 'CRM hygiene', 'CRM data', 'Salesforce clean', 'every call logged', 'logged every call', 'pipeline hygiene'], source: 'keeping the CRM accurate' },
  { id: 'cash-handling', forms: 'till tills', phrases: ['cash handling', 'money handling', 'cash/money handling', 'safe drops', 'safe drop', 'cash drawer', 'cash drawers', 'count tills', 'counted tills', 'cash reports', 'balanced the drawer', 'balance the drawer', 'drawer counts', 'deposits'], source: 'handling the cash in a till' },
  { id: 'failures', forms: 'failure failures fault faults defect defects malfunction malfunctions breakdown breakdowns', phrases: ['failure mechanisms', 'failure modes', 'failed units', 'failed parts'], source: 'what goes wrong with hardware' },
  { id: 'discovery', forms: 'discovery', phrases: ['discovery calls', 'discovery call', 'needs analysis', 'needs assessment', 'needs assessments'], source: 'sales: finding what the buyer needs' },
  { id: 'assessments', forms: 'quiz quizzes rubric rubrics exam exams', phrases: ['assessments', 'knowledge checks', 'skills checks', 'test questions'], source: 'quizzes, exams and rubrics are how learning is assessed' },
  { id: 'wound-care', forms: '', phrases: ['wound care', 'wound assessment', 'wound assessments', 'wound management', 'wound vac', 'dressing changes'], source: 'wound care includes assessing the wound' },
];
// People nouns: what a statement names as WHO the work is for or with. A who-word alone proves nothing; with the action
// it is part of the object. Each group is one kind of person (any member proves the group).
export const PEOPLE_GROUPS = [
  { id: 'patients', forms: 'patient patients caseload resident residents client clients family families caregiver caregivers', source: 'people in care' },
  { id: 'customers', forms: 'customer customers guest guests client clients shopper shoppers member members caller callers user users buyer buyers', source: 'people served' },
  { id: 'staff', forms: 'staff employee employees associate associates agent agents rep reps representative representatives cook cooks crew team teams teammate teammates colleague colleagues coworker coworkers hire hires nurse nurses technician technicians cashier cashiers worker workers trainee trainees learner learners', source: 'people one works beside or leads' },
  { id: 'students', forms: 'student students learner learners child children kid kids pupil pupils adolescent adolescents youth', source: 'people taught in school' },
  { id: 'leaders', forms: 'leader leaders leadership executive executives manager managers director directors vp stakeholder stakeholders', source: 'people reported to' },
  // a class written by the posting: any adult group proves it
  { id: 'adults', forms: 'adult adults', proves: ['customers', 'staff', 'patients', 'leaders'], source: 'adults are any grown-up group' },
];
