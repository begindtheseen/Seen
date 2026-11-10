// The tailored summary — built from the verdict and the person's own words (director's decision B).
//
//   [identity] with [N]+ years of experience[, most recently <Title> at <Company>]. Experienced in [the
//   3–4 heaviest matched requirements, in the résumé's own phrasing]. Credentials: [what the posting names
//   that the résumé holds, as the résumé writes it].
//
//   • identity — the person's own phrase from their summary/headline ("Registered nurse", "CPA",
//     "Administrative professional"; adjectives like "Compassionate" / "Hard working and dependable" left
//     out), else their latest relevant title as written;
//   • years — a title identity counts only the months of roles with that title's head word ("Registered
//     nurse with 6+ years" never counts the CNA years); a field identity counts the relevant roles
//     (lib/resume/years.js supportedYears — never above a figure the person states);
//   • "most recently" — the latest-ENDING role (never a gap note); named only when it is relevant to the
//     posting, as "most recently at <Company>" when it is the identity's own title, else "most recently
//     <Title> at <Company>" — never "<Title> at <Title> at <Company>";
//   • never a pasted bullet, never "Strengths in", never a job-hunting sentence.
//
// The person's summary is KEPT unless the new one names strictly more of the posting's matched requirements
// (counted the same way for both); a "Looking for / Seeking …" sentence is the only thing ever removed from
// a kept summary. Every decision is returned with its reason.
import { supportedYears, coveredMonths, statedYears, careerYears } from '../years.js';
const statedYearsIn = (base) => statedYears([base.basics.summary, base.basics.headline].filter(Boolean).join(' ')) != null;
import { passesFirewall } from '../rewrite/rules.js';
import { serializeToText } from '../model.js';
import { isGapNote, stemsCovered, contentStems, cleanLine, GENERIC_REQ } from './verdict.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const JOB_SEARCH_RE = /(?:^|\b)(?:looking\s+for|seeking|searching\s+for|hoping\s+to\s+(?:join|find|grow)|open\s+to\s+(?:a|new|roles?|opportunit)|eager\s+to\s+(?:join|find)|my\s+goal\s+is|objective:|to\s+obtain\s+a|to\s+secure\s+a|ready\s+for\s+(?:a|my)\s+next)\b/i;
const CLICHE_RE = /\b(?:team player|works? well under pressure|hard[- ]?working|dependable|detail[- ]oriented|known for|running smoothly|results[- ]driven|self[- ]starter|go[- ]getter|people person|fast learner|quick learner|passionate about|think outside the box)\b/i;
// substance = what is left once job-hunting sentences and cliché CLAUSES are cut ("Registered Nurse with 6 years in home
// health and med-surg, known for careful assessments" keeps its first clause)
const substanceWords = (sentences) => sentences.filter((x) => !JOB_SEARCH_RE.test(x)).map((x) => x.split(/,|;|\band\b(?=\s+(?:known|a|an)\b)/).filter((c) => !CLICHE_RE.test(c)).join(' ')).join(' ').split(/\s+/).filter((w) => w.length > 2).length;
const ADJECTIVES = new Set(['compassionate', 'organized', 'dedicated', 'hard', 'working', 'hardworking', 'hard-working', 'dependable', 'motivated', 'passionate', 'results-driven', 'results', 'driven', 'detail-oriented', 'detail', 'oriented', 'reliable', 'enthusiastic', 'experienced', 'seasoned', 'dynamic', 'proven', 'skilled', 'energetic', 'friendly', 'caring', 'diligent', 'highly', 'self-motivated', 'versatile', 'accomplished', 'professional,', 'driven,', 'and', 'a', 'an', 'creative', 'ambitious', 'confident', 'personable', 'outgoing', 'loyal', 'punctual', 'trustworthy', 'efficient', 'effective', 'strong', 'talented', 'enthusiastic,']);
const ROLE_HEAD = /\b(nurse|engineer|electrician|accountant|professional|developer|manager|specialist|technician|assistant|associate|analyst|designer|marketer|coordinator|administrator|representative|lead|supervisor|cpa|rn|lpn|cna|driver|operator|clerk|cashier|receptionist|bookkeeper|graduate|student|advisor|consultant|recruiter|teacher|paralegal|pharmacist|therapist|mechanic|plumber|welder|carpenter|machinist|chef|cook|server|bartender|barista|attendant|agent|officer|scientist|architect|writer|editor|planner|buyer|controller|auditor|director|executive|generalist|worker|handler|picker|packer|loader|custodian|janitor|aide|caregiver|technologist|hygienist|medic|emt|paramedic|electrical|journeyman)\b/i;
const HEAD_SYNONYMS = { nurse: ['rn', 'lpn', 'lvn'], rn: ['nurse'], engineer: ['developer', 'swe'], developer: ['engineer'], accountant: ['cpa'], cpa: ['accountant'] };
const GENERIC_HEADS = new Set(['professional', 'graduate', 'student', 'worker', 'specialist', 'associate', 'executive', 'generalist', 'cpa', 'rn', 'lpn', 'journeyman']);

const cleanTitle = (t) => String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*[|]\s*.*$/, '').trim();
// "Sunbelt Electric Contractors, Phoenix AZ" / "Ledgerline (Series B fintech)" → the employer's name
const cleanCompany = (c) => String(c || '').replace(/\s*\([^)]*\)/g, '').replace(/,\s*[A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+)?,?\s+(?:[A-Z]{2})\b.*$/, '').replace(/,\s*(?:remote|hybrid)$/i, '').trim();
const headWord = (phrase) => { const m = String(phrase || '').toLowerCase().match(new RegExp(ROLE_HEAD.source, 'gi')); return m ? m[m.length - 1].toLowerCase() : ''; };

/** The person's own identity phrase from the opener of their summary or headline, adjectives removed. */
export function ownIdentity(base) {
  for (const src of [base.basics.summary, base.basics.headline]) {
    const first = String(src || '').split(/(?<=[.!?])\s+/)[0] || '';
    if (!first || /^\s*(?:i\s+am\s+|i.m\s+)?(?:looking|seeking|searching|objective|to obtain|to secure)\b/i.test(first)) continue;
    // the noun phrase that opens the sentence and ends on a role word ("Hard working and dependable warehouse
    // professional looking for…" → "warehouse professional"), up to six words
    const toks = first.replace(/[,.;:]+/g, ' $& ').split(/\s+/).filter(Boolean);
    let end = -1;
    for (let i = 0; i < Math.min(toks.length, 7); i++) {
      if (/^[,.;:]$/.test(toks[i])) break;
      if (ROLE_HEAD.test(toks[i]) && new RegExp(`^${ROLE_HEAD.source}$`, 'i').test(toks[i].replace(/[^A-Za-z]/g, ''))) {
        const next = (toks[i + 1] || '').toLowerCase();
        if (!next || /^[,.;:]$/.test(next) || /^(?:with|who|and|having|specializing|skilled|experienced|focused|offering|bringing|known|looking|seeking|eager|ready|interested|in|at|for)$/.test(next)) { end = i; break; }
      }
    }
    if (end < 0) continue;
    const words = toks.slice(0, end + 1);
    while (words.length && ADJECTIVES.has(words[0].toLowerCase())) words.shift();
    if (!words.length || words.length > 4) continue;
    const phrase = words.join(' ');
    return { phrase: /^[A-Z]{2,}$/.test(words[0]) ? phrase : cap(phrase.charAt(0).toLowerCase() + phrase.slice(1)), source: src === base.basics.summary ? 'summary' : 'headline' };
  }
  return null;
}

function endKey(e) {
  const end = String(e.end || '');
  if (!end && !e.start) return '0000-00';
  if (end === 'present' || (!end && e.start)) return '9999-12';
  return end.length === 4 ? `${end}-12` : end;
}

/** The latest-ending role (ties: one with verdict evidence first, then the person's own order). */
export function latestRole(base, verdict) {
  const roles = base.experience.filter((e) => !isGapNote(e) && (e.title || e.company));
  let best = null;
  for (const e of roles) {
    const k = endKey(e);
    if (!best) { best = e; continue; }
    const bk = endKey(best);
    if (k > bk || (k === bk && (verdict.roleWeight.get(e.id) || 0) > (verdict.roleWeight.get(best.id) || 0))) best = e;
  }
  return best;
}

/** The résumé's own words for a matched requirement, or the posting's label when the evidence line carries
 * every one of its words (rule 2). Searched in the body only — bullets, titles, skills, certifications. */
export function ownPhrase(row, bodyText) {
  for (const p of [row.label, ...(row.postingPhrases || [])]) {
    const s = String(p || '').trim();
    if (s.length < 2) continue;
    const re = new RegExp(`(?<![A-Za-z0-9])(${escRe(s).replace(/\\? /g, '[\\s-]+')}(?:e?s)?)(?![A-Za-z0-9])`, 'i');
    const m = bodyText.match(re);
    if (m) return m[1].replace(/\s+/g, ' ');
  }
  if (row.evidence) {
    // the evidence line's own casing ("Proficient in Microsoft Office." → "Microsoft Office")
    const re = new RegExp(`(?<![A-Za-z0-9])(${escRe(String(row.label)).replace(/\\? /g, '[\\s-]+')}(?:e?s)?)(?![A-Za-z0-9])`, 'i');
    const m = row.evidence.match(re);
    if (m) return m[1];
    if (stemsCovered(row.label, row.evidence)) return row.label;
  }
  return null;
}
// the person's casing: a lowercase use anywhere wins ("patient education"), else as written ("Excel", "Dentrix")
// the résumé's own casing: a lowercase use anywhere wins ("patient education"); else the casing the résumé writes it in
// ("Excel", "Dentrix"); a capital that only comes from starting a line ("Wound care, ostomy care…") is not the word's own
const keepCase = (phrase, body) => {
  const all = [...body.matchAll(new RegExp(`(^|[^A-Za-z0-9])(${escRe(phrase)})(?![A-Za-z0-9])`, 'gim'))];
  if (!all.length) return phrase;
  if (all.some((m) => m[2] === m[2].toLowerCase())) return phrase.toLowerCase();
  const mid = all.find((m) => m[1] && m[1] !== '\n');
  const own = (mid || all[0])[2];
  return !mid && /^[A-Z][a-z]+(?:[\s-][a-z0-9]+)*$/.test(own) ? own.charAt(0).toLowerCase() + own.slice(1) : own;
};
const sentenceCase = (s) => (/^[A-Z][a-z]+(?:[\s-][a-z0-9]+)*$/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** How many of the verdict's matched requirements a summary names (the same count for old and new). */
export function namedRequirements(text, verdict) {
  const t = String(text || '');
  if (!t.trim()) return [];
  return verdict.matched.filter((r) => !r.soft && r.label && stemsCovered(r.label, t)).map((r) => r.label);
}

// a diagnosis is who you cared for, not what you are experienced in ("Experienced in … CHF")
const DIAGNOSIS_RE = /^(?:chf|copd|diabetes|stroke|sepsis|pneumonia|dementia|hypertension|cancer|covid|asthma|mi|cva|dvt|uti|ckd|esrd|afib|tbi)$/i;
const CERT_WORD = /\b(?:licen[cs]e[ds]?|certif\w*|registered|cpr|bls|acls|pals|nihss|osha|cdl|cpa|ccrn|tncc|nrp|servsafe|forklift|epa|nfpa|journeyman|master)\b/i;
function credentialsNamed(base, verdict) {
  const out = [];
  const want = [...verdict.matched.filter((r) => CERT_WORD.test(r.label)).map((r) => r.label), ...verdict.constraints.filter((c) => (c.kind === 'certification' || c.kind === 'license') && c.status === 'met').map((c) => c.label)];
  if (!want.length) return out;
  for (const c of base.certifications) {
    const text = String(c.text || c.name || '').replace(/\s*\((?:[^)]*(?:association|academy|institute|council|red cross|issued|board)[^)]*)\)/gi, '').replace(/[,\s]*(?:19|20)\d{2}\s*$/, '').trim();
    if (!text) continue;
    if (want.some((w) => stemsCovered(w.replace(/\b(?:certification|certificate|certified|license|licence|licensure|required|preferred|current|active|valid)\b/gi, '').trim() || w, text))) out.push(text);
  }
  return [...new Set(out)];
}

/**
 * @returns {{ mode: 'replace'|'add'|'keep'|'trim', text: string, before: string, named: string[], namedBefore: string[], why: string, sources: object }}
 */
export function composeVerdictSummary(base, verdict, { relevantIds = null, now = new Date(), yearsCeiling = null, postingText = '' } = {}) {
  const before = String(base.basics.summary || '').trim();
  const beforeSentences = before.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const jobSearch = beforeSentences.filter((s) => JOB_SEARCH_RE.test(s));
  const namedBefore = namedRequirements(before, verdict);
  const roles = base.experience.filter((e) => !isGapNote(e));
  const relevant = new Set(relevantIds ? [...relevantIds] : roles.filter((e) => (verdict.roleWeight.get(e.id) || 0) > 0).map((e) => e.id));
  for (const e of roles) if ((verdict.roleWeight.get(e.id) || 0) > 0) relevant.add(e.id);

  // identity + years
  let own = ownIdentity(base);
  // an identity from another field ("automotive technician" applying to GNC sales) is not how this application
  // should open: the latest relevant title leads instead — still the person's own words
  const offField = !!(own && postingText && !contentStems(own.phrase).some((st) => contentStems(postingText).includes(st)));
  const latestRelevant = roles.filter((e) => relevant.has(e.id)).sort((a, b) => (endKey(b) > endKey(a) ? 1 : endKey(b) < endKey(a) ? -1 : 0))[0] || null;
  // …only when that title is closer to this posting than their own phrase ("Membership Specialist" for a sales job);
  // a warehouse professional applying to handle material keeps "Warehouse professional"
  if (offField && latestRelevant && contentStems(latestRelevant.title).some((st) => contentStems(postingText.split('\n')[0] || '').includes(st))) own = null;
  const identity = own ? own.phrase : latestRelevant ? cleanTitle(latestRelevant.title) : '';
  const head = headWord(identity);
  let years = null;
  if (identity) {
    if (head && !GENERIC_HEADS.has(head)) {
      const syn = HEAD_SYNONYMS[head] ? `(?:${[head, ...HEAD_SYNONYMS[head]].map(escRe).join('|')})` : escRe(head);
      const same = roles.filter((e) => new RegExp(`\\b${syn}s?\\b`, 'i').test(e.title || ''));
      const months = coveredMonths(same, now);
      const sy = supportedYears(base, { relevantIds: same.map((e) => e.id), now });
      years = sy ? Math.min(sy.years, Math.floor(months / 12)) : null;
      if (!(years >= 1) && own) { const all = supportedYears(base, { relevantIds: [...relevant], now }); years = all ? all.years : null; }
    } else if (own && statedYearsIn(base)) {
      // the person's own phrase with their own figure ("administrative professional with 12+ years"): their
      // claim, never above the ONE dated figure every tool prints (lib/resume/years.js careerYears)
      const cy = careerYears(serializeToText(base), { now });
      const st = statedYears([base.basics.summary, base.basics.headline].filter(Boolean).join(' '));
      years = cy.whole >= 1 ? Math.min(cy.whole, st ?? cy.whole) : null;
    } else {
      const sy = supportedYears(base, { relevantIds: [...relevant], now });
      years = sy ? sy.years : null;
    }
  }
  // one years figure per package: never more than the verdict's own count ("You show 5.6 years")
  if (years != null && yearsCeiling != null && years > Math.floor(yearsCeiling)) years = Math.floor(yearsCeiling) >= 1 ? Math.floor(yearsCeiling) : null;
  // most recently
  const latest = latestRole(base, verdict);
  let recent = '';
  if (latest && relevant.has(latest.id) && latest.company) {
    const co = cleanCompany(latest.company);
    const sameTitle = head && new RegExp(`\\b${escRe(head)}s?\\b`, 'i').test(latest.title || '');
    recent = sameTitle || !latest.title ? `most recently at ${co}` : `most recently ${cleanTitle(latest.title)} at ${co}`;
  }
  // the person's own "experience in med-surg and telemetry" rides along when this posting asks for those words
  let field = '';
  let fieldPrep = 'in';
  if (own && own.source === 'summary' && postingText) {
    const fm = String(base.basics.summary).split(/(?<=[.!?])\s+/)[0].match(/\b(?:experience|background|years?)\s+(in|with|across|supporting|serving|leading|managing|building|running)\s+([^.;,]+?)(?:[.;,]|$)/i);
    // the person's own field, when this posting shares at least one of its words ("home health and med-surg" for a
    // home-health posting)
    // a gerund tail is who they are ("supporting executives and busy offices") and always rides along; a field ("in
    // home health and med-surg") rides along when this posting shares one of its words
    if (fm && fm[2].split(/\s+/).length <= 7 && contentStems(fm[2]).length && (/ing$/i.test(fm[1]) || contentStems(fm[2]).some((st) => st.length > 2 && contentStems(postingText).includes(st)))) { field = fm[2].trim(); fieldPrep = fm[1].toLowerCase(); }
  }
  const parts = [];
  if (identity) {
    const tail = field ? (/ing$/.test(fieldPrep) ? ` ${fieldPrep} ${field}` : ` in ${field}`) : '';
    const yrs = years != null && years >= 1 ? (field && /ing$/.test(fieldPrep) ? ` with ${years}+ years${tail}` : ` with ${years}+ years of experience${tail}`) : field ? ` with experience${tail}` : '';
    parts.push(`${identity}${yrs}${recent ? `, ${recent}` : ''}.`);
  }
  // the heaviest matched requirements, in the résumé's own words
  // the work only: bullets, titles, unqualified skills — never a certification's issuer ("American Heart
  // Association") and never a skill the person marks as partial ("TypeScript (working)")
  const QUAL = /\((?:working|basic|some|familiar|familiarity|learning|beginner|exposure|novice|limited)\b[^)]*\)/i;
  const body = [...base.experience.flatMap((e) => [e.title, ...e.bullets.map((b) => b.text)]), ...base.skills.map((g) => `Skills: ${g.items.filter((it) => !QUAL.test(it)).join(', ')}`), ...base.projects.flatMap((p) => [p.name, ...p.bullets.map((b) => b.text)])].filter(Boolean).map(cleanLine).join('\n');
  const identityStems = new Set([...contentStems(identity), ...contentStems(field)]);
  const picks = [];
  const pickStems = [];
  for (const r of [...verdict.matched].sort((a, b) => b.weight - a.weight)) {
    if (picks.length >= 4) break;
    if (r.soft || r.inferred || r.via === 'related' || CERT_WORD.test(r.label) || DIAGNOSIS_RE.test(r.label) || GENERIC_REQ.has(r.label.toLowerCase())) continue;
    if (r.where !== 'bullet' && r.where !== 'role' && r.where !== 'skills' && !r.surfaced) continue;
    if (r.where === 'skills' && !stemsCovered(r.label, body)) continue;
    const phrase = ownPhrase(r, body);
    if (!phrase || phrase.length > 40 || phrase.split(/\s+/).length > 5) continue;
    const st = contentStems(phrase);
    if (!st.length || st.every((s) => identityStems.has(s))) continue;
    if (pickStems.some((ps) => st.every((s) => ps.includes(s)) || ps.every((s) => st.includes(s)))) continue;
    picks.push(keepCase(phrase, body)); pickStems.push(st);
  }
  // one item alone must say something specific ("wound care"), never a single generic word ("cleaning")
  if (picks.length >= 2 || (picks.length === 1 && picks[0].split(/\s+/).length >= 2)) parts.push(`Experienced in ${listJoin(picks)}.`);
  const creds = credentialsNamed(base, verdict);
  if (creds.length) parts.push(`Credentials: ${creds.join('; ')}.`);
  let composed = parts.join(' ').replace(/\.\./g, '.').trim();
  // grounded: every word is the résumé's, a posting label proven by its own line, or a connective
  const vocab = [serializeToText(base), ...verdict.matched.map((r) => r.label)].join('\n');
  const fw = composed ? passesFirewall(vocab, composed, ['with', 'years', 'of', 'experience', 'most', 'recently', 'at', 'experienced', 'in', 'and', 'credentials', String(years || '')]) : { ok: false };
  if (!fw.ok) composed = '';
  const named = namedRequirements(composed, verdict);
  const sources = { field,
    identity, identitySource: own ? own.source : (latestRelevant ? 'latest relevant title' : null), years, recent: latest ? { itemId: latest.id, title: latest.title, company: latest.company } : null, requirements: picks, credentials: creds, firewall: fw };

  // decide
  if (!before) {
    if (composed && named.length >= 2) return { mode: 'add', text: composed, before, named, namedBefore, sources, why: `You had no summary. They ask for ${listJoin(named.slice(0, 4))}; this one opens with that, every word from your résumé.` };
    return { mode: 'keep', text: '', before, named: [], namedBefore, sources, why: 'No summary was added: there was not enough the posting asks for that your résumé already shows to say it in one.' };
  }
  // A summary with substance stays in the person's words (only a job-hunting line leaves); a thin or cliché one
  // ("Team player who works well under pressure", "Hard working and dependable … looking for a lead role") is
  // rewritten when the new one names more of what the posting asks for.
  const substance = substanceWords(beforeSentences);
  if (composed && offField && namedBefore.length === 0 && named.length >= 2) {
    return { mode: 'replace', text: composed, before, named, namedBefore, sources, why: `Your summary is about ${ownIdentity(base).phrase.toLowerCase()} work and names nothing ${postingText ? 'this posting' : 'the posting'} asks for. They ask for ${listJoin(named.slice(0, 4))}; this one leads with that, every word from your résumé.` };
  }
  if (composed && ((named.length > namedBefore.length && (substance < 15 || named.length >= namedBefore.length + 3)) || (substance < 5 && named.length >= namedBefore.length && named.length >= 1))) {
    // one sentence of the person's summary rides along when it states a fact the new one does not (a licence,
    // a language, a number) — never a job-hunting line and never one that repeats the opener
    const FACT_RE = /\b(?:licen[cs]e[ds]?|certif\w*|exam|bilingual|fluent|spanish|french|mandarin|portuguese|vietnamese|tagalog|arabic|korean|\$\d|\d+%|\d[\d,.]*\s*(?:b|m|k)\b)/i;
    const carry = beforeSentences.find((s) => !JOB_SEARCH_RE.test(s) && FACT_RE.test(s) && !stemsCovered(s, composed) && (s.match(/\d[\d,.]*/g) || [s]).some((n) => !composed.includes(n)) && !(identity && s.toLowerCase().startsWith(identity.toLowerCase())));
    const text = carry ? `${composed} ${carry}` : composed;
    const nowNamed = namedRequirements(text, verdict);
    const fresh = nowNamed.filter((x) => !namedBefore.includes(x));
    const jsAt = jobSearch.length ? jobSearch[0].slice(jobSearch[0].search(JOB_SEARCH_RE)).replace(/^\W+/, '') : '';
    const oldFault = jobSearch.length ? ` and spent words on what you want next ("${jsAt.split(/\s+/).slice(0, 5).join(' ')}…")` : beforeSentences.some((x) => CLICHE_RE.test(x)) ? ' and leaned on phrases any applicant could write' : '';
    const why = `They ask for ${listJoin(nowNamed.slice(0, 4))}. Your summary ${namedBefore.length ? `named only ${listJoin(namedBefore.slice(0, 3))}` : 'named none of it'}${oldFault}. This one ${recent && latest ? `leads with your ${latest.end === 'present' ? 'current' : 'latest'} job at ${cleanCompany(latest.company)} and ` : ''}names ${listJoin((fresh.length ? fresh : nowNamed).slice(0, 4))} — every word from your résumé.`;
    return { mode: 'replace', text, before, named: nowNamed, namedBefore, sources: { ...sources, carried: carry || null }, why };
  }
  if (jobSearch.length && jobSearch.length < beforeSentences.length && substance >= 5) {
    const text = beforeSentences.filter((s) => !JOB_SEARCH_RE.test(s)).join(' ');
    return { mode: 'trim', text, before, named: namedBefore, namedBefore, sources, why: `Your summary stays in your words; only "${jobSearch[0].slice(0, 60)}${jobSearch[0].length > 60 ? '…' : ''}" is left out — a recruiter reads it as what you want, not what you bring to this job.` };
  }
  if (jobSearch.length && jobSearch.length === beforeSentences.length && substance < 5) {
    return { mode: 'trim', text: '', before, named: [], namedBefore, sources, why: `Your summary was only about what you want next ("${beforeSentences[0].slice(0, 60)}${beforeSentences[0].length > 60 ? '…' : ''}"), and there is not enough on your résumé that this posting asks for to write a better one, so it is left off — your experience opens the page.` };
  }
  return { mode: 'keep', text: before, before, named: namedBefore, namedBefore, sources, why: composed ? `Your own summary already names ${namedBefore.length} of the posting's requirements; a rewritten one would not name more, so it stays as you wrote it.` : 'Your own summary stays as you wrote it.' };
}
