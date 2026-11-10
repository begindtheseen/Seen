// A pasted posting, cleaned of the way it was copied — before any section or requirement is read.
//
// 2026-11-08 paste stress (scripts/optimizer-paste-stress.mjs, 144 real postings × 7 copy formats): flat
// text, PDF line wraps, LinkedIn copies, odd bullets and numbered lists already read the same requirements;
// a markdown copy ("## Requirements", "**Must have**") lost a third of its requirements on 19 postings and an
// email forward ("> " on every line, a From/Subject header) on 24 — 12 flipped to "no requirements".
// This removes only the copying: quote marks, markdown markup, email headers and board UI lines. It never
// changes a word of the posting.

import { escapeRegExp } from '../text/escapeRegExp.js';

const UI_LINE_RE = /^(?:about the job|…?\s*show (?:more|less)|see (?:more|less)|see how you compare.*|try premium.*|apply(?: now)?|easy apply|save(?: job)?|saved|set alert.*|report (?:this )?job|share|follow|job details|full job description|profile insights|indeed'?s salary guide.*|skills and qualifications fit|people you can reach out to|meet the hiring team|message|show all.*|about the company|company photos|more jobs.*|similar jobs.*|\d[\d,]* applicants?|\d+ (?:days?|hours?|weeks?) ago.*|promoted|actively recruiting|responses managed off linkedin|over \d+ applicants)$/i;
const EMAIL_HEADER_RE = /^(?:-{3,}\s*forwarded message\s*-{3,}|from:\s.*|to:\s.*|cc:\s.*|date:\s.*|sent:\s.*|subject:\s.*)$/i;

// HTML entities left in stored posting text ("&mdash;", "&amp;", "&#8217;") — decoded once, in ONE pass, here at the
// reader's entry point (never chained replaces: "&amp;lt;" must become "&lt;", not "<").
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°', frac12: '½', eacute: 'é', ntilde: 'ñ', rarr: '→', shy: '' };
export function decodeEntities(text) {
  return String(text || '').replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});/gi, (m0, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m0;
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v === undefined ? m0 : v;
  });
}
export function cleanPastedPosting(text) {
  let t = decodeEntities(String(text || '')).replace(/\r\n?/g, '\n');
  const lines = t.split('\n');
  // an email quote: most non-empty lines start with ">"
  const nonEmpty = lines.filter((l) => l.trim());
  const quoted = nonEmpty.filter((l) => /^\s*>/.test(l)).length;
  if (nonEmpty.length >= 4 && quoted / nonEmpty.length >= 0.5) t = lines.map((l) => l.replace(/^\s*(?:>\s?)+/, '')).join('\n');
  t = t
    .split('\n')
    .filter((l) => !EMAIL_HEADER_RE.test(l.trim()) && !UI_LINE_RE.test(l.trim()))
    .map((l) => l
      .replace(/^\s{0,3}#{1,6}\s+/, '')            // markdown heading
      .replace(/^\s*[-*+]\s+(?=\S)/, '• ')          // markdown bullet
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')          // bold
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?]|$)/g, '$1$2')   // italic
      .replace(/\[([^\]\n]+)\]\((?:https?:)?[^)\s]+\)/g, '$1')) // markdown link → its text
    .join('\n');
  t = normalizeBullets(t);
  t = splitInlineBullets(t);
  return reflowHardWraps(t);
}

const HEADING_HEAD = "(?:What (?:You|We)|Who (?:You|We)|Why (?:You|Join|Us|Work)|About (?:You|Us|the|This)|Your (?:Impact|Role|Day|Responsibilities)|The (?:Role|Opportunity|Team)|Requirements|Qualifications|Minimum Qualifications|Preferred Qualifications|Basic Qualifications|Responsibilities|Key Responsibilities|Duties|Essential (?:Duties|Functions)|Skills|Nice to Have|Bonus Points|Benefits|Perks|Compensation|Pay|Salary|Education|Experience|Physical Requirements|Working Conditions|Job (?:Summary|Description|Duties)|Position (?:Summary|Overview)|Important Notes|Base Pay Range)";

// A posting copied as one line keeps its bullet glyphs inline ("What You Bring • 6+ years … • Experience
// with SQL…"): each glyph starts a line again, and the words before the first one end their own line.
function splitInlineBullets(t) {
  const newlines = (t.match(/\n/g) || []).length;
  const inline = (t.match(/\s[•▪◦‣●]\s/g) || []).length;
  if (inline < 3 || newlines > inline) return t;
  const lines = t.replace(/\s+([•▪◦‣●])\s+/g, '\n$1 ').split('\n');
  // the heading that opened a bullet run sits at the end of the line before it: "…our offices. What You Bring"
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1] || '';
    let m = null;
    if (/^[•▪◦‣●]\s/.test(next)) {
      // after a sentence end, any short Title-Case phrase; after a bare word (the last bullet ran into it),
      // only a phrase that is a posting heading ("What You Bring", "Benefits that Benefit You", "Requirements")
      m = (!/^[•▪◦‣●]\s/.test(lines[i]) && lines[i].match(/^(.*[.!?:)])\s+([A-Z][\w’'&/-]*(?:\s+[A-Z][\w’'&/-]*){0,5})\s*$/))
        || lines[i].match(new RegExp(`^(.*\\S)\\s+(${HEADING_HEAD}(?:\\s+[\\w’'&/-]+){0,4})$`));
    }
    if (m) out.push(m[1], m[2].trim()); else out.push(lines[i]);
  }
  return out.join('\n');
}

// "o Item", "➢ Item", "✓ Item", "– Item", "▪ Item" (Word / PDF / Outlook bullets) → "• Item", when the
// glyph opens at least two lines (one "o" at a line start is a word).
function normalizeBullets(t) {
  const lines = t.split('\n');
  const glyphs = ['o', '➢', '✓', '✔', '–', '▪', '◦', '■', '□', '►', '▶', '→', '⁃', '∙', '●', '○'];
  for (const g of glyphs) {
    const re = new RegExp(`^\\s*${escapeRegExp(g)}\\s+(?=\\S)`);
    if (lines.filter((l) => re.test(l)).length >= 2) for (let i = 0; i < lines.length; i++) lines[i] = lines[i].replace(re, '• ');
  }
  return lines.join('\n');
}

// A PDF / plain-text email breaks every line near the same width, mid-sentence. When most long lines end
// without punctuation inside a tight width band, a line is joined to the next unless it ends a sentence or a
// heading, or the next line opens a bullet.
function reflowHardWraps(t) {
  const lines = t.split('\n');
  const long = lines.filter((l) => l.trim().length >= 40);
  if (long.length < 6) return t;
  const lens = long.map((l) => l.length).sort((a, b) => a - b);
  const p80 = lens[Math.floor(lens.length * 0.8)], p20 = lens[Math.floor(lens.length * 0.2)];
  const unpunctuated = long.filter((l) => !/[.:;!?)]\s*$/.test(l)).length / long.length;
  if (!(p80 - p20 <= 22 && p80 <= 100 && unpunctuated >= 0.5)) return t;
  const out = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const prev = out[out.length - 1];
    const joinable = prev !== undefined && prev.trim().length >= p20 - 10 && !/[.:;!?]\s*$/.test(prev) && line.trim() && !/^\s*(?:•|\d+[.)]\s)/.test(line);
    if (joinable) out[out.length - 1] = `${prev} ${line.trim()}`;
    else out.push(line);
  }
  return out.join('\n');
}
