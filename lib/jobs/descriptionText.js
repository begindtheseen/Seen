// Listing descriptions as people should read them.
//
// Owner report 2026-10-24: "every job listing description doesn't fully open, and many of SpaceX's
// descriptions are just the company mission." Verified on 400 active SpaceX rows (read-only):
//   • 98 are Adzuna rows of exactly 500 chars ending "…" mid-word — Adzuna's search API returns a
//     teaser, never the posting (10,675 active Adzuna rows site-wide are like this);
//   • 0 of 400 stored descriptions contain a newline (ingest collapsed all whitespace), so
//     "RESPONSIBILITIES:" ran into the sentence before it and a 5,000-char posting was one block;
//   • 5 Greenhouse rows are exactly 8,000 chars and end "green card holde" (the old cap cut mid-word);
//   • all 302 Greenhouse rows open with the same 300-char mission paragraph, so every card read alike.
// These helpers are shared by every renderer (JobCard, SwipeJobDeck, JobDetailDrawer, /jobs/[id])
// and by the ingest cap. They never invent text: a preview is labelled a preview, a cut is labelled a
// cut, and a snippet is the listing's own first sentence about the role.

import { looksLikeSlug, splitSlugWords } from './companyName.js';
import { splitSentences } from '../text/sentences.js';
import { cutInlineHeadings, splitRunOn } from '../optimizer/postingSections.js';

const ELLIPSIS_RE = /(?:…|\.{3})\s*$/;
// Adzuna teasers are ~500 chars; allow for a little variation around that.
const PREVIEW_MAX = 520;
// An Adzuna row longer than this is no longer its API teaser: the person pasted (or ingest fetched) the posting.
const TEASER_MAX = 600;
/** Where ingest caps a description (lib/server/jobSources.js cleanDescription), at a sentence end. */
export const DESCRIPTION_CAP = 12000;
// The cap before 2026-10-24 — rows stored under it still exist (and were cut mid-word).
const LEGACY_CAP = 8000;

/**
 * Is this row only a teaser of the posting (never the full text)? True for every Adzuna row — its
 * API returns a snippet — and for any short description ending in an ellipsis.
 * @param {{ source?: string|null, description?: string|null }} job
 */
export function isDescriptionPreview(job) {
  const src = String(job?.source || '').toLowerCase();
  const d = String(job?.description || '').trim();
  // An Adzuna row's STORED text is a teaser — but a person who pastes the full posting over it has a posting
  // (owner 2026-10-27: a 2,000-character Marriott posting pasted into the box was still refused as "only a
  // summary" because the saved job came from Adzuna). The text decides, not the source.
  if (src === 'adzuna') return d.length <= TEASER_MAX;
  return d.length > 0 && d.length <= PREVIEW_MAX && ELLIPSIS_RE.test(d);
}

/**
 * A teaser without its dangling tail: the trailing "…" goes, and so does the word it cut in half
 * ("…accounting fina…" → "…accounting"). Text that does not end in an ellipsis is returned as is.
 */
export function stripDanglingEllipsis(text) {
  const t = String(text || '').trim();
  if (!ELLIPSIS_RE.test(t)) return t;
  let s = t.replace(ELLIPSIS_RE, '').trimEnd();
  // The last token is a cut word unless the text ended cleanly (punctuation) before the ellipsis.
  if (/[A-Za-z0-9]$/.test(s)) s = s.replace(/\s*\S+$/, '');
  return s.trim();
}

/** The stored text was cut at the ingest cap mid-sentence (no terminal punctuation near the cap). */
export function endsCutOff(text) {
  const t = String(text || '').trimEnd();
  if (t.length < LEGACY_CAP - 200) return false;
  if (t.length > LEGACY_CAP + 200 && t.length < DESCRIPTION_CAP - 200) return false;
  return !/[.!?)"”'’]$/.test(t);
}

/**
 * Cap a description at a sentence end at or before `cap` characters (the last ". " / "! " / "? "
 * boundary), never mid-word; falls back to the last word boundary when no sentence ends in the
 * last 1,500 chars.
 */
export function capAtSentence(text, cap = DESCRIPTION_CAP) {
  const t = String(text || '');
  if (t.length <= cap) return t;
  const head = t.slice(0, cap);
  let cut = -1;
  const re = /[.!?]["”’)]?(?=\s)/g;
  let mm;
  while ((mm = re.exec(head)) !== null) cut = mm.index + mm[0].length;
  if (cut >= cap - 1500) return head.slice(0, cut).trimEnd();
  const ws = head.lastIndexOf(' ');
  return (ws > cap - 200 ? head.slice(0, ws) : head).trimEnd();
}

// ── Paragraphs ─────────────────────────────────────────────────────────────────────────────────
// Headings postings use, in the casing they use. An ALL-CAPS run of two or more words ("CONSTRUCTION
// SAFETY ENGINEER", "ITAR REQUIREMENTS:"), a single ALL-CAPS word with a colon ("RESPONSIBILITIES:"),
// or a Title-case section word followed by a colon or standing before a capitalised sentence.
const CAPS_WORD = '(?:[A-Z][A-Z0-9&/.\'’-]{1,}|[A-Z]{2,})';
// A run may carry commas and parenthesised qualifiers: "ACCOUNT LEAD, STARLINK STRATEGIC CONNECTIVITY (AVIATION)".
const CAPS_RUN_RE = new RegExp(`(?:^|(?<=[\\s.;:!?)]))((?:${CAPS_WORD},?(?:\\s+(?:${CAPS_WORD},?|\\([A-Z0-9 ,&/-]+\\)|[&/-])){1,9})|[A-Z][A-Z0-9]{3,}:)`, 'g');
const SECTION_WORDS = '(?:Responsibilities|Requirements|Qualifications|Basic Qualifications|Preferred (?:Skills|Qualifications|Experience)|Minimum Qualifications|Required (?:Skills|Qualifications|Experience)|Nice to Have|What You\'?ll Do|What You Will Do|What You\'?ll Bring|What We Offer|What We\'?re Looking For|Who You Are|About (?:the|this) Role|About the Team|About Us|About the Company|The Role|Your Role|Role Overview|Job Summary|Position Summary|Overview|Summary|Benefits|Compensation(?: and Benefits)?|Perks|Education|Experience|Skills|Duties|Key Duties|Essential Functions|Physical (?:Requirements|Demands)|Working Conditions|Schedule|Pay|Salary|Location|ITAR(?: Requirements)?|Additional Requirements|Additional Information|How to Apply|Equal Opportunity(?: Employer)?|EEO Statement)';
const SECTION_RE = new RegExp(`(?:^|(?<=[\\s.;!?)]))(${SECTION_WORDS})(?=\\s*:|\\s+[A-Z•\\-–])`, 'g');
// A bullet mark that starts an item: •, ●, ▪, or "- " / "– " after a sentence end.
const BULLET_RE = /(?:(?<=[.!?:;])\s+|^)([•●▪◦]\s*|[-–]\s+(?=[A-Z]))/g;
const TARGET_PARA = 400;

/**
 * Paragraphs for a stored description. Real newlines win when the row has them (ingest keeps them
 * since 2026-10-24); the 76k older rows stored as one line are split at the headings and bullets
 * postings carry, and any remaining long block is grouped into ~400-character paragraphs at
 * sentence ends. A leading "Category: …" tag is dropped. Never empty for non-trivial text.
 * @param {string} text
 * @returns {string[]}
 */
export function paragraphs(text) {
  const t0 = String(text || '').replace(/^Category\s*:\s*[^\n.]+\s*/i, '').trim();
  if (t0.length < 10) return t0 ? [t0] : [];
  if (/\n/.test(t0)) {
    return t0.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  }
  // headings run into a flat posting ("… safely. What you'll do Design and build …") start a block
  let t = cutInlineHeadings(t0, { keepColon: true })
    .replace(CAPS_RUN_RE, (m, run) => `\n${run}\n`)
    .replace(SECTION_RE, (m, w) => `\n${w}`)
    .replace(BULLET_RE, (m, mark) => `\n${mark}`);
  const blocks = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  // Re-attach a heading's colon and merge a heading line that is immediately followed by its
  // first sentence only when the split left a dangling ":".
  const merged = [];
  for (const b of blocks) {
    // a heading's first word cut away from the rest ("Key" | "Responsibilities") rejoins it
    if (merged.length && /^(?:Key|Minimum|Basic|Preferred|Required|Additional|Core|Job)$/.test(merged[merged.length - 1])) { merged[merged.length - 1] += ` ${b}`; continue; }
    if (b === ':' && merged.length) { merged[merged.length - 1] += ':'; continue; }
    if (/^:\s*\S/.test(b) && merged.length) { merged[merged.length - 1] += ':'; merged.push(b.replace(/^:\s*/, '')); continue; }
    merged.push(b);
  }
  const out = [];
  for (const b of merged) {
    if (b.length <= TARGET_PARA * 1.6) { out.push(b); continue; }
    // Group sentences into ~TARGET_PARA chunks.
    // ONE splitter (lib/text/sentences.js): the old match regex SKIPPED every run it could not match,
    // so "… event-driven (e.g. Kafka/CDC) …" lost 1,000 characters and read "safely. g. Kafka/CDC)"
    const sentences = splitSentences(b).flatMap((x) => splitRunOn(x));
    let cur = '';
    for (const s of sentences) {
      if (cur && cur.length + s.length > TARGET_PARA) { out.push(cur.trim()); cur = ''; }
      cur += (cur ? ' ' : '') + s;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

// ── Card snippet ───────────────────────────────────────────────────────────────────────────────
const BOILERPLATE_RE = /\b(?:was founded|our mission|we believe|is a leading|is the leading|is a global|is an? (?:[\w-]+ )?(?:company|leader|provider|pioneer)|about us|who we are|join us|we are (?:a|an|the)\b|headquartered in|is actively developing|with the ultimate goal)/i;

// The employer's name words — a board slug read through lib/jobs/companyName.js first, so "aloyoga"
// recognises "…what we do at ALO" as a sentence about the company.
function companyTokens(company) {
  const raw = String(company || '').trim();
  const words = looksLikeSlug(raw) ? splitSlugWords(raw) : raw.toLowerCase().split(/[^a-z0-9]+/);
  return words.map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !/^(?:inc|llc|the|and|corp|group|company)$/.test(w));
}

function sentencesOf(text) {
  return splitSentences(text);
}

function cutAtWord(s, max) {
  const t = s.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const ws = head.lastIndexOf(' ');
  return `${(ws > max * 0.6 ? head.slice(0, ws) : head).replace(/[,;:\-–—]$/, '').trim()}…`;
}

/**
 * The first thing the posting says about the ROLE, for a card (≤ `max` chars, cut at a word, one
 * "…"). Leading sentences that are about the company — they name it, or read as boilerplate ("was
 * founded", "our mission") — are skipped; an ALL-CAPS heading (often the title) at the start of the
 * chosen sentence is dropped; a teaser's dangling tail is removed first. Falls back to the first
 * heading marker, then to the start of the text — never to nothing when there is text.
 * @param {string} description
 * @param {string} company
 * @param {string} title
 * @param {number} [max=160]
 */
export function roleSnippet(description, company, title, max = 160) {
  const raw = stripDanglingEllipsis(description);
  if (!raw) return '';
  const paras = paragraphs(raw);
  const flat = paras.join(' ');
  const tokens = companyTokens(company);
  const aboutCompany = (s) => {
    const l = s.toLowerCase();
    return tokens.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l)) || BOILERPLATE_RE.test(s);
  };
  // Split sentences but keep a heading glued to the sentence that follows it.
  const sentences = sentencesOf(flat);
  let start = -1;
  for (let i = 0; i < sentences.length && i < 12; i++) {
    const s = sentences[i];
    const body = stripLeadingHeading(s, title);
    if (body.length < 25) continue; // a bare heading, a label
    if (aboutCompany(body) && i < 6) continue;
    start = i;
    break;
  }
  let picked = start >= 0 ? stripLeadingHeading(sentences[start], title) : '';
  if (!picked) {
    // Fall back to the first heading marker in the text, else the start.
    const heads = [...flat.matchAll(CAPS_RUN_RE)];
    const h = heads.find((m) => m.index > 0);
    picked = stripLeadingHeading(h ? flat.slice(h.index) : flat, title);
    if (!picked) picked = flat;
  }
  // Keep adding sentences until there is enough for the card.
  if (start >= 0) {
    let i = start + 1;
    while (picked.length < max && i < sentences.length) { picked = `${picked} ${sentences[i]}`; i++; }
  }
  return cutAtWord(picked.replace(/\s+/g, ' '), max);
}

// Drop an ALL-CAPS heading (or the job title in any case) from the start of a sentence:
// "CONSTRUCTION SAFETY ENGINEER As part of a team…" → "As part of a team…";
// "SR. ACCOUNTANT (LATAM) RESPONSIBILITIES: Support Latin…" → "Support Latin…".
function stripLeadingHeading(s, title) {
  let t = String(s || '').trim();
  const tl = String(title || '').trim();
  if (tl && t.toLowerCase().startsWith(tl.toLowerCase())) t = t.slice(tl.length).replace(/^[\s:,–—-]+/, '');
  for (let guard = 0; guard < 4; guard++) {
    const m = t.match(new RegExp(`^((?:${CAPS_WORD},?|\\([A-Z0-9 ,&/-]+\\)|[&/-])(?:\\s+(?:${CAPS_WORD},?|\\([A-Z0-9 ,&/-]+\\)|[&/-]))*)\\s*:?\\s+(?=\\S)`));
    if (!m || m[1].length < 3) break;
    // Do not strip a short all-caps word that is part of a real sentence ("US citizens may…").
    if (!/\s/.test(m[1]) && !/:\s*$/.test(m[0]) && m[1].length <= 4) break;
    t = t.slice(m[0].length);
  }
  return t.trim();
}
