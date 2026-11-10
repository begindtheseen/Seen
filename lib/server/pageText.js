// The posting text on ANY job page — when the page has no schema.org JobPosting and no ATS API we know.
//
// 2026-11-08 resolver bench (live pages from 14 career-site systems): JSON-LD covered Paylocity, Remotive
// and some Workday pages; the rest came back as a 60–200 character meta summary, so the résumé tools got
// nothing to read. Real postings were sitting in the page in three other shapes:
//   1. a string inside the page's own script data — Next.js __NEXT_DATA__, an SPA's bootstrap JSON, Taleo's
//      api.fillList(...) call (URL-encoded HTML after a "!*!" marker);
//   2. a description container — <div class="job-description">, <section id="jobDetails">, <span
//      class="jobdescription"> (SuccessFactors career sites), <div class="content-intro"> …;
//   3. the page body itself, once navigation, header, footer, forms and scripts are gone.
// mainPostingText() tries all three and keeps the candidate that reads most like a job posting (length
// times job-section words). Pure: HTML in, text out — the caller fetched the page.

import { cleanDescription } from './jobSources.js';

// Words a job posting is made of. A candidate with none of them is a cookie banner or a site menu.
const JOB_WORD_RE = /\b(?:responsibilit\w*|requirements?|qualifications?|experience|skills?|duties|you will|you'll|what you|about the (?:role|job|position|team)|benefits|education|degree|ability to|preferred|required|must have|knowledge of|proficien\w*|license|certif\w*|schedule|shift|salary|pay range|per hour|equal opportunity)\b/gi;

const JOB_WORD_TEST = new RegExp(JOB_WORD_RE.source, 'i');
// A section a posting has and a login page, a menu or an error page does not.
const SECTION_RE = /\b(?:responsibilit\w*|qualifications?|requirements?|duties|what you(?:'ll| will) do|what you(?:'ll)? bring|about (?:the|this) (?:role|job|position|opportunity)|who you are|what we(?:'re| are) looking for|job (?:summary|description|purpose)|position (?:summary|overview)|essential functions|key (?:skills|accountabilities)|minimum qualifications|education and experience|you will|you'll)\b/i;

// A job-search results page, not one posting.
const LIST_PAGE_RE = /\b\d[\d,]* (?:jobs?|results?|openings|positions|opportunities) (?:found|matching|available)\b|\bsorted by\b|\bsaved jobs\b|\bshowing \d+ (?:of|to) \d+\b/i;
/** Lines that are a posting's section headings ("Responsibilities", "What you'll do:", "QUALIFICATIONS"). */
export function headingCount(text) {
  const heads = new Set();
  for (const raw of String(text || '').split('\n')) {
    const l = raw.replace(/^[•\s#*-]+|[:\s]+$/g, '');
    if (l.length < 4 || l.length > 60) continue;
    const m = l.match(SECTION_RE);
    if (m && m[0].length >= l.length * 0.35) heads.add(m[0].toLowerCase());
  }
  return heads.size;
}

/** How much a text reads like a job posting: job-section words, weighted by length (capped). */
export function postingScore(text) {
  const t = String(text || '');
  if (t.length < 200) return 0;
  const hits = (t.match(JOB_WORD_RE) || []).length;
  if (hits < 2) return 0;
  return hits * Math.log10(Math.min(t.length, 20000));
}

const decodeJsonString = (raw) => { try { return JSON.parse(`"${raw}"`); } catch { return ''; } };

/** Long strings inside the page's scripts that hold a posting (HTML or prose). */
export function embeddedStrings(html) {
  const page = String(html || '');
  const out = [];
  const scripts = page.match(/<script\b(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const sc of scripts) {
    const body = sc.replace(/^<script\b[^>]*>|<\/script>$/gi, '');
    if (body.length < 400) continue;
    // Taleo: api.fillList('requisitionDescriptionInterface', 'descRequisition', ['…', '!*!%3Cp%3E…'])
    for (const m of body.matchAll(/'!\*!((?:[^'\\]|\\.)*)'/g)) {
      try { out.push(decodeURIComponent(m[1].replace(/\\'/g, "'"))); } catch { /* not URL-encoded */ }
    }
    // JSON string literals ("…") long enough to be a posting
    for (const m of body.matchAll(/"((?:[^"\\]|\\.){400,})"/g)) {
      const s = decodeJsonString(m[1]);
      if (s && /\s/.test(s) && !/^(?:[A-Za-z0-9+/=]{200,}|https?:\/\/\S+)$/.test(s)) out.push(s);
    }
  }
  return out;
}

// Containers that hold a posting on hand-built and white-label career sites.
// An opening tag of a block element; its attributes are tested separately (one linear pass, no nested scans).
const OPEN_TAG_RE = /<(div|section|article|span|td|main)\b([^>]{0,600})>/gi;
const CONTAINER_ATTR_RE = /\b(?:class|id|data-automation-id|itemprop)\s*=\s*["']([^"']{0,300})["']/gi;
const CONTAINER_NAME_RE = /(?:^|[\s_-])(?:job[-_ ]?(?:description|details?|body|content|posting|info|summary|desc|ad)|jobdescription|jobdetails?|description|posting[-_ ]?(?:body|content|description)|vacancy[-_ ]?(?:description|details?)|position[-_ ]?(?:description|details?)|requisition[-_ ]?description|jd[-_ ]?(?:content|body|text)|content[-_ ]?intro|career[-_ ]?detail)(?:$|[\s_-])/i;
function isContainerTag(attrs) {
  CONTAINER_ATTR_RE.lastIndex = 0;
  let a;
  while ((a = CONTAINER_ATTR_RE.exec(attrs)) !== null) if (CONTAINER_NAME_RE.test(a[1])) return true;
  return false;
}

/** The inner HTML of the element whose opening tag ends at `from` (same-tag depth counting). */
function innerOf(page, tag, from) {
  const re = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(page)) !== null) {
    if (m[0][1] === '/') { depth--; if (depth === 0) return page.slice(from, m.index); }
    else if (!m[0].endsWith('/>')) depth++;
    if (re.lastIndex - from > 400000) break;
  }
  return page.slice(from, Math.min(page.length, from + 200000));
}

/** Text of every description-shaped container on the page. */
export function containerTexts(html) {
  const page = String(html || '');
  const out = [];
  OPEN_TAG_RE.lastIndex = 0;
  let m;
  while ((m = OPEN_TAG_RE.exec(page)) !== null && out.length < 40) {
    if (!isContainerTag(m[2])) continue;
    const inner = innerOf(page, m[1].toLowerCase(), m.index + m[0].length);
    const text = cleanDescription(stripChrome(inner));
    if (text.length >= 200) out.push(text);
  }
  return out;
}

// Elements that are never the posting.
function stripChrome(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|button|select|textarea|form|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:input|img|link|meta)\b[^>]*>/gi, ' ');
}

/** The page body as text, cut to the stretch that reads like a posting. */
export function bodyText(html) {
  const page = String(html || '');
  const body = (page.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [null, page])[1];
  const text = cleanDescription(stripChrome(body));
  const lines = text.split('\n');
  // drop the menu-shaped lines (very short, no sentence) at the two ends
  const isProse = (l) => l.length >= 60 || /[.:;]$/.test(l) || /^•/.test(l) || JOB_WORD_TEST.test(l);
  let a = 0, b = lines.length - 1;
  while (a < b && !isProse(lines[a])) a++;
  while (b > a && !isProse(lines[b])) b--;
  return lines.slice(a, b + 1).join('\n').trim();
}

/**
 * The best posting text on a page, or '' when nothing reads like one.
 * @param {string} html
 * @returns {{ text: string, via: 'embedded'|'container'|'body'|null }}
 */
export function mainPostingText(html) {
  const cands = [];
  for (const s of embeddedStrings(html)) cands.push({ text: cleanDescription(/<[a-z][^>]*>/i.test(s) ? s : s.replace(/\\n/g, '\n')), via: 'embedded' });
  for (const t of containerTexts(html)) cands.push({ text: t, via: 'container' });
  const b = bodyText(html);
  if (b) cands.push({ text: b, via: 'body' });
  let best = { text: '', via: null, score: 0 };
  for (const c of cands) {
    // the whole body or a guessed container must show a posting's sections (a sign-in page has job words too);
    // the whole body is the last resort: it must clearly beat a focused candidate
    const heads = headingCount(c.text);
    if (c.via === 'body' && (heads < 2 || LIST_PAGE_RE.test(c.text))) continue;
    if (c.via === 'container' && heads < 1 && (c.text.match(new RegExp(SECTION_RE.source, 'gi')) || []).length < 2) continue;
    if (c.via === 'embedded' && ((!SECTION_RE.test(c.text) && c.text.length < 1200) || LIST_PAGE_RE.test(c.text))) continue;
    const score = postingScore(c.text) * (c.via === 'body' ? 0.7 : 1);
    if (score > best.score) best = { ...c, score };
  }
  return { text: best.text, via: best.via };
}

// A page that says the job is gone ("This job is no longer available", "Job Not Found", "position has been filled").
// "Open until the position is filled" is an OPEN posting (a live UniFirst ad said exactly that — liveness round 2):
// a closed phrase right after until/till/once/before/when/unless/if is never a closed page.
export const CLOSED_PAGE_RE = /\b(?<!\b(?:until|till|once|before|when|unless|if|after)\s+(?:(?:the|this)\s+)?)(?:(?:this |the )?(?:job|position|posting|opening|requisition|vacancy)(?: you(?:'re| are) looking for)? (?:is|has been|was) (?:no longer (?:available|active|open|accepting)|closed|filled|removed|expired)|job not found|position not found|no longer accepting applications|this (?:job|posting) has expired|page not found|the job you are trying to (?:view|apply) is (?:no longer|not) available|job (?:is )?(?:closed|expired))\b/i;
