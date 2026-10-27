// How a company interviews — Seen's hand-written knowledge base (owner decision 2026-10-26: no model API,
// so what Seen knows about an employer's process is written once, here, and shipped as data).
//
// Round 3 of the willingness-to-pay test: all four job seekers refused the $9.99 prep because it said nothing
// about the actual company ("what Amazon lead interviews really ask — Leadership Principles, STAR", "Stripe's
// real phone-screen format", "freight, closing, pay" for a Ross manager). Each guide in lib/server/guides/*.js
// carries, for one employer: how the interview usually runs (per track: hourly / corporate / tech), its named
// framework when it has one, the questions it is known for, tips, questions to ask them, and one thing
// applicants trip on. Every sentence is hedged ("usually", "many applicants report") and limited to what the
// company publishes or what is consistently reported in public; nothing is a guarantee, nothing names a pay
// figure, nothing assumes anything about the person.

import retail from './guides/retail.js';
import services from './guides/services.js';
import tech from './guides/tech.js';
import { prepFamily } from './interviewPrep.js';

const GUIDES = [...(retail.guides || []), ...(services.guides || []), ...(tech.guides || [])];

// "Ross Stores, Inc." / "The Home Depot" / "Amazon Fulfillment Center" → the name people type.
const LEGAL_RE = /[,.]?\s+(?:inc|llc|l\.l\.c|corp|corporation|co|company|ltd|plc|group|holdings|enterprises|international|usa|us|na|north america)\.?$/i;
const SITE_RE = /\s+(?:fulfillment(?:\s+center)?|distribution(?:\s+center)?|warehouse|dc|store|stores|supercenter|restaurant|restaurants|location|careers?|jobs|hiring|talent)$/i;
export function normalizeCompany(name) {
  let s = String(name || '').toLowerCase().replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^the\s+/, '');
  for (let i = 0; i < 3; i++) s = s.replace(LEGAL_RE, '').replace(SITE_RE, '').trim();
  return s;
}

// A name can belong to two guides ("Apple": the store guide and the corporate/engineering one); the role's
// track decides between them (findGuide with a role).
const INDEX = new Map();
for (const g of GUIDES) for (const n of g.names || []) { const k = normalizeCompany(n); INDEX.set(k, [...(INDEX.get(k) || []), g]); }
const pickFor = (list, role) => {
  if (!list || !list.length) return null;
  if (list.length === 1 || !role) return list[0];
  const aud = audienceFor(role);
  return list.find((g) => g.format && g.format[aud]) || list.find((g) => aud !== 'hourly' && !(g.format && g.format.hourly)) || list[0];
};

/** The guide for a company name as a job seeker types it (and, with a role, for that role's track), or null. */
export function findGuide(company, role = '') {
  const key = normalizeCompany(company);
  if (!key) return null;
  if (INDEX.has(key)) return pickFor(INDEX.get(key), role);
  // "Amazon Flex" / "Walmart Neighborhood Market": the known name followed by a sub-brand or site word —
  // never any other word ("Target Hospitality" is not Target)
  const TAIL = /^(?:flex|fresh|go|prime|air|logistics|delivery|web services|aws|cloud|retail|neighborhood market|market|express|online|digital|technology|technologies|health|pharmacy|optical|bakery|cafe|restaurants?|usa|america|dc|fc|warehouse|distribution(?: center)?|fulfillment(?: center)?|sort(?:ation)? center|delivery station|store|stores|supercenter|\d+)$/;
  for (const [n, list] of INDEX) if (n.length >= 4 && key.startsWith(`${n} `) && TAIL.test(key.slice(n.length + 1))) return pickFor(list, role);
  return null;
}

// Which of a guide's tracks a role reads.
const HOURLY = new Set(['retail', 'warehouse', 'delivery_logistics', 'food_service', 'hospitality', 'customer_service', 'security', 'valet_parking']);
const TECH = new Set(['software_engineering', 'data_analytics']);
export function audienceFor(role) {
  const fam = prepFamily(role);
  if (HOURLY.has(fam)) return 'hourly';
  if (TECH.has(fam)) return 'tech';
  if (fam === 'healthcare_support' || fam === 'skilled_trades' || fam === 'education') return 'all';
  return 'corporate';
}

/**
 * What the prep shows for this company and role: the track's format (or the default), the framework, the
 * questions for this audience, tips, questions to ask, and the watch-out. null when Seen has no guide.
 */
export function guideFor(company, role) {
  const g = findGuide(company, role);
  if (!g) return null;
  const aud = audienceFor(role);
  const fmt = g.format || {};
  // the track's text leads — except for someone interviewing for a lead or manager job on an hourly track, where
  // the general (behavioral) text comes first and the associate-hiring notes after
  const leadRole = /\b(?:lead|leader|supervisor|manager|foreman|captain|charge)\b/i.test(String(role || ''));
  const parts = aud !== 'all' && fmt[aud] ? (aud === 'hourly' && leadRole ? [fmt.default, fmt[aud]] : [fmt[aud], fmt.default]) : [fmt.default];
  const format = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const questions = (g.questions || []).filter((q) => !q.audience || q.audience === 'all' || aud === 'all' || q.audience === aud)
    .map((q) => ({ q: String(q.q || '').trim(), why: String(q.why || '').trim(), principle: q.principle || null }))
    // a question, or a prompt ("Tell me about a time…", "Design a system that…") that ends in a full stop
    .filter((q) => q.q.length >= 12 && /[?.]$/.test(q.q));
  return {
    company: g.names[0],
    confidence: g.confidence || 'medium',
    framework: g.framework && g.framework.name ? { name: g.framework.name, note: String(g.framework.note || '').trim() } : null,
    format,
    questions,
    tips: (g.tips || []).map((t) => String(t).trim()).filter(Boolean),
    ask_them: (g.ask_them || []).map((t) => String(t).trim()).filter(Boolean),
    watch: g.watch ? String(g.watch).trim() : '',
  };
}

/** Every company Seen has a guide for (the first name of each), for tests and the admin. */
export function guidedCompanies() {
  return GUIDES.map((g) => g.names[0]);
}
