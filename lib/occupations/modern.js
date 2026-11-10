// Modern job titles the formal O*NET title list lacks or files oddly ("Forward Deployed Engineer", "SDR",
// "People & Culture Specialist", "Cath Lab Technologist", "Journeyman HVAC Team Lead"). Rules over a title's ROLE
// NOUN and its MODIFIERS — not one rule per title — each mapping to O*NET-SOC occupations (first = most likely;
// the rest are alternatives). Every rule family is pinned by ≥10 test titles in modern.test.mjs.
//
//   modernOccupation(normalisedTitle) → { codes: string[], rule: string } | null
//
// The caller (occupationOf) hands in a key from lib/occupations/normalize.js (lower case, abbreviations expanded,
// noise removed) and treats a hit as `close` — these are usage rules, not O*NET titles.

const has = (/** @type {string} */ key, /** @type {RegExp} */ re) => re.test(key);
const ENGINEER = '(engineer|engineering|developer|programmer|swe|technologist|architect|member of (the )?technical staff|mts)';
const LEAD = '(lead|leader|manager|director|head|supervisor|principal)';

/** @type {Array<{ rule: string, re: RegExp, codes: string[], unless?: RegExp }>} */
const RULES = [
  // ---- not a job: paid AI-training tasks and survey panels advertised as postings
  { rule: 'not an occupation', re: /\b(ai training|artificial intelligence training|artificial intelligence tutor|survey participants?|data contributor|fluent speakers|task based|ai tutor|rater|annotation tasks|audio tasks|research participants?)\b/, codes: [] },
  { rule: 'delivery driver', re: /\b(delivery|dsp delivery|amazon delivery|amazon dsp|courier|last mile|route) (driver|associate)\b|\bdelivery driver\b|\bdsp (delivery )?driver\b/, codes: ['53-3033.00', '53-3031.00'] },
  // ---- software, data, ML, DevOps / SRE, security, network, QA
  { rule: 'technical staff', re: /\bmember of (the )?technical staff\b|\bmts\b/, codes: ['15-1252.00', '15-1221.00'] },
  { rule: 'forward deployed', re: /\bforward deployed (software )?(engineer|developer)\b/, codes: ['15-1252.00', '15-1211.00'] },
  { rule: 'devops / sre / cloud', re: new RegExp(`\\b(devops|dev ops|site reliability|sre|cloud|platform reliability|infrastructure|systems reliability|production)( operations)? ${ENGINEER}\\b`), codes: ['15-1244.00', '15-1252.00'], unless: /\b(civil|structural|mechanical|electrical|power|plant|manufacturing|process|chemical)\b/ },
  { rule: 'security engineering', re: new RegExp(`\\b(security|cybersecurity|cyber security|application security|appsec|information security|infosec|cloud security|offensive security|detection|threat|security operations center)( operations)? (${ENGINEER}|analyst|specialist|researcher)\\b`), codes: ['15-1212.00', '15-1299.05'], unless: /\b(physical security|security officer|security guard)\b/ },
  { rule: 'network engineering', re: new RegExp(`\\b(network|ip network|networking|telecommunications network) ${ENGINEER}\\b`), codes: ['15-1241.00', '15-1244.00'] },
  { rule: 'ml / ai engineering', re: new RegExp(`\\b(machine learning|ml|mle|ai|artificial intelligence|deep learning|computer vision|nlp|llm|applied ai|applied ml|ml infrastructure|ai infrastructure|ai systems|perception)( platform| research)? ${ENGINEER}\\b`), codes: ['15-1252.00', '15-2051.00'] },
  { rule: 'data engineering', re: new RegExp(`\\b(data|analytics|big data|etl|data platform|data infrastructure) ${ENGINEER}\\b`), codes: ['15-1252.00', '15-1243.01'] },
  { rule: 'qa / test engineering', re: /\b(qa|quality assurance|test automation|automation test|software test|sdet|software development engineer in test|software quality|test) (engineer|analyst|lead|developer|specialist|manager)\b|\bsdet\b/, codes: ['15-1253.00'], unless: /\b(hardware|product test|avionics|rf|silicon|validation|electrical|mechanical|abuse|safety|materials)\b/ },
  { rule: 'software engineering', re: new RegExp(`\\b(software|back end|front end|full stack|fullstack|frontend|backend|mobile|ios|android|web|application|applications|api|game|embedded software|firmware|systems software|java|python|net|dot net|c sharp|react|node|golang|go|ruby|rails|php|javascript|typescript|scala|kotlin|swift|rust|salesforce|dynamics 365|servicenow|sap|oracle cloud|shopify|unity|graphics|compiler|kernel|distributed systems|product|growth|integration|integrations|tools|developer productivity|developer experience|ui) (development )?${ENGINEER}\\b|\\bsoftware development (engineer|lead|manager)\\b|\\b(software|application|applications|net|java|web|mobile|front end|back end|full stack) (development|dev) (lead|manager)\\b`), codes: ['15-1252.00', '15-1254.00'], unless: /\b(civil|structural|mechanical|electrical|chemical|process|manufacturing|sales|field application|applications engineer|rf|antenna|hardware)\b/ },
  { rule: 'web development', re: /\b(web|wordpress|front end web|shopify) (developer|designer|programmer)\b/, codes: ['15-1254.00', '15-1252.00'] },
  { rule: 'solutions / sales engineering', re: /\b(solutions?|sales|pre sales|presales|customer|field|partner|value) (engineer|engineering|consultant|architect)\b/, codes: ['41-9031.00', '15-1299.08', '15-1211.00'], unless: /\b(field service|civil|mechanical)\b/ },
  { rule: 'solutions architect', re: /\b(cloud|enterprise|solutions?|technical|software|systems|data|integration) architect\b/, codes: ['15-1299.08', '15-1241.00', '15-1211.00'] },
  { rule: 'it support', re: /\b(it|information technology|technical|tech|end user|user|desktop|computer)? ?(support|help desk|helpdesk|service desk|desktop support) (analyst|specialist|technician|engineer|associate|agent)\b|\b(help desk|helpdesk|service desk|desktop) (analyst|specialist|technician|engineer|associate|agent)\b/, codes: ['15-1232.00', '15-1231.00'], unless: /\b(data|business|financial|security|systems engineer|field service|software|network)\b/ },
  { rule: 'saas administrator', re: /\b(salesforce|gainsight|hubspot|workday|servicenow|netsuite|jira|okta|zendesk|marketo|crm|system|systems) (administrator|admin)\b/, codes: ['15-1211.00', '15-1299.00', '15-1244.00'] },
  { rule: 'data science / analytics', re: /\b(data scientist|data science|applied scientist|research scientist machine learning|machine learning scientist|ml scientist|decision scientist|quantitative analyst|analytics engineer|(senior |staff |lead )?(data|product|business intelligence|bi|marketing data|people|human resources|sales|revenue|growth|insights|reporting|analytics) analyst|scientist (driver|pricing|marketplace|experimentation|growth|incentives|ads|economics))\b/, codes: ['15-2051.00', '15-2051.01', '13-1111.00'] },
  // ---- product, program, project
  { rule: 'product management', re: new RegExp(`\\b(product|technical product|group product|ai product|platform product) (manager|owner|lead|director|management)\\b|\\bhead of product\\b|\\bvp( of)? product\\b|\\bproduct management\\b`), codes: ['11-2021.00', '11-3021.00', '15-1299.09'] },
  { rule: 'technical program management', re: /\b(technical|technology|engineering|it|software|ai|data|security|infrastructure|ai operations) (program|project) (manager|lead|director|management)\b/, codes: ['15-1299.09', '13-1082.00', '11-3021.00'] },
  { rule: 'program / project management', re: /\b(program|project|delivery|implementation|launch|manufacturing program|construction project) (manager|lead|director|coordinator)\b|\bproject management specialist\b/, codes: ['13-1082.00', '11-9199.00', '11-9021.00'], unless: /\b(technical|technology|engineering|software|it)\b/ },
  // ---- design / UX
  { rule: 'ux / product design', re: /\b(ux|ui|user experience|user interface|product|interaction|visual|service|design systems|experience) (designer|design lead|design manager|researcher|writer|architect)\b|\b(ux|ui|product) design\b|\b(content|conversation|conversational) designer\b|\bdesign (lead|manager|director)\b/, codes: ['15-1255.00', '27-1021.00', '27-1024.00'] },
  { rule: 'motion / creative design', re: /\b(motion|brand|creative|marketing|social|video|3d|presentation) (designer|design lead)\b|\bmotion graphics\b/, codes: ['27-1024.00', '27-1014.00'] },
  { rule: 'care coordination', re: /\b(care|patient care|clinical care|chronic care|transitions of care|referral) (coordinator|navigator|manager)\b/, codes: ['29-1141.00', '21-1022.00', '43-6013.00', '29-2099.08'] },
  // ---- retail, warehouse and production floors (the rung comes from levelOf)
  { rule: 'retail floor lead', re: /\b(front end|sales floor|cashier|retail|store|guest experience|customer experience|visual|merchandising|stockroom|backroom) (lead|team lead|supervisor|key holder|keyholder)\b/, codes: ['41-1011.00', '41-2031.00'] },
  { rule: 'retail associate', re: /\b(retail|store|sales floor|cashier|front end|guest service|guest experience|merchandise|merchandising) (associate|team member|clerk|specialist|advisor)\b/, codes: ['41-2031.00', '41-2011.00'] },
  { rule: 'warehouse / fulfillment', re: /\b(warehouse|fulfillment|fulfilment|distribution center|dc|logistics|shipping|receiving|inbound|outbound|order) (associate|worker|team member|picker|packer|selector|handler|lead|team lead)\b|\b(order picker|picker packer|material handler)\b/, codes: ['53-7065.00', '53-7062.00', '53-1042.00'] },
  { rule: 'inventory control', re: /\binventory (specialist|clerk|associate|control specialist|control associate|coordinator|analyst|control)\b/, codes: ['43-5071.00', '53-7065.00'] },
  { rule: 'production floor', re: /\b(production|manufacturing|assembly|plant|factory) (associate|worker|team member|operator|technician|lead|team lead)\b/, codes: ['51-2092.00', '51-9199.00', '51-1011.00'], unless: /\b(engineer|manager|supervisor|planner|scheduler|control)\b/ },
  { rule: 'accounting leadership', re: /\b(accounting|finance|financial reporting|consolidations|controllership) (manager|director|lead|supervisor)\b|\bcontroller\b/, codes: ['11-3031.00', '13-2011.00'] },
  { rule: 'collections', re: /\b(collections?|collector|debt collection|accounts receivable collections) (specialist|agent|representative|analyst|associate|coordinator)\b/, codes: ['43-3011.00'] },
  // ---- customer success, support, solutions
  { rule: 'customer success', re: /\b(customer|client) (success|outcomes|onboarding|retention|advocacy) (manager|lead|director|specialist|associate|representative|coordinator|partner|executive)\b/, codes: ['41-3091.00', '43-4051.00', '13-1199.00'] },
  { rule: 'customer support', unless: /\bpatient care\b/, re: /\b(customer|client|member|technical|product|player|guest) (support|service|care|care services|services|experience) (specialist|representative|rep|agent|associate|advocate|analyst|engineer|lead|supervisor|coordinator)\b/, codes: ['43-4051.00', '15-1232.00'] },
  // ---- sales, business development, account management, revenue operations
  { rule: 'sdr / bdr', re: /\b(sales|business) development (representative|rep|associate|specialist)\b|\b(sdr|bdr)\b/, codes: ['41-3091.00', '41-4011.00', '41-4012.00'] },
  { rule: 'account executive / manager', re: /\baccount (executive|manager|director|representative|lead|partner)\b/, codes: ['41-4011.00', '41-3091.00', '41-4012.00', '11-2022.00'], unless: /\b(advertising|media|agency|accounts payable|accounts receivable)\b/ },
  { rule: 'sales leadership', re: new RegExp(`\\b(sales|regional sales|district sales|area sales|national sales|territory sales|channel sales|partner sales|field sales|inside sales|enterprise sales) ${LEAD}\\b|\\b(vice president|vp|head|director)( of)? sales\\b|\\bbusiness development (manager|director|lead|executive)\\b|\\b(partner|channel|alliances) (manager|director)\\b`), codes: ['11-2022.00', '41-1012.00', '41-4011.00'] },
  { rule: 'sales representative', re: /\b(outside|inside|field|territory|technical|medical device|pharmaceutical|enterprise|b2b|saas|software) sales (representative|rep|executive|specialist|consultant|associate|contractor)\b|\b(sales representative|sales executive|sales consultant)\b/, codes: ['41-4011.00', '41-3091.00', '41-4012.00'], unless: /\b(retail|store|floor)\b/ },
  { rule: 'revenue operations', re: /\b(revenue|sales|go to market|gtm|business) operations\b|\b(revops|salesops)\b|\bdeal desk\b|\b(revenue|sales) enablement\b/, codes: ['13-1199.00', '13-1111.00', '13-1161.00'] },
  // ---- marketing operations, growth, content
  { rule: 'marketing specialist', re: /\b(marketing|growth|digital marketing|performance marketing|lifecycle|crm|email marketing|product marketing|content marketing|demand generation|demand gen|field marketing|partner marketing|brand marketing|social media|community|campaign|influencer|affiliate|paid social|paid search|seo|sem|ppc|marketing operations) (specialist|coordinator|manager|associate|strategist|lead|analyst|executive|marketer)\b|\b(growth|lifecycle|performance|content|product) marketer\b/, codes: ['13-1161.00', '11-2021.00', '13-1161.01'] },
  { rule: 'content', re: /\b(content|copy|technical|user experience|proposal|grant) (writer|editor)\b|\bcontent (strategist|manager|developer|lead)\b|\bcopywriter\b/, codes: ['27-3043.00', '27-3042.00', '13-1161.00'] },
  // ---- people operations, talent
  { rule: 'people operations', re: /\b(people|people and culture|people operations|people ops|employee experience|hr|human resources|talent) (operations )?(partner|business partner|specialist|generalist|associate|coordinator|operations|lead|manager|advisor|analyst)\b|\bhrbp\b/, codes: ['13-1071.00', '11-3121.00', '43-4161.00'] },
  { rule: 'talent acquisition', re: /\b(talent (acquisition|sourcer|sourcing|partner)|technical recruiter|recruiter|recruiting (specialist|coordinator|partner|lead|manager)|sourcer)\b/, codes: ['13-1071.00', '43-4161.00'] },
  { rule: 'compensation / benefits', re: /\b(compensation|total rewards|benefits|comp) (analyst|specialist|partner|lead|manager|consultant|administrator)\b/, codes: ['13-1141.00', '11-3111.00'] },
  // ---- finance operations, FP&A, accounting
  { rule: 'fp and a', re: /\b(fp and a|fpanda|financial planning( and analysis)?|finance|corporate finance|strategic finance|business finance) (analyst|associate|manager|lead|partner)\b|\bfinancial analyst\b/, codes: ['13-2051.00', '11-3031.00'] },
  { rule: 'treasury', re: /\btreasury (analyst|officer|associate|manager|specialist)\b|\btreasurer\b/, codes: ['13-2051.00', '11-3031.01'] },
  { rule: 'payroll', re: /\bpayroll (analyst|specialist|administrator|coordinator|accountant|lead|manager)\b/, codes: ['43-3051.00', '13-2011.00', '11-3111.00'] },
  { rule: 'accountant', re: /\b(tax|revenue|staff|senior|general ledger|gl|cost|project|fund|property|corporate|technical|payroll) accountant\b|\baccountant\b/, codes: ['13-2011.00'] },
  { rule: 'accounting operations', re: /\b(accounts payable|accounts receivable|ap|ar|billing|collections|order to cash|procure to pay) (specialist|analyst|coordinator|associate|clerk|lead)\b/, codes: ['43-3031.00', '43-3021.00', '43-3011.00'] },
  // ---- clinical and allied health, with unit names
  { rule: 'registered nurse', re: /\b(registered nurse|rn|staff nurse|charge nurse|travel nurse|nurse (navigator|educator|case manager|coordinator|supervisor|manager)|nursing (supervisor|manager|director|coordinator))\b|\b(icu|er|ed|or|pacu|picu|nicu|med surg|telemetry|home health|hospice|dialysis|labor and delivery|oncology|float pool|mds|adon|don|wound care|infusion|triage|cath lab|cardiac|step down|psych|ambulatory) (nurse|rn)\b|\b(adon|director of nursing|assistant director of nursing)\b/, codes: ['29-1141.00', '11-9111.00'], unless: /\b(licensed practical|lpn|lvn|nurse practitioner|aide|assistant|anesthetist|midwife)\b/ },
  { rule: 'licensed practical nurse', re: /\b(licensed practical|licensed vocational|lpn|lvn)\b/, codes: ['29-2061.00'] },
  { rule: 'imaging technologist', re: /\b(cath lab|cardiac cath|cardiovascular|echo|echocardiography|vascular|interventional|interventional radiology|ir|radiology|radiologic|x ray|xray|ct|mri|mammography|nuclear medicine|ultrasound|sonography) (technologist|technician|tech|sonographer)\b/, codes: ['29-2031.00', '29-2034.00', '29-2032.00', '29-2035.00'] },
  { rule: 'medical coding / health information', re: /\b(medical|surgical|inpatient|outpatient|profee|pro fee|physician|hospital|risk adjustment|hcc|clinical documentation) (coder|coding specialist|coding auditor|auditor)\b|\bcoding (auditor|specialist|analyst)\b|\bhealth information (specialist|technician|coordinator)\b|\b(medical biller|medical billing)\b/, codes: ['29-2072.00', '29-9021.00', '43-3021.00'] },
  { rule: 'care coordination', re: /\b(care|patient care|clinical care|chronic care|transitions of care|referral) (coordinator|navigator|manager)\b/, codes: ['29-1141.00', '21-1022.00', '43-6013.00', '29-2099.08'] },
  { rule: 'direct support', unless: /\b(delivery|driver|digital signal)\b/, re: /\b(direct support (professional|specialist|staff)|dsp|personal care (specialist|assistant|attendant)|caregiver|resident assistant)\b/, codes: ['21-1093.00', '31-1122.00', '39-9041.00'] },
  { rule: 'clinical research', re: /\bclinical (research|trial|trials) (coordinator|associate|assistant|specialist|manager)\b/, codes: ['11-9121.01', '29-1141.00'] },
  { rule: 'veterinary', re: /\b(veterinary|vet) (surgeon|doctor|physician)\b|\bveterinarian\b|\b(small animal|equine|emergency) (vet|veterinarian)\b/, codes: ['29-1131.00'] },
  { rule: 'veterinary technician', re: /\b(veterinary|vet) (technician|tech|technologist|nurse)\b/, codes: ['29-2056.00', '31-9096.00'] },
  // ---- skilled trades and their rungs (the rung comes from levelOf)
  { rule: 'hvac trade', re: /\b(hvac|hvacr|hvac r|heating and air|refrigeration|heat pump|boiler)( installation| service)? (technician|tech|installer|mechanic|apprentice|journeyman|helper|lead|team lead|foreman|specialist)\b|\b(journeyman|apprentice|master|lead) hvac\b/, codes: ['49-9021.00'] },
  { rule: 'electrical trade', re: /\b(journeyman|apprentice|master|lead|commercial|industrial|residential|maintenance|construction)? ?electrician\b|\b(journeyman|apprentice) electrical\b|\belectrical (journeyman|apprentice|foreman)\b/, codes: ['47-2111.00', '47-3013.00'] },
  { rule: 'plumbing trade', re: /\b(journeyman|apprentice|master|lead|service|commercial|residential)? ?(plumber|pipefitter|steamfitter|sprinkler fitter)\b/, codes: ['47-2152.00', '47-3015.00'] },
  { rule: 'carpentry trade', re: /\b(journeyman|apprentice|lead|finish|framing|union)? ?carpenter\b/, codes: ['47-2031.00', '47-3012.00'] },
  { rule: 'welding trade', re: /\b(journeyman|apprentice|lead|structural|pipe|tig|mig|certified)? ?(welder|welder fabricator|fabricator welder)\b/, codes: ['51-4121.00', '51-2041.00'] },
  { rule: 'field service technician', re: /\b(field service|field|service|equipment service|biomedical|biomed) (technician|tech|engineer|specialist)\b/, codes: ['49-9041.00', '49-2094.00', '49-9071.00', '49-9062.00'], unless: /\b(software|it|desk|network|veterinary|pharmacy|lab)\b/ },
  { rule: 'maintenance technician', re: /\b(maintenance|facilities maintenance|building maintenance|apartment maintenance|industrial maintenance|plant maintenance) (technician|tech|mechanic|worker|engineer|specialist|lead)\b/, codes: ['49-9071.00', '49-9041.00'] },
  { rule: 'ehs', re: /\b(ehs|eh and s|hse|she|environmental health and safety|health and safety|safety) (technician|specialist|coordinator|manager|program manager|engineer|officer|lead)\b/, codes: ['19-5011.00', '19-5012.00', '11-9199.00'] },
  { rule: 'general contractor', re: /\b(general contractor|construction (manager|superintendent|project manager)|site superintendent)\b/, codes: ['47-1011.00', '11-9021.00'] },
  { rule: 'hardware test / validation engineering', re: /\b(post silicon|silicon|hardware|product|avionics|rf|electrical|safety and abuse|abuse|reliability|equipment reliability|validation|verification|design verification|test) (test |validation |verification )?engineer\b/, codes: ['17-2072.00', '17-2061.00', '17-2199.00', '17-2141.00'], unless: /\b(software|qa|quality assurance|automation|sdet|web|mobile|site reliability|data|security|chief|director|officer|vice president)\b/ },
  { rule: 'laboratory management', re: /\b(lab|laboratory|lab services|laboratory services) (manager|director|supervisor|lead)\b/, codes: ['11-9121.00', '29-2011.00'] },
  { rule: 'it leadership', re: /\b(information technology|technology infrastructure|infrastructure|it operations|end user computing|enterprise systems|technology)( engineering)?( and support)? (director|manager|head|vice president|lead)\b|\b(director|head|vice president) (of )?(information technology|technology|infrastructure)\b/, codes: ['11-3021.00'], unless: /\b(sales|marketing|product)\b/ },
  { rule: 'operations / logistics coordination', re: /\b(operations|logistics|transportation|supply chain|dispatch) (coordinator|specialist|associate|analyst)\b/, codes: ['13-1081.00', '43-5061.00', '13-1199.00'] },
  { rule: 'bank branch', re: /\b(branch|banking center|financial center) (operations )?(manager|supervisor|lead)\b/, codes: ['11-3031.00', '43-1011.00'] },
  { rule: 'security officer', re: /\b(security|loss prevention|asset protection) (host|hostess|officer|guard|ambassador|agent|associate|specialist|patrol)\b/, codes: ['33-9032.00', '33-9099.02'], unless: /\b(information|cyber|cybersecurity|network|cloud|application|data)\b/ },
  { rule: 'plasma / donor center', re: /\b(plasma|donor|blood donor|plasma center|donor center) (technician|specialist|processor|phlebotomist|center technician)\b/, codes: ['31-9097.00', '29-2012.00'] },
  { rule: 'estimator', re: /\b(estimator|cost estimator|estimating (manager|engineer))\b/, codes: ['13-1051.00'] },
  // ---- other common modern titles
  { rule: 'rideshare', re: /\b(rideshare|ride share|uber|lyft) driver\b|\bdriving (with|for) (uber|lyft)\b/, codes: ['53-3054.00', '53-3053.00'] },
  { rule: 'executive assistant', re: /\bexecutive (assistant|administrative assistant|business partner)\b|\bchief of staff\b/, codes: ['43-6011.00', '11-1021.00'] },
  { rule: 'litigation attorney', re: /\b(attorney|lawyer|counsel|associate attorney|litigator)\b/, codes: ['23-1011.00'], unless: /\b(paralegal|assistant)\b/ },
  { rule: 'trade crew lead', re: /\b(framing|roofing|construction|concrete|drywall|painting|electrical|plumbing|landscaping|siding|flooring|demolition|masonry|carpentry|solar installation) (crew lead|crew leader|lead|foreman|forewoman|supervisor)\b/, codes: ['47-1011.00', '37-1012.00'] },
  { rule: 'shift leader restaurant', re: /\b(restaurant|kitchen|cafe|bakery|coffee)( hourly)?( shift)? (leader|lead|supervisor)\b|\bshift (leader|lead) restaurant\b/, codes: ['35-1012.00', '41-1011.00'] },
  { rule: 'consultant', re: /\b(ai|artificial intelligence|technology|it|information technology|erp|sap|salesforce|oracle|digital transformation|cloud) (consultant|advisor)\b/, codes: ['15-1211.00', '13-1111.00'] },
  { rule: 'management consulting', re: /\b(management|strategy|business|transformation|value creation|strategy and planning) (consultant|advisor)\b|\b(transformation|value creation) (director|manager|lead)\b/, codes: ['13-1111.00', '11-1021.00'], unless: /\b(product|sales|marketing|engineering|human resources)\b/ },
  { rule: 'category / procurement', re: /\b(category|sourcing|procurement|strategic sourcing|purchasing) (manager|lead|director|specialist|analyst)\b/, codes: ['11-3061.00', '13-1023.00'] },
  { rule: 'real estate agent', re: /\b(real estate|licensed real estate|realtor|real estate sales) (agent|associate|salesperson|advisor)\b|\brealtor\b/, codes: ['41-9022.00', '41-9021.00'] },
];

/**
 * @param {string} key a normalised title (lib/occupations/normalize.js)
 * @returns {{ codes: string[], rule: string } | null}
 */
export function modernOccupation(key) {
  const k = ` ${String(key || '').trim()} `;
  for (const r of RULES) {
    if (!has(k, r.re)) continue;
    if (r.unless && has(k, r.unless)) continue;
    return { codes: r.codes.slice(), rule: r.rule };
  }
  return null;
}

/** For tests and the report: the rule families. */
export const MODERN_RULES = RULES.map((r) => r.rule);
