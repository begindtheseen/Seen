// Wording proposals that are real (director's decision C, ADDENDUM rule 2). Each is a before → after on ONE
// bullet, tied to the posting requirement it serves, with a default (applied / needs your OK):
//
//  (i)  posting form — the bullet already proves requirement R in other word forms; the line is re-phrased
//       so R reads the way the posting writes it. Every content word of the result is the bullet's own, the
//       posting's label for R (whose stems the bullet already carries), or one verb from a closed neutral
//       list. Pattern: "<Verb> <object> …" where R = "[object words] <noun of Verb>":
//         "Managed complex calendar and travel for CFO and 2 VPs" + "calendar management"
//            → "Handled complex calendar management and travel for CFO and 2 VPs"
//         "Scheduled patients and handled insurance verification" + "patient scheduling"
//            → "Performed patient scheduling and handled insurance verification"
//       Never a new object, tool, number or credential ("idempotent webhook" for a bullet that never says
//       webhook is NOT allowed — optimize.md U1's own example fails this rule).
//  (ii) weak-lead polish — the person's own stems + the closed neutral list:
//         "Responsible for month-end close for 3 entities" → "Handle month-end close for 3 entities"
//         "Charge nurse 1-2 shifts per month" → "Serve as charge nurse 1-2 shifts per month"
//         "Use Epic for charting" → "Chart in Epic"
//       and the rewrite engine's weak-lead / hidden-verb fixes ("Responsible for managing the front desk" →
//       "Managed the front desk"). A noun-led bullet is never re-tensed ("Wound care" stays "Wound care").
//  The rewrite engine's other changes (tense, fillers, passive) stay proposals that need the person's OK.
import { pastTense, baseFromPast, matchCase } from '../rewrite/inflect.js';
import { rewriteBullet, passesFirewall } from '../rewrite/rules.js';
import { KNOWN_VERBS } from '../health/verbs.js';
import { completedResult } from './optimizer.js';
import { contentStems, isGapNote } from './verdict.js';
import { rewriteKeepsMeaning } from '../health/meaningGuard.js';

// the closed list of neutral verbs a proposal may add (base forms)
export const NEUTRAL_VERBS = ['perform', 'handle', 'provide', 'complete'];
const NO_SINGULAR = new Set(['sales', 'logistics', 'analytics', 'operations', 'news', 'series', 'species', 'ethics', 'economics', 'physics', 'payroll', 'its', 'this', 'status', 'process', 'business', 'class', 'access', 'address', 'lens']);
const OBJECT_END = /^(?:and|or|for|to|with|at|in|on|by|from|across|using|via|through|while|into|per|including|within|under|over)$/i;
const DETERMINER = /^(?:the|a|an|all|our|their|his|her|its)$/i;

const stemOf = (w) => String(w || '').toLowerCase().replace(/(?:ization|isation|ations?|itions?|ments?|ings?|ions?|ances?|ences?|ers?|ed|es|s|e)$/, '');
function sameRoot(verb, noun) {
  const a = stemOf(verb), b = stemOf(noun);
  if (a.length < 4 || b.length < 4) return false;
  const n = Math.min(a.length, b.length);
  return n >= 5 ? a.slice(0, n) === b.slice(0, n) || a.startsWith(b) || b.startsWith(a) : a === b;
}
const singularWord = (w) => (NO_SINGULAR.has(w.toLowerCase()) || /ss$/i.test(w) || !/s$/i.test(w) ? w : /ies$/i.test(w) ? w.slice(0, -3) + 'y' : w.slice(0, -1));
const leadTense = (word) => (baseFromPast(word.toLowerCase(), KNOWN_VERBS) && baseFromPast(word.toLowerCase(), KNOWN_VERBS) !== word.toLowerCase() ? 'past' : 'present');
const verbForm = (base, tense, like) => matchCase(tense === 'past' ? pastTense(base) : base, like);
const has = (text, w) => new RegExp(`\\b${w}\\b`, 'i').test(text);

/** (i) the posting's form of words for a requirement this bullet already proves — or null. */
export function postingFormRewrite(text, label) {
  const t = String(text || '').trim().replace(/[.]+$/, '');
  const lab = String(label || '').trim();
  const lw = lab.split(/\s+/);
  if (!t || !lab || lw.length > 3 || /[^A-Za-z\s-]/.test(lab)) return null;
  // already in the posting's words (plural-tolerant)
  if (new RegExp(`\\b${lab.replace(/[-\s]+/g, '[-\\s]+')}s?\\b`, 'i').test(t)) return null;
  const words = t.split(/\s+/);
  const lead = words[0].replace(/[^A-Za-z-]/g, '');
  const leadBase = KNOWN_VERBS.has(lead.toLowerCase()) ? lead.toLowerCase() : baseFromPast(lead.toLowerCase(), KNOWN_VERBS);
  if (!leadBase) return null;
  const headNoun = lw[lw.length - 1];
  if (!sameRoot(leadBase, headNoun)) return null;
  // the object phrase right after the verb
  const obj = [];
  let i = 1;
  for (; i < words.length && obj.length < 4; i++) {
    const w = words[i];
    const bare = w.replace(/[^A-Za-z0-9/&-]/g, '');
    if (!bare || OBJECT_END.test(bare) || /[,;:()—–]/.test(w.slice(0, 1))) break;
    obj.push(bare);
    if (/[,;:)]$/.test(w)) { i++; break; }
  }
  while (obj.length && DETERMINER.test(obj[0])) obj.shift();
  if (!obj.length || obj.some((w) => /\d/.test(w))) return null;
  // the label's other words must already be the object's (the bullet proves R; nothing is added)
  const mods = lw.slice(0, -1);
  const objStems = new Set(obj.map((w) => contentStems(w)[0]).filter(Boolean));
  if (!mods.every((m) => objStems.has(contentStems(m)[0]))) return null;
  const objOut = [...obj.slice(0, -1), singularWord(obj[obj.length - 1])].join(' ');
  const rest = words.slice(i).join(' ');
  // "Read blueprints and schematics to…" — the object is coordinated ("blueprints and schematics"); splitting it
  // reads "Perform blueprint reading and schematics". Only a second VERB may follow the conjunction.
  const cm = rest.match(/^(?:and|or|,)\s+([A-Za-z-]+)/i);
  if (cm && !(KNOWN_VERBS.has(cm[1].toLowerCase()) || baseFromPast(cm[1].toLowerCase(), KNOWN_VERBS))) return null;
  const tense = leadTense(lead);
  const neutral = NEUTRAL_VERBS.find((v) => !has(t, v) && !has(t, pastTense(v)) && !sameRoot(v, headNoun));
  if (!neutral) return null;
  const noun = headNoun.toLowerCase();
  const out = `${verbForm(neutral, tense, lead)} ${objOut} ${noun}${rest ? ` ${rest}` : ''}`.replace(/\s+/g, ' ').trim();
  const fw = passesFirewall(t, out, [neutral, pastTense(neutral), ...lw.map((w) => w.toLowerCase())]);
  if (!fw.ok) return null;
  return `${out}.`;
}

const ROLE_FRAGMENT_RE = /^(charge nurse|preceptor|relief charge nurse|team lead|shift lead|shift leader|floor lead|crew lead|lead cashier|key ?holder|safety captain|safety lead|union steward|trainer|backup supervisor|acting supervisor|acting manager|relief manager|super user|superuser|point person|mentor)\b/i;
/** (ii) weak-lead polish from the person's own stems + the neutral list — or null. */
export function polishLead(text, tense) {
  const t = String(text || '').trim().replace(/[.]+$/, '');
  if (!t) return null;
  let m = t.match(/^(?:was\s+|were\s+)?responsible\s+for\s+(?!\w+ing\b)(.+)$/i);
  if (m && m[1].split(/\s+/).length >= 2) {
    const out = `${verbForm('handle', tense, 'H')} ${m[1]}`;
    return passesFirewall(t, out, ['handle', 'handled']).ok ? { text: `${out}.`, rule: 'responsible_for' } : null;
  }
  m = t.match(ROLE_FRAGMENT_RE);
  if (m && !KNOWN_VERBS.has(t.split(/\s+/)[0].toLowerCase())) {
    const out = `${tense === 'past' ? 'Served' : 'Serve'} as ${t.charAt(0).toLowerCase()}${t.slice(1)}`;
    return passesFirewall(t, out, ['serve', 'served', 'as']).ok ? { text: `${out}.`, rule: 'role_as_verb' } : null;
  }
  m = t.match(/^(?:[Uu]se|[Uu]sed|[Uu]sing)\s+((?:[A-Z][\w+#.-]*)(?:\s+[A-Z][\w+#.-]*)?)\s+(?:for|to)\s+(\w+ing)\b(.*)$/);
  if (m) {
    const base = m[2].toLowerCase().replace(/ing$/, '');
    const cands = [base, `${base}e`, base.replace(/(.)\1$/, '$1')];
    const verb = cands.find((c) => KNOWN_VERBS.has(c));
    if (verb) {
      const out = `${verbForm(verb, tense, 'X')} in ${m[1]}${m[3]}`.replace(/\s+/g, ' ').trim();
      return passesFirewall(t, out, [verb, pastTense(verb), 'in']).ok ? { text: `${out}.`, rule: 'use_for' } : null;
    }
  }
  const rw = rewriteBullet(t, { tense: 'keep' });
  if (rw.unchanged || rw.firewall?.ok === false || rw.changes.some((c) => c.rule === 'tense')) return null;
  // the engine's weak-lead fix ("Responsible for managing the front desk" → "Managed the front desk"), and its
  // hidden-verb fix only where the verb was literally hidden behind a linking verb ("Performed audits of…" →
  // "Audited…") — never "Worked with clients to resolve audit adjustments" → "Audited clients…" (an inflation)
  const first = t.split(/\s+/)[0].toLowerCase();
  if (rw.changes.some((c) => c.rule === 'weak_lead') && /^(?:responsible|duties|tasked|in)$/.test(first)) return { text: rw.text, rule: 'weak_lead' };
  if (rw.changes.some((c) => c.rule === 'hidden_verb') && /^(?:performed|conducted|provided|completed|carried|made|gave|did|perform|conduct|provide|complete|make|give|do)$/.test(first) && rw.text.split(/\s+/).length >= t.split(/\s+/).length - 2) return { text: rw.text, rule: 'hidden_verb' };
  return null;
}

const quote = (t) => { const s = String(t || '').replace(/[.;,]+$/, ''); return s.length > 60 ? `${s.slice(0, 60).replace(/\s+\S*$/, '')}…` : s; };
function polishWhy(rule, text, req) {
  const lead = String(text).trim().split(/\s+/).slice(0, 2).join(' ');
  const forReq = req ? ` It is one of your lines for "${req.label}", which they ask for.` : '';
  if (rule === 'responsible_for') return `"Responsible for" says what you were assigned, not what you did; the line now starts with the work.${forReq}`;
  if (rule === 'role_as_verb') return `"${lead}…" had no verb; "Serve as" makes it a line about what you did, nothing added.${forReq}`;
  if (rule === 'use_for') return `Starts with the work ("${quote(text)}" led with the tool).${forReq}`;
  return `"${lead}…" hid the verb; the line now starts with it, in your own words.${forReq}`;
}

/**
 * Every wording proposal for the bullets on the page. One proposal per bullet: the posting form for its
 * heaviest requirement first, else a lead polish, else the rewrite engine's tense/hygiene proposal (needs OK).
 */
export function planWordingProposals(base, decisions, verdict) {
  const out = [];
  for (const d of decisions) {
    if (d.decision !== 'keep' && d.decision !== 'trim') continue;
    const e = base.experience.find((x) => x.id === d.itemId);
    if (!e || isGapNote(e)) continue;
    const roleTense = e.end === 'present' ? 'present' : 'past';
    for (const id of d.keptBullets || []) {
      const b = e.bullets.find((x) => x.id === id);
      if (!b) continue;
      const reqs = (verdict.bulletReqs.get(b.id) || []).filter((r) => !r.soft && !r.inferred && r.via !== 'related');
      let proposal = null;
      for (const r of reqs) {
        const to = postingFormRewrite(b.text, r.label);
        // your call, not applied: the posting's exact phrase helps a system that matches words literally, but the
        // verb you wrote usually reads stronger to a person ("Scheduled patients" vs "Performed patient scheduling")
        if (to) { proposal = { bulletId: b.id, itemId: e.id, from: b.text, to, rules: ['posting_form'], requirement: r.label, default: 'needs_ok', why: `They ask for "${r.label}"; your line "${quote(b.text)}" already shows it. This version uses their exact words — worth it if their system matches phrases literally; your own verb reads stronger to a person, so it is your call.` }; break; }
      }
      if (!proposal) {
        const firstWord = b.text.trim().split(/\s+/)[0] || '';
        const tense = KNOWN_VERBS.has(firstWord.toLowerCase()) ? 'present' : baseFromPast(firstWord.toLowerCase(), KNOWN_VERBS) ? 'past' : roleTense;
        const p = polishLead(b.text, tense);
        if (p && p.text !== b.text) proposal = { bulletId: b.id, itemId: e.id, from: b.text, to: p.text, rules: [p.rule], requirement: reqs[0] ? reqs[0].label : null, default: 'applied', why: polishWhy(p.rule, b.text, reqs[0]) };
      }
      // tense proposals only for an ENDED role written in the present ("Prepare reconciliations" under a 2019–2020
      // job); a current role's present tense is right, and a dated result in it may stay as written
      if (!proposal && roleTense === 'past') {
        const tense = 'past';
        const rw = rewriteBullet(b.text, { tense });
        if (!rw.unchanged && rw.changes.some((c) => c.rule !== 'hygiene') && !rw.changes.some((c) => c.rule === 'hidden_verb' || c.rule === 'weak_lead') && rw.firewall?.ok !== false) proposal = { bulletId: b.id, itemId: e.id, from: b.text, to: rw.text, rules: [...new Set(rw.changes.map((c) => c.rule))], requirement: reqs[0] ? reqs[0].label : null, default: 'needs_ok', tense, why: rw.changes.some((c) => c.rule === 'tense') ? `Your ${e.company || e.title} role ${roleTense === 'past' ? 'has ended, so this line reads in the past tense like the others' : 'is current, so this line reads in the present tense'}.` : `Tightens "${quote(b.text)}" without changing what it says.` };
      }
      if (proposal) {
        // the person's punctuation: no full stop added to a résumé whose lines have none
        if (!/[.!?]\s*$/.test(b.text)) proposal.to = proposal.to.replace(/\.\s*$/, '');
        // the shared guard (lib/resume/health/meaningGuard.js): a proposal may change how a line says it, never what
        if (proposal.to !== b.text && rewriteKeepsMeaning(b.text, proposal.to).ok) out.push(proposal);
      }
    }
  }
  return out;
}
