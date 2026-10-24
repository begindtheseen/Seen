// Text rules for a quoted account: what can never be a first-hand applicant account (links, markdown,
// bot boilerplate), how a stored attribution suffix is separated from the words, and how an excerpt is
// cut so it never ends mid-word.
//
// Owner's rule (2026-10-24, /company/spacex showed a Reddit AutoModerator comment — "Hello /u/…! Thank
// you for posting in r/EngineeringStudents. Please remember to: Read our [Rules](https://…)… *I am a bot,
// and this action was performed automatically.*" — as a "Mixed" applicant report): "links in the reviews
// should not let them go through." Enforced in ONE place, lib/reports/applicantRules.js, which every
// collector (archive / OpenCLI / Google), the ingest re-check, admin moderation and the feed / ticker /
// company-page display filters already call. Pure, dependency-free.

// Seen's own attribution, appended by the pipelines — the ONLY link a stored excerpt may carry:
//   "<words> [Source: <url>]"  ·  "<words> [Public <host> post, posted <date>: <url>]"
//   and the bracket-less "Source: <url>" / "(Source: <url>)" variants some imports wrote.
const ATTRIBUTION_SUFFIX = /\s*\[(?:Source|Public [^\]]*? post)[^\]]*\]\s*$/i;
const BARE_ATTRIBUTION = /\s*\(?\s*Source:\s*https?:\/\/[^\s)\]]+\s*\)?\s*$/i;
// A cap cut an attribution open ("[Public reddit.com post, posted 2025-" …) — drop the fragment too.
const OPEN_ATTRIBUTION = /\s*\[(?:Source|Public [^\]]*? post)[^\]]*$/i;

/** The words of a stored excerpt without Seen's trailing attribution (complete, bracket-less or cut). */
export function stripAttribution(text) {
  return String(text ?? '').replace(ATTRIBUTION_SUFFIX, '').replace(BARE_ATTRIBUTION, '').replace(OPEN_ATTRIBUTION, '').trim();
}

const URL_RE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}|\breddit\.com\/|\bredd\.it\/|\b[a-z0-9-]+\.(?:com|org|net|io|gov|edu|co\.uk)\/[^\s]*/i;
const MARKDOWN_LINK_RE = /\[[^\]\n]{1,200}\]\([^)\s]{1,500}\)/;
const BOT_RE = /\b(?:i am a bot|i'm a bot|automoderator|auto-?mod(?:erator)?\b|this action was performed automatically|contact the moderators|please remember to:|read our \[?(?:rules|wiki|faq)\]?|thank you for posting in r\/|your post (?:has been|was) (?:removed|approved)|this (?:post|comment|submission) (?:has been|was) (?:removed|locked)|^\s*hello \/u\/)/i;

/**
 * True when the text can never be a first-hand applicant account: it carries a URL (any form), a
 * markdown link, or moderator-bot boilerplate. Seen's own attribution suffix is NOT counted (it is
 * stripped first) — the rule is about links in the person's words.
 */
export function looksLikeBotOrLinkText(text) {
  const words = stripAttribution(text);
  if (!words) return false;
  return URL_RE.test(words) || MARKDOWN_LINK_RE.test(words) || BOT_RE.test(words);
}

// HTML entities a source page left in a quote (prod 2026-10-24: 2 web_reviews quotes). ONE pass over a
// closed map — never chained replaces (a first "&amp;" → "&" pass re-creates entities from already-
// escaped text; CodeQL double-unescape class, see lib/jobs/atsProviders.js decodeEntities).
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', ndash: '–', '#39': "'", '#039': "'", '#x27': "'", '#34': '"', '#38': '&', '#x26': '&', '#160': ' ' };
export function decodeEntitiesOnce(text) {
  return String(text ?? '').replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|ldquo|rdquo|hellip|mdash|ndash|#39|#039|#x27|#34|#38|#x26|#160);/gi, (m, name) => ENTITY[String(name).toLowerCase()] ?? m);
}

const DANGLING_QUOTE = /[\s"“”'‘’«»*_(\[,;:—–-]+$/;

/**
 * Cut text to at most `max` characters at a sentence end (the last . ! ? … before the cap), else at a
 * word boundary — never mid-word — and never ending on a dangling quote mark, bracket or dash. Text
 * already within the cap is returned trimmed and unchanged. An ellipsis marks a cut that is not at a
 * sentence end.
 */
export function trimToSentence(text, max = 500) {
  const s = decodeEntitiesOnce(text).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  // Prefer the last sentence end that keeps at least a third of the budget.
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('… '), head.lastIndexOf('." '), head.lastIndexOf('.” '));
  if (sentenceEnd >= max / 3) {
    const endChar = head[sentenceEnd + 1] === '"' || head[sentenceEnd + 1] === '”' ? sentenceEnd + 2 : sentenceEnd + 1;
    return head.slice(0, endChar).trim();
  }
  const wordEnd = head.lastIndexOf(' ');
  const cut = (wordEnd > 0 ? head.slice(0, wordEnd) : head).replace(DANGLING_QUOTE, '').trim();
  return cut ? `${cut}…` : '';
}
