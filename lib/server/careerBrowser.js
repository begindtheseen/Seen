// Pure pieces of the local-Chrome career-site collector (scripts/collect-career-site.mjs).
// The browser does the reading because these sites refuse servers (Tesla answers "Access Denied" even
// for robots.txt) or build job pages in JavaScript (Walmart). What it sends back is the page's own
// schema.org JobPosting data; Seen checks every posting server-side (api/ingest-local-career-jobs.js).
// Tests: lib/server/careerBrowser.test.mjs.

// Runs inside the page (opencli browser eval). Returns a JSON string so the transport is plain text.
export const EXTRACT_JS = `(() => {
  const out = { url: location.href, title: document.title, postings: [], links: [] };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { out.postings.push(JSON.parse(s.textContent)); } catch (e) {}
  }
  const re = /\\/(?:jobs?|job-details?|positions?|openings?|postings?|vacanc(?:y|ies)|requisitions?)\\/[^/?#]+/i;
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    try { const u = new URL(a.href, location.href); if (u.hostname === location.hostname && re.test(u.pathname)) { u.hash = ''; seen.add(u.toString()); } } catch (e) {}
    if (seen.size >= 500) break;
  }
  out.links = [...seen];
  return JSON.stringify(out);
})()`;

function* walk(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  yield node;
  if (node['@graph']) yield* walk(node['@graph']);
}
const isJobPosting = (n) => [].concat(n['@type'] || []).some((t) => /^(?:https?:\/\/schema\.org\/)?JobPosting$/i.test(String(t)));

/** Parse what EXTRACT_JS returned (through OpenCLI's JSON envelope) into { url, postings, links }. */
export function parseExtract(value) {
  let v = value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result; // tolerate { result } wrappers
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return { url: null, postings: [], links: [] }; } }
  if (!v || typeof v !== 'object') return { url: null, postings: [], links: [] };
  const postings = []; for (const n of walk(v.postings || [])) if (isJobPosting(n)) postings.push(n);
  const links = (Array.isArray(v.links) ? v.links : []).filter((l) => { try { return new URL(l).protocol === 'https:'; } catch { return false; } });
  return { url: typeof v.url === 'string' ? v.url : null, postings, links };
}

/** The start URL must be a plain https URL (it comes from Seen, but it is still input). */
export function safeStartUrl(raw) {
  try { const u = new URL(String(raw || '')); return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null; } catch { return null; }
}
