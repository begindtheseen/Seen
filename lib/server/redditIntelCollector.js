// Deterministic, deliberately conservative classification for raw public Reddit text.
// This is not an LLM and never rewrites a person's words.
const firstPerson = /\b(i|i'm|i’ve|i'd|my|me|we|we're|we’ve|our)\b/i;

export function classifyRawRedditExcerpt(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  const direct = firstPerson.test(value);
  const match = (rx) => rx.test(value);
  if (direct && match(/\b(ghosted|never heard back|no response|heard nothing)\b/i)) return { kind: 'applicant_outcome', outcome: 'ghosted', sentiment: 'negative' };
  if (direct && match(/\b(auto(?:matic)?(?:ally)? reject(?:ed|ion)?|rejected automatically)\b/i)) return { kind: 'applicant_outcome', outcome: 'autoreject', sentiment: 'negative' };
  if (direct && match(/\b(rejected|turned down|declined)\b/i)) return { kind: 'applicant_outcome', outcome: 'rejected', sentiment: 'negative' };
  if (direct && match(/\b(interviewed|interviewing|interview scheduled|phone screen)\b/i)) return { kind: 'applicant_outcome', outcome: 'interview', sentiment: 'mixed' };
  if (direct && match(/\b(offer(?:ed)?|got the job|hired)\b/i)) return { kind: 'applicant_outcome', outcome: 'offer', sentiment: 'positive' };
  if (direct && match(/\b(assessment|take.?home|coding challenge)\b/i)) return { kind: 'applicant_outcome', outcome: 'assessment', sentiment: 'mixed' };
  if (direct && match(/\b(i work|i worked|my job|my manager|my team|coworker|co-worker)\b/i)) return { kind: 'employee_review', sentiment: 'mixed' };
  return { kind: 'public_commentary', sentiment: 'mixed' };
}

export function flattenRedditRead(data) {
  const out = [], seen = new Set();
  const walk = (value, fallbackUrl = '') => {
    if (!value) return;
    if (Array.isArray(value)) { value.forEach((item) => walk(item, fallbackUrl)); return; }
    if (typeof value !== 'object') return;
    const text = String(value.text || value.body || value.selftext || '').replace(/\s+/g, ' ').trim();
    const url = String(value.url || value.permalink || fallbackUrl || '');
    if (text && !seen.has(`${url}\n${text}`)) { seen.add(`${url}\n${text}`); out.push({ text, url }); }
    for (const [key, child] of Object.entries(value)) if (!['text', 'body', 'selftext', 'url', 'permalink'].includes(key)) walk(child, url);
  };
  walk(data);
  return out;
}

export function unwrapOpenCli(value) {
  return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'ok') ? value.data : value;
}

// execFile's own message is just "Command failed: opencli …"; the reason (rate limit, timeout,
// Chrome bridge down) is in the tool's stderr/stdout. Keep the first useful line of it.
export function opencliFailure(error) {
  const tail = [error?.stderr, error?.stdout].map((t) => String(t || '').trim()).filter(Boolean).join(' | ');
  const why = error?.killed ? 'timed out after 90s' : tail.replace(/\s+/g, ' ').slice(0, 240);
  return why ? `${String(error?.message || error).split('\n')[0].slice(0, 160)} — ${why}` : String(error?.message || error).slice(0, 400);
}
