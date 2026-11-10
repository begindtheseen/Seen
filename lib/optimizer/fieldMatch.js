// FIELD MATCH — is this posting in the person's line of work? (G, 2026-11-10)
//
// The hidden acceptance set had five deliberate wrong-field pairs (a journeyman electrician × a frontend-engineer
// posting, fit 12) and nothing on any screen said "this is a different field": the only signal was "Weak fit", and the
// paid tools went on to sell tailoring. This module answers one question a recruiter answers first — has this person
// done this job, or the one next to it? — from the person's job TITLES (and, when a title says nothing, the duties under
// it), never from keyword overlap.
//
//   fieldMatch({ resumeText, jobTitle, jobText, matches, now }) → {
//     level: 'same' | 'adjacent' | 'different',
//     known: boolean,             false when the posting's field could not be placed (level is then never 'different')
//     resumeField:  string|null,  the person's main field, as words ("electrical work")
//     postingField: string|null,  the posting's field, as words ("software engineering")
//     postingFieldKey / resumeFieldKey: the field ids (for tools; never shown)
//     sameRoles / adjacentRoles: [{ title, span }] — the résumé roles that put the person in (or next to) the field
//     titleMatch: 0..1            how close the person's closest job title is to the posting's ("done this job")
//     transferable: string[]      things on the résumé that carry over, as the résumé wrote them
//     sentence: string            plain, kind, true; names both fields and what carries over
//   }
//
// 'different' only when every placed role on the résumé is outside the posting's field AND its neighbours, and the
// résumé's education names nothing in the field either. Conservative by design: support lead → call-center trainer is
// adjacent; teacher → corporate trainer is adjacent; electrician → frontend engineer is different.
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { experienceProfile } from '../resume/years.js';
import { resumeLineInfo, NOT_PEOPLE_MANAGER_TITLE_RE } from './extractResumeFacts.js';

// Ordered: the first field whose title pattern matches a title wins (specific before generic). `label` is how the field
// reads in "your experience is in X"; `role` how a job in it reads in "This is a X role".
export const FIELDS = [
  { key: 'patient_care', label: 'patient care', role: 'patient-care', title: /\b(?:medical\s+assistant|CMA|CCMA|RMA|nursing\s+assistant|CNA|LNA|patient\s+care\s+(?:assistant|tech\w*)|caregiver|home\s+health\s+aide|HHA|CHHA|phlebotom\w*|EMT|paramedic|pharmacy\s+tech\w*|dental\s+assistant|direct\s+support\s+professional|optometric\s+tech\w*|medical\s+technician|veterinary\s+tech\w*)\b/i, edu: /\bmedical\s+assistant|phlebotomy|EMT\b/i, adj: ['nursing', 'clinical', 'front_office', 'behavior', 'support'] },
  { key: 'behavior', label: 'behavior therapy', role: 'behavior-therapy', title: /\b(?:behavio(?:u)?r(?:al)?\s+(?:technician|tech|therapist|interventionist|specialist)|RBT|BCAT|ABA\s+(?:therapist|technician|instructor)|autism\s+(?:technician|specialist))\b/i, edu: /\bpsychology\b|\bapplied\s+behavior\b/i, adj: ['education', 'patient_care', 'clinical'] },
  { key: 'nursing', label: 'nursing', role: 'nursing', title: /\b(?:registered\s+nurse|nurse|nursing|RN|LPN|LVN|BSN|charge\s+nurse|nurse\s+practitioner)\b/i, edu: /\bnursing\b|\bBSN\b|\bADN\b/i, adj: ['patient_care', 'clinical'] },
  { key: 'clinical', label: 'clinical care', role: 'clinical', title: /\b(?:clinical\s+(?:trial|pharmacolog\w*)|DPT|therapist|physician|doctor|dentist|surgeon|endodontist|orthodontist|nutritionist|behavior\s+analyst|clinical\s+research|optometrist|psychologist|social\s+worker|dietitian|pharmacist|radiologic|technologist|counselor|clinician|veterinarian|PMHNP|CRNA|BCBA|LCSW|speech\s+language)\b/i, edu: null, adj: ['nursing', 'patient_care'] },
  { key: 'engineering', label: 'engineering', role: 'engineering', title: /\b(?:mechanical|electrical|civil|structural|hardware|manufacturing|quality|process|facilities|aerospace|propulsion|gnc|test|industrial|chemical|optical|rf|controls?|physical\s+design|digital\s+design|asic|fpga|power|ot|commissioning|field\s+operations|project|low\s+observables|turbomachinery|serdes|flight\s+assurance|quality\s+systems)\s+(?:\w+\s+)?(?:engineer\w*|design\s+engineer)\b|\b(?:mechanical|structural|electrical|civil)\s+engineering\b|\bengineering\s+(?:intern|co-op|technician)\b|\b(?:tooling|MEP|cellular|compliance|validation|characterization|silicon|SoC|serdes|photonic\w*|audio|avionics|teardown)\b[\w\s&/-]{0,40}?\b(?:engineer\w*|architect|design\s+intern)\b/i, edu: /\b(?:mechanical|electrical|civil|aerospace|chemical|industrial)\s+engineering\b/i, adj: ['manufacturing', 'software', 'maintenance', 'construction', 'electrical'] },
  { key: 'software', label: 'software engineering', role: 'software engineering', title: /\b(?:software|backend|back-end|front[- ]?end|full[- ]?stack|web|mobile|ios|android|devops|platform|application|cloud|data|ml|machine\s+learning|ai|qa|test\s+automation|infrastructure|systems)\s+(?:engineer|engineering|developer|architect)\b|\b(?:research|forward\s+deployed|solutions?|services|security|cybersecurity|ai|ml|agent)\s+engineer\b|\bsolutions?\s+architect\b|\bsite\s+reliability\b|\bSRE\b|\bSDET\b|\bdeveloper\b|\bprogrammer\b|\bsoftware\s+(?:engineer\w*|develop\w*|design\s+and\s+develop\w*)\b|\bengineer\s+in\s+test\b|\b(?:llm|inference|deep\s+learning|machine\s+learning)\s+(?:\w+\s+)?(?:engineer|researcher)\b|\bengineering\s+manager\b/i, edu: /\bcomputer\s+science\b|\bsoftware\s+engineering\b|\bcomputer\s+engineering\b/i, adj: ['data', 'it'] },
  { key: 'data', label: 'data analytics', role: 'data analytics', title: /\b(?:data\s+(?:analyst|scientist)|analytics|business\s+intelligence|BI\s+analyst|quantitative)\b/i, edu: /\bstatistics\b|\bdata\s+science\b/i, adj: ['software', 'accounting', 'marketing'] },
  { key: 'science', label: 'laboratory science', role: 'laboratory science', title: /\b(?:scientist|chemist|biologist|microbiologist|biochemist|research\s+associate|lab(?:oratory)?\s+(?:technician|assistant|analyst|manager|scientist)|bioconjugat\w*|assay\s+\w+|formulation\s+\w+|QC\s+(?:analyst|chemist)|toxicolog\w*|pharmacolog\w*)\b/i, edu: /\b(?:chemistry|biology|biochem\w*|life\s+sciences?|microbiology|physics)\b/i, adj: ['clinical', 'engineering', 'data', 'manufacturing'] },
  { key: 'cyber', label: 'cybersecurity and intelligence', role: 'cybersecurity', title: /\b(?:cyber\w*|security\s+operations|SOC\s+(?:analyst|specialist|engineer)|threat\s+(?:intel\w*|hunt\w*|analyst)|incident\s+(?:response|responder|handler)|information\s+security|infosec|intelligence\s+analyst|all-source|SIGINT|HUMINT|OSINT|penetration\s+tester|red\s+team|blue\s+team|cyber\s+protection)\b/i, edu: /\bcyber\w*|information\s+assurance|intelligence\s+studies\b/i, adj: ['software', 'it', 'data'] },
  { key: 'records', label: 'health information and medical records', role: 'health-information', title: /\b(?:health\s+information|medical\s+records?|HIM\b|release\s+of\s+information|ROI\s+specialist|medical\s+coder|coding\s+specialist|records\s+(?:clerk|specialist|technician|custodian))\b/i, edu: /\bhealth\s+information|RHIT|RHIA\b/i, adj: ['front_office', 'patient_care', 'clinical'] },
  { key: 'it', label: 'IT support', role: 'IT', title: /\b(?:IT\s+(?:support|specialist|technician|analyst|engineer)|help\s*desk|service\s+desk|desktop\s+support|network\s+(?:administrator|engineer|technician)|systems?\s+administrator|sysadmin)\b/i, edu: /\binformation\s+technology\b/i, adj: ['software', 'support'] },
  { key: 'electrical', label: 'electrical work', role: 'electrical', title: /\b(?:electrician|electrical\s+(?:apprentice|technician|helper|worker|test)|journeyman|wireman|lineman|electrical\s+contractor|(?:telematics|low[- ]voltage|alarm|fire\s+alarm|solar|electronics?|cable|fiber)\s+(?:installer|technician|programmer))\b/i, edu: /\belectrical\s+(?:apprenticeship|technology)\b|\bIEC\b|\bIBEW\b/i, adj: ['maintenance', 'manufacturing', 'construction'] },
  { key: 'maintenance', label: 'maintenance and repair', role: 'maintenance', title: /\b(?:maintenance|mechanic|hvac|plumber|plumbing|installer|installation|welder|machinist|carpenter|technician\s+helper|service\s+technician|tool\s+technician|repair\s+tech\w*)\b/i, edu: null, adj: ['electrical', 'manufacturing', 'construction'] },
  { key: 'manufacturing', label: 'manufacturing and assembly', role: 'manufacturing', title: /\b(?:assembl\w*|production\s+(?:operator|worker|associate|supervisor|planner|services|technician)|machine\s+operator|set\s*-?up\s+operator|manufacturing|test\s+technician|quality\s+(?:inspector|technician)|CNC|fabricat\w*)\b/i, edu: null, adj: ['warehouse', 'maintenance', 'electrical'] },
  { key: 'construction', label: 'construction', role: 'construction', title: /\b(?:construction|superintendent|laborer|pipe\s+layer|foreman|crew\s+chief|stagehand)\b/i, edu: null, adj: ['electrical', 'maintenance'] },
  { key: 'legal', label: 'legal work', role: 'legal', title: /\b(?:attorney|counsel|lawyer|paralegal|legal|litigation)\b/i, edu: /\bJ\.?D\.?\b|\blaw\s+school\b/i, adj: ['front_office'] },
  { key: 'accounting', label: 'accounting and finance', role: 'accounting', title: /\b(?:accountant|accounting|bookkeep\w*|investment\s+operations|transaction\s+advisory|auditor|audit\s+(?:associate|senior)|controller|accounts\s+(?:payable|receivable)|payroll|tax\s+(?:preparer|associate)|financial\s+(?:analyst|reporting)|FP&A|finance|treasury)\b/i, edu: /\baccount(?:ing|ancy)\b|\bfinance\b/i, adj: ['front_office', 'data'] },
  { key: 'retail', label: 'retail', role: 'retail', title: /\b(?:cashier|sales\s+associate|retail|store|keyholder|key\s+holder|merchandis\w*|front\s+end\s+(?:team|lead|supervisor|cashier)|guest\s+(?:service|experience)|person\s+in\s+charge|visual\s+lead|grocery)\b/i, edu: null, adj: ['support', 'food', 'warehouse', 'hospitality', 'sales', 'ops'] },
  { key: 'sales', label: 'sales', role: 'sales', title: /\b(?:account\s+executive|sales|business\s+development|BDR|SDR|account\s+manager|inside\s+sales|development\s+representative|territory\s+manager|customer\s+success|client\s+(?:partner|success)|lead\s+generator|(?:therapeutic|pharmaceutical|medical\s+device)\s+(?:specialty\s+)?(?:representative|specialist))\b/i, edu: null, adj: ['marketing', 'support', 'retail'] },
  { key: 'product', label: 'product management', role: 'product management', title: /\bproduct\s+(?:manager|owner|lead|strategy|director|management)\b|\bdirector,?\s+product\b|\bhead\s+of\s+product\b/i, edu: null, adj: ['software', 'marketing', 'data'] },
  { key: 'marketing', label: 'marketing', role: 'marketing', title: /\b(?:marketing|social\s+media|content|brand|seo|paid\s+media|communications|copywriter|public\s+relations|PR\s+(?:specialist|coordinator)|campaign|growth)\b/i, edu: /\bmarketing\b|\bcommunications?\b|\bjournalism\b/i, adj: ['sales', 'data'] },
  { key: 'design', label: 'design', role: 'design', title: /\b(?:designer|ux|ui\s+designer|graphic|visual\s+design|interior\s+design\w*|drafter|cadd?\s+(?:specialist|designer|technician))\b/i, edu: /\bgraphic\s+design|\bdesign\b/i, adj: ['marketing', 'product'] },
  { key: 'fitness', label: 'fitness', role: 'fitness', title: /\b(?:personal\s+trainer|fitness|yoga|pilates|strength\s+(?:and\s+conditioning\s+)?coach)\b/i, edu: /\bkinesiology|exercise\s+science\b/i, adj: ['training', 'education', 'hospitality'] },
  { key: 'training', label: 'training and coaching', role: 'training', title: /\b(?:(?<!\bAI\s)trainer|(?<!\bin\s|\bAI\s)training(?!\s+(?:provided|available|experts?))|learning\s+(?:and|&)\s+development|instructional\s+design\w*|coach|enablement|facilitator)\b/i, edu: null, adj: ['education', 'support', 'hr'] },
  { key: 'education', label: 'teaching', role: 'teaching', title: /\b(?:teacher|tutor|instructor|professor|educator|teaching\s+assistant|paraprofessional|lecturer|kids|youth|children'?s\s+program|camp\s+counselor)\b/i, edu: /\beducation\b|\bteaching\b/i, adj: ['training', 'front_office', 'hr', 'behavior'] },
  { key: 'hr', label: 'human resources and recruiting', role: 'HR', title: /\b(?:recruit\w*|human\s+resources?|HR\s+(?:generalist|specialist|director|coordinator)|people\s+(?:operations|systems)|talent\s+acquisition)\b/i, edu: /\bhuman\s+resources\b/i, adj: ['training', 'front_office'] },
  { key: 'support', label: 'customer support', role: 'customer support', title: /\b(?:customer\s+(?:service|support|care|experience)|support\s+(?:agent|specialist|team\s+lead|representative|lead)|call\s+cent\w*|contact\s+cent\w*|CSR|client\s+care|care\s+expert)\b/i, edu: null, adj: ['sales', 'retail', 'front_office', 'training', 'hospitality', 'ops', 'patient_care'] },
  { key: 'food', label: 'food service', role: 'food-service', title: /\b(?:dietary\s+(?:aide|assistant|worker|clerk|cook)|nutrition\s+services|food\s+service\s+(?:worker|attendant|aide)|cook|chef|sous|kitchen|line\s+cook|prep\s+cook|barista|server|bartender|crew\s+member|dishwasher|restaurant|food\s+service|grill|baker|host(?:ess)?|cafe|caf[eé]|catering|busser|deli)\b/i, edu: /\bculinary\b/i, adj: ['retail', 'hospitality', 'support', 'ops'] },
  { key: 'hospitality', label: 'hospitality', role: 'hospitality', title: /\b(?:hotel|front\s+desk|housekeep\w*|concierge|valet|guest\s+services?\s+agent|desk\s+clerk)\b/i, edu: null, adj: ['food', 'retail', 'support', 'front_office'] },
  { key: 'front_office', label: 'office administration', role: 'office administration', title: /\b(?:receptionist|administrative|admin\b|office\s+(?:manager|assistant|coordinator)|executive\s+assistant|secretary|office\s+clerk|file\s+clerk|clerical|data\s+entry|scheduler|administrative\s+coordinator|office\s+coordinator)\b/i, edu: null, adj: ['support', 'accounting', 'patient_care', 'hospitality', 'hr', 'ops'] },
  { key: 'warehouse', label: 'warehouse work', role: 'warehouse', title: /\b(?:warehouse|material\s+handler|forklift|picker|packer|inventory\s+(?:control|specialist|associate|supervisor|clerk|coordinator|analyst|lead)|stock\s+(?:associate|clerk|handler)|stocker|receiving\s+(?:clerk|associate)|shipping\s+(?:clerk|associate)|shipping|receiving|distribution|fulfil?lment|loader|yard\s+technician|materials?\s+(?:coordinator|handler))\b/i, edu: null, adj: ['supply_chain', 'logistics', 'retail', 'manufacturing', 'ops'] },
  { key: 'supply_chain', label: 'logistics and supply chain', role: 'logistics', title: /\b(?:logistics|supply\s+chain|procurement|purchasing|buyer|freight|transportation\s+(?:coordinator|planner|manager|analyst)|materials?\s+(?:manager|planner)|expeditor)\b/i, edu: /\bsupply\s+chain|logistics\b/i, adj: ['warehouse', 'logistics', 'ops', 'manufacturing', 'construction', 'front_office'] },
  { key: 'logistics', label: 'driving and delivery', role: 'driving and delivery', title: /\b(?:driver|delivery|courier|dispatcher|truck|doordash|instacart)\b/i, edu: null, adj: ['warehouse', 'ops'] },
  { key: 'ops', label: 'operations management', role: 'operations management', title: /\b(?:operations\s+(?:manager|supervisor|director|lead)|general\s+manager|district\s+manager|area\s+manager|shift\s+lead|shift\s+supervisor)\b/i, edu: /\bbusiness\s+(?:management|administration)\b/i, adj: ['retail', 'food', 'warehouse', 'support', 'logistics', 'hospitality', 'front_office'] },
];
const BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
// What a bullet in a field DOES (a role whose title says little but whose bullets are this work is in the field).
const DUTY = {
  support: /\b(?:customers?|guests?|members?|clients?|callers?|patients?)\b[^.\n]{0,60}\b(?:questions?|complaints?|inquir\w*|issues?|billing|satisfaction|escalat\w*|support|calls?|chats?|tickets?)\b|\b(?:answered|handled|resolved)\b[^.\n]{0,40}\b(?:calls?|questions?|complaints?|tickets?|chats?|inquir\w*)\b|\b(?:CSAT|satisfaction\s+score|NPS)\b/i,
  sales: /\b(?:sold|selling|sell|closed|quota|upsell\w*|renewed|memberships?\s+(?:sold|sales)|revenue|pipeline|prospect\w*)\b/i,
  retail: /\b(?:register|POS|cash\s+drawer|sales\s+floor|merchandis\w*|restock\w*|stock(?:ed|ing)?\s+shelves|returns?\s+and\s+exchanges|planogram|shoppers?)\b/i,
  food: /\b(?:cook\w*|prep(?:ped|ping)?|plat(?:ed|ing)|line\s+check|ticket\s+times|food\s+(?:safety|prep|cost)|kitchen|menu|espresso|drinks?|orders?\s+(?:for|to)\s+guests)\b/i,
  warehouse: /\b(?:pick(?:ed|ing)?|pack(?:ed|ing)?|forklift|pallet\w*|RF\s+scanner|cycle\s+counts?|loading|unloading|shipments?|receiv(?:ed|ing))\b/i,
  front_office: /\b(?:scheduled\s+appointments|schedule\s+appointments|answer(?:ed)?\s+phones|calendars?|filing|data\s+entry|front\s+desk|check(?:ed)?\s+(?:patients|guests|visitors)\s+in|greet(?:ed)?\s+(?:visitors|patients|clients))\b/i,
  patient_care: /\b(?:vitals?|patients?|venipuncture|injections?|EKGs?|specimens?|bathing|ambulat\w*|wound\s+care|charting)\b/i,
};
/** The fields a role's DUTIES are in: a third or more of its bullets (at least one) do that work. */
export function roleDuties(role) {
  const bullets = (role && role.bullets) || [];
  if (!bullets.length) return [];
  return Object.entries(DUTY).filter(([, re]) => bullets.filter((b) => re.test(b)).length / bullets.length >= 1 / 3).map(([k]) => k);
}
// the ontology's families, for a title none of the patterns place
const FAMILY_TO_FIELD = { customer_service: 'support', retail: 'retail', warehouse: 'warehouse', delivery_logistics: 'logistics', valet_parking: 'hospitality', food_service: 'food', hospitality: 'hospitality', clinical: 'clinical', healthcare_support: 'patient_care', administrative: 'front_office', sales: 'sales', software_engineering: 'software', data_analytics: 'data', finance_accounting: 'accounting', marketing: 'marketing', education: 'education', skilled_trades: 'maintenance' };

/** The field a job title is in, or null. */
// The job noun is at the END of a title ("Warehouse Delivery Driver" is a driver, "Retail Sales Associate" a retail
// associate): among the fields whose pattern matches, the one whose match ends last wins; ties go to table order.
const GLOBAL = new Map();
function lastEnd(f, t) {
  let re = GLOBAL.get(f.key);
  if (!re) { re = new RegExp(f.title.source, 'gi'); GLOBAL.set(f.key, re); }
  re.lastIndex = 0;
  let m, end = -1, guard = 0;
  while ((m = re.exec(t)) !== null && guard++ < 20) { end = Math.max(end, m.index + m[0].length); if (m[0].length === 0) re.lastIndex++; }
  return end;
}
export function titleField(title) {
  // two jobs joined by "+" / " and " ("Math Teacher + Business Operations Specialist"): the first one names the field
  const t = String(title || '').slice(0, 160).split(/\s+\+\s+/)[0];
  if (!t.trim()) return null;
  let best = null, bestEnd = -1;
  // operations management is a level more than a field: a title that also names a field ("Restaurant Operations Manager")
  // is in that field
  for (const f of FIELDS) { if (f.key === 'ops') continue; const e = lastEnd(f, t); if (e > bestEnd) { best = f.key; bestEnd = e; } }
  if (best) return best;
  if (lastEnd(BY_KEY.ops, t) >= 0) return 'ops';
  if (/\bcoordinator\b/i.test(t)) return 'front_office';
  const fam = detectRoleFamily(t, '').family;
  return FAMILY_TO_FIELD[fam] || null;
}
/** The field a résumé role is in: its title, else (a title the patterns cannot place) its duties. */
export function roleField(role) {
  const byTitle = titleField(role && role.title);
  if (byTitle) return byTitle;
  const header = String(role && role.header || '').split(/\s+[—–|]\s+|\s+-\s+|,\s+/)[0];
  const byHeader = titleField(header);
  if (byHeader) return byHeader;
  const fam = detectRoleFamily(String(role && role.title || ''), ((role && role.bullets) || []).join(' ')).family;
  return FAMILY_TO_FIELD[fam] || null;
}
// Words in a posting about the employer's products, buildings or equipment — never the job's field ("spacecraft",
// "maintenance parts", "HVAC equipment" in an inventory specialist's posting).
/** The posting's field, from its TITLE first: the job noun before any " - ", "," "(" or "|" (an "Inventory Specialist,
 *  Maintenance Parts" is inventory work, not maintenance), then the whole title, then the weight of its duty lines. */
export function postingField(jobTitle, jobText = '') {
  const title = String(jobTitle || '');
  // a parenthetical that names the work ("Patient Care Advocate (Customer Service)") is the field
  const paren = (title.match(/\(([^)]{4,40})\)/) || [])[1];
  if (paren && /\b(?:customer\s+(?:service|support)|sales|warehouse|retail|accounting|marketing|nursing|maintenance|software|IT)\b/i.test(paren)) { const pf = titleField(paren); if (pf) return pf; }
  const core = title.replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,|\|/)[0];
  const byCore = titleField(core);
  if (byCore) return byCore;
  const byTitle = titleField(title);
  if (byTitle) return byTitle;
  // the description's duty lines (three or more doing one field's work) — never the role-family guesser over the whole
  // description, which placed a bioconjugation scientist in "driving and delivery" (coordinator G2 item 2): a posting
  // that cannot be placed is `known: false`, never a wrong known field
  return dutyField(jobText);
}
/** The field most of a posting's duty lines do (a third or more of its bullet-like lines, at least three). */
export function dutyField(jobText) {
  const lines = String(jobText || '').split(/\n|(?<=[.;])\s+(?=[A-Z])|\s+[•▪●]\s+/).map((l) => l.trim()).filter((l) => l.length > 15 && l.length < 300);
  if (lines.length < 3) return null;
  let best = null, bestN = 0;
  for (const [k, re] of Object.entries(DUTY)) {
    const n = lines.filter((l) => re.test(l)).length;
    if (n > bestN) { best = k; bestN = n; }
  }
  return bestN >= 3 ? best : null;
}
// Depth language: the posting asks for someone who has done this for a while, with or without a number.
const DEPTH_CUES = [
  /\b(?:strong|deep|extensive|proven|significant|substantial|advanced)\s+(?:[\w/-]+\s+){0,4}?(?:experience|expertise|background|knowledge|proficiency)\b/i,
  /\bsenior\s+(?:\w+\s+)?(?:engineer|developer|manager|level|role|position|analyst|designer|accountant|associate)\b|\bstaff\s+(?:software|engineer)|\bprincipal\s+(?:\w+\s+)?(?:engineer|developer|designer)\b/i,
  /\barchitect(?:ure|ing|ed)?\b/i,
  /\bownership\b|\bown\s+(?:the|features?|projects?|end-to-end|systems?|services?)\b|\bindependent(?:ly)?\b|\bautonom(?:y|ous)\b/i,
  /\bat\s+scale\b|\blarge[- ]scale\b|\bhigh[- ]scale\b/i,
  /\blead(?:ing)?\s+(?:engineers|projects|initiatives|a\s+team|teams|the\s+design)\b|\bmentor(?:ing|ship)?\b/i,
];
/** The posting's own depth phrases, as written ("strong production experience", "architecture", "at scale"). */
export function depthCues(jobTitle, jobText) {
  const t = `${jobTitle || ''}\n${String(jobText || '').slice(0, 8000)}`;
  return DEPTH_CUES.map((re) => (t.match(re) || [])[0]).filter(Boolean).map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim()).slice(0, 4);
}
/** How many kinds of depth language a posting uses (0–6); two or more = an implied senior level. */
export function postingDepth(jobTitle, jobText) {
  const t = `${jobTitle || ''}\n${String(jobText || '').slice(0, 8000)}`;
  return DEPTH_CUES.filter((re) => re.test(t)).length;
}
export function fieldLabel(key) { return (BY_KEY[key] && BY_KEY[key].label) || null; }
export function areAdjacent(a, b) {
  if (!a || !b) return false;
  return a === b || (BY_KEY[a] && BY_KEY[a].adj.includes(b)) || (BY_KEY[b] && BY_KEY[b].adj.includes(a));
}

// Words in a title that name neither the work nor the job (levels, schedules, places).
const TITLE_NOISE = new Set(['senior', 'sr', 'junior', 'jr', 'lead', 'staff', 'principal', 'chief', 'head', 'i', 'ii', 'iii', 'iv', 'part', 'time', 'full', 'remote', 'hybrid', 'onsite', 'contract', 'temporary', 'temp', 'seasonal', 'intern', 'internship', 'trainee', 'the', 'and', 'for', 'with', 'of', 'a', 'an', 'in', 'at', 'to', 'night', 'nights', 'day', 'days', 'shift', 'weekend', 'weekends', 'entry', 'level', 'mid', 'new', 'grad', 'st', 'nd', 'rd', 'th', '1st', '2nd', '3rd', 'basic', 'all', 'team']);
const stem = (w) => w.toLowerCase().replace(/(?:ing|ers|er|es|s)$/, '');
function titleWords(title) {
  // drop "(…)" and anything after " - " / "," / "|" that names a place or a team
  const core = String(title || '').replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,|\|/)[0];
  return [...new Set(core.toLowerCase().split(/[^a-z0-9&+#]+/).filter((w) => w.length > 1 && !TITLE_NOISE.has(w)).map(stem))];
}
/** 0..1: how much of the posting's title the person's closest job title already says ("done this job"). */
// A title made only of level / shift words ("Shift Lead", "Team Lead", "Crew Lead") is still a job: lead, supervisor and
// shift lead are one rung (G5 — "Shift Lead" × "Shift Supervisor" scored title 0)
const RUNG_SAME = [['lead', 'supervisor', 'supervis', 'charge', 'keyholder', 'key holder', 'foreman', 'crew chief'], ['manager', 'manag', 'head']];
function rungWords(title) {
  const core = String(title || '').replace(/\([^)]*\)/g, ' ').split(/\s+[-–—|]\s+|,|\|/)[0].toLowerCase();
  return core.split(/[^a-z]+/).filter(Boolean);
}
export function titleCloseness(jobTitle, roles, postingKey) {
  let want = titleWords(jobTitle);
  if (!want.length) {
    // only level / shift words: compare the rung and the field instead
    const jw = rungWords(jobTitle);
    const rung = RUNG_SAME.findIndex((g) => jw.some((w) => g.includes(w)));
    if (rung < 0) return 0;
    let best = 0;
    for (const r of roles || []) {
      const rw = rungWords(r.title || '');
      const same = RUNG_SAME[rung].some((w) => rw.includes(w) || rw.join(' ').includes(w));
      if (!same) continue;
      const shiftBoth = jw.includes('shift') === rw.includes('shift');
      const field = r.field && postingKey && (r.field === postingKey || areAdjacent(r.field, postingKey));
      best = Math.max(best, (field || !postingKey ? 0.85 : 0.6) + (shiftBoth ? 0.1 : 0));
    }
    return Math.round(Math.min(1, best) * 100) / 100;
  }
  let best = 0;
  for (const r of roles || []) {
    const have = new Set(titleWords(r.title || String(r.header || '').split(/\s+[—–|]\s+/)[0]));
    if (!have.size) continue;
    const shared = want.filter((w) => have.has(w)).length;
    let c = shared / want.length;
    const field = r.field;
    // an internship, a student or a trainee job is a taste of the job, not having done it
    const learner = /\b(?:intern|internship|student|trainee|apprentice|extern|volunteer)\b/i.test(r.title || '');
    // same field: at least a solid "done the adjacent job"; the head noun shared too = the same job
    if (field && postingKey && field === postingKey) c = Math.max(c, shared ? 0.75 : 0.6);
    else if (postingKey && roleDuties(r).includes(postingKey) && (!field || areAdjacent(field, postingKey))) c = Math.max(c, 0.6);
    else if (field && postingKey && areAdjacent(field, postingKey)) c = Math.max(c * 0.8, 0.3);
    else c *= 0.5;
    if (learner) c *= 0.6;
    best = Math.max(best, Math.min(1, c));
  }
  return Math.round(best * 100) / 100;
}

// ── Level (G2, B ii) ─────────────────────────────────────────────────────────────────────────────────────────
// One scale for a posting's title and a person's titles: 1 entry / junior · 2 a plain, working-level job · 3 senior, a
// team or shift lead, a supervisor · 4 a people manager, staff / principal / lead engineer · 5 director, head of ·
// 6 VP / chief. A title with no level word is null (a plain job title says nothing about level).
export function titleLevel(title) {
  const t = String(title || '').replace(/\([^)]*\)/g, ' ');
  if (!t.trim()) return null;
  if (/\bcrew\s+chief\b/i.test(t)) return 3;
  if (/\b(?:vp|svp|evp|vice\s+president|chief\s+(?:\w+\s+)?officer|chief\s+of|c[etfoi]o)\b/i.test(t)) return 6;
  if (/\b(?:director|head\s+of)\b/i.test(t) && !/\bassistant\s+director\b/i.test(t)) return 5;
  if (/\b(?:staff|principal)\s+(?:\w+\s+){0,2}(?:engineer|developer|designer|scientist|architect|analyst|product)\b|\b(?:lead|principal)\s+(?:\w+\s+){0,2}(?:engineer|developer|designer|scientist|architect)\b/i.test(t)) return 4;
  if (/\b(?:manager|superintendent)\b/i.test(t) && !NOT_PEOPLE_MANAGER_TITLE_RE.test(t) && !/\bassistant\s+(?:\w+\s+)?manager\b|\bmanager\s+(?:trainee|in\s+training)\b/i.test(t)) return 4;
  if (/\b(?:senior|sr\.?|iii|iv)\b|\b(?:team|shift|crew)\s+lead\b|\bsupervisor\b|\bassistant\s+(?:\w+\s+)?manager\b|\bcharge\s+nurse\b|\bkey\s*holder\b|\bperson\s+in\s+charge\b|\blead\b/i.test(t)) return 3;
  if (/\b(?:junior|jr\.?|entry[- ]level|intern|internship|trainee|apprentice|new\s+grad\w*|graduate|i)\b/i.test(t) && !/\b(?:senior|sr)\b/i.test(t)) return 1;
  if (/\bii\b/i.test(t)) return 2;
  return null;
}
// A person's level in the posting's field: their most senior titled role there, and the years they have done it.
function personLevel(roles, fieldYears) {
  const byYears = fieldYears < 1.5 ? 1 : fieldYears < 4.5 ? 2 : 3;
  const titled = roles.map((r) => titleLevel(r.title)).filter((x) => x != null);
  if (!titled.length) return byYears;
  const best = Math.max(...titled);
  // a junior / intern title counts as written; a senior title earns the level only with some years behind it
  return best <= 1 ? Math.min(byYears, 1.5) : Math.max(best === 3 && fieldYears < 2 ? 2 : best, byYears);
}
// Fields whose depth language ("strong experience", "architecture", "ownership") implies a senior level when the title
// says none; an hourly posting's "work independently" says nothing about level.
const PROFESSIONAL = new Set(['software', 'data', 'science', 'engineering', 'accounting', 'marketing', 'product', 'design', 'legal', 'it', 'hr', 'sales', 'clinical']);
// ── Kind of job inside a field (G2, B iii) ────────────────────────────────────────────────────────────────────
// Same field, different job: a bedside ICU nurse and a care navigator, an account executive and sales operations, a
// backend and a frontend engineer. `duty` is what a résumé line must show for the person to have done that kind.
const KINDS = {
  nursing: [
    { key: 'coordination', label: 'care-coordination', title: /\b(?:navigator|case\s+manag\w*|care\s+(?:coordinat\w*|manag\w*|transition\w*)|utilization|discharge|triage|transition\w*\s+of\s+care|population\s+health)\b/i, duty: /\b(?:referrals?|discharge\s+plan\w*|utilization\s+review|case\s+manag\w*|care\s+coordinat\w*|prior\s+auth\w*|authorizations?|navigat\w*)\b/i },
    { key: 'home', label: 'home-health', title: /\b(?:home\s+health|hospice|home\s+care|private\s+duty|visit\s+nurse|in-home)\b/i, duty: /\b(?:home\s+visits?|in\s+the\s+home|caseload|hospice)\b/i },
    { key: 'education', label: 'nurse-education', title: /\bnurse\s+educator|clinical\s+educator\b/i, duty: /\b(?:taught|curriculum|competenc\w*\s+(?:training|validation)|orientation\s+program)\b/i },
    { key: 'bedside', label: 'bedside', title: /\b(?:icu|critical\s+care|med[\s/-]*surg\w*|telemetry|emergency|\bER\b|step[\s-]?down|pacu|labor|l&d|nicu|picu|oncology|inpatient|acute|charge\s+nurse|perioperative|operating\s+room|float)\b/i, duty: /\b(?:patients?\s+per\s+shift|per\s+shift|bedside|drips?|titrat\w*|unit\b|codes?\b|rapid\s+response)\b/i },
  ],
  sales: [
    { key: 'ops', label: 'sales-operations', title: /\b(?:sales\s+(?:operations|ops|enablement|analyst|strategy)|rev(?:enue)?\s*ops|revenue\s+operations|deal\s+desk|sales\s+performance\s+management)\b/i, duty: /\b(?:salesforce\s+admin\w*|territory\s+(?:design|planning)|commission\w*|forecast\w*\s+model\w*|dashboards?|enablement\s+program|cpq)\b/i },
    { key: 'closing', label: 'selling', title: /\b(?:account\s+executive|\bAE\b|sales\s+(?:representative|rep|consultant|associate)|business\s+development|territory|inside\s+sales|\bSDR\b|\bBDR\b|development\s+representative|account\s+manager)\b/i, duty: /\b(?:quota|closed|pipeline|prospect\w*|deals?)\b/i },
  ],
  software: [
    { key: 'frontend', label: 'frontend', title: /\b(?:front[\s-]?end|ui\s+engineer|web\s+developer|react)\b/i, duty: /\b(?:react|vue|angular|css|frontend|front-end|ui\s+components?|typescript\s+components?|browser)\b/i },
    { key: 'mobile', label: 'mobile', title: /\b(?:ios|android|mobile)\b/i, duty: /\b(?:swift|kotlin|ios|android|react\s+native|mobile\s+app)\b/i },
    { key: 'backend', label: 'backend', title: /\b(?:back[\s-]?end|platform|infrastructure|distributed|api|data\s+engineer|site\s+reliability|SRE|devops)\b/i, duty: /\b(?:apis?|microservices?|postgres\w*|kafka|distributed|backend|back-end|services?\s+in\s+go|kubernetes)\b/i },
  ],
};
function kindOf(field, title) { return ((KINDS[field] || []).find((k) => k.title.test(String(title || ''))) || null); }
/** Does a different KIND of job inside the same field separate the person from this posting? Null when not. */
export function jobKindGap(field, jobTitle, sameRoles) {
  const want = kindOf(field, jobTitle);
  if (!want || !sameRoles.length) return null;
  const have = sameRoles.map((r) => kindOf(field, r.title) || (KINDS[field] || []).find((k) => (r.bullets || []).filter((b) => k.duty.test(b)).length >= 2) || null).filter(Boolean);
  if (!have.length || have.some((k) => k.key === want.key)) return null;
  // the résumé shows the posting kind's core work on at least two lines: the person has done it
  const lines = sameRoles.flatMap((r) => r.bullets || []);
  if (lines.filter((b) => want.duty.test(b)).length >= 2) return null;
  return { posting: want.label, resume: have[0].label, postingKey: want.key, resumeKey: have[0].key };
}

// an acronym is read letter by letter: "an HR role", "an RN", "an MRI tech"
const article = (w) => { const x = String(w || ''); if (/^[A-Z]{2,}\b/.test(x)) return /^[AEFHILMNORSX]/.test(x) ? 'an' : 'a'; return /^[aeiou]/i.test(x) && !/^(?:uni|eu|one)/i.test(x) ? 'an' : 'a'; };
const cleanTitle = (t) => String(t || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
function joinWords(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * @param {{ resumeText: string, jobTitle?: string, jobText?: string, matches?: object[], now?: Date, profile?: object }} input
 */
export function fieldMatch({ resumeText = '', jobTitle = '', jobText = '', matches = [], now = new Date(), profile = null } = {}) {
  const prof = profile || experienceProfile(resumeText, { now, fieldOf: roleField });
  const roles = prof.roles.map((r) => ({ ...r, field: r.field || roleField(r) }));
  const pKey = postingField(jobTitle, jobText);
  const placed = roles.filter((r) => r.field);
  // the person's main field: the one with the most dated months (ties → the latest role)
  const monthsBy = {};
  for (const r of placed) monthsBy[r.field] = (monthsBy[r.field] || 0) + (r.months || 1);
  const rKey = Object.keys(monthsBy).sort((a, b) => monthsBy[b] - monthsBy[a])[0] || null;
  // roles with a title first (a dated line with no title — "did DoorDash deliveries 2020 - 2021" — counts, but is never named)
  const titledFirst = (rs) => [...rs.filter((r) => r.title), ...rs.filter((r) => !r.title)];
  // in the field by title, or (a title next to it, or one the patterns cannot place) by what its bullets do
  const byDuty = (r) => !!pKey && (!r.field || areAdjacent(r.field, pKey)) && roleDuties(r).includes(pKey);
  const sameRoles = titledFirst(roles.filter((r) => pKey && (r.field === pKey || byDuty(r))));
  const adjRoles = titledFirst(placed.filter((r) => pKey && r.field !== pKey && !byDuty(r) && areAdjacent(r.field, pKey)));
  const eduLines = resumeLineInfo(resumeText).filter((l) => l.section === 'education' || l.kind === 'education').map((l) => l.text).join(' ');
  const eduInField = !!(pKey && BY_KEY[pKey] && BY_KEY[pKey].edu && BY_KEY[pKey].edu.test(eduLines));
  // share of the posting's required, non-soft requirements a résumé line shows: a résumé that shows 40% of them is never
  // in a "different" field, whatever its titles say (coordinator round 2, A ii)
  const req = (matches || []).filter((m) => m.importance === 'required' && !m.soft);
  const shownShare = req.length ? req.filter((m) => m.matched && !m.inferred).length / req.length : 0;
  // the same field, but a different kind of job in it (bedside ICU → care navigator): next to it, not the same (B iii)
  const kindGap = pKey ? jobKindGap(pKey, jobTitle, sameRoles) : null;
  let level;
  if (!pKey) level = 'adjacent';
  else if (sameRoles.length && kindGap) level = 'adjacent';
  else if (sameRoles.length) level = 'same';
  else if (adjRoles.length || eduInField || !placed.length) level = 'adjacent';
  else level = shownShare >= 0.4 && req.length >= 3 ? 'adjacent' : 'different';
  const titleMatch = Math.round(titleCloseness(jobTitle, roles, pKey) * (kindGap ? 0.7 : 1) * 100) / 100;
  // years in the posting's field (each month once), learner roles at half weight
  const merged = (rs) => { const sp = rs.filter((r) => r.from != null && r.to != null && r.to >= r.from).map((r) => [r.from, r.to]).sort((a, b) => a[0] - b[0]); let m = 0, cs = null, ce = null; for (const [a, b] of sp) { if (ce == null || a > ce + 1) { if (ce != null) m += ce - cs + 1; cs = a; ce = b; } else ce = Math.max(ce, b); } if (ce != null) m += ce - cs + 1; return m; };
  const isLearner = (r) => /\b(?:intern|internship|student|trainee|extern|volunteer)\b/i.test(r.title || '');
  const fieldYears = Math.round(((merged(sameRoles.filter((r) => !isLearner(r))) + merged(sameRoles.filter(isLearner)) * 0.5) / 12) * 10) / 10;
  // what carries over, as the résumé wrote it: the requirements a résumé line proves (posting words), hard skills first
  const shown = (matches || []).filter((m) => m.matched && !m.inferred && m.evidence);
  const transferable = [...new Set([...shown.filter((m) => !m.soft), ...shown.filter((m) => m.soft)].map((m) => String(m.surface || m.requirement || '').trim()).filter((s) => s && !/^one of\b/i.test(s)))].slice(0, 4);
  // the posting's level (its title, else — in a professional field — depth language in two or more wordings) against the
  // person's (their most senior title in this field, and their years in it)
  const depthN = postingDepth(jobTitle, jobText);
  const tLevel = titleLevel(String(jobTitle || '').split(/\s+[-–—|]\s+/)[0]) ?? titleLevel(jobTitle);
  const pLevel = tLevel ?? (PROFESSIONAL.has(pKey) && depthN >= 2 ? 3 : null);
  const inFieldRoles = sameRoles.length ? sameRoles : adjRoles;
  // the person's level: their most senior title in the field OR next to it (a Shift Supervisor in a coffee shop is a
  // supervisor for a retail keyholder posting), with their years in and next to the field
  const nearYears = Math.round(merged([...sameRoles, ...adjRoles]) / 12 * 10) / 10;
  const myLevel = inFieldRoles.length ? personLevel([...sameRoles, ...adjRoles], Math.max(fieldYears, nearYears)) : null;
  const levelGap = pLevel != null && myLevel != null && pLevel >= 2 ? Math.max(0, Math.round((pLevel - myLevel) * 2) / 2) : 0;
  // the role a sentence names: the one closest to the posting by level (and title), the current one on a tie (G5 — a
  // Shift Supervisor was named as "a Barista (2020–2022)" against a supervisor posting)
  const lvl = (r) => titleLevel(r.title) ?? 2;
  const nowM = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const current = (r) => r.to != null && r.to >= nowM - 1;
  // the CURRENT job wins ties, and wins whenever it is in the posting's field (G5: a current dietary aide was described by
  // an old Crew Member job)
  const near = (r) => (pLevel != null ? -Math.abs(lvl(r) - pLevel) : 0) + 0.5 * titleCloseness(jobTitle, [r], pKey) + (current(r) && r.field === pKey ? 2 : current(r) ? 0.1 : 0);
  const byFit = (rs) => rs.map((r, i) => ({ r, i, k: near(r) })).sort((a, b) => (b.k - a.k) || ((b.r.to ?? 0) - (a.r.to ?? 0)) || (a.i - b.i)).map((x) => x.r);
  sameRoles.splice(0, sameRoles.length, ...titledFirst(byFit(sameRoles)));
  adjRoles.splice(0, adjRoles.length, ...titledFirst(byFit(adjRoles)));
  // across same-field and next-field roles: a lower-level same-field role (Cashier) is not named over a role at the
  // posting's level next to it (Shift Supervisor) when the posting states a level
  const leadPick = pLevel != null ? byFit([...sameRoles, ...adjRoles].filter((r) => r.title))[0] : sameRoles.find((r) => r.title) || adjRoles.find((r) => r.title);
  const leadRole = leadPick ? { title: leadPick.title, span: leadPick.span, same: sameRoles.includes(leadPick) } : null;
  const pLabel = fieldLabel(pKey);
  const rLabel = fieldLabel(rKey);
  let sentence;
  if (level === 'different') {
    sentence = `This is ${article(BY_KEY[pKey].role)} ${BY_KEY[pKey].role} role; your experience is in ${rLabel}.${transferable.length ? ` What carries over: ${joinWords(transferable)}.` : ' Little on your résumé lines up with it yet, so treat it as a career change.'}`;
  } else if (level === 'adjacent' && kindGap && sameRoles.length) {
    const r = sameRoles[0];
    sentence = `This is ${article(kindGap.posting)} ${kindGap.posting} ${BY_KEY[pKey].role} role; your ${BY_KEY[pKey].label} experience is ${kindGap.resume} work${r.title ? ` (${cleanTitle(r.title)}${r.span ? `, ${r.span}` : ''})` : ''}, a different kind of job in the same field.${transferable.length ? ` What carries over: ${joinWords(transferable)}.` : ''}`;
  } else if (level === 'adjacent' && pKey && rKey && adjRoles.length) {
    const r = adjRoles[0];
    sentence = `This is ${article(BY_KEY[pKey].role)} ${BY_KEY[pKey].role} role; your closest experience is ${r.title ? `as ${article(r.title)} ${cleanTitle(r.title)}` : `in ${fieldLabel(r.field)}`}${r.span ? ` (${r.span})` : ''}, which sits next to it.${transferable.length ? ` What carries over: ${joinWords(transferable)}.` : ''}`;
  } else if (level === 'adjacent' && eduInField && pKey) {
    sentence = `This is ${article(BY_KEY[pKey].role)} ${BY_KEY[pKey].role} role; your schooling is in the field, but none of your jobs are yet.`;
  } else if (level === 'same' && sameRoles.length) {
    const r = sameRoles[0];
    sentence = `This is ${article(BY_KEY[pKey].role)} ${BY_KEY[pKey].role} role, and you have done this work${r.title ? ` as ${article(r.title)} ${cleanTitle(r.title)}${r.span ? ` (${r.span})` : ''}` : ' before'}.`;
  } else {
    sentence = pLabel ? `This is ${article(BY_KEY[pKey].role)} ${BY_KEY[pKey].role} role; your job titles do not say clearly whether you have done it.` : 'Seen could not place this posting in a field, so it is judged on its requirements alone.';
  }
  return {
    level,
    known: !!pKey,
    resumeField: rLabel,
    postingField: pLabel,
    resumeFieldKey: rKey,
    postingFieldKey: pKey,
    // how the posting's kind of job reads after "a" / "an": "an electrical role", "a software engineering role"
    postingRole: pKey ? `${article(BY_KEY[pKey].role)} ${BY_KEY[pKey].role} role` : null,
    sameRoles: sameRoles.map((r) => ({ title: r.title, span: r.span })),
    adjacentRoles: (kindGap ? sameRoles : adjRoles).map((r) => ({ title: r.title, span: r.span })),
    kindGap,
    leadRole,
    postingLevel: pLevel,
    personLevel: myLevel,
    levelGap,
    levelFrom: tLevel != null ? 'title' : pLevel != null ? 'depth' : null,
    titleMatch,
    fieldYears,
    shownShare: Math.round(shownShare * 100) / 100,
    // depth language in the posting (0–6 kinds); with < 2 years in the field a person cannot exceed the stretch band
    postingDepth: depthN,
    depthCues: depthCues(jobTitle, jobText),
    // the years that matter, said with the total: "1 year in software engineering; 6.9 years of work in all"
    yearsDisplay: pKey ? `${fieldYears >= 1 ? `${fieldYears} year${fieldYears === 1 ? '' : 's'}` : fieldYears > 0 ? 'under a year' : 'no time'} in ${BY_KEY[pKey].label}; ${prof.totalYears} years of work in all` : null,
    transferable,
    sentence,
  };
}
