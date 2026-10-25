// The hourly / store-level vocabulary — DATA, grouped by family. The 2026-10-24 expert audits
// (a 15-year retail recruiter and an ATS engineer) found the optimizer's ~60-token taxonomy had
// no words for the work a cashier, sales associate, barista, front-desk or warehouse posting is
// made of: availability, lifting, blackout dates, shift minimums, clienteling, replenishment,
// shipment, cash drawer, register, scanning, loss prevention, food handler, forklift. Every entry
// here is a canonical skill with the surfaces (aliases) that mean it on EITHER side — a posting's
// "balanced cash drawer" and a résumé's "Cash handling" meet at `cash handling`; a résumé's
// "POS systems (Square, Clover)" and a posting's "register" meet at `point of sale`.
//
// Rules that live next to the data (consumed by extractJobFacts / extractResumeFacts):
//   • SOFT_SKILLS count as a posting requirement only when their sentence carries a requirement
//     cue (R8) — a core-values footer "Teamwork ● Results" is not a requirement.
//   • AMBIGUOUS_TOKENS (excel, lead, drive, go, rest) are skills only with a tool cue in the same
//     sentence ("Microsoft Excel", "Excel spreadsheets"); "how we grow and excel" is a verb.
//   • TITLE_WORDS are never "missing" — the posting's own title token (cashier, associate, crew)
//     is the job, not a skill the résumé lacks.
//   • Aliases are TRUE synonyms only. Related-but-distinct skills (cash handling ~ point of sale)
//     are weighted edges (RELATED) that give partial credit and never drive a wording rewrite.

import { PROFESSIONAL_VOCABULARY } from './professionalVocabulary.js';

export const HOURLY_VOCABULARY = {
  register: {
    label: 'Cash & register',
    skills: [
      { canonical: 'cash handling', aliases: ['cash drawer', 'cash drawers', 'balanced cash drawer', 'balanced drawer', 'balancing a drawer', 'balancing the drawer', 'balance a cash drawer', 'drawer accuracy', 'cash deposits', 'bank deposits', 'counting cash', 'money handling', 'handling cash', 'handle cash', 'cash management', 'cash control', 'cash transactions', 'cash and credit transactions'] },
      { canonical: 'point of sale', aliases: ['pos', 'pos system', 'pos systems', 'point-of-sale', 'point-of-sale system', 'point of sale system', 'register', 'registers', 'cash register', 'cash registers', 'ring up', 'ringing up', 'ring sales', 'checkout', 'check-out', 'self-checkout', 'self checkout', 'square pos', 'square register', 'clover pos', 'toast pos', 'aloha pos', 'ncr pos', 'micros pos', 'lightspeed pos', 'shopify pos', 'scanning items', 'scan items'] },
      { canonical: 'returns and refunds', aliases: ['refunds', 'voids', 'returns and exchanges', 'process returns', 'processing returns'] },
      { canonical: 'loss prevention', aliases: ['shrink', 'shrinkage', 'theft prevention', 'asset protection', 'loss-prevention'] }],
  },
  customer: {
    label: 'Customer-facing',
    skills: [
      { canonical: 'customer service', aliases: ['customer support', 'guest service', 'guest services', 'client service', 'client services', 'customer care', 'member service', 'member services', 'customer-facing', 'customer focus', 'serving customers', 'assisting customers', 'help customers', 'helping customers'] },
      { canonical: 'complaint resolution', aliases: ['resolving complaints', 'resolve complaints', 'resolved complaints', 'customer complaints', 'guest complaints', 'de-escalation', 'de-escalate', 'escalations', 'handling escalations', 'conflict resolution', 'difficult customers', 'problem resolution'] },
      { canonical: 'front desk', aliases: ['front-desk', 'reception', 'receptionist', 'check-in', 'check-ins', 'checking in guests', 'greeting guests', 'greet guests', 'greeting customers', 'greet customers', 'welcoming guests'] },
      { canonical: 'phone communication', aliases: ['answering phones', 'answer phones', 'multi-line phone', 'inbound calls', 'outbound calls', 'phone etiquette', 'phone calls', 'call handling'] },
      { canonical: 'bilingual spanish', aliases: ['spanish', 'english/spanish', 'english and spanish', 'spanish speaking', 'spanish-speaking', 'bilingual spanish', 'spanish bilingual'] },
      { canonical: 'product knowledge', aliases: ['product knowledge', 'product expertise', 'educate customers', 'educating customers', 'educating our customers', 'product recommendations', 'recommend products', 'advised customers', 'advising customers', 'advise customers'] }],
  },
  selling: {
    label: 'Upsell & clienteling',
    skills: [
      { canonical: 'upselling', aliases: ['upsell', 'upsells', 'up-sell', 'up-selling', 'add-on sales', 'add on sales', 'attach rate', 'suggestive selling', 'offer products', 'offering products', 'offer products and services', 'cross-selling', 'cross-sell', 'cross sell'] },
      { canonical: 'sales', aliases: ['selling', 'sales goals', 'sales targets', 'sales floor', 'sales quota', 'sales quotas', 'drive sales', 'driving sales', 'close sales', 'closing sales', 'retail sales'] },
      { canonical: 'loyalty programs', aliases: ['loyalty program', 'loyalty programs', 'loyalty sign-ups', 'loyalty signups', 'rewards program', 'rewards programs', 'credit card applications', 'credit applications', 'store credit card', 'membership sales', 'memberships', 'membership sign-ups'] },
      { canonical: 'clienteling', aliases: ['client book', 'clientele', 'client relationships', 'client relationship', 'repeat customers', 'repeat business', 'building relationships with customers', 'build relationships', 'customer relationships', 'client-centric', 'client centric'] },
      { canonical: 'conversion', aliases: ['conversion rate', 'conversion rates', 'units per transaction', 'average dollar sale', 'average ticket', 'average transaction'] }],
  },
  reliability: {
    label: 'Reliability',
    skills: [
      { canonical: 'attendance', aliases: ['perfect attendance', 'reliable attendance', 'punctual', 'punctuality', 'dependable', 'dependability', 'reliability', 'no-call no-show', 'show up on time'] },
      { canonical: 'opening and closing', aliases: ['opened and closed', 'open and close', 'opening/closing', 'opening and closing procedures', 'opening and closing checklist', 'opening checklist', 'closing checklist', 'close the store', 'closing the store', 'open the store', 'key holder', 'keyholder', 'key-holder', 'closing duties', 'opening duties'] },
      { canonical: 'safety record', aliases: ['zero accidents', 'zero incidents', 'zero damage', 'zero damage claims', 'accident-free', 'accident free', 'incident-free', 'no incidents', 'no accidents', 'clean safety record', 'safety record'] }],
  },
  stock: {
    label: 'Replenishment & shipment',
    skills: [
      { canonical: 'replenishment', aliases: ['replenish', 'replenishing', 'restock', 'restocking', 're-stock', 'stocking shelves', 'stock shelves', 'stocking', 'backstock', 'back stock', 'back-stock', 'floor replenishment'] },
      { canonical: 'shipment processing', aliases: ['shipment', 'shipments', 'process shipment', 'processing shipment', 'processing shipments', 'receiving shipments', 'truck unload', 'unloading trucks', 'unload trucks', 'freight', 'processing freight', 'unload freight'] },
      { canonical: 'merchandising', aliases: ['visual merchandising', 'planogram', 'planograms', 'promo resets', 'promotional resets', 'floor sets', 'floor set', 'product displays', 'merchandise displays'] },
      { canonical: 'inventory management', aliases: ['inventory', 'inventory control', 'inventory counts', 'stock management', 'stock counts', 'cycle counts', 'cycle counting', 'stock levels'] },
      { canonical: 'store standards', aliases: ['store appearance', 'neat and clean store', 'clean store', 'store cleanliness', 'store recovery', 'housekeeping standards', 'store environment'] }],
  },
  warehouse: {
    label: 'Warehouse',
    skills: [
      { canonical: 'order picking', aliases: ['picking', 'pick and pack', 'pick/pack', 'order fulfillment', 'order selection', 'order picker', 'picks per hour', 'pick rate', 'pick accuracy'] },
      { canonical: 'packing', aliases: ['pack orders', 'packing orders'] },
      { canonical: 'rf scanner', aliases: ['rf scanners', 'rf gun', 'handheld scanner', 'handheld scanners', 'scan gun', 'barcode scanner', 'barcode scanning'] },
      { canonical: 'pallet jack', aliases: ['pallet jacks', 'electric pallet jack', 'manual pallet jack', 'pallets', 'palletizing'] },
      { canonical: 'forklift', aliases: ['fork lift', 'forklift operation', 'forklift operator', 'reach truck', 'order picker lift', 'cherry picker'] },
      { canonical: 'loading and unloading', aliases: ['load and unload', 'loading trucks', 'unloading trucks', 'load trucks'] },
      { canonical: 'shipping', aliases: ['ship orders', 'shipping labels'] },
      { canonical: 'receiving', aliases: ['receive inventory', 'receiving inventory'] },
      { canonical: 'warehouse', aliases: ['fulfillment center', 'fulfilment center', 'distribution center', 'dashmart', 'local-fulfillment center'] }],
  },
  food: {
    label: 'Food & beverage',
    skills: [
      { canonical: 'food safety', aliases: ['food handling', 'sanitation', 'food-safety', 'allergen', 'allergens', 'health code', 'health inspection', 'temperature logs'] },
      { canonical: 'food preparation', aliases: ['food prep', 'cooking', 'line cook'] },
      { canonical: 'beverage preparation', aliases: ['espresso', 'espresso drinks', 'coffee drinks', 'drink preparation', 'making drinks', 'latte art', 'barista experience'] },
      { canonical: 'drive-thru', aliases: ['drive thru', 'drive-through', 'drive through'] },
      { canonical: 'speed of service', aliases: ['speed-of-service', 'ticket times', 'order accuracy', 'order times'] }],
  },
  compliance: {
    label: 'Compliance & accuracy',
    skills: [
      { canonical: 'compliance', aliases: ['regulatory compliance', 'regulations', 'federal, state, and local regulations', 'federal state and local regulations', 'policies and procedures', 'company policies and procedures', 'in compliance'] },
      { canonical: 'attention to detail', aliases: ['detail-oriented', 'detail oriented', 'accuracy'] },
      { canonical: 'multitasking', aliases: ['multi-task', 'multi-tasking', 'multitask', 'juggling', 'prioritization'] },
      { canonical: 'data entry', aliases: ['data-entry', 'entering data', '10-key'] }],
  },
};

// Generic soft skills: a requirement only in a sentence with a requirement cue (R8).
export const SOFT_SKILLS = new Set(['communication', 'teamwork', 'leadership', 'problem solving', 'time management', 'attendance', 'attention to detail', 'multitasking', 'reliability', 'adaptability', 'work ethic', 'positive attitude']);

// Tokens that are English verbs/nouns first and tools second: a skill only with a tool cue.
export const AMBIGUOUS_TOKENS = {
  excel: /\b(?:microsoft\s+excel|ms\s+excel|excel\s+(?:spreadsheets?|skills?|proficien\w*|formulas?|pivot|macros?|experience)|proficien\w*\s+(?:in|with)\s+(?:ms\s+)?excel|advanced\s+excel|intermediate\s+excel|basic\s+excel|excel\s*,\s*word|word\s*,\s*excel|excel\s+and\s+(?:word|powerpoint|outlook)|(?:word|powerpoint|outlook)\s+and\s+excel)\b/i,
  lead: /\b(?:lead\s+(?:generation|gen|qualification|lists?|tracking)|sales\s+leads?|qualified\s+leads?|inbound\s+leads?)\b/i,
  drive: /\b(?:valid\s+driver|driver'?s\s+licen[sc]e|drive\s+(?:a|the)\s+(?:truck|van|forklift|vehicle)|delivery\s+driv|driving\s+record)\b/i,
  // Go the language, never the verb: "Golang", "Go programming", "Go services", "in Go", "Go as your\n  // primary language", "Go, Java", "Go (Golang)". CASE-SENSITIVE on "Go" so "go above and beyond" never counts.
  go: /\b[Gg]olang\b|\bGo\s+(?:programming|language|developers?|engineers?|services?|microservices?|code(?:base)?|modules?|backend|as\s+(?:your|a|the|our|their|its)\b)|(?:\b(?:in|with|using|written\s+in|of|like)\s+|[,\/(]\s*)Go\b(?!\s+(?:to|out|above|beyond|through|ahead|back|live|over|for|the\s+extra)\b)|\bGo\s*(?:\(|,|\/)/,
  rest: /\b(?:rest(?:ful)?\s+apis?|rest\s+endpoints?|restful)\b/i,
  leadership: /\bleadership\b(?!\s+(?:team|support|group|development\s+program))/i,
  // "a positive outlook", "an epic journey", "community outreach", "Manhattan, KS" are English first
  'microsoft outlook': /\b(?:microsoft|ms)\s+outlook\b|\bOutlook\s*[,)]|[(,]\s*Outlook\b|\bOutlook\s+(?:calendars?|email|and)\b|\b(?:Excel|Word|Teams|Office)\s*(?:,|and)\s*Outlook\b/,
  epic: /\bEpic\b(?!\s+(?:games|journey|scale|proportions))/,
  // R the language: next to another analysis language or named as one ("Python or R for analysis")
  r: /\b(?:Python|SQL|SAS|Stata|MATLAB|Julia)\s*(?:,|\/|or|and)\s*R\b|\bR\s*(?:,|\/|or|and)\s*(?:Python|SQL|SAS|Stata|MATLAB)\b|\bR\s+(?:programming|language|for\s+(?:analysis|statistics|data))\b|\bRStudio\b/,
  outreach: /\bOutreach(?:\.io)?\s*(?:,|or|and|\/|\))|[(,]\s*Outreach\b/,
  'manhattan wms': /\bManhattan\b[^.]{0,40}\b(?:wms|blue\s+yonder|jda|or\s+similar)\b|warehouse\s+management[^.]{0,40}\bManhattan\b|\bManhattan\s+(?:wms|associates|scale)\b/i,
};
// "Store Leadership Team", "leadership support", "mentorship, coaching, and leadership support":
// the people you report to or a perk — never a requirement the résumé lacks.
export const LEADERSHIP_NOT_A_REQUIREMENT = /\b(?:store\s+leadership|leadership\s+(?:team|support|group|development)|senior\s+leadership|leadership\s+will)\b/i;

// The posting's own job words — never a skill the résumé is "missing".
export const TITLE_WORDS = new Set(['cashier', 'cashiers', 'associate', 'associates', 'sales associate', 'barista', 'baristas', 'crew', 'crew member', 'team member', 'team members', 'representative', 'representatives', 'specialist', 'specialists', 'clerk', 'clerks', 'attendant', 'attendants', 'stocker', 'stockers', 'picker', 'pickers', 'packer', 'packers', 'server', 'servers', 'host', 'hostess', 'greeter', 'teller', 'tellers', 'agent', 'agents', 'coordinator', 'assistant', 'driver', 'drivers', 'courier', 'guard', 'technician', 'warehouse associate', 'customer service representative', 'csr', 'member', 'members']);

// Related-but-distinct skills: partial credit, never a synonym.
export const RELATED = {
  'cash handling': [{ to: 'point of sale', weight: 0.7 }, { to: 'attention to detail', weight: 0.5 }],
  'point of sale': [{ to: 'cash handling', weight: 0.7 }, { to: 'customer service', weight: 0.4 }, { to: 'returns and refunds', weight: 0.6 }],
  'returns and refunds': [{ to: 'point of sale', weight: 0.6 }, { to: 'customer service', weight: 0.5 }],
  'complaint resolution': [{ to: 'customer service', weight: 0.7 }, { to: 'communication', weight: 0.6 }, { to: 'problem solving', weight: 0.7 }],
  'customer service': [{ to: 'complaint resolution', weight: 0.6 }, { to: 'communication', weight: 0.6 }, { to: 'front desk', weight: 0.5 }, { to: 'hospitality', weight: 0.6 }],
  'front desk': [{ to: 'customer service', weight: 0.7 }, { to: 'phone communication', weight: 0.6 }, { to: 'hospitality', weight: 0.6 }],
  upselling: [{ to: 'sales', weight: 0.8 }, { to: 'product knowledge', weight: 0.5 }, { to: 'conversion', weight: 0.6 }],
  sales: [{ to: 'upselling', weight: 0.7 }, { to: 'clienteling', weight: 0.6 }, { to: 'loyalty programs', weight: 0.6 }, { to: 'customer service', weight: 0.5 }],
  'loyalty programs': [{ to: 'sales', weight: 0.7 }, { to: 'upselling', weight: 0.6 }],
  clienteling: [{ to: 'sales', weight: 0.7 }, { to: 'customer service', weight: 0.6 }],
  replenishment: [{ to: 'shipment processing', weight: 0.7 }, { to: 'inventory management', weight: 0.7 }, { to: 'merchandising', weight: 0.6 }],
  'shipment processing': [{ to: 'replenishment', weight: 0.7 }, { to: 'receiving', weight: 0.8 }, { to: 'inventory management', weight: 0.5 }],
  merchandising: [{ to: 'replenishment', weight: 0.5 }, { to: 'inventory management', weight: 0.5 }],
  'inventory management': [{ to: 'replenishment', weight: 0.7 }, { to: 'order picking', weight: 0.4 }, { to: 'warehouse', weight: 0.6 }],
  'order picking': [{ to: 'warehouse', weight: 0.8 }, { to: 'packing', weight: 0.7 }, { to: 'rf scanner', weight: 0.6 }],
  warehouse: [{ to: 'order picking', weight: 0.6 }, { to: 'loading and unloading', weight: 0.6 }, { to: 'shipping', weight: 0.6 }, { to: 'receiving', weight: 0.6 }],
  'opening and closing': [{ to: 'cash handling', weight: 0.5 }, { to: 'attendance', weight: 0.5 }],
  'safety record': [{ to: 'attention to detail', weight: 0.5 }, { to: 'attendance', weight: 0.4 }],
  'bilingual spanish': [{ to: 'communication', weight: 0.5 }],
  multitasking: [{ to: 'time management', weight: 0.7 }],
  'attention to detail': [{ to: 'accuracy', weight: 0.8 }],
};

// Both vocabularies — hourly (above) and salaried (professionalVocabulary.js) — feed ONE list.
const ALL_FAMILIES = () => [...Object.values(HOURLY_VOCABULARY), ...Object.values(PROFESSIONAL_VOCABULARY)];
/** Flat list of every canonical skill in the vocabulary. */
export function vocabularySkills() {
  return ALL_FAMILIES().flatMap((f) => f.skills.map((s) => s.canonical));
}
/** alias → canonical map for every surface in the vocabulary (canonicals map to themselves). */
export function vocabularyAliases() {
  const out = {};
  for (const f of ALL_FAMILIES()) for (const s of f.skills) { out[s.canonical] = s.canonical; for (const a of s.aliases) out[a] = s.canonical; }
  return out;
}
