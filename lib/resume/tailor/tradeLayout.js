// TRADE LAYOUT — the paid build / Studio tailor for an oilfield entry job or a trade apprenticeship / helper job
// (2026-11-13; rules R10, R16, R26–R28, R31, R32, R37, R40 of the hiring-side research, scratchpad research/
// resume-hiring-side.md §6; the posting reading itself is lib/optimizer/tradeReading.js).
//
//   tradePlan({ jobTitle, jobText, base, variant, fit, now }) → null | { certsFirst, addCerts, notes }
//     PLAN DATA (the tailor's contract: the server and the browser apply the same plan — optimizer.applyPlan calls
//     applyTradeLayout(v, plan.trade)):
//       certsFirst — Licenses & Certifications go right under the header (R10: hirers read the license and tickets first);
//       addCerts   — credentials the PERSON said they hold, in answer to the posting's own question (a yes on "Do you hold a
//                    valid driver's license?", "Do you hold an H2S training card?"): the fixed label of what was asked,
//                    never a date, an issuer, an endorsement or "in progress" they did not give;
//       notes      — what the person should fix themselves (one page, a summary of facts, a drug-test / record line to take
//                    out, an OSHA card called a certification, year-only dates on a CDL résumé); never applied silently.
//   applyTradeLayout(v, trade) → v (mutated): the two document changes above, each with provenance.
import { tradeContext } from '../../optimizer/tradeReading.js';
import { serializeToText, normalizeDoc } from '../model.js';

const ADJECTIVE_RE = /\b(?:hard[- ]?work(?:ing|er)|motivated|eager|passionate|team\s+player|dependable|reliable|go-getter|self[- ]starter|quick\s+learner)\b/i;
const NEVER_RE = /\b(?:drug[- ]free|(?:can\s+)?pass(?:ed)?\s+(?:a\s+|any\s+)?drug\s+(?:tests?|screens?)|no\s+criminal|clean\s+background|criminal\s+record|date\s+of\s+birth|DOB\b|\bage\s*:\s*\d{2})/i;
const OSHA_CERT_RE = /\bOSHA[\s-]*(?:10|30)\b[^\n]{0,30}\bcertif\w*|\bcertif\w*[^\n]{0,15}\bOSHA[\s-]*(?:10|30)\b/i;
const UNIVERSAL_SKILLS = /^(?:shovels?|brooms?|hand\s+digging|safety\s+meetings?|hard\s+worker|team\s+player|punctual|dependable|reliable)$/i;
const MONTH_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}\b|\b\d{1,2}\/\d{4}\b/i;
const bare = (l) => String(l || '').replace(/^[•\-*]\s*/, '').trim();

function claimLabel(c) {
  const t = c.trade || {};
  if (t.licence === 'driver') return "Valid driver's license";
  if (t.licence === 'cdl') return String(c.label || 'CDL');
  if (t.ticket) return String(c.label || '').replace(/^\w/, (x) => x.toUpperCase());
  return null;
}

/** The trade plan for this posting and this résumé, or null when the posting is not oilfield / trade work. */
export function tradePlan({ jobTitle = '', jobText = '', base = null, variant = null, fit = null, now = new Date() } = {}) {
  const ctx = tradeContext(jobTitle, jobText);
  if (!ctx || !base) return null;
  base = normalizeDoc(base);
  variant = variant ? normalizeDoc(variant) : null;
  const cons = (fit && fit.constraints) || [];
  const have = new Set((base.certifications || []).map((c) => String(c.name || c.text || '').toLowerCase()));
  const addCerts = [];
  for (const c of cons) {
    // the person's own answer: a yes (by:'you') on a license / ticket the posting asks for
    if (!c.trade || c.by !== 'you' || c.status !== 'met' || c.trade.readiness || c.trade.obtainLater) continue;
    const name = claimLabel(c);
    if (!name || have.has(name.toLowerCase()) || addCerts.some((x) => x.name === name)) continue;
    addCerts.push({ name, why: c.claimed ? 'You said you hold it.' : 'You said yes.' });
  }
  const notes = [];
  const doc = variant || base;
  const text = serializeToText(doc);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // R26: one page (the renderer's 1-page budget is 46 lines)
  if (lines.length > 46) notes.push({ rule: 'one_page', text: 'Keep it to one page: hiring managers for these jobs decide in seconds. Cut the bottom line of each older job first — never your licenses or tickets.' });
  // R28: a summary of facts, two lines at most
  const summary = String((doc.basics && doc.basics.summary) || '');
  if (summary && (summary.split(/(?<=[.!?])\s+/).filter(Boolean).length > 2 || ADJECTIVE_RE.test(summary))) notes.push({ rule: 'summary', text: 'Keep the summary to one or two lines of facts — your license, tickets, years of physical work, when you can start — or leave it out. Words like "hard working" or "motivated" read as filler unless a job line proves them.' });
  // R31 / R32: never a test, a record or an age on a résumé
  for (const l of String(serializeToText(base)).split('\n')) if (NEVER_RE.test(l)) notes.push({ rule: 'never_on_resume', text: `Take out "${bare(l)}" — drug tests, records and age never go on a résumé.` });
  // R9: an OSHA card is not a certification
  for (const l of String(serializeToText(base)).split('\n')) if (OSHA_CERT_RE.test(l)) { notes.push({ rule: 'osha_card', text: `OSHA 10 / 30 is a card, not a certification — write it as "OSHA 10-Hour Construction card" (or General Industry): "${bare(l)}".` }); break; }
  // R27: universal skills the posting does not name
  const universal = (base.skills || []).flatMap((g) => g.items || []).filter((x) => UNIVERSAL_SKILLS.test(String(x).trim()) && !new RegExp(`\\b${String(x).trim().replace(/s$/i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(jobText));
  if (universal.length) notes.push({ rule: 'universal_skills', text: `Drop ${universal.map((x) => `"${x}"`).join(', ')} from your skills — everyone can, and the posting does not ask.` });
  // R40: English alone is never a language line
  const langs = (base.languages || []).map((l) => String(l.name || l.language || l.text || l).toLowerCase());
  if (langs.length && langs.every((l) => /^english\b/.test(l))) notes.push({ rule: 'languages', text: 'Leave out a languages line that says only English — your résumé already shows it.' });
  // R37: a CDL job — every employer of the last 3 years with month / year dates
  const cdlJob = ctx.driving || cons.some((c) => c.trade && c.trade.licence === 'cdl' && c.importance === 'required');
  if (cdlJob) {
    const nowY = now.getUTCFullYear();
    const recent = (base.experience || []).filter((e) => { const end = String(e.end || e.dateText || ''); const y = Number((end.match(/\d{4}/) || [])[0]) || (/present|current|now/i.test(end) || !end ? nowY : 0); return y >= nowY - 3; });
    const yearOnly = recent.filter((e) => !MONTH_RE.test(`${e.start || ''} ${e.end || ''} ${e.dateText || ''}`) && !/^\d{4}-\d{2}/.test(String(e.start || '')));
    const dropped = variant ? recent.filter((e) => !(variant.experience || []).some((x) => x.id === e.id)) : [];
    if (yearOnly.length) notes.push({ rule: 'cdl_dates', text: `Your DOT driver application must list every employer of the last 3 years with dates and reasons for leaving. Give month and year for ${yearOnly.map((e) => e.title || e.company).filter(Boolean).join(', ')} so your résumé matches it.` });
    if (dropped.length) notes.push({ rule: 'cdl_recent', text: `For a CDL job, keep every job of the last 3 years on your résumé — put back ${dropped.map((e) => e.title || e.company).filter(Boolean).join(', ')}.` });
  }
  const certsFirst = (base.certifications || []).length > 0 || addCerts.length > 0;
  if (!certsFirst && !addCerts.length && !notes.length) return null;
  return { certsFirst, addCerts, notes };
}

/** Apply the trade plan to a variant (the tailor and optimizer.applyPlan both call this; plan data only). */
export function applyTradeLayout(v, trade) {
  if (!v || !trade) return v;
  v.meta = v.meta || {};
  v.meta.provenance = v.meta.provenance || [];
  const have = new Set((v.certifications || []).map((c) => String(c.name || c.text || '').toLowerCase()));
  for (const a of trade.addCerts || []) {
    if (!a || !a.name || have.has(String(a.name).toLowerCase())) continue;
    v.certifications = [...(v.certifications || []), { id: `c_trade_${(v.certifications || []).length}`, name: a.name, issuer: '', date: '', text: a.name }];
    have.add(String(a.name).toLowerCase());
    v.meta.provenance.push({ kind: 'claimed_credential', name: a.name, reason: `${a.why || 'You said you hold it.'} Added with the posting's own name for it — no date or issuer you did not give.` });
  }
  if (trade.certsFirst && (v.certifications || []).length) {
    const order = Array.isArray(v.sectionOrder) && v.sectionOrder.length ? v.sectionOrder.filter((k) => k !== 'certifications') : ['summary', 'experience', 'education', 'skills', 'projects', 'languages'].filter((k) => k !== 'summary' || (v.basics && v.basics.summary));
    const at = order[0] === 'summary' ? 1 : 0;
    order.splice(at, 0, 'certifications');
    v.sectionOrder = order;
    v.meta.sectionTitles = { ...(v.meta.sectionTitles || {}), certifications: 'Licenses & Certifications' };
    v.meta.provenance.push({ kind: 'reorder_sections', section: 'certifications', reason: 'Licenses and tickets first — oilfield and trade hirers look for them before anything else.' });
  }
  return v;
}
