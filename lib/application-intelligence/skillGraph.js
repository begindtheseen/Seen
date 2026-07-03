// Skill graph — canonicalization (aliases) + a relatedness graph (adjacency) that lets the
// transferability engine know that, e.g., "guest service" is the same as "customer service"
// and that "cash handling" is adjacent to "point of sale". Bundled data + pure functions,
// no AI, no fetch.

// alias surface (lowercased) → canonical skill label
export const SKILL_ALIASES = {
  'guest service': 'customer service', 'guest services': 'customer service', 'client service': 'customer service',
  'customer care': 'customer service', 'customer support': 'customer service', 'client relations': 'customer service',
  'pos': 'point of sale', 'point-of-sale': 'point of sale', 'register': 'point of sale', 'cash register': 'point of sale',
  'cash': 'cash handling', 'money handling': 'cash handling', 'cash drawer': 'cash handling',
  'stocking': 'inventory management', 'restocking': 'inventory management', 'inventory': 'inventory management',
  'stock control': 'inventory management',
  'route planning': 'route planning', 'routing': 'route planning', 'navigation': 'route planning',
  'crm': 'crm', 'customer relationship management': 'crm', 'salesforce': 'salesforce',
  'ms office': 'microsoft office', 'microsoft office suite': 'microsoft office', 'ms excel': 'excel',
  'data entry': 'data entry', 'documentation': 'documentation', 'record keeping': 'documentation',
  'records': 'documentation', 'filing': 'documentation',
  'intake': 'customer intake', 'patient intake': 'customer intake', 'client intake': 'customer intake',
  'scheduling': 'scheduling', 'calendar management': 'scheduling', 'appointment setting': 'scheduling',
  'de-escalation': 'conflict resolution', 'deescalation': 'conflict resolution', 'complaint resolution': 'conflict resolution',
  'teamwork': 'teamwork', 'collaboration': 'teamwork',
  'time management': 'time management', 'punctuality': 'reliability', 'dependability': 'reliability',
  'attendance': 'reliability',
  'shipping': 'shipping', 'receiving': 'receiving', 'picking': 'warehouse', 'packing': 'warehouse',
  'forklift': 'forklift', 'rf scanner': 'scan accuracy', 'scanning': 'scan accuracy',
  'food safety': 'food safety', 'sanitation': 'food safety', 'servsafe': 'food safety',
  'phone': 'phone communication', 'phone support': 'phone communication', 'telephone': 'phone communication',
  'ehr': 'documentation', 'emr': 'documentation', 'medical records': 'documentation',
  'javascript': 'javascript', 'js': 'javascript', 'typescript': 'typescript', 'ts': 'typescript',
  'react.js': 'react', 'reactjs': 'react', 'node': 'node.js', 'nodejs': 'node.js',
  'postgres': 'postgresql', 'sql': 'sql',
};

// Undirected relatedness: canonical → [{ to, weight }]. weight ~ how strongly doing/knowing
// the first is evidence toward the second (0.5–0.85 = transferable, not identical).
export const SKILL_RELATIONS = {
  'customer service': [['communication', 0.8], ['conflict resolution', 0.7], ['sales', 0.55], ['hospitality', 0.75], ['phone communication', 0.65]],
  hospitality: [['customer service', 0.85], ['communication', 0.7]],
  'point of sale': [['cash handling', 0.8], ['customer service', 0.6]],
  'cash handling': [['point of sale', 0.8], ['accuracy', 0.6], ['accounting', 0.5]],
  'inventory management': [['warehouse', 0.7], ['receiving', 0.65], ['accuracy', 0.55]],
  warehouse: [['inventory management', 0.7], ['shipping', 0.7], ['receiving', 0.7], ['safety', 0.6], ['scan accuracy', 0.7]],
  'route planning': [['logistics', 0.85], ['time management', 0.75]],
  logistics: [['route planning', 0.85], ['time management', 0.7], ['operations', 0.6]],
  'time management': [['reliability', 0.6], ['operations', 0.55]],
  'customer intake': [['data entry', 0.8], ['documentation', 0.75], ['scheduling', 0.6], ['customer service', 0.7]],
  'data entry': [['documentation', 0.75], ['accuracy', 0.7], ['customer intake', 0.7]],
  documentation: [['data entry', 0.75], ['compliance', 0.6], ['accuracy', 0.6]],
  scheduling: [['operations', 0.6], ['coordination', 0.7], ['customer intake', 0.55]],
  sales: [['customer service', 0.6], ['communication', 0.7], ['negotiation', 0.75], ['crm', 0.6]],
  communication: [['customer service', 0.7], ['teamwork', 0.6]],
  safety: [['warehouse', 0.55], ['compliance', 0.6]],
  operations: [['scheduling', 0.6], ['coordination', 0.7], ['process improvement', 0.7]],
  'food safety': [['compliance', 0.55]],
  accounting: [['bookkeeping', 0.85], ['data entry', 0.55], ['accuracy', 0.6]],
  sql: [['data analytics', 0.7], ['reporting', 0.6]],
  javascript: [['typescript', 0.8], ['software engineering', 0.7]],
  typescript: [['javascript', 0.8], ['software engineering', 0.7]],
  react: [['javascript', 0.7], ['software engineering', 0.7]],
};

// Canonicalize a raw skill surface → canonical label (lowercased, alias-resolved).
export function canonSkill(s) {
  const k = String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!k) return '';
  if (SKILL_ALIASES[k]) return SKILL_ALIASES[k];
  return k;
}

// Related canonical skills for a canonical skill, as a Map(to → weight).
export function relatedSkills(canon) {
  const out = new Map();
  for (const [to, w] of SKILL_RELATIONS[canon] || []) out.set(to, w);
  // reverse edges (undirected)
  for (const [from, rels] of Object.entries(SKILL_RELATIONS)) {
    for (const [to, w] of rels) if (to === canon) out.set(from, Math.max(out.get(from) || 0, w));
  }
  return out;
}

// Relationship between two canonical skills: 'exact' | 'adjacent' | 'transferable' | 'none'.
// 'adjacent' = directly related with high weight; 'transferable' = related with lower weight
// or two hops.
export function skillRelation(a, b) {
  const ca = canonSkill(a), cb = canonSkill(b);
  if (!ca || !cb) return { relation: 'none', weight: 0 };
  if (ca === cb) return { relation: 'exact', weight: 1 };
  const rel = relatedSkills(ca);
  if (rel.has(cb)) {
    const w = rel.get(cb);
    return { relation: w >= 0.72 ? 'adjacent' : 'transferable', weight: w };
  }
  // two-hop transferable
  for (const [mid, w1] of rel) {
    const rel2 = relatedSkills(mid);
    if (rel2.has(cb)) {
      const w = Math.min(w1, rel2.get(cb)) * 0.7;
      if (w >= 0.4) return { relation: 'transferable', weight: Number(w.toFixed(2)) };
    }
  }
  return { relation: 'none', weight: 0 };
}
