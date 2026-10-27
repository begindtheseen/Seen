// Competency model — what a job IS, not just which words its bullets happen to contain.
//
// The v1 tailor scored a role by keyword hits in its bullets, so a role with no bullets (the
// most common shape for older or packed roles — "Membership Specialist – UFC Gym") scored zero
// even when its TITLE is the single most relevant fact on the page for a sales posting. This
// layer gives every role an IMPLIED competency vector from its title/family (the duties that
// job inherently involves) and an EVIDENCED vector from its bullets, and gives the posting a
// DEMANDED vector from its title family + requirements + wording. Relevance is the overlap.
//
// Everything is bundled data + pure functions (deterministic, no AI, browser-safe). Competency
// labels are the skill graph's canonical labels wherever one exists, so the ontology's
// `provides`, the transferability engine and this layer all speak the same vocabulary.

import { ROLE_FAMILIES, GENERAL_FAMILY, detectRoleFamily } from '../../application-intelligence/roleOntology.js';
import { canonSkill } from '../../application-intelligence/skillGraph.js';

export const COMPETENCY_VERSION = 'competencies_v1';

// ── Competency catalogue (label → group). Groups drive the "customer-facing cluster" logic. ──
export const COMPETENCIES = {
  'customer service': 'customer', hospitality: 'customer', sales: 'customer', upselling: 'customer', 'product knowledge': 'customer',
  'conflict resolution': 'customer', 'phone communication': 'customer', 'customer intake': 'customer', 'membership sales': 'customer',
  'goal attainment': 'customer', crm: 'customer', negotiation: 'customer', 'client relationships': 'customer',
  'point of sale': 'retail', 'cash handling': 'retail', 'inventory management': 'retail', merchandising: 'retail', 'loss prevention': 'retail',
  'store operations': 'retail', 'opening and closing': 'retail',
  'food safety': 'service', 'food preparation': 'service', 'order accuracy': 'service',
  communication: 'core', teamwork: 'core', reliability: 'core', 'time management': 'core', 'problem solving': 'core', independence: 'core',
  'attention to detail': 'core', 'work ethic': 'core', adaptability: 'core', 'physical stamina': 'core',
  safety: 'ops', logistics: 'ops', scheduling: 'ops', operations: 'ops', coordination: 'ops', 'quality control': 'ops', compliance: 'ops',
  'route planning': 'ops', warehouse: 'ops', shipping: 'ops', receiving: 'ops', 'scan accuracy': 'ops', 'vehicle handling': 'ops', driving: 'ops',
  'small business operations': 'ops', 'vendor management': 'ops', 'event coordination': 'ops',
  leadership: 'people', training: 'people', coaching: 'people', 'team supervision': 'people', recruiting: 'people',
  documentation: 'admin', 'data entry': 'admin', administration: 'admin', 'microsoft office': 'admin', 'record keeping': 'admin', accuracy: 'admin',
  'mechanical repair': 'technical', diagnostics: 'technical', 'hand tools': 'technical', installation: 'technical', troubleshooting: 'technical',
  maintenance: 'technical', 'blueprint reading': 'technical', 'electrical systems': 'technical', fabrication: 'technical', 'preventive maintenance': 'technical',
  marketing: 'knowledge', 'campaign management': 'knowledge', fundraising: 'knowledge', 'social media': 'knowledge', 'content creation': 'knowledge',
  'software development': 'knowledge', 'data analysis': 'knowledge', 'project management': 'knowledge', 'patient care': 'knowledge',
  education: 'knowledge', accounting: 'knowledge', 'financial reporting': 'knowledge', design: 'knowledge', writing: 'knowledge', research: 'knowledge',
  security: 'ops', 'nutrition knowledge': 'knowledge', fitness: 'knowledge', childcare: 'knowledge', cleaning: 'ops', 'guest relations': 'customer',
};

// Families that are "near" each other for the purposes of experience relevance: a valet and a
// retail associate are both customer-facing hourly work; an electrician and a warehouse
// associate share safety/physical/tooling; admin and customer service share intake/records.
const FAMILY_CLUSTERS = {
  customer_facing: ['customer_service', 'retail', 'sales', 'hospitality', 'food_service', 'valet_parking'],
  field_ops: ['warehouse', 'delivery_logistics', 'skilled_trades', 'operations', 'security'],
  office: ['administrative', 'customer_service', 'finance_accounting', 'operations', 'project_management'],
  knowledge: ['software_engineering', 'data_analytics', 'marketing', 'education', 'project_management', 'finance_accounting'],
  care: ['healthcare_support', 'education', 'hospitality'],
};

// Implied competencies per role family (weight = how strongly doing that job evidences it).
// Supplements the ontology's flat `provides` lists with weights and with competencies the
// ontology does not name.
const FAMILY_IMPLIED = {
  customer_service: { 'customer service': 0.95, communication: 0.85, 'conflict resolution': 0.75, 'problem solving': 0.7, 'phone communication': 0.6, 'data entry': 0.5, documentation: 0.45, reliability: 0.5, 'customer intake': 0.5 },
  retail: { 'customer service': 0.9, 'point of sale': 0.8, 'cash handling': 0.8, 'inventory management': 0.7, merchandising: 0.65, sales: 0.65, upselling: 0.5, 'store operations': 0.6, 'loss prevention': 0.4, communication: 0.7, teamwork: 0.6, reliability: 0.55, 'product knowledge': 0.55 },
  sales: { sales: 0.95, 'goal attainment': 0.85, communication: 0.85, negotiation: 0.75, crm: 0.6, 'customer service': 0.7, upselling: 0.7, 'client relationships': 0.8, 'product knowledge': 0.6, independence: 0.5 },
  hospitality: { hospitality: 0.95, 'customer service': 0.9, communication: 0.8, 'guest relations': 0.85, teamwork: 0.6, 'time management': 0.6, reliability: 0.55, 'conflict resolution': 0.5 },
  food_service: { 'customer service': 0.8, 'food safety': 0.8, 'food preparation': 0.7, 'cash handling': 0.6, 'point of sale': 0.55, teamwork: 0.8, 'time management': 0.75, 'order accuracy': 0.7, reliability: 0.6, 'physical stamina': 0.5 },
  valet_parking: { 'customer service': 0.8, hospitality: 0.8, 'vehicle handling': 0.95, driving: 0.9, safety: 0.75, 'time management': 0.7, reliability: 0.7, 'cash handling': 0.35, communication: 0.6, independence: 0.5, 'attention to detail': 0.5 },
  warehouse: { warehouse: 0.95, 'inventory management': 0.8, shipping: 0.7, receiving: 0.7, safety: 0.75, 'physical stamina': 0.8, 'scan accuracy': 0.6, teamwork: 0.55, reliability: 0.6, 'time management': 0.5 },
  delivery_logistics: { driving: 0.95, 'route planning': 0.85, logistics: 0.8, 'time management': 0.8, 'customer service': 0.6, safety: 0.7, reliability: 0.75, independence: 0.7, 'vehicle handling': 0.7 },
  healthcare_support: { 'patient care': 0.9, 'customer intake': 0.7, documentation: 0.75, compliance: 0.6, communication: 0.8, 'attention to detail': 0.7, scheduling: 0.5, teamwork: 0.6 },
  administrative: { administration: 0.95, scheduling: 0.8, documentation: 0.8, 'data entry': 0.8, 'microsoft office': 0.7, 'phone communication': 0.7, communication: 0.8, 'attention to detail': 0.7, coordination: 0.6, 'record keeping': 0.75, 'customer service': 0.5 },
  software_engineering: { 'software development': 0.95, 'problem solving': 0.8, troubleshooting: 0.6, documentation: 0.5, teamwork: 0.6, 'data analysis': 0.4 },
  data_analytics: { 'data analysis': 0.95, 'problem solving': 0.75, documentation: 0.5, communication: 0.6, accuracy: 0.6 },
  operations: { operations: 0.9, coordination: 0.8, scheduling: 0.7, 'problem solving': 0.7, logistics: 0.6, 'vendor management': 0.5, leadership: 0.5, 'quality control': 0.5, compliance: 0.5 },
  security: { security: 0.95, safety: 0.8, 'attention to detail': 0.7, documentation: 0.6, 'conflict resolution': 0.6, reliability: 0.7, independence: 0.6 },
  finance_accounting: { accounting: 0.95, 'financial reporting': 0.8, accuracy: 0.85, 'data entry': 0.6, compliance: 0.6, 'microsoft office': 0.6, documentation: 0.6 },
  marketing: { marketing: 0.95, 'campaign management': 0.8, 'content creation': 0.7, 'social media': 0.65, communication: 0.85, 'data analysis': 0.5, writing: 0.6, 'project management': 0.5 },
  education: { education: 0.95, communication: 0.85, training: 0.8, coaching: 0.7, 'problem solving': 0.6, documentation: 0.5, 'conflict resolution': 0.5 },
  project_management: { 'project management': 0.95, coordination: 0.85, scheduling: 0.75, leadership: 0.7, communication: 0.85, documentation: 0.6, 'problem solving': 0.7 },
  skilled_trades: { installation: 0.8, 'mechanical repair': 0.7, troubleshooting: 0.85, maintenance: 0.8, safety: 0.85, 'hand tools': 0.8, 'blueprint reading': 0.55, 'attention to detail': 0.7, 'physical stamina': 0.6, 'quality control': 0.6, independence: 0.5, 'preventive maintenance': 0.5 },
  general: { communication: 0.5, teamwork: 0.5, reliability: 0.5, 'problem solving': 0.4, 'time management': 0.4 },
};

// Title-level knowledge: a specific title says more than its family. Patterns are tested
// against the lowercased title (and company, for "Owner — X Detailing"); the first group of
// hits is merged (max weight wins).
const TITLE_IMPLIED = [
  [/membership (specialist|sales|advisor|consultant|coordinator)|membership/i, { 'membership sales': 0.95, sales: 0.9, 'goal attainment': 0.75, 'customer service': 0.85, upselling: 0.6, crm: 0.5, 'client relationships': 0.7, fitness: 0.5, 'phone communication': 0.5 }],
  [/sales (associate|representative|rep|consultant|advisor|specialist|lead)|retail sales|brand ambassador/i, { sales: 0.9, 'customer service': 0.9, 'product knowledge': 0.7, upselling: 0.7, 'point of sale': 0.6, 'goal attainment': 0.7, merchandising: 0.4 }],
  [/cashier|front end|checkout/i, { 'point of sale': 0.95, 'cash handling': 0.95, 'customer service': 0.85, accuracy: 0.7, 'loss prevention': 0.4 }],
  [/(?:key ?holder|shift (?:lead|leader|supervisor)|assistant manager|store manager|team lead)/i, { leadership: 0.8, 'team supervision': 0.8, 'opening and closing': 0.8, 'cash handling': 0.6, 'store operations': 0.75, training: 0.6, 'customer service': 0.7 }],
  [/team member|crew member|associate/i, { 'customer service': 0.7, teamwork: 0.8, reliability: 0.6, 'time management': 0.5 }],
  [/barista|server|waiter|waitress|bartender|host(?:ess)?|busser|line cook|prep cook|cook|kitchen/i, { 'customer service': 0.8, 'food safety': 0.8, 'food preparation': 0.7, 'order accuracy': 0.7, 'cash handling': 0.5, 'point of sale': 0.5, teamwork: 0.8, 'time management': 0.8, upselling: 0.4 }],
  [/valet|parking attendant/i, { 'vehicle handling': 0.95, driving: 0.9, 'customer service': 0.8, hospitality: 0.8, safety: 0.75, 'time management': 0.7, reliability: 0.7, 'attention to detail': 0.5 }],
  [/owner|founder|self[- ]employed|proprietor|operator/i, { 'small business operations': 0.9, 'customer service': 0.7, scheduling: 0.7, sales: 0.55, 'vendor management': 0.5, independence: 0.85, 'time management': 0.7, 'client relationships': 0.6, marketing: 0.35, accounting: 0.3 }],
  [/detail(?:er|ing)/i, { 'attention to detail': 0.9, 'quality control': 0.7, 'vehicle handling': 0.6, cleaning: 0.7, 'customer service': 0.5 }],
  [/campaign manager|campaign|canvass|field organizer|organizer/i, { 'campaign management': 0.9, marketing: 0.6, communication: 0.85, leadership: 0.6, fundraising: 0.5, 'event coordination': 0.6, coordination: 0.7, recruiting: 0.4, 'goal attainment': 0.5 }],
  [/administrative assistant|admin assistant|office (?:assistant|manager|coordinator)|receptionist|front desk|secretary|clerk/i, { administration: 0.9, scheduling: 0.8, 'data entry': 0.8, documentation: 0.8, 'phone communication': 0.8, 'microsoft office': 0.7, 'customer service': 0.6, 'attention to detail': 0.7, 'record keeping': 0.7 }],
  [/automotive technician|mechanic|auto tech|lube tech|service technician/i, { 'mechanical repair': 0.95, diagnostics: 0.9, 'hand tools': 0.85, safety: 0.6, 'attention to detail': 0.75, troubleshooting: 0.8, 'quality control': 0.5, maintenance: 0.7 }],
  [/electrician|journeyman|apprentice|lineman/i, { 'electrical systems': 0.9, installation: 0.85, troubleshooting: 0.8, safety: 0.85, 'blueprint reading': 0.6, 'hand tools': 0.8 }],
  [/driver|courier|delivery/i, { driving: 0.95, 'route planning': 0.7, 'time management': 0.75, 'customer service': 0.55, reliability: 0.7, independence: 0.7 }],
  [/warehouse|picker|packer|stocker|material handler|forklift/i, { warehouse: 0.9, 'inventory management': 0.7, 'physical stamina': 0.8, safety: 0.7, 'scan accuracy': 0.6 }],
  [/security|guard|loss prevention/i, { security: 0.95, safety: 0.75, 'attention to detail': 0.7, 'conflict resolution': 0.6, reliability: 0.7 }],
  [/teacher|tutor|instructor|educator|coach|trainer/i, { education: 0.85, training: 0.85, coaching: 0.8, communication: 0.85, leadership: 0.5 }],
  [/nurse|cna|medical assistant|caregiver|patient care|phlebotom/i, { 'patient care': 0.9, documentation: 0.7, compliance: 0.6, communication: 0.8, 'attention to detail': 0.7 }],
  [/engineer|developer|programmer|software/i, { 'software development': 0.9, 'problem solving': 0.8, troubleshooting: 0.6, 'data analysis': 0.4 }],
  [/analyst|data/i, { 'data analysis': 0.85, 'problem solving': 0.7, accuracy: 0.6, documentation: 0.5 }],
  [/marketing|social media|content|brand/i, { marketing: 0.85, 'content creation': 0.7, 'social media': 0.7, communication: 0.8 }],
  [/accountant|bookkeeper|payroll|accounts (?:payable|receivable)/i, { accounting: 0.9, accuracy: 0.85, 'financial reporting': 0.7, 'data entry': 0.6 }],
  [/project manager|program manager|coordinator/i, { 'project management': 0.8, coordination: 0.85, scheduling: 0.7, communication: 0.8 }],
  [/custodian|janitor|housekeep|cleaner/i, { cleaning: 0.9, reliability: 0.7, 'attention to detail': 0.6, 'physical stamina': 0.6, independence: 0.6 }],
  [/fitness|personal trainer|gym/i, { fitness: 0.85, coaching: 0.7, 'customer service': 0.7, sales: 0.4, 'goal attainment': 0.5 }],
  [/nutrition|dietitian|wellness|supplement/i, { 'nutrition knowledge': 0.9, 'product knowledge': 0.7, 'customer service': 0.6 }],
];

// Term lexicon: words/phrases in bullets OR postings → competencies (with weights). Matched
// as whole words on normalized text; a bullet hit is EVIDENCE, a posting hit is DEMAND.
const TERMS = [
  [/\b(customers?|clients?|guests?|patrons?|members?|shoppers?)\b/, { 'customer service': 0.6 }],
  [/\bcustomer (?:service|care|support|experience|satisfaction|expectations?)\b/, { 'customer service': 0.95 }],
  [/\bguest (?:service|experience|relations)\b|\bhospitality\b/, { hospitality: 0.9, 'customer service': 0.6 }],
  [/\b(sold|sell(?:ing)?|sales|upsell(?:ing|s)?|quota|revenue|closing|closed deals?|commission|conversion|memberships? sold|sign-?ups?)\b/, { sales: 0.85, 'goal attainment': 0.5 }],
  [/\b(memberships?)\b/, { 'membership sales': 0.8, sales: 0.5 }],
  [/\b(targets?|goals?|kpis?|quotas?|exceed(?:ed|ing)?|achiev(?:ed|ing|e))\b/, { 'goal attainment': 0.7 }],
  [/\b(pos|point[- ]of[- ]sale|register|cash register|checkout|transactions?)\b/, { 'point of sale': 0.85, 'cash handling': 0.6 }],
  [/\b(cash|cash handling|drawer|deposits?|tills?|change)\b/, { 'cash handling': 0.8 }],
  [/\b(inventory|stock(?:ing|ed|room)?|restock(?:ing|ed)?|shelves|shelf|counts?|cycle counts?|backroom)\b/, { 'inventory management': 0.8 }],
  [/\b(merchandis(?:e|ing|ed)|displays?|planograms?|visual)\b/, { merchandising: 0.85 }],
  [/\b(open(?:ing)? and clos(?:e|ing)|opened and closed|open\/close|closing duties|opening duties)\b/, { 'opening and closing': 0.9, 'store operations': 0.6 }],
  [/\b(loss prevention|shrink(?:age)?|theft)\b/, { 'loss prevention': 0.9 }],
  [/\b(product knowledge|products?|supplements?|nutrition|wellness|vitamins?)\b/, { 'product knowledge': 0.6 }],
  [/\b(nutrition|supplements?|vitamins?|dietary)\b/, { 'nutrition knowledge': 0.8 }],
  // "wellness" alone is brand language (apparel, spas, gyms) — it does not imply nutrition knowledge
  [/\b(wellness)\b/, { fitness: 0.3 }],
  [/\b(communicat(?:e|ed|ion|ing)|explain(?:ed|ing)?|presented?|liais(?:ed|on))\b/, { communication: 0.7 }],
  [/\b(phones?|calls?|inbound|outbound|answered)\b/, { 'phone communication': 0.7 }],
  [/\b(teams?|teammates?|crews?|partners|collaborat(?:ed|ion|ive)|coworkers)\b/, { teamwork: 0.7 }],
  [/\b(led|lead(?:ing)?|supervis(?:ed|ing|or)|managed (?:a )?(?:team|crew|staff)|oversaw|directed)\b/, { leadership: 0.8, 'team supervision': 0.6 }],
  [/\b(train(?:ed|ing)|onboard(?:ed|ing)|mentor(?:ed|ing)|coach(?:ed|ing))\b/, { training: 0.85, coaching: 0.6 }],
  [/\b(schedul(?:e|ed|ing|es)|appointments?|calendars?|shifts? coverage|rosters?)\b/, { scheduling: 0.8 }],
  [/\b(suppl(?:y|ies)|vendors?|ordering|purchas(?:ed|ing))\b/, { 'vendor management': 0.6, operations: 0.4, 'inventory management': 0.3 }],
  [/\b(independently|unsupervised|on my own|sole|solo|full responsibility|self[- ]directed|autonomous)\b/, { independence: 0.85, reliability: 0.5 }],
  [/\b(reliab(?:le|ility)|punctual|attendance|dependab(?:le|ility)|overnight|night shifts?|weekends?)\b/, { reliability: 0.7 }],
  [/\b(high[- ]volume|high volumes?|rush(?:es)?|peak|busy|under pressure|high[- ]pressure|fast[- ]paced|deadlines?|time[- ]sensitive)\b/, { 'time management': 0.75 }],
  [/\b(safety|safe(?:ly)?|osha|zero[- ]incident|incident[- ]free|accident[- ]free|hazard|ppe|lockout|recordables?|zero (?:recordable )?injur\w*|injury[- ]free|lost[- ]time|near[- ]miss(?:es)?)\b/, { safety: 0.85 }],
  [/\b(vehicles?|cars?|automobiles?|luxury models?|fleet)\b/, { 'vehicle handling': 0.6, driving: 0.4 }],
  [/\b(drove|driving|driver|routes?|deliver(?:ed|ies|y)|cdl)\b/, { driving: 0.8, 'route planning': 0.4 }],
  [/\b(engine|transmission|clutch|suspension|drivetrain|brakes?|torque|repairs?|repaired|diagnos(?:ed|is|tics?)|mechanical)\b/, { 'mechanical repair': 0.85, diagnostics: 0.6, 'hand tools': 0.4 }],
  [/\b(tools?|equipment|machinery|power tools)\b/, { 'hand tools': 0.6 }],
  [/\b(install(?:ed|ation|ing)?|wiring|wired|conduit|circuits?|panels?|voltage|\d+v)\b/, { installation: 0.7, 'electrical systems': 0.7 }],
  [/\b(troubleshoot(?:ing|s)?|diagnos(?:e|ed|ing)|root cause|debug(?:ged|ging)?)\b/, { troubleshooting: 0.85 }],
  [/\b(maint(?:ain|ained|enance)|preventive|upkeep|serviced)\b/, { maintenance: 0.7 }],
  [/\b(blueprints?|schematics?|drawings?)\b/, { 'blueprint reading': 0.9 }],
  [/\b(detail(?:ed|ing)?|precis(?:e|ion|ely)|accura(?:te|cy|tely)|meticulous|specifications?|exact(?:ly)?)\b/, { 'attention to detail': 0.8, accuracy: 0.5 }],
  [/\b(quality|qc|inspect(?:ed|ion|ing)|standards|finish)\b/, { 'quality control': 0.75 }],
  [/\b(clean(?:ed|ing)?|sanitiz(?:ed|ation|ing)|detailing|wash(?:ed|ing)?)\b/, { cleaning: 0.7 }],
  [/\b(food|kitchen|menu|cooking|prep|servsafe|sanitation|allergen)\b/, { 'food safety': 0.6, 'food preparation': 0.6 }],
  [/\b(orders?|order accuracy|tickets?)\b/, { 'order accuracy': 0.6 }],
  [/\b(documented?|documentation|records?|logs?|reports?|paperwork|filing|filed)\b/, { documentation: 0.8, 'record keeping': 0.6 }],
  [/\b(data entry|entered|spreadsheets?|excel|word|outlook|microsoft office|google (?:docs|sheets|workspace)|typing)\b/, { 'data entry': 0.7, 'microsoft office': 0.7 }],
  [/\b(administrative|admin|office|clerical|front desk|reception)\b/, { administration: 0.8 }],
  [/\b(marketing|campaigns?|outreach|promotions?|advertis(?:ing|ements?)|social media|instagram|facebook|tiktok|content)\b/, { marketing: 0.8, 'campaign management': 0.5, 'social media': 0.4 }],
  [/\b(fundrais(?:ing|ed)|donors?|donations?|canvass(?:ed|ing)|petitions?|voters?|volunteers?)\b/, { fundraising: 0.7, 'campaign management': 0.6, recruiting: 0.3 }],
  [/\b(events?|event planning|coordinated|coordination|logistics)\b/, { coordination: 0.7, 'event coordination': 0.5, logistics: 0.4 }],
  [/\b(warehouse|pallets?|forklift|shipping|receiving|picking|packing|loading|unloading|rf scanner|scanned)\b/, { warehouse: 0.85, 'inventory management': 0.4 }],
  [/\b(lift(?:ing)?|lbs|pounds|standing|physical|heavy)\b/, { 'physical stamina': 0.8 }],
  [/\b(patients?|clinical|vitals|charting|hipaa|medical|care plans?)\b/, { 'patient care': 0.85, documentation: 0.3 }],
  [/\b(students?|lessons?|curriculum|classroom|taught|teaching|tutored)\b/, { education: 0.85 }],
  [/\b(code|software|api|database|sql|javascript|python|java|deploy(?:ed|ment)?|git|react|node)\b/, { 'software development': 0.85 }],
  [/\b(analy(?:sis|zed|tics|ze)|dashboards?|metrics|reporting|kpis?|insights?|sql|excel models?)\b/, { 'data analysis': 0.7 }],
  [/\b(projects?|milestones?|stakeholders?|timelines?|scope|budget)\b/, { 'project management': 0.6, coordination: 0.4 }],
  [/\b(budget(?:s|ed|ing)?|invoic(?:es|ing)|reconcil(?:ed|iation)|payroll|ledger|bookkeeping|accounts)\b/, { accounting: 0.75, accuracy: 0.4 }],
  [/\b(negotiat(?:ed|ion|ing)|contracts?|pricing|quotes?)\b/, { negotiation: 0.8, sales: 0.4 }],
  [/\b(crm|salesforce|hubspot|pipeline|leads?|prospect(?:s|ing|ed)?|follow[- ]ups?)\b/, { crm: 0.75, sales: 0.5 }],
  [/\b(complaints?|de-?escalat(?:ed|ion|e)|resolved|resolution|disputes?|difficult)\b/, { 'conflict resolution': 0.8, 'problem solving': 0.5 }],
  [/\b(problem(?:s|-solving)?|solv(?:ed|ing)|issues?|fixed|troubleshot)\b/, { 'problem solving': 0.7 }],
  [/\b(security|patrols?|surveillance|access control|incidents?)\b/, { security: 0.8 }],
  [/\b(compliance|regulations?|policies|procedures|protocols?|standards)\b/, { compliance: 0.6 }],
  [/\b(fitness|workouts?|gym|training programs?)\b/, { fitness: 0.7 }],
  [/\b(children|kids|childcare|daycare)\b/, { childcare: 0.85 }],
  [/\b(adapt(?:ed|able|ability)|flexib(?:le|ility)|multitask(?:ing|ed)?|cross[- ]trained)\b/, { adaptability: 0.75 }],
  [/\b(wrote|writing|written|edited|copy|articles?|blog)\b/, { writing: 0.7, 'content creation': 0.4 }],
  [/\b(research(?:ed)?|surveys?|studies)\b/, { research: 0.7 }],
  [/\b(design(?:ed|s)?|figma|photoshop|layouts?|branding)\b/, { design: 0.75 }],
];

// Well-known employers whose name says what the work was when the title does not ("Team
// Member – Chipotle", "Associate – Target"). Hint family + a few implied competencies.
const COMPANY_HINTS = [
  [/\b(chipotle|mcdonald'?s|starbucks|subway|taco bell|wendy'?s|burger king|chick-?fil-?a|panera|dunkin|domino'?s|pizza hut|papa john'?s|kfc|popeyes|sonic|in-n-out|five guys|shake shack|jack in the box|panda express|olive garden|applebee'?s|chili'?s|ihop|denny'?s|waffle house|dairy queen|raising cane'?s|wingstop|jersey mike'?s|jimmy john'?s|whataburger|culver'?s|arby'?s|qdoba|sweetgreen|cava)\b/i, 'food_service', { 'customer service': 0.8, 'food safety': 0.7, 'food preparation': 0.6, 'cash handling': 0.6, 'point of sale': 0.6, teamwork: 0.8, 'time management': 0.75, 'order accuracy': 0.6 }],
  [/\b(walmart|target|costco|kroger|safeway|albertsons|publix|h-?e-?b|aldi|trader joe'?s|whole foods|cvs|walgreens|rite aid|home depot|lowe'?s|best buy|gamestop|gnc|vitamin shoppe|ulta|sephora|macy'?s|nordstrom|kohl'?s|tj ?maxx|marshalls|ross|old navy|gap|h&m|zara|foot locker|dick'?s sporting|rei|petsmart|petco|autozone|o'?reilly|advance auto|dollar general|dollar tree|family dollar|five below|michaels|hobby lobby|staples|office depot|ikea|bed bath|7-?eleven|circle k|wawa|sheetz|quiktrip|verizon|t-?mobile|at&t store|apple store)\b/i, 'retail', { 'customer service': 0.85, 'point of sale': 0.7, 'cash handling': 0.7, 'inventory management': 0.65, merchandising: 0.55, sales: 0.6, 'product knowledge': 0.5, teamwork: 0.6 }],
  [/\b(ufc gym|planet fitness|la fitness|24 hour fitness|anytime fitness|equinox|crunch fitness|gold'?s gym|orangetheory|f45|lifetime fitness|life time|ymca)\b/i, 'sales', { 'membership sales': 0.8, sales: 0.75, 'customer service': 0.8, fitness: 0.6, 'goal attainment': 0.6, 'client relationships': 0.6 }],
  [/\b(amazon|fedex|ups|usps|dhl|xpo|ryder|j\.?b\.? hunt|schneider|swift)\b/i, 'warehouse', { warehouse: 0.7, 'physical stamina': 0.7, safety: 0.6, 'time management': 0.6, 'scan accuracy': 0.5, driving: 0.4 }],
  [/\b(marriott|hilton|hyatt|holiday inn|best western|wyndham|four seasons|ritz|towne park|lazparking|laz parking|ace parking|sp\+|abm)\b/i, 'hospitality', { hospitality: 0.85, 'customer service': 0.85, 'guest relations': 0.8, communication: 0.7 }],
  [/\b(uber|lyft|doordash|instacart|grubhub|postmates)\b/i, 'delivery_logistics', { driving: 0.9, 'customer service': 0.6, 'time management': 0.7, independence: 0.8, 'route planning': 0.6 }],
  [/\b(hospital|clinic|medical center|health(?:care)?|urgent care|dental|pharmacy|senior living|assisted living|home care|hospice)\b/i, 'healthcare_support', { 'patient care': 0.6, 'customer intake': 0.5, documentation: 0.6, compliance: 0.5, communication: 0.7 }],
  [/\b(school district|elementary|middle school|high school|academy|university|college|tutoring|learning center|daycare|preschool)\b/i, 'education', { education: 0.6, communication: 0.7, 'patient care': 0, childcare: 0.4 }],
  [/\b(bank|credit union|wells fargo|chase|bank of america|citi|capital one|h&r block)\b/i, 'finance_accounting', { 'customer service': 0.7, 'cash handling': 0.7, accuracy: 0.7, compliance: 0.6, 'data entry': 0.5 }],
];
const GENERIC_TITLE_RE = /^(team member|crew member|associate|team lead|member|staff|employee|worker|intern|assistant|representative|specialist|helper|aide)s?$/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[‘’`]/g, "'").replace(/[^a-z0-9+#/.' -]+/g, ' ').replace(/\s+/g, ' ').trim();
const merge = (into, add, scale = 1) => { for (const [k, w] of Object.entries(add || {})) { const v = w * scale; if (v > (into[k] || 0)) into[k] = v; } return into; };

// front-line competencies an engineering role or posting never evidences through its wording: a ledger's
// "transactions" is not a register, an "order pipeline" is not sales (round 6, Dev: "sales ✓ — shown in your
// bullets" on two backend roles, and the H-E-B role outranked the senior fintech role on "point of sale")
export const HOURLY_ONLY = ['customer service', 'hospitality', 'upselling', 'point of sale', 'cash handling', 'sales', 'merchandising', 'inventory management', 'food safety', 'cleaning', 'stocking', 'order picking'];

/** Competencies a text evidences (bullets) or demands (posting): { competency: weight } with the matching terms. */
export function termCompetencies(text) {
  const t = norm(text);
  const out = {}, hits = {};
  if (!t) return { vector: out, hits };
  for (const [re, comps] of TERMS) {
    const m = t.match(re);
    if (!m) continue;
    for (const [c, w] of Object.entries(comps)) { if (w > (out[c] || 0)) out[c] = w; (hits[c] = hits[c] || []).push(m[0]); }
  }
  return { vector: out, hits };
}

/** Implied competencies for a role from its title/company/family. */
export function impliedCompetencies(title, company = '', bulletsText = '') {
  let fam = detectRoleFamily(title, `${title} ${bulletsText}`);
  // a known employer decides the family when the title is generic or the ontology is unsure
  let hint = null;
  for (const [re, family, comps] of COMPANY_HINTS) if (re.test(String(company || ''))) { hint = { family, comps }; break; }
  if (hint && (fam.family === 'general' || fam.confidence < 0.5 || GENERIC_TITLE_RE.test(String(title || '').trim()))) fam = { family: hint.family, confidence: Math.max(fam.confidence, 0.7), label: (ROLE_FAMILIES[hint.family] || GENERAL_FAMILY).label };
  // the title's own family when the ontology missed it ("Membership Specialist" → sales)
  if (fam.family === 'general') {
    if (/membership|sales|account (?:executive|manager)|business development/i.test(title)) fam = { family: 'sales', confidence: 0.65, label: ROLE_FAMILIES.sales.label };
    else if (/campaign|marketing|brand|social media|content/i.test(title)) fam = { family: 'marketing', confidence: 0.6, label: ROLE_FAMILIES.marketing.label };
    else if (/owner|founder|operator|self[- ]employed|proprietor/i.test(title)) fam = { family: 'operations', confidence: 0.55, label: ROLE_FAMILIES.operations.label };
  }
  const famData = fam.family === 'general' ? GENERAL_FAMILY : (ROLE_FAMILIES[fam.family] || GENERAL_FAMILY);
  const vec = {};
  // ontology `provides` (flat) at a moderate weight, then weighted family knowledge, then title specifics
  for (const p of famData.provides || []) merge(vec, { [canonSkill(p)]: 0.6 });
  merge(vec, FAMILY_IMPLIED[fam.family] || FAMILY_IMPLIED.general, fam.confidence >= 0.5 ? 1 : 0.8);
  if (hint) merge(vec, hint.comps, 0.9);
  const hay = `${title} ${company}`;
  const titleHits = [];
  for (const [re, comps] of TITLE_IMPLIED) if (re.test(hay)) { merge(vec, comps); titleHits.push(re.source.slice(0, 24)); }
  return { vector: vec, family: fam.family, familyLabel: famData.label, familyConfidence: fam.confidence, titleHits, companyHint: hint ? hint.family : null };
}

/** The posting's demanded competencies: title family + requirements + wording. */
export function jobCompetencies({ jobTitle = '', jobDescription = '', requirements = [] }) {
  const fam = detectRoleFamily(jobTitle, jobDescription);
  const famData = fam.family === 'general' ? GENERAL_FAMILY : (ROLE_FAMILIES[fam.family] || GENERAL_FAMILY);
  const vec = {};
  for (const p of famData.provides || []) merge(vec, { [canonSkill(p)]: 0.55 });
  merge(vec, FAMILY_IMPLIED[fam.family] || FAMILY_IMPLIED.general, 0.9);
  const { vector: tv } = termCompetencies(`${jobTitle}. ${jobDescription}`);
  // an engineering posting's "great customer experience" is not a customer-service job (round 3: a backend
  // engineer's summary got "customer service ✓" and a front-line service line was suggested for Stripe)
  if (/^(?:software_engineering|data_analytics)$/.test(fam.family)) for (const k of HOURLY_ONLY) if (tv[k]) tv[k] = Math.min(tv[k], 0.25);
  merge(vec, tv, 0.9);
  for (const [re, comps] of TITLE_IMPLIED) if (re.test(jobTitle)) merge(vec, comps, 0.95);
  // explicit requirements (taxonomy displayName / V2 normalizedLabel) → canonical competency where known
  for (const r of requirements) {
    const label = canonSkill(String(r.displayName || r.normalizedLabel || r.requirement || ''));
    if (!label) continue;
    const w = r.requirementLevel === 'REQUIRED' || r.importance === 'required' ? 1 : 0.75;
    if (COMPETENCIES[label]) merge(vec, { [label]: w });
    else { const { vector } = termCompetencies(label); merge(vec, vector, w * 0.8); }
  }
  return { vector: vec, family: fam.family, familyLabel: famData.label, familyConfidence: fam.confidence };
}

/** How much of the job's demanded mass a role covers (0–1), with the shared competencies. */
export function coverage(jobVec, roleVec) {
  let demand = 0, covered = 0;
  const shared = [];
  for (const [c, w] of Object.entries(jobVec)) {
    demand += w;
    const r = roleVec[c] || 0;
    if (r > 0) { covered += w * Math.min(1, r); shared.push({ competency: c, demand: w, have: r }); }
  }
  shared.sort((a, b) => b.demand * b.have - a.demand * a.have);
  return { score: demand ? covered / demand : 0, shared };
}

/** Family alignment: same family 1, same cluster 0.6, otherwise 0.15 (general on either side 0.4). */
export function familyAlignment(jobFamily, roleFamily) {
  if (!jobFamily || !roleFamily || jobFamily === 'general' || roleFamily === 'general') return 0.4;
  if (jobFamily === roleFamily) return 1;
  for (const members of Object.values(FAMILY_CLUSTERS)) if (members.includes(jobFamily) && members.includes(roleFamily)) return 0.6;
  return 0.15;
}

export function competencyGroup(c) { return COMPETENCIES[c] || 'other'; }
