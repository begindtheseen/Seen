// Role ontology — the local knowledge base that makes the engine feel like it understands
// hiring. NO external AI, NO runtime fetch: this is bundled data + pure functions.
//
// Each role family encodes what a real recruiter/strategist knows about that kind of work:
// the keywords an ATS looks for, the skills the role genuinely provides EVIDENCE for
// (transferable proof), strong vs. weak verbs, metric shapes that are believable for the
// role, the overclaims that get people caught in interviews, and role-specific bullet
// scaffolds that read like a human wrote them (never "delivered results in a fast-paced
// environment").
//
// A `provides` skill means: doing this job is real evidence the candidate has that skill.
// That is the backbone of the transferability engine — a valet has genuine evidence of
// customer service even with no "customer service" job title.

export const ROLE_FAMILIES = {
  customer_service: {
    label: 'Customer Service',
    titles: ['customer service', 'csr', 'support', 'call center', 'help desk', 'client service', 'customer care', 'representative'],
    keywords: ['customer service', 'communication', 'problem solving', 'de-escalation', 'crm', 'phone support', 'email support', 'ticketing', 'complaint resolution'],
    provides: ['customer service', 'communication', 'problem solving', 'conflict resolution', 'data entry', 'phone communication'],
    strongVerbs: ['resolved', 'handled', 'assisted', 'de-escalated', 'documented', 'answered', 'supported'],
    metrics: [{ unit: 'customers per shift', q: 'How many customers or calls did you handle per shift?' }, { unit: 'satisfaction rating', q: 'Did you have a measured satisfaction or QA score?' }],
    overclaims: [{ pattern: /manage|led team|strategy|owned the/i, warn: 'implies management/ownership when customer-service evidence usually shows individual contribution' }],
    interviewRisks: ['Be ready to describe a specific hard customer interaction and how you resolved it.'],
    employerPriorities: ['reliability', 'patience', 'clear communication', 'follows process'],
  },
  retail: {
    label: 'Retail',
    titles: ['retail', 'sales associate', 'store associate', 'cashier', 'merchandiser', 'stock associate', 'store'],
    keywords: ['point of sale', 'pos', 'customer service', 'merchandising', 'inventory', 'cash handling', 'sales', 'loss prevention', 'restocking'],
    provides: ['customer service', 'point of sale', 'cash handling', 'inventory management', 'merchandising', 'sales', 'communication'],
    strongVerbs: ['processed', 'restocked', 'assisted', 'merchandised', 'balanced', 'upsold'],
    metrics: [{ unit: 'transactions per shift', q: 'How many transactions did you ring up per shift?' }, { unit: 'sales total', q: 'Did you hit or beat a sales target?' }],
    overclaims: [{ pattern: /manage|store manager|led team/i, warn: 'implies store management when associate evidence shows floor-level work' }],
    interviewRisks: ['Expect questions on handling a busy register line and a difficult return.'],
    employerPriorities: ['reliability', 'accuracy at the register', 'friendly service', 'shift coverage'],
  },
  warehouse: {
    label: 'Warehouse / Fulfillment',
    titles: ['warehouse', 'fulfillment', 'picker', 'packer', 'material handler', 'stocker', 'shipping', 'receiving', 'forklift'],
    keywords: ['inventory', 'shipping', 'receiving', 'picking', 'packing', 'forklift', 'scan accuracy', 'safety', 'rf scanner', 'pallet', 'loading'],
    provides: ['inventory management', 'shipping', 'receiving', 'warehouse', 'safety', 'physical stamina', 'scan accuracy'],
    strongVerbs: ['picked', 'packed', 'loaded', 'scanned', 'staged', 'inspected', 'operated'],
    metrics: [{ unit: 'orders per shift', q: 'How many orders/units did you pick or pack per shift?' }, { unit: 'scan accuracy', q: 'What was your scan/pick accuracy?' }],
    overclaims: [{ pattern: /manage|supervis|led team/i, warn: 'implies supervision when the evidence shows floor operations' }],
    interviewRisks: ['Be ready to discuss safety practices and lifting/standing requirements honestly.'],
    employerPriorities: ['accuracy', 'safety', 'speed', 'dependability'],
  },
  delivery_logistics: {
    label: 'Delivery / Logistics',
    titles: ['driver', 'delivery', 'courier', 'route', 'logistics', 'cdl', 'dispatch', 'last mile'],
    keywords: ['route planning', 'delivery', 'time management', 'customer delivery', 'logistics', 'safety', 'dot', 'scanning', 'on-time', 'navigation'],
    provides: ['route planning', 'logistics', 'time management', 'customer service', 'safety', 'reliability'],
    strongVerbs: ['delivered', 'routed', 'navigated', 'loaded', 'scanned', 'completed'],
    metrics: [{ unit: 'stops per shift', q: 'How many stops or packages per shift?' }, { unit: 'on-time rate', q: 'What was your on-time delivery rate?' }, { unit: 'safety record', q: 'Any accident-free streak or safety record?' }],
    overclaims: [{ pattern: /manage|dispatch team|fleet manager/i, warn: 'implies fleet/dispatch management when driving evidence shows route execution' }],
    interviewRisks: ['Expect questions on time management under a tight route and safe-driving record.'],
    employerPriorities: ['on-time reliability', 'safe driving', 'customer-facing professionalism', 'independence'],
  },
  valet_parking: {
    label: 'Valet / Parking',
    titles: ['valet', 'parking attendant', 'parking', 'car park'],
    keywords: ['guest service', 'vehicle handling', 'hospitality', 'safety', 'ticketing', 'key control', 'time-sensitive', 'communication', 'professionalism'],
    provides: ['customer service', 'hospitality', 'logistics', 'safety', 'communication', 'cash handling', 'time management', 'reliability'],
    strongVerbs: ['parked', 'greeted', 'retrieved', 'coordinated', 'staged', 'assisted'],
    metrics: [{ unit: 'vehicles per shift', q: 'How many vehicles did you handle during a busy shift?' }, { unit: 'wait time', q: 'Did you help keep guest wait times down during rushes?' }],
    overclaims: [{ pattern: /manage|led team|valet manager/i, warn: 'implies managing the valet stand when the evidence shows attendant work' }],
    interviewRisks: ['Be ready to describe handling a busy arrival rush and protecting guest keys/vehicles.'],
    employerPriorities: ['guest experience', 'vehicle safety', 'speed during rushes', 'trustworthiness with keys'],
  },
  food_service: {
    label: 'Food Service',
    titles: ['server', 'waiter', 'waitress', 'host', 'hostess', 'barista', 'cook', 'crew', 'cashier', 'food', 'restaurant', 'fast food', 'line cook'],
    keywords: ['customer service', 'point of sale', 'pos', 'food safety', 'teamwork', 'speed', 'order accuracy', 'cash handling', 'high volume', 'sanitation'],
    provides: ['customer service', 'point of sale', 'food safety', 'teamwork', 'cash handling', 'communication', 'time management'],
    strongVerbs: ['served', 'prepared', 'rang up', 'restocked', 'cleaned', 'coordinated'],
    metrics: [{ unit: 'customers per shift', q: 'How many customers/orders did you serve during a rush?' }, { unit: 'order accuracy', q: 'Did order accuracy or speed matter and get tracked?' }],
    overclaims: [{ pattern: /manage|shift manager|ran the kitchen/i, warn: 'implies shift management when crew evidence shows line/counter work' }],
    interviewRisks: ['Expect questions on working a rush, food safety, and teamwork under pressure.'],
    employerPriorities: ['speed under pressure', 'food safety', 'teamwork', 'reliability'],
  },
  hospitality: {
    label: 'Hospitality',
    titles: ['front desk', 'concierge', 'hotel', 'guest services', 'reservations', 'housekeeping'],
    keywords: ['guest service', 'reservations', 'check-in', 'hospitality', 'communication', 'problem solving', 'pos', 'cash handling'],
    provides: ['customer service', 'hospitality', 'communication', 'cash handling', 'scheduling', 'problem solving'],
    strongVerbs: ['welcomed', 'checked in', 'coordinated', 'resolved', 'booked', 'assisted'],
    metrics: [{ unit: 'guests per shift', q: 'How many guests/check-ins did you handle per shift?' }],
    overclaims: [{ pattern: /manage|hotel manager|led team/i, warn: 'implies management beyond a front-line hospitality role' }],
    interviewRisks: ['Be ready to describe resolving a guest complaint calmly.'],
    employerPriorities: ['guest experience', 'composure', 'accuracy', 'availability'],
  },
  healthcare_support: {
    label: 'Healthcare Support',
    titles: ['medical assistant', 'cna', 'caregiver', 'patient', 'home health', 'nursing assistant', 'phlebotom', 'intake', 'front office medical'],
    keywords: ['patient care', 'customer intake', 'documentation', 'scheduling', 'hipaa', 'vitals', 'ehr', 'compassion', 'phlebotomy', 'medical records'],
    provides: ['customer intake', 'data entry', 'documentation', 'scheduling', 'patient care', 'communication', 'compliance'],
    strongVerbs: ['assisted', 'documented', 'scheduled', 'recorded', 'monitored', 'supported'],
    metrics: [{ unit: 'patients per day', q: 'How many patients did you support/intake per day?' }],
    overclaims: [{ pattern: /diagnos|prescrib|nurse\b|managed care plan/i, warn: 'implies clinical/licensed duties beyond a support role — high interview + legal risk' }],
    interviewRisks: ['Do not imply licensed clinical duties you did not perform; expect HIPAA/compliance questions.'],
    employerPriorities: ['compassion', 'accuracy', 'compliance', 'reliability'],
  },
  administrative: {
    label: 'Administrative / Office',
    titles: ['administrative', 'admin', 'office', 'receptionist', 'clerk', 'assistant', 'coordinator', 'data entry', 'intake specialist', 'intake'],
    keywords: ['data entry', 'scheduling', 'documentation', 'customer intake', 'phone', 'filing', 'microsoft office', 'excel', 'calendar', 'records', 'accuracy'],
    provides: ['data entry', 'scheduling', 'documentation', 'customer intake', 'communication', 'phone communication', 'accuracy'],
    strongVerbs: ['scheduled', 'documented', 'entered', 'coordinated', 'filed', 'verified', 'answered'],
    metrics: [{ unit: 'forms/records per day', q: 'How many forms, records, or calls did you process per day?' }, { unit: 'accuracy', q: 'Did accuracy or turnaround time get measured?' }],
    overclaims: [{ pattern: /office manager|managed staff|led team|owned budget/i, warn: 'implies office management when the evidence shows coordination/support' }],
    interviewRisks: ['Expect questions on accuracy, tools used, and handling confidential records.'],
    employerPriorities: ['accuracy', 'organization', 'dependability', 'discretion'],
  },
  sales: {
    label: 'Sales',
    titles: ['sales', 'account executive', 'business development', 'sdr', 'bdr', 'account manager', 'sales rep'],
    keywords: ['sales', 'quota', 'pipeline', 'crm', 'salesforce', 'prospecting', 'closing', 'upsell', 'lead generation', 'negotiation'],
    provides: ['sales', 'crm', 'communication', 'negotiation', 'customer service'],
    strongVerbs: ['closed', 'sold', 'prospected', 'negotiated', 'grew', 'exceeded'],
    metrics: [{ unit: 'quota attainment', q: 'What was your quota attainment (%)?' }, { unit: 'revenue', q: 'How much revenue did you generate or influence?' }],
    overclaims: [{ pattern: /vp of sales|built the team|owned strategy/i, warn: 'implies sales leadership when IC quota-carrying evidence is shown' }],
    interviewRisks: ['Be ready to walk through a real deal you closed and your numbers.'],
    employerPriorities: ['quota attainment', 'persistence', 'pipeline discipline', 'communication'],
  },
  software_engineering: {
    label: 'Software Engineering',
    titles: ['software engineer', 'developer', 'programmer', 'full stack', 'backend', 'frontend', 'sde', 'swe'],
    keywords: ['javascript', 'typescript', 'python', 'react', 'node.js', 'sql', 'api', 'git', 'testing', 'ci/cd', 'aws', 'code review'],
    provides: ['software engineering', 'testing', 'code review', 'problem solving'],
    strongVerbs: ['built', 'shipped', 'implemented', 'optimized', 'debugged', 'designed'],
    metrics: [{ unit: 'latency/perf improvement', q: 'Did you measurably improve performance, latency, or reliability?' }, { unit: 'users/scale', q: 'What scale (users, requests, data) did your work operate at?' }],
    overclaims: [{ pattern: /architect(ed)? the (entire|whole)|led the team|owned the platform/i, warn: 'implies architecture/lead ownership beyond individual-contributor evidence' }],
    interviewRisks: ['Expect to explain and defend any system or technique you list.'],
    employerPriorities: ['code quality', 'shipping', 'collaboration', 'debugging'],
  },
  data_analytics: {
    label: 'Data / Analytics',
    titles: ['data analyst', 'analyst', 'business intelligence', 'data scientist', 'bi'],
    keywords: ['sql', 'excel', 'tableau', 'power bi', 'data analytics', 'reporting', 'dashboards', 'python', 'statistics'],
    provides: ['data analytics', 'sql', 'reporting', 'problem solving'],
    strongVerbs: ['analyzed', 'built', 'reported', 'modeled', 'automated', 'visualized'],
    metrics: [{ unit: 'reporting time saved', q: 'Did you cut reporting time or automate a manual process?' }],
    overclaims: [{ pattern: /led data strategy|owned the warehouse|managed analysts/i, warn: 'implies leadership beyond analyst evidence' }],
    interviewRisks: ['Be ready to defend any tool/technique and walk through an analysis end to end.'],
    employerPriorities: ['accuracy', 'clarity of reporting', 'tool fluency', 'business sense'],
  },
  operations: {
    label: 'Operations',
    titles: ['operations', 'ops', 'operations coordinator', 'operations associate', 'process'],
    keywords: ['operations', 'process improvement', 'scheduling', 'coordination', 'reporting', 'vendor', 'sop', 'efficiency'],
    provides: ['operations', 'scheduling', 'coordination', 'process improvement', 'communication'],
    strongVerbs: ['coordinated', 'streamlined', 'scheduled', 'tracked', 'improved', 'documented'],
    metrics: [{ unit: 'efficiency gain', q: 'Did you measurably improve a process, cost, or turnaround?' }],
    overclaims: [{ pattern: /director of operations|owned p&l|led the department/i, warn: 'implies senior ops ownership beyond coordinator evidence' }],
    interviewRisks: ['Expect questions on a specific process you improved and how you measured it.'],
    employerPriorities: ['organization', 'follow-through', 'measurable improvement', 'reliability'],
  },
  security: {
    label: 'Security',
    titles: ['security', 'security guard', 'security officer', 'loss prevention', 'guard'],
    keywords: ['security', 'surveillance', 'patrol', 'incident reports', 'access control', 'safety', 'de-escalation', 'loss prevention'],
    provides: ['safety', 'communication', 'documentation', 'de-escalation', 'reliability'],
    strongVerbs: ['patrolled', 'monitored', 'documented', 'responded', 'secured', 'reported'],
    metrics: [{ unit: 'incidents handled', q: 'How many incidents did you document or respond to?' }],
    overclaims: [{ pattern: /security manager|led the team|armed|law enforcement/i, warn: 'implies duties/authority beyond a guard role — verify licensing claims' }],
    interviewRisks: ['Be ready to describe following protocol and writing an incident report.'],
    employerPriorities: ['vigilance', 'reliability', 'clear reporting', 'composure'],
  },
  finance_accounting: {
    label: 'Finance / Accounting',
    titles: ['accountant', 'accounting', 'bookkeeper', 'accounts payable', 'accounts receivable', 'finance', 'payroll'],
    keywords: ['accounting', 'bookkeeping', 'quickbooks', 'excel', 'accounts payable', 'accounts receivable', 'reconciliation', 'payroll', 'gaap', 'invoicing'],
    provides: ['accounting', 'bookkeeping', 'data entry', 'accuracy', 'reporting'],
    strongVerbs: ['reconciled', 'processed', 'balanced', 'audited', 'reported', 'prepared'],
    metrics: [{ unit: 'accounts/invoices per period', q: 'How many accounts or invoices did you process per period?' }],
    overclaims: [{ pattern: /controller|cfo|owned the audit|managed the finance team/i, warn: 'implies senior finance ownership beyond the evidence' }],
    interviewRisks: ['Expect questions on reconciliation, accuracy, and any system you list.'],
    employerPriorities: ['accuracy', 'discretion', 'deadline reliability', 'tool fluency'],
  },
};

// Generic, low-signal phrasing that must NOT appear in generated bullets. The bullet compiler
// rejects any candidate containing these.
export const BANNED_PHRASES = [
  'deliver results', 'delivered results', 'day-to-day responsibilities', 'proven track record',
  'results-driven', 'dynamic', 'go-getter', 'think outside the box', 'utilized', 'leveraged',
  'synergy', 'wheelhouse', 'hit the ground running', 'team player who', 'detail-oriented professional',
];

// "fast-paced" is only allowed for role families where it is literally true.
export const FAST_PACED_OK = new Set(['food_service', 'retail', 'warehouse', 'delivery_logistics', 'valet_parking', 'hospitality', 'customer_service']);

const _titleIndex = Object.entries(ROLE_FAMILIES).flatMap(([fam, d]) =>
  d.titles.map(t => ({ t, fam })),
).sort((a, b) => b.t.length - a.t.length); // longest title token first for specificity

// Detect the most likely role family from a title + text. Returns { family, confidence, label }.
// Deterministic: scores each family by weighted title + keyword hits, picks the top.
export function detectRoleFamily(title = '', text = '') {
  const hay = `${title} ${text}`.toLowerCase();
  const scores = {};
  for (const [fam, d] of Object.entries(ROLE_FAMILIES)) {
    let s = 0;
    for (const t of d.titles) if (hay.includes(t)) s += (title.toLowerCase().includes(t) ? 3 : 1) * Math.min(2, t.length / 6);
    for (const k of d.keywords) if (hay.includes(k)) s += 0.6;
    if (s) scores[fam] = s;
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { family: null, confidence: 0, label: 'General' };
  const [family, top] = ranked[0];
  const second = ranked[1]?.[1] || 0;
  const confidence = Math.max(0.35, Math.min(0.95, top / (top + second + 1.5)));
  return { family, confidence: Number(confidence.toFixed(2)), label: ROLE_FAMILIES[family].label };
}

export function roleFamily(fam) {
  return ROLE_FAMILIES[fam] || null;
}
