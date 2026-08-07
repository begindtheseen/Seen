// Resume Intelligence Engine — LOCAL SEMANTIC LAYER (Phase 8).
//
// Recognizes that "supervised and trained 12 associates" is evidence of TEAM LEADERSHIP and that
// "tracked prospects from initial contact through closed sale" is evidence of SALES PIPELINE — with
// NO paid AI and NO neural model. It is a curated INDICATOR LEXICON (verbs/nouns/phrases that are
// evidence a person actually did a thing) plus token-overlap similarity. Research verdict: for
// short skill-phrase ↔ evidence-sentence matching this deterministic layer handles the cases a
// neural model would, at 0 KB / 0 cold-start, and is fully explainable ("matched on: supervised,
// trained"). A neural backend (Supabase Edge `gte-small` or browser Transformers.js — NEVER an
// onnxruntime-node bundle on a Vercel function, which blows the 250 MB limit) can register through
// setSemanticBackend() to add long-tail recall, without any caller changing.
//
// FABRICATION FIREWALL: indicators exist ONLY for skills / soft-skills / operational concepts.
// Credentials, licenses, and named tools have NO indicators — they can never be "inferred" from
// similar work, only proven by being named. The matcher enforces this. Pure + deterministic.

// concept id → indicator evidence. `verbs`/`nouns` are single tokens (stemmed-compared); `phrases`
// are multi-word cues; `strong` verbs count double. A concept fires when evidence contains a verb
// or phrase AND (for people/operational concepts) a relevant object noun.
export const INDICATORS = {
  team_leadership: {
    verbs: ['supervised', 'led', 'managed', 'oversaw', 'coached', 'mentored', 'trained', 'directed', 'coordinated', 'headed', 'ran', 'led'],
    strong: ['supervised', 'led', 'managed', 'oversaw', 'coached', 'mentored'],
    nouns: ['associates', 'staff', 'team', 'employees', 'crew', 'hires', 'reports', 'members', 'people', 'workers', 'volunteers', 'apprentices'],
    phrases: ['direct reports', 'team of', 'shift lead', 'team lead', 'led a team', 'managed a team'],
    needsNoun: true,
  },
  staff_supervision: {
    verbs: ['supervised', 'oversaw', 'managed', 'monitored', 'scheduled'], strong: ['supervised', 'oversaw'],
    nouns: ['associates', 'staff', 'team', 'employees', 'crew', 'shift'], phrases: ['shift supervision'], needsNoun: true,
  },
  employee_coaching: {
    verbs: ['coached', 'mentored', 'trained', 'developed', 'onboarded'], strong: ['coached', 'mentored'],
    nouns: ['associates', 'staff', 'employees', 'hires', 'team', 'reps'], phrases: ['new hires', 'new associates'], needsNoun: true,
  },
  training: {
    verbs: ['trained', 'onboarded', 'taught', 'instructed'], strong: ['trained', 'onboarded'],
    nouns: ['associates', 'staff', 'employees', 'hires', 'team', 'new'], phrases: ['new hires', 'onboarding'], needsNoun: false,
  },
  sales_pipeline: {
    verbs: ['tracked', 'managed', 'prospected', 'sourced', 'converted', 'closed', 'nurtured', 'qualified', 'followed'], strong: ['prospected', 'closed', 'converted'],
    nouns: ['prospects', 'leads', 'deals', 'opportunities', 'pipeline', 'quota', 'accounts'],
    phrases: ['initial contact', 'closed sale', 'through close', 'from lead to', 'sales funnel', 'follow up'], needsNoun: false,
  },
  prospecting: {
    verbs: ['prospected', 'sourced', 'generated', 'cold-called', 'called', 'reached'], strong: ['prospected', 'sourced'],
    nouns: ['leads', 'prospects', 'contacts'], phrases: ['cold call', 'cold outreach', 'lead generation'], needsNoun: false,
  },
  closing: {
    verbs: ['closed', 'won', 'signed', 'converted'], strong: ['closed', 'won'],
    nouns: ['deals', 'sales', 'contracts', 'accounts'], phrases: ['closed sale', 'closed deal'], needsNoun: false,
  },
  inventory_management: {
    verbs: ['tracked', 'counted', 'replenished', 'restocked', 'maintained', 'managed', 'monitored', 'stocked', 'organized'], strong: ['replenished', 'restocked', 'counted'],
    nouns: ['inventory', 'stock', 'shipments', 'sku', 'merchandise', 'supplies', 'products'],
    phrases: ['stock counts', 'stock levels', 'inventory levels', 'cycle count'], needsNoun: true,
  },
  receiving: {
    verbs: ['received', 'unloaded', 'processed', 'inspected', 'checked'], strong: ['received', 'unloaded'],
    nouns: ['shipments', 'deliveries', 'freight', 'goods', 'pallets', 'trucks'], phrases: ['incoming shipments', 'inbound'], needsNoun: true,
  },
  shipping: {
    verbs: ['shipped', 'loaded', 'processed', 'dispatched', 'fulfilled', 'staged'], strong: ['shipped', 'loaded', 'fulfilled'],
    nouns: ['orders', 'shipments', 'packages', 'freight', 'outbound'], phrases: ['outgoing orders', 'outbound shipments'], needsNoun: true,
  },
  order_picking: {
    verbs: ['picked', 'packed', 'pulled', 'selected', 'staged'], strong: ['picked', 'packed'],
    nouns: ['orders', 'items', 'units', 'products'], phrases: ['pick and pack'], needsNoun: true,
  },
  customer_service: {
    verbs: ['assisted', 'served', 'helped', 'resolved', 'handled', 'greeted', 'supported', 'answered'], strong: ['assisted', 'served', 'resolved'],
    nouns: ['customers', 'guests', 'clients', 'shoppers', 'patrons', 'callers', 'visitors'],
    phrases: ['customer questions', 'guest needs', 'customer complaints'], needsNoun: true,
  },
  de_escalation: {
    verbs: ['de-escalated', 'deescalated', 'calmed', 'resolved', 'defused', 'diffused', 'mediated'], strong: ['de-escalated', 'deescalated', 'defused'],
    nouns: ['confrontations', 'conflicts', 'disputes', 'situations', 'customers', 'guests'],
    phrases: ['difficult customer', 'difficult situation', 'irate customer', 'upset guest'], needsNoun: false,
  },
  surveillance: {
    verbs: ['monitored', 'watched', 'observed', 'surveilled', 'reviewed'], strong: ['monitored', 'surveilled'],
    nouns: ['cameras', 'cctv', 'floor', 'activity', 'footage'], phrases: ['security cameras', 'camera monitoring'], needsNoun: true,
  },
  incident_reporting: {
    verbs: ['documented', 'wrote', 'reported', 'logged', 'recorded'], strong: ['documented', 'reported'],
    nouns: ['incidents', 'reports', 'events'], phrases: ['incident reports', 'incident report'], needsNoun: true,
  },
  loss_prevention: {
    verbs: ['prevented', 'reduced', 'deterred', 'recovered', 'apprehended'], strong: ['prevented', 'apprehended', 'recovered'],
    nouns: ['theft', 'shrink', 'shortage', 'loss', 'shoplifting'], phrases: ['loss prevention', 'reduced shrink'], needsNoun: true,
  },
  cash_handling: {
    verbs: ['handled', 'balanced', 'reconciled', 'processed', 'counted'], strong: ['balanced', 'reconciled'],
    nouns: ['cash', 'register', 'drawer', 'transactions', 'payments'], phrases: ['cash drawer', 'cash register'], needsNoun: true,
  },
  point_of_sale: {
    verbs: ['operated', 'rang', 'processed', 'used'], strong: ['operated', 'rang'],
    nouns: ['register', 'pos', 'transactions', 'sales', 'checkout'], phrases: ['point of sale', 'cash register', 'rang up'], needsNoun: false,
  },
  documentation: {
    verbs: ['documented', 'recorded', 'logged', 'filed', 'maintained', 'entered'], strong: ['documented', 'recorded'],
    nouns: ['records', 'files', 'documents', 'data', 'reports', 'logs'], phrases: ['record keeping', 'data entry'], needsNoun: true,
  },
  scheduling: {
    verbs: ['scheduled', 'coordinated', 'booked', 'arranged', 'planned'], strong: ['scheduled', 'coordinated'],
    nouns: ['appointments', 'shifts', 'schedules', 'calendars', 'meetings'], phrases: ['shift scheduling', 'appointment setting'], needsNoun: true,
  },
  patient_intake: {
    verbs: ['processed', 'registered', 'intook', 'checked', 'documented'], strong: ['processed', 'registered'],
    nouns: ['patients', 'intake', 'forms', 'records'], phrases: ['patient intake', 'intake forms'], needsNoun: true,
  },
  route_planning: {
    verbs: ['planned', 'routed', 'navigated', 'optimized', 'mapped'], strong: ['planned', 'routed'],
    nouns: ['routes', 'deliveries', 'stops', 'trips'], phrases: ['route planning', 'daily routes'], needsNoun: true,
  },
  safety: {
    verbs: ['maintained', 'enforced', 'followed', 'ensured', 'complied'], strong: ['enforced', 'maintained'],
    nouns: ['safety', 'osha', 'protocols', 'standards', 'procedures', 'compliance'], phrases: ['safety standards', 'safety procedures', 'osha compliance'], needsNoun: true,
  },
  communication: {
    verbs: ['communicated', 'presented', 'wrote', 'liaised', 'corresponded', 'coordinated'], strong: ['presented', 'communicated'],
    nouns: ['stakeholders', 'teams', 'clients', 'customers', 'management', 'updates'], phrases: ['cross-functional', 'written and verbal'], needsNoun: false,
  },
};

// crude stem so "training"/"trained"/"trains" all match "train". Deterministic, no lib.
function stem(w) {
  return String(w || '').toLowerCase()
    .replace(/[^a-z-]/g, '')
    .replace(/(ing|ed|es|s)$/,'')
    .replace(/-$/,'');
}
function tokens(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
}

// Deterministic evidence check: does `text` demonstrate `conceptId`? Returns
// { score:0..1, matched:[tokens] }. score 0 = no evidence. A verb/phrase hit with (when required) a
// matching object noun → strong; a lone verb → weak. Only concepts with an INDICATORS entry can
// produce transferable evidence — everything else returns 0 (fabrication firewall).
export function evidenceForConcept(conceptId, text) {
  const ind = INDICATORS[conceptId];
  if (!ind) return { score: 0, matched: [] };
  const low = String(text || '').toLowerCase();
  const toks = tokens(low);
  const stems = new Set(toks.map(stem));
  const matched = [];

  let verbHit = 0, strongHit = false, nounHit = false, phraseHit = false;
  for (const v of ind.verbs) { if (stems.has(stem(v)) || low.includes(v)) { verbHit++; matched.push(v); if ((ind.strong || []).includes(v)) strongHit = true; } }
  for (const n of ind.nouns || []) { if (stems.has(stem(n)) || low.includes(n)) { nounHit = true; matched.push(n); } }
  for (const p of ind.phrases || []) { if (low.includes(p)) { phraseHit = true; matched.push(p); } }

  if (!verbHit && !phraseHit) return { score: 0, matched: [] };
  if (ind.needsNoun && !nounHit && !phraseHit) return { score: 0, matched: [] };

  // Score: base from verb strength, boosted by noun + phrase corroboration. Capped < exact.
  let score = 0.45;
  if (strongHit) score += 0.2;
  if (verbHit >= 2) score += 0.08;
  if (nounHit) score += 0.12;
  if (phraseHit) score += 0.15;
  return { score: Math.min(0.9, Number(score.toFixed(2))), matched: [...new Set(matched)] };
}

// ── Pluggable neural backend (optional recall upgrade) ───────────────────────
// Default: deterministic lexical similarity only. A backend fn(a,b)->Promise<number 0..1> can be
// registered to add embedding cosine on the long tail. Kept behind this interface so the core stays
// Vercel-safe and the neural path runs on Supabase Edge / the browser, never bundled server-side.
let _backend = null;
export function setSemanticBackend(fn) { _backend = typeof fn === 'function' ? fn : null; }
export function semanticBackendAvailable() { return !!_backend; }

// Lexical similarity between two short phrases: stemmed token Jaccard with a light length guard.
export function lexicalSimilarity(a, b) {
  const A = new Set(tokens(a).map(stem).filter((t) => t.length > 1));
  const B = new Set(tokens(b).map(stem).filter((t) => t.length > 1));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return Number((inter / (A.size + B.size - inter)).toFixed(3)); // Jaccard
}

// Similarity through the active backend if present, else lexical. Async so a neural backend fits.
export async function semanticSimilarity(a, b) {
  if (_backend) { try { const v = await _backend(a, b); if (typeof v === 'number') return v; } catch { /* fall through */ } }
  return lexicalSimilarity(a, b);
}
