// Parse a pasted job-listing blob into fields — client-side "smart paste".
//
// When a site hard-blocks server-side extraction (Indeed's Cloudflare blocks every
// serverless fetch), the user copies the whole listing off the page and pastes it. Rather
// than make them hand-type title/company/location/description as four separate fields,
// this splits ONE paste into those fields, which the import modal shows pre-filled and
// fully editable. Best-effort by design: a wrong guess is a one-tap fix, never a dead end.
//
// Dependency-free and framework-free so it's safe to import into the client bundle AND
// unit-test directly under node. No server code, no secrets, no fetch.

// Indeed/board chrome that shows up in a copy but isn't listing content.
const NOISE_LINE = /^(apply now|easily apply|apply on company site|save( job)?|saved|report( job)?|share|show more|show less|full job description|job details|benefits pulled from the full job description|profile insights|find out how your skills align|here.?s how the job details align|\d+\+? days? ago|posted\b.*|active \d.*|hiring \d.*|urgently hiring|be an early applicant|responded to \d.*|view all jobs|see how you match|·|—|–|-|•|\*)$/i;
const RATING_LINE = /^[\d.]+\s*(★|out of 5 stars|\(\s*[\d,]+\s*reviews?\s*\))/i;
const LOC_RE = /(\b[A-Za-z.\-' ]+,\s*[A-Z]{2}\b(\s*\d{5})?)|(\bremote\b)|(\bhybrid\b)|(\bon-?site\b)/i;
const SALARY_HINT = /\$\s?[\d,]+/;
const SALARY_RE = /\$\s?[\d,]+(\.\d+)?\s*(-|–|to)?\s*\$?[\d,]*\s*(an?\s*hour|\/\s*hour|hourly|per hour|a\s*year|\/\s*year|yearly|annually|per year|k\b)?/i;
const DESC_MARKER = /\b(full job description|job description|about the (job|role|position|team|company)|what you.?ll do|responsibilities|role overview|position summary|who we are|the opportunity|job summary)\b/i;

const norm = (l) => l.replace(/[ \t]+/g, ' ').trim();
const isUrl = (l) => /^https?:\/\/\S+$/i.test(l) || /^www\.\S+\S$/i.test(l);
const isChrome = (l) => !l || isUrl(l) || NOISE_LINE.test(l) || RATING_LINE.test(l);
// A "header token" is short and label-like; a real description sentence is long / punctuated.
const looksLikeBody = (l) => l.length > 60 || /[.!?:](\s|$)/.test(l.replace(/,\s*[A-Z]{2}\b/, ''));

// Split a line on strong inline separators Indeed uses ("Company · Location · $Pay"),
// but NOT on hyphens (titles contain them). Returns trimmed non-empty tokens.
const splitTokens = (l) => l.split(/\s*[·•|]\s*/).map(norm).filter(Boolean);

function headerTokens(block) {
  const out = [];
  for (const raw of String(block || '').replace(/\r/g, '').split('\n')) {
    const l = norm(raw);
    if (isChrome(l)) continue;
    for (const tok of splitTokens(l)) if (!isChrome(tok)) out.push(tok);
  }
  return out;
}

// Clean the description body: drop url-only and chrome lines, collapse blank runs, keep paragraphs.
function cleanBody(block) {
  const kept = String(block || '').replace(/\r/g, '').split('\n')
    .map(norm)
    .filter(l => !isUrl(l) && !RATING_LINE.test(l) && !/^(apply now|easily apply|save|report job|share)$/i.test(l));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);
}

export function parsePastedListing(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const out = { title: '', company: '', location: '', salary: null, description: '' };
  if (!text.trim()) return out;

  let header, body;
  const marker = text.match(DESC_MARKER);
  if (marker) {
    header = headerTokens(text.slice(0, marker.index));
    body = cleanBody(text.slice(marker.index + marker[0].length).replace(/^[\s:•\-]+/, ''));
  } else {
    // No marker: header = title + following short label-like tokens; description starts at
    // the first line that reads like prose.
    const toks = headerTokens(text);
    let cut = toks.length;
    for (let i = 1; i < toks.length; i++) { if (looksLikeBody(toks[i])) { cut = i; break; } }
    header = toks.slice(0, cut);
    // Body from the original text starting at the first body-like line, so paragraphs survive.
    if (cut < toks.length) {
      const firstBody = toks[cut];
      const idx = text.indexOf(firstBody);
      body = cleanBody(idx >= 0 ? text.slice(idx) : toks.slice(cut).join('\n'));
    } else {
      body = '';
    }
  }

  if (header.length) {
    out.title = header[0].slice(0, 200);
    for (let i = 1; i < header.length; i++) {
      const l = header[i];
      if (!out.salary && SALARY_HINT.test(l)) { const m = l.match(SALARY_RE); out.salary = (m ? m[0] : l).trim().slice(0, 60); continue; }
      if (!out.location && LOC_RE.test(l)) { out.location = (l.match(LOC_RE)[0] || l).slice(0, 120); continue; }
      if (!out.company && !LOC_RE.test(l) && !SALARY_HINT.test(l)) { out.company = l.slice(0, 120); continue; }
    }
    const joined = header.join(' · ');
    if (!out.location) { const m = joined.match(LOC_RE); if (m) out.location = m[0].slice(0, 120); }
    if (!out.salary) { const m = joined.match(SALARY_RE); if (m && SALARY_HINT.test(m[0])) out.salary = m[0].trim().slice(0, 60); }
  }

  out.description = body || '';
  return out;
}
