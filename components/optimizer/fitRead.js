// THE fit read, as the screen shows it — built ONLY from fields the server returned (runOptimizer's
// `statements`, `constraints`, `verdict`, `field_match`). Nothing here re-derives a verdict, a status, a
// count or a band: it groups, orders and words what the reader and the verdict already decided.
//
// Screen rules (director's brief, phase B):
//  - each requirement as the posting states it, with one of four states carried by an icon AND a word:
//    Shown (the person's line quoted under it) · Partly (the line + what is missing, in words) · Not shown ·
//    Only you can say (physical, schedule, eligibility, traits — asked as a question, never a failure);
//  - required first, then duties, then preferred (labelled);
//  - one résumé line that proves several statements is quoted once; later rows point back to it;
//  - the posting's promises ("No experience required") sit in their own quiet block;
//  - graded gates in plain words with what was counted (constraints[].sentence, written by the server).

/** @typedef {'shown'|'partly'|'not_shown'|'ask'} RowState */

const STATE_OF = { shown: 'shown', partly: 'partly', not_shown: 'not_shown', cannot_tell: 'ask' };
// Gate kinds the verdict grades (constraints.js); physical / schedule asks are statements of their own.
const GATE_KINDS = new Set(['years', 'seniority', 'management', 'degree', 'education', 'certification', 'license', 'licence', 'language', 'clearance', 'age', 'work_authorization']);
const GRADE_STATE = { met: 'shown', partly: 'partly', not_shown: 'not_shown', cannot_tell: 'ask' };

const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
/** The proof line as people read it: no bullet glyph. */
export const proofText = (t) => clean(t).replace(/^[•\-*·–—]+\s*/, '');
const key = (t) => proofText(t).toLowerCase();

// A role header ("Guest Experience Team Lead — Target | Phoenix, AZ | Mar 2021 – Sep 2026") is the verdict's
// evidence for a years/title match; a bullet or a summary sentence is better proof to quote when both are there.
const looksLikeHeader = (t) => /\|/.test(t) && /\b(?:19|20)\d{2}\b/.test(t) && t.split(/\s+/).length <= 18;

/** The line to quote for a statement: its first evidence line, preferring a bullet over a role header. */
export function proofOf(st) {
  // ONE statement shape everywhere (free, paid and Studio): evidence is the verdict's [{ line, why }]; a row the person
  // answered (`by: 'you'`) is never proved by a résumé line here — the row prints their answer
  if (st && st.by === 'you') return '';
  const raw = st && Array.isArray(st.evidence) ? st.evidence : [];
  const ev = raw.map((e) => proofText(e && e.line)).filter(Boolean);
  if (!ev.length) return '';
  return ev.find((l) => !looksLikeHeader(l)) || ev[0];
}

// verbs a physical / schedule / eligibility line starts with — "Stand, walk, and smile…" becomes
// "Can you stand, walk, and smile…?"
const ASK_VERB = /^(?:stand|walk|lift|push|pull|carry|climb|stoop|kneel|bend|sit|work|travel|be|have|speak|read|write|drive|commute|reach|handle|operate|pass|maintain|obtain|relocate|wear|use|tolerate|perform|follow|communicate|learn|adapt|attend|respond|remain|move|stay|start|hold|provide|submit|complete|reside|live|report)\b/i;

/** A statement only the person can answer, phrased as a question to them (never as a failure). */
export function askQuestion(text) {
  // the reader keeps a line's own wrapping and lead-ins: "(On call during the weekend only…)", "Additionally, …"
  let t = clean(text).replace(/^\((.*)\)$/, '$1').replace(/^(?:additionally|also|please note|note)\s*[,:]\s*/i, '').replace(/[.;:]+$/, '').trim();
  if (!t) return '';
  const m = t.match(/^must\s+(?:be\s+)?(.*)$/i);
  if (m && /^must\s+be\b/i.test(t)) return `Are you ${m[1]}?`;
  if (m) t = m[1];
  if (ASK_VERB.test(t)) return `Can you ${t.charAt(0).toLowerCase()}${t.slice(1)}?`;
  // a policy or schedule the posting states ("some roles require…", "on call…") is a fit question, a trait a self-check
  if (/\b(?:may|might|some roles|required|requires?|on[- ]call|shifts?|weekends?|schedule|travel|drug test|background check)\b/i.test(t)) return `“${t.charAt(0).toUpperCase()}${t.slice(1)}” — does that work for you?`;
  return `${t} — is that true for you?`;
}

/**
 * The statements in display groups, each row with its state, its quote (once per line) and its words.
 * Returns null when the answer carries no statements (an older cached response) — the caller then shows the
 * verdict's requirement list instead.
 * @param {{ statements?: Array<Record<string, any>> }} d
 */
// "I've done this" / "I hold this" / "I speak this" (x-integration "Claims"): offered on a line the reading calls not shown or
// partly, never on a years ask (years come from the dates — the person fixes dates, not a tick; the server ignores a claim
// on one) and never on a line already answered or settled. The wording follows what the line asks for: a credential or a
// degree is held, a language spoken, anything else done. Only which words the button wears is decided here — what the
// claim does is the server's (the row comes back `by: 'you'`, `claimed: true`).
const YEARS_ASK = /\b\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\(\d+\)\s+)?years?\b/i;
const HOLD_KINDS = new Set(['certification', 'license', 'licence', 'credential', 'degree', 'education', 'clearance']);
const HOLD_WORDS = /\b(?:licen[cs]e[ds]?|certif\w*|certificate|registered|degree|diploma|bachelor|master|associate'?s?\s+degree|ged|cpr|bls|acls|cdl|servsafe|food handler'?s?\s+card|clearance)\b/i;
const SPEAK_WORDS = /\b(?:bilingual|fluent|fluency|speak|spoken|spanish|english|french|mandarin|cantonese|vietnamese|tagalog|arabic|korean|japanese|german|portuguese|russian|asl|sign language)\b/i;
export const CLAIM_LABEL = { done: "I've done this", hold: 'I hold this', speak: 'I speak this' };
export function claimWordFor(st, constraints) {
  if (!st || st.by === 'you' || st.settled || st.claimed) return null;
  if (st.status !== 'not_shown' && st.status !== 'partly') return null;
  const linked = (constraints || []).filter((c) => c && c.statementId && c.statementId === st.id).map((c) => String(c.kind));
  if (linked.includes('years') || YEARS_ASK.test(String(st.text || ''))) return null;
  if (linked.includes('language') || (!linked.some((k) => HOLD_KINDS.has(k)) && SPEAK_WORDS.test(String(st.text || '')) && !HOLD_WORDS.test(String(st.text || '')))) return 'speak';
  if (linked.some((k) => HOLD_KINDS.has(k)) || HOLD_WORDS.test(String(st.text || ''))) return 'hold';
  return 'done';
}

export function fitGroups(d) {
  // the reader marks a malformed or low-confidence line `display: false`: it never reaches a screen
  const sts = d && Array.isArray(d.statements) ? d.statements.filter((s) => s && s.display !== false && clean(s.text)) : [];
  if (!sts.length) return null;
  const rows = [];
  const promises = [];
  for (const st of sts) {
    if (st.kind === 'promise') { promises.push({ id: st.id, text: clean(st.text), source: clean(st.source) }); continue; }
    const state = /** @type {RowState} */ (STATE_OF[st.status] || 'not_shown');
    const group = state === 'ask' ? 'ask' : st.importance === 'preferred' || st.kind === 'preferred' ? 'preferred' : st.importance === 'duty' || st.kind === 'duty' ? 'duty' : 'required';
    rows.push({
      id: String(st.id || rows.length),
      text: clean(st.text),
      state,
      group,
      preferred: st.importance === 'preferred' || st.kind === 'preferred',
      line: state === 'shown' || state === 'partly' ? proofOf(st) : '',
      // a role header ("Warehouse Associate — Midwest Distribution | 2021 – Present") is the person's JOB, not a line they wrote
      lineIsJob: false,
      // the reader writes `missing` as phrases now ("not shown: putting away inventory"): printed as written, never re-joined
      missing: state === 'partly' ? (Array.isArray(st.missing) ? st.missing.map((m) => clean(m)).filter(Boolean) : []) : [],
      // the closest résumé line the judge found but could not prove — asked, never claimed (`candidate: { line, why }`)
      candidate: (state === 'not_shown' || state === 'partly') && st.candidate && clean(st.candidate.line) ? { line: proofText(st.candidate.line), why: clean(st.candidate.why) } : null,
      // the server changed this row because of the person's own answer: printed "You said …", never "your résumé shows"
      byYou: st.by === 'you',
      // the person said they have done it / hold it (no résumé line — the server's own sentence is printed), or said the
      // partial reading is right (the row is no longer asked about)
      claimed: st.claimed === true,
      claimWhy: st.claimed === true ? clean((Array.isArray(st.evidence) && st.evidence[0] && st.evidence[0].why) || '') : '',
      settled: st.settled === true,
      claim: claimWordFor(st, d.constraints),
      question: state === 'ask' ? askQuestion(st.text) : '',
      source: clean(st.source),
    });
  }
  for (const r of rows) if (r.line && looksLikeHeader(r.line)) r.lineIsJob = true;
  // what they require, the work itself, then what only the person can say (traits, hours, lifting), preferred last
  const order = ['required', 'duty', 'ask', 'preferred'];
  const groups = order.map((g) => ({ key: g, rows: rows.filter((r) => r.group === g) })).filter((g) => g.rows.length);
  // one quote per line: the first row (in display order) quotes it; later rows point back to that row
  const firstBy = new Map();
  for (const g of groups) for (const r of g.rows) {
    if (!r.line) continue;
    const k = key(r.line);
    if (firstBy.has(k)) r.sameAs = firstBy.get(k); else firstBy.set(k, r.text);
  }
  return { groups, promises, total: rows.length };
}

const STATE_RANK = { not_shown: 0, partly: 1, shown: 2 };
/**
 * The first rows a person reads: required before duties, and within each what is NOT shown (or only partly) before
 * what is — so the top of the screen is what matters. Questions only the person can answer are not in it.
 * @param {{ groups: Array<{ key: string, rows: Array<Record<string, any>> }> } | null} model
 */
export function topRows(model, n = 5, skip = []) {
  if (!model) return [];
  // a statement a graded gate already says ("You show about 6 years…; they ask for 1+") is not said twice
  const skipped = new Set(skip.filter(Boolean));
  const pick = (k) => ((model.groups.find((g) => g.key === k) || { rows: [] }).rows).map((r, i) => ({ r, i }))
    // a row the person just answered keeps its place near the top (it was there when they tapped it)
    .sort((a, b) => (a.r.byYou ? 1 : STATE_RANK[a.r.state] ?? 3) - (b.r.byYou ? 1 : STATE_RANK[b.r.state] ?? 3) || a.i - b.i).map((x) => x.r);
  const all = [...pick('required'), ...pick('duty')].filter((r) => !skipped.has(r.id));
  const top = all.slice(0, n);
  // an answer the server accepted stays on the first screen, wherever it now ranks — the person sees what their tap did
  return [...top, ...all.slice(n).filter((r) => r.byYou)];
}

/** Group heading: plain label + the count of THIS group's rows that are shown (states from the server). */
export function groupHeading(g) {
  const n = g.rows.length;
  const shown = g.rows.filter((r) => r.state === 'shown').length;
  const partly = g.rows.filter((r) => r.state === 'partly').length;
  const tally = `${shown} of ${n} shown${partly ? `, ${partly} partly` : ''}`;
  if (g.key === 'required') return { label: 'What they require', tally };
  if (g.key === 'duty') return { label: 'The work itself', tally };
  if (g.key === 'preferred') return { label: 'Preferred — not required', tally };
  return { label: 'Only you can say', tally: `${n} question${n === 1 ? '' : 's'}` };
}

/** "Partly" in words: what the line shows is quoted; this says what it does not. */
export function partlySentence(r) {
  return r.missing.length ? '' : 'Your line shows part of this, not all of it.';
}

/**
 * Graded gates in plain words, from constraints the verdict graded (sentence written by the server, e.g.
 * "Your résumé shows about 4 years leading a kitchen crew (Kitchen Manager, 2021–now); they ask for 5+.").
 * @param {Array<Record<string, any>>} constraints
 */
export function gateRows(constraints) {
  const out = [];
  const seen = new Set();
  for (const c of constraints || []) {
    if (!c || !GATE_KINDS.has(String(c.kind))) continue;
    const text = clean(c.sentence || c.message);
    // two graded rows that say the same thing ("…lead duties (…) but no role where you managed people; they ask for 7+ years" and the
    // same without the years) are one row: the first 60 characters decide
    const head = text.slice(0, 60).toLowerCase();
    if (!text || seen.has(head)) continue;
    seen.add(head);
    const state = GRADE_STATE[c.grade] || (c.status === 'met' ? 'shown' : c.status === 'ask' ? 'ask' : c.status === 'partial' ? 'partly' : 'not_shown');
    out.push({ kind: String(c.kind), text, state, caps: !!c.caps, quote: clean(c.posting_quote), preferred: c.importance === 'preferred', statementId: c.statementId || null, claimed: c.claimed === true });
  }
  // a gate that stops the application first, then what is short, then what is met
  const rank = (r) => (r.caps ? 0 : r.state === 'not_shown' ? 1 : r.state === 'partly' ? 2 : r.state === 'ask' ? 3 : 4);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** The field verdict when the reader KNOWS the posting is other work (known !== false); null otherwise. */
export function differentField(fm) {
  if (!fm || fm.level !== 'different' || fm.known === false) return null;
  return { sentence: clean(fm.sentence), carries: Array.isArray(fm.transferable) ? fm.transferable.filter(Boolean).slice(0, 5) : [] };
}

/** The verdict sentence without its leading score ("51 — You show …" → "You show …"). */
export function verdictSentence(v) {
  if (!v) return '';
  const t = clean(v.sentence);
  return v.withheld ? t : t.replace(/^\d+\s*[—-]\s*/, '');
}

/** A tone from the SERVER's band word (lib/optimizer/explainScore.js fitBand) — never a client score threshold. */
export function bandTone(band) {
  const b = String(band || '');
  if (/^(?:strong|good)\b/i.test(b)) return 'good';
  if (/^partial\b/i.test(b)) return 'caution';
  return undefined;
}

// 'said': a line the person said they have done / hold — not on the résumé, so never "Shown"
export const STATE_WORD = { shown: 'Shown', partly: 'Partly', not_shown: 'Not shown', ask: 'Only you can say', said: 'You said yes' };
