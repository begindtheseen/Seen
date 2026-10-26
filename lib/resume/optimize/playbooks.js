// What a hiring manager in each field screens for, as data the optimizer loads (research 2026-10-25,
// scratchpad research3/resume-science.md §4: US DOL CareerOneStop, Purdue OWL, university career
// centres, OSHA, BLS, practitioner and recruiter sources). The model reads the playbook for the
// target job's field; it never treats a playbook item as a fact about the person — playbook terms are
// what to LOOK for and what to ASK about.

const P = (o) => o;

export const PLAYBOOKS = {
  retail: P({
    label: 'Retail',
    screens_for: 'reliability and availability, trust (keys, opening/closing, cash), accuracy at the register, sales, service under pressure',
    evidence: ['tenure and promotions', 'key holder / opening / closing', 'cash drawer accuracy', 'training new hires', 'sales or credit-card goals hit', 'recognition (employee of the month)', 'inventory or cycle counts'],
    seniority: ['key holder', 'shift lead', 'trainer', 'department ownership', 'scheduling', 'store manager scope: sales volume, payroll hours, shrink, team size'],
    red_flags: ['generic soft-skill lists', '"responsible for cashier duties"', 'many very short stints'],
    ask_about: ['transactions or customers per shift', 'how soon they were trusted with keys or cash', 'people trained', 'sales goals and how they did against them'],
  }),
  warehouse: P({
    label: 'Warehouse / logistics',
    screens_for: 'safety record, equipment by type, pace and accuracy, shift availability, scanner/WMS use',
    evidence: ['equipment named by type (sit-down, reach truck, order picker, pallet jack)', 'pick/pack rate or accuracy the employer measured', 'safety record', 'cycle counts', 'training others'],
    seniority: ['lead', 'trainer', 'inventory control', 'receiving or shipping coordination', 'crew size'],
    red_flags: ['vague "fast-paced environment"', '"forklift certified" without the truck types or where they were trained'],
    ask_about: ['rate or accuracy as the employer measured it', 'equipment types and where they were trained', 'crew size led', 'safety record'],
  }),
  food_service: P({
    label: 'Food service',
    screens_for: 'speed at volume, food safety, stations, teamwork, availability',
    evidence: ['covers per shift or rush volume', 'food-handler card / ServSafe (state-specific)', 'stations worked', 'inspections', 'training others', 'waste or food-cost tracking'],
    seniority: ['trainer', 'shift or kitchen lead', 'ordering and inventory', 'food cost'],
    red_flags: ['"cooked food"', 'generic "team player"'],
    ask_about: ['covers on a busy night', 'stations', 'food-safety card and state', 'people trained'],
  }),
  caregiving: P({
    label: 'Patient care (CNA / caregiving)',
    screens_for: 'active state registry listing, setting, ADLs, vitals, documentation, safe transfers',
    evidence: ['certification + state + expiry', 'BLS/CPR', 'resident or patient load', 'specific skills (vitals, intake/output, mechanical lift)', 'documentation system'],
    seniority: ['restorative aide', 'CNA II', 'trainer', 'charge aide'],
    red_flags: ['lapsed certification', '"helped patients"'],
    ask_about: ['residents per shift', 'setting and unit size', 'certification state and expiry'],
  }),
  nursing: P({
    label: 'Nursing (RN)',
    screens_for: 'active license (state/compact), unit and specialty fit, certifications (BLS/ACLS/PALS, specialty), patient load and acuity, EHR',
    evidence: ['unit type and size', 'patient ratio', 'acuity', 'EHR (Epic, Cerner)', 'charge and preceptor roles', 'quality or safety projects with results'],
    seniority: ['charge nurse', 'preceptor', 'unit council', 'specialty certification', 'nurse manager: budget and staff'],
    red_flags: ['no license state', 'vague "provided patient care"', 'specialty mismatch not addressed', 'an expired required certification'],
    ask_about: ['license state and expiry', 'patients per shift and acuity', 'the result of a quality project'],
    credentials_first: true,
  }),
  skilled_trades: P({
    label: 'Skilled trades',
    screens_for: 'license or apprenticeship status, code knowledge, safety cards, equipment and systems, project types',
    evidence: ['license number/state or apprenticeship hours', 'residential / commercial / industrial work', 'project scale', 'inspections passed first time', 'safety record', 'tools and equipment in project context'],
    seniority: ['journeyman', 'foreman', 'crew size', 'estimating', 'pulling permits'],
    red_flags: ['no license or hours', 'tool lists without project context'],
    ask_about: ['license or hours', 'project types and size', 'inspection record', 'crew size'],
    credentials_first: true,
  }),
  administrative: P({
    label: 'Office / administrative',
    screens_for: 'who they supported and at what level, calendar and travel complexity, software, confidentiality, accuracy',
    evidence: ['number and level of people supported', 'volume (meetings, travel, invoices)', 'process fixes', 'vendor or budget handling'],
    seniority: ['executive assistant to a named level', 'office manager (budget, vendors)', 'project coordination'],
    red_flags: ['"answered phones" alone', 'inflated titles'],
    ask_about: ['how many people and at what level', 'volume per week or month', 'a process they fixed and what changed'],
  }),
  customer_service: P({
    label: 'Customer service',
    screens_for: 'channels, volume, quality metrics as the employer measured them, systems, escalations',
    evidence: ['contacts per day', 'CSAT / QA / first-contact resolution as measured', 'escalations handled', 'languages', 'tools'],
    seniority: ['tier 2', 'escalations', 'QA', 'trainer', 'team lead'],
    red_flags: ['"excellent communication skills" without evidence'],
    ask_about: ['contacts per day', 'how the employer measured quality and their score', 'escalations'],
  }),
  sales: P({
    label: 'Sales',
    screens_for: 'quota attainment over several periods, rank, deal size, cycle, segment',
    evidence: ['% to quota by period', 'stack rank', 'new logos', 'average deal size', 'territory'],
    seniority: ['enterprise segment', 'larger deals', 'team quota', 'player-coach'],
    red_flags: ['activity counts without outcomes', 'team revenue shown as personal'],
    ask_about: ['% to quota by year', 'rank among reps', 'deal size and segment'],
  }),
  software_engineering: P({
    label: 'Software engineering',
    screens_for: 'what they built, scale, impact, technologies applied (not listed), ownership, progression',
    evidence: ['system built or owned', 'scale (users, requests, data)', 'latency, cost, reliability results', 'on-call ownership', 'migrations'],
    seniority: ['owned a service end to end', 'led a design', 'cross-team migration', 'mentoring', 'org-wide standards'],
    red_flags: ['tool soup', 'scope inflation beyond level', 'posting terms merged in without evidence'],
    ask_about: ['scale', 'the measurable result', 'what they owned versus contributed to'],
  }),
  data_analytics: P({
    label: 'Data / analytics',
    screens_for: 'the question, the method, the decision it changed; tools in context; data scale; stakeholders',
    evidence: ['decision changed by an analysis', 'who used the work', 'data scale', 'time saved by automation'],
    seniority: ['framing problems', 'influencing decisions', 'building self-serve data'],
    red_flags: ['tool or model lists without outcomes'],
    ask_about: ['the decision an analysis changed', 'who used the dashboard and how often'],
  }),
  marketing: P({
    label: 'Marketing',
    screens_for: 'channels, budget owned, outcomes with a baseline, tools',
    evidence: ['growth with a baseline and time frame', 'conversion or pipeline', 'budget', 'launches'],
    seniority: ['strategy and budget ownership', 'team', 'cross-functional launches'],
    red_flags: ['vanity metrics without a baseline', 'company growth claimed as personal'],
    ask_about: ['the baseline and the time frame', 'budget', 'what part was theirs'],
  }),
  finance_accounting: P({
    label: 'Finance / accounting',
    screens_for: 'close, reconciliation, audit, ERP named, credentials (CPA status), dollar scale, accuracy',
    evidence: ['close timeline', 'accounts reconciled', 'audit support', 'ERP', 'dollar scale', 'recoveries'],
    seniority: ['owned the close', 'managed staff', 'led an audit', 'controller-level scope'],
    red_flags: ['arithmetic or format inconsistencies', '"assisted with"'],
    ask_about: ['entities or revenue scale', 'close days before and after', 'CPA exam status as of now'],
  }),
  education: P({
    label: 'Teaching',
    screens_for: 'license and endorsements, grade and subject, classroom management, student-achievement evidence',
    evidence: ['grades, sections, class size', 'student population (IEP/ELL)', 'specific methods and materials', 'assessment results', 'collaboration and parent communication'],
    seniority: ['grade-level lead', 'department chair', 'curriculum writing', 'mentoring student teachers'],
    red_flags: ['duties every teacher does'],
    ask_about: ['growth on a named assessment', 'class size and population', 'a specific method and what changed'],
    credentials_first: true,
  }),
  management: P({
    label: 'Management',
    screens_for: 'team size, budget or P&L, hiring and retention, what the team achieved under them versus before, built versus inherited',
    evidence: ['people led', 'money owned', 'before and after results', 'hiring and retention'],
    seniority: ['scope nouns: people, money, sites', 'decision rights', 'building a function'],
    red_flags: ['only personal output', 'titles without scope'],
    ask_about: ['team size', 'budget or sales volume', 'a result before versus after'],
  }),
  general: P({
    label: 'General',
    screens_for: 'what they did, for whom, how much, and what changed because of it',
    evidence: ['volume', 'people served or trained', 'recognition', 'trust given'],
    seniority: ['training others', 'leading a shift or a project', 'being trusted with keys, cash or customers'],
    red_flags: ['duty lists', 'soft-skill adjectives'],
    ask_about: ['volume per shift or week', 'people trained', 'what happened as a result'],
  }),
};

// Seen's role families (lib/application-intelligence/roleOntology.js) → playbooks.
const FAMILY_MAP = {
  retail: 'retail', warehouse: 'warehouse', delivery_logistics: 'warehouse', food_service: 'food_service',
  hospitality: 'customer_service', valet_parking: 'customer_service', healthcare_support: 'caregiving', clinical: 'nursing',
  skilled_trades: 'skilled_trades', administrative: 'administrative', customer_service: 'customer_service', sales: 'sales',
  software_engineering: 'software_engineering', data_analytics: 'data_analytics', marketing: 'marketing',
  finance_accounting: 'finance_accounting', education: 'education', operations: 'management', project_management: 'management',
  security: 'general', general: 'general',
};
const LEAD_RE = /\b(manager|director|supervisor|head|chief|lead|foreman|principal)\b/i;

/** The playbook for a target job, plus the management overlay for titles that run people. */
export function playbookFor(family, role = '') {
  const nurse = /\b(nurse|rn|lpn|lvn)\b/i.test(role) && !/\bassistant|aide|cna\b/i.test(role);
  const key = nurse ? 'nursing' : FAMILY_MAP[family] || 'general';
  const base = PLAYBOOKS[key];
  const lead = LEAD_RE.test(role) && key !== 'management';
  return { key, ...base, management: lead ? PLAYBOOKS.management : null };
}

// LLM house vocabulary and grand verbs that add no information (research §6: recruiters read these
// as AI tells; Kobak et al. "excess vocabulary"). A rewrite may not introduce them.
export const AI_TELLS = [
  'spearheaded', 'spearhead', 'orchestrated', 'orchestrate', 'leveraged', 'leverage', 'leveraging', 'utilized', 'utilize', 'utilizing',
  'seamlessly', 'seamless', 'robust', 'delve', 'delved', 'intricate', 'notably', 'synergy', 'synergies', 'dynamic', 'passionate',
  'results-driven', 'proven track record', 'cutting-edge', 'best-in-class', 'world-class', 'innovative', 'transformative',
  'empowered', 'championed', 'fostered', 'cultivated', 'pivotal', 'meticulous', 'meticulously', 'tapestry', 'myriad', 'plethora',
  'holistic', 'elevated', 'streamlined operations', 'drove success', 'ensuring seamless',
];
export const AI_TELL_RE = new RegExp(`\\b(?:${AI_TELLS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|')})\\b`, 'i');

// Claim strength of a lead verb. A rewrite may not raise it unless a cited fact or answer supports
// the stronger verb ("helped" → "led" is intensification, research §9.3).
const STRENGTH = {
  1: ['helped', 'help', 'assisted', 'assist', 'supported', 'support', 'contributed', 'contribute', 'participated', 'worked', 'work', 'joined', 'shadowed'],
  3: ['led', 'lead', 'managed', 'manage', 'directed', 'direct', 'owned', 'own', 'headed', 'head', 'ran', 'run', 'supervised', 'supervise', 'oversaw', 'oversee', 'founded', 'launched', 'launch', 'built', 'build', 'created', 'create', 'designed', 'design'],
};
export function verbStrength(word) {
  const w = String(word || '').toLowerCase();
  if (STRENGTH[3].includes(w)) return 3;
  if (STRENGTH[1].includes(w)) return 1;
  return 2;
}
