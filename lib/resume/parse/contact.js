// Contact block: name, headline, email, phone, location, links — and an unlabeled summary
// paragraph when the top of the résumé carries one before any section header.

import { EMAIL_RE, PHONE_RE, URL_RE, LINKEDIN_RE, GITHUB_RE, LOCATION_RE, LOCATION_INLINE_RE, TITLE_WORD_RE, HEADER_VOCAB } from './lexicon.js';
import { findDateRange } from './dates.js';
import { inferLinkKind, hostIs } from '../model.js';

const NAME_STOP = /\b(at|the|and|with|for|of|in|on|to|was|is|were|are|worked|seeking|resume|résumé|cv|curriculum|vitae|profile|experienced|skilled|summary|objective|contact|address|phone|email|mobile|cell|tel)\b/i;
const PARTICLES = new Set(['de', 'van', 'von', 'der', 'den', 'da', 'di', 'la', 'le', 'del', 'della', 'bin', 'al', 'el', 'du', 'des', 'mac', 'mc', 'st', 'y']);
// Post-nominal credentials after the name: ", PMP", ", RN, BSN", ", Ph.D.", ", Jr.". The token
// alternatives are disjoint at their first character and repetitions need a real separator, so
// the match is linear (no backtracking blow-up on runs like ",IIIII").
const CRED_TOKEN = String.raw`(?:[A-Z]{2,5}(?:\.[A-Z]\.)?|Ph\.?D\.?|M\.D\.?|Esq\.?|Jr\.?|Sr\.?)`;
const CREDENTIAL_SUFFIX_RE = new RegExp(String.raw`,\s*${CRED_TOKEN}(?:,?\s+${CRED_TOKEN})*\s*$`);

export function looksLikeName(text) {
  const t = String(text || '').replace(/[•|·]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /[\d@/:]/.test(t)) return false;
  const base = t.replace(CREDENTIAL_SUFFIX_RE, '').trim();
  const words = base.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (NAME_STOP.test(base)) return false;
  if (TITLE_WORD_RE.test(base) && !/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(base)) return false; // "Senior Engineer" is not a name
  return words.every((w) => {
    const bare = w.replace(/[^A-Za-z.'’-]/g, '');
    if (!bare) return false;
    if (PARTICLES.has(bare.toLowerCase())) return true;
    return /^[A-Z]/.test(bare);
  });
}

function toTitleCaseName(name) {
  // "MARIA GONZALEZ" → "Maria Gonzalez" (keeps "McDonald", "O'Brien", "de la Cruz" sensible enough).
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
}

function looksLikeHeadline(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 90) return false;
  if (/[@]|https?:|www\./i.test(t)) return false;
  if (findDateRange(t)) return false;
  const words = t.split(/\s+/).length;
  if (words > 12) return false;
  if (HEADER_VOCAB.has(t.toLowerCase())) return false;
  // "Senior Software Engineer" · "Registered Nurse | BSN" · "Warehouse Operations Lead" · "Marketing & Growth"
  return TITLE_WORD_RE.test(t) || /\|/.test(t) || (words <= 4 && /^[A-Z]/.test(t) && !/[.!?]$/.test(t));
}

export function extractContactLinks(text) {
  const links = [];
  const seen = new Set();
  const push = (url, kind) => {
    const clean = String(url || '').replace(/[),.;]+$/, '').trim();
    if (!clean) return;
    const key = clean.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ kind: kind || inferLinkKind(clean), url: clean, label: '' });
  };
  let m;
  const li = new RegExp(LINKEDIN_RE.source, 'gi');
  while ((m = li.exec(text))) push(m[0], 'linkedin');
  const gh = new RegExp(GITHUB_RE.source, 'gi');
  while ((m = gh.exec(text))) push(m[0], 'github');
  const ur = new RegExp(URL_RE.source, 'gi');
  while ((m = ur.exec(text))) {
    const u = m[0];
    if (EMAIL_RE.test(u) || /@/.test(text.slice(Math.max(0, m.index - 1), m.index + u.length + 1))) continue;
    if (hostIs(u, 'linkedin.com') || hostIs(u, 'github.com')) continue;
    push(u);
  }
  return links;
}

/**
 * @param {object[]} headerLines  lines before the first section header
 * @param {object[]} contactLines lines from an explicit CONTACT section (may be empty)
 * @param {string} fullText       whole résumé text (fallback scan for email/phone/links)
 * @param {object} stats
 */
export function extractContact(headerLines, contactLines, fullText, stats) {
  const basics = { name: '', headline: '', email: '', phone: '', location: '', links: [], summary: '' };
  const consumed = new Set();
  const top = [...headerLines, ...contactLines];
  const topText = top.map((l) => l.text).join('\n');
  const scan = topText + '\n' + String(fullText || '');

  const em = scan.match(EMAIL_RE);
  if (em) basics.email = em[0];
  basics.links = extractContactLinks(topText).concat(extractContactLinks(fullText || '').filter((l) => l.kind !== 'portfolio' || !basics.email || !l.url.includes(basics.email.split('@')[1])))
    .filter((l, i, arr) => arr.findIndex((o) => o.url.toLowerCase() === l.url.toLowerCase()) === i)
    .slice(0, 4);
  // Phone: a real 10–15 digit number, never a date range or a zip.
  for (const src of [topText, fullText || '']) {
    const re = new RegExp(PHONE_RE.source, 'g');
    let m;
    while ((m = re.exec(src))) {
      const digits = m[0].replace(/\D/g, '');
      // Not a date range and not two years glued together ("2019 2021").
      if (digits.length >= 10 && digits.length <= 15 && !findDateRange(m[0]) && !/^(?:19|20)\d{2}\s*[-–—/]?\s*(?:19|20)\d{2}$/.test(m[0].trim())) {
        basics.phone = m[0].trim().replace(/\s{2,}/g, ' ');
        break;
      }
    }
    if (basics.phone) break;
  }

  // Name: the largest-font line at the top that reads like a name; else the first such line.
  const nameCands = top.slice(0, 8).filter((l) => looksLikeName(l.text) && !l.bullet);
  let nameLine = null;
  if (nameCands.length) {
    nameLine = stats.hasGeometry ? [...nameCands].sort((a, b) => b.size - a.size || top.indexOf(a) - top.indexOf(b))[0] : nameCands[0];
    const credentials = (nameLine.text.match(CREDENTIAL_SUFFIX_RE) || [''])[0].replace(/^,\s*/, '').trim();
    basics.name = toTitleCaseName(nameLine.text.replace(/[•|·]/g, ' ').replace(CREDENTIAL_SUFFIX_RE, '').replace(/\s+/g, ' ').trim());
    if (credentials) basics.headline = credentials;
    consumed.add(nameLine);
  }

  // Location: a "City, ST" fragment in the top lines (not the name line, not inside a URL).
  for (const l of top.slice(0, 10)) {
    if (l === nameLine) continue;
    const t = l.text;
    if (LOCATION_RE.test(t)) { basics.location = t.replace(/\.$/, ''); consumed.add(l); break; }
    const inline = t.match(LOCATION_INLINE_RE);
    if (inline && !/linkedin|github|@|\.com/i.test(inline[0])) { basics.location = inline[0].trim(); break; }
  }

  // Which top lines are pure contact lines (email/phone/links/location/labels)? A line that
  // carries contact info AND a short title ("Product Designer · Chicago · email") yields the
  // title as the headline.
  const contactResidue = (l) => {
    let t = l.text;
    t = t.replace(EMAIL_RE, ' ').replace(new RegExp(PHONE_RE.source, 'g'), ' ').replace(new RegExp(URL_RE.source, 'gi'), ' ')
      .replace(LOCATION_INLINE_RE, ' ').replace(/\b(phone|mobile|cell|tel|email|e-mail|address|linkedin|github|portfolio|website|web|location)\b\s*[:：]?/gi, ' ')
      // A work-location qualifier beside the city ("Austin, TX (open to remote)") is contact data.
      .replace(/\b(?:open to (?:remote|relocation|relocating|hybrid)(?: work)?|willing to relocate|relocating|remote[- ]friendly)\b/gi, ' ')
      .replace(/[|•·,;:()\s-]+/g, ' ').trim();
    return t;
  };
  const isContactLine = (l) => {
    if (LOCATION_RE.test(l.text)) return true;
    const t = contactResidue(l);
    return t.length <= 3 || /^[A-Z]{2}\s*\d{5}$/.test(t);
  };
  for (const l of top) {
    if (isContactLine(l)) { consumed.add(l); continue; }
    // Mixed line: contact info + a title → headline from the residue.
    if ((EMAIL_RE.test(l.text) || PHONE_RE.test(l.text)) && !basics.headline) {
      const residue = contactResidue(l);
      if (residue && looksLikeHeadline(residue) && residue.split(/\s+/).length <= 6) { basics.headline = residue; consumed.add(l); }
    }
  }

  // Headline: the first non-consumed short title-like line within 3 lines of the name.
  const nameIdx = nameLine ? top.indexOf(nameLine) : -1;
  for (const l of top.slice(Math.max(0, nameIdx), nameIdx + 4)) {
    if (consumed.has(l) || l === nameLine) continue;
    if (looksLikeHeadline(l.text)) {
      basics.headline = basics.headline ? `${l.text} · ${basics.headline}` : l.text;
      consumed.add(l);
      break;
    }
  }

  // Summary: leftover prose in the header block (≥ 12 words, no dates) becomes the summary.
  const leftover = headerLines.filter((l) => !consumed.has(l));
  const prose = [];
  const remaining = [];
  for (const l of leftover) {
    const words = l.text.split(/\s+/).length;
    if (words >= 12 && !findDateRange(l.text) && !l.bullet && !TITLE_WORD_RE.test(l.text.slice(0, 40)) || (prose.length && words >= 6 && !findDateRange(l.text) && !l.bullet && l.gapAbove <= 1.5)) {
      prose.push(l.text); consumed.add(l);
    } else remaining.push(l);
  }
  if (prose.length) basics.summary = prose.join('\n');

  return { basics, consumed, remaining };
}
