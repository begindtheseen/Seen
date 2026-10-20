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

// ---- the harvest: every job on a site, read inside the page ---------------------------------------
// Some career sites list hundreds or thousands of jobs behind JavaScript (Tesla's search page builds
// its list in the browser and refuses servers outright). Opening each job as its own tab would take
// hours, so the harvest runs INSIDE the already-open page: same origin, the visitor's own session,
// plain fetch() calls. It works in two steps, each with a fallback, and reports which one worked:
//   1. the list: a site recipe (Tesla's own careers feed) → else scroll the page until no new job
//      links appear (infinite scroll / "load more").
//   2. each job: the job page's schema.org JobPosting data → else a site recipe's job feed → else the
//      job is counted as "no job data" (never invented).
// It runs in the background in the page; the collector polls HARVEST_POLL_JS and takes finished
// postings in batches with HARVEST_TAKE_JS, so a long run streams to Seen as it goes.
//
// This function is serialized into the page with toString(), so it must not reference anything
// outside itself. Seen still checks every posting server-side (rowFromPosting).
export function harvestInPage(opts) {
  const W = typeof window !== 'undefined' ? window : globalThis;
  if (W.__seenHarvest && W.__seenHarvest.running) return JSON.stringify({ started: false, already: true });
  const H = W.__seenHarvest = { running: true, phase: 'listing', method: null, detail: null, listed: 0, done: 0, noData: 0, failed: 0, out: [], errors: [], notes: [] };
  const max = Math.max(1, Math.min(5000, Number(opts.maxJobs) || 3000));
  const company = String(opts.company || '');
  const host = location.hostname;
  const isTesla = /(^|\.)tesla\.com$/i.test(host);
  const JOB_PATH = /\/(?:jobs?|job-details?|positions?|openings?|postings?|vacanc(?:y|ies)|requisitions?)\/[^/?#]+/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scrollPause = opts.scrollPauseMs ?? 1200; const jobPause = opts.jobPauseMs ?? 300;
  // errors = something failed (a job, the whole harvest); notes = a strategy that did not apply and was
  // replaced by the fallback (the run still worked).
  const fail = (e) => { if (H.errors.length < 20) H.errors.push(String((e && e.message) || e).slice(0, 200)); };
  const note = (e) => { if (H.notes.length < 10) H.notes.push(String((e && e.message) || e).slice(0, 200)); };
  const getJson = async (path) => { const r = await fetch(path, { credentials: 'include', headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(`${path} answered ${r.status}`); return r.json(); };
  const str = (v) => (v == null ? '' : typeof v === 'object' ? String(v.name || v.label || v.title || '') : String(v));
  const slug = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  // A JSON document's job list: the biggest array of objects that each carry an id and a title.
  function findListings(doc) {
    let best = [];
    const idOf = (o) => o.id ?? o.jobId ?? o.job_id ?? o.requisitionId ?? o.reqId;
    const titleOf = (o) => o.title ?? o.t ?? o.name ?? o.jobTitle;
    const seenNodes = new Set();
    (function visit(v, depth) {
      if (!v || typeof v !== 'object' || depth > 6 || seenNodes.has(v)) return; seenNodes.add(v);
      if (Array.isArray(v)) {
        const good = v.filter((o) => o && typeof o === 'object' && !Array.isArray(o) && idOf(o) != null && typeof titleOf(o) === 'string');
        if (good.length > best.length && good.length >= v.length * 0.8) best = good;
        for (const x of v.slice(0, 50)) visit(x, depth + 1);
        return;
      }
      for (const k of Object.keys(v)) visit(v[k], depth + 1);
    })(doc, 0);
    // A field holding an id is resolved through any lookup table in the document keyed by that id.
    const tables = [];
    (function collect(v, depth, name) {
      if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 4) return;
      const keys = Object.keys(v);
      if (keys.length && keys.every((k) => /^\w+$/.test(k)) && keys.slice(0, 20).every((k) => typeof v[k] === 'string' || (v[k] && typeof v[k] === 'object' && !Array.isArray(v[k]) && (v[k].name || v[k].label)))) tables.push({ name, map: v });
      for (const k of keys) collect(v[k], depth + 1, k);
    })(doc, 0, '');
    const resolve = (val, hint) => {
      if (val == null) return '';
      if (typeof val === 'object') return str(val);
      const t = tables.find((x) => hint.test(x.name) && x.map[val] != null) || null;
      return t ? str(t.map[val]) : String(val);
    };
    return best.map((o) => ({
      id: String(idOf(o)),
      title: String(titleOf(o)).trim(),
      location: resolve(o.location ?? o.l ?? o.city ?? o.locationName, /loc|city|site/i),
      url: typeof o.url === 'string' ? o.url : null,
    }));
  }

  async function listFromTesla() {
    const doc = await getJson('/cua-api/apps/careers/state');
    const items = findListings(doc);
    if (!items.length) throw new Error('the Tesla careers feed answered but carried no job list');
    return items.map((x) => ({ ...x, url: x.url || `${location.origin}/careers/search/job/${slug(x.title)}-${x.id}` }));
  }

  async function listByScrolling() {
    const found = new Map();
    const grab = () => {
      for (const a of document.querySelectorAll('a[href]')) {
        let u; try { u = new URL(a.href, location.href); } catch (e) { continue; }
        if (u.hostname !== location.hostname || !JOB_PATH.test(u.pathname)) continue;
        u.hash = '';
        const key = u.toString();
        if (!found.has(key)) found.set(key, { id: (u.pathname.match(/(\d{3,})\/?$/) || [])[1] || null, title: String(a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200), location: '', url: key });
      }
    };
    let still = 0;
    for (let round = 0; round < 300 && still < 3 && found.size < max; round++) {
      const before = found.size;
      grab();
      W.scrollTo(0, document.body ? document.body.scrollHeight : 0);
      for (const b of document.querySelectorAll('button, a')) {
        if (/^(load|show|view) more|more jobs|next page/i.test(String(b.textContent || '').trim())) { try { b.click(); } catch (e) { /* ignore */ } break; }
      }
      await sleep(scrollPause);
      grab();
      still = found.size === before ? still + 1 : 0;
      H.listed = found.size;
    }
    return [...found.values()];
  }

  // The job page's own JobPosting data (JSON-LD in the server HTML).
  function postingsInHtml(html) {
    const out = [];
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      let v; try { v = JSON.parse(m[1]); } catch (e) { continue; }
      const stack = [v];
      while (stack.length) {
        const n = stack.pop();
        if (!n || typeof n !== 'object') continue;
        if (Array.isArray(n)) { stack.push(...n); continue; }
        if ([].concat(n['@type'] || []).some((t) => /JobPosting$/i.test(String(t)))) out.push(n);
        if (n['@graph']) stack.push(n['@graph']);
      }
    }
    return out;
  }

  // Tesla's per-job feed → a JobPosting. Its exact shape is not documented, so the description is the
  // longest text field in it (job descriptions are by far the longest strings).
  async function teslaJob(item) {
    const d = await getJson(`/cua-api/careers/job/${encodeURIComponent(item.id)}`);
    let desc = '';
    const stack = [d];
    while (stack.length) {
      const n = stack.pop();
      if (typeof n === 'string') { if (n.length > desc.length) desc = n; continue; }
      if (n && typeof n === 'object') stack.push(...Object.values(n));
    }
    const loc = str(d.location || d.locationName || d.city) || item.location;
    return { '@type': 'JobPosting', title: str(d.title || d.jobTitle) || item.title, description: desc, hiringOrganization: { name: company },
      jobLocation: { address: { addressLocality: loc } }, url: item.url, identifier: item.id };
  }

  async function detail(item) {
    try {
      const r = await fetch(item.url, { credentials: 'include' });
      if (r.ok) {
        const ps = postingsInHtml(await r.text());
        if (ps.length) { H.detail = H.detail || 'job_page'; for (const p of ps) H.out.push({ page_url: item.url, posting: { url: item.url, identifier: item.id, ...p } }); return; }
      }
      if (isTesla && item.id) {
        const p = await teslaJob(item);
        if (p.description && p.description.length > 80) { H.detail = H.detail || 'tesla_job_feed'; H.out.push({ page_url: item.url, posting: p }); return; }
      }
      H.noData++;
    } catch (e) { H.failed++; fail(e); }
  }

  (async () => {
    try {
      let list = [];
      if (isTesla) {
        try { list = await listFromTesla(); H.method = 'tesla_feed'; } catch (e) { note(e); }
      }
      if (!list.length) { list = await listByScrolling(); H.method = 'page_scroll'; }
      list = list.slice(0, max);
      H.listed = list.length; H.phase = 'jobs';
      let i = 0;
      const worker = async () => { while (i < list.length) { const item = list[i++]; await detail(item); H.done++; await sleep(jobPause); } };
      await Promise.all([worker(), worker()]); // two at a time: polite to the site's bot protection
    } catch (e) { fail(e); } finally { H.running = false; H.phase = 'done'; }
  })();
  return JSON.stringify({ started: true });
}

export const harvestStartJs = (opts) => {
  const o = { company: String(opts.company || ''), maxJobs: Number(opts.maxJobs) || 3000 };
  for (const k of ['scrollPauseMs', 'jobPauseMs']) if (Number.isFinite(opts[k])) o[k] = opts[k]; // tests run without the pauses
  return `(${harvestInPage.toString()})(${JSON.stringify(o)})`;
};
export const HARVEST_POLL_JS = `(() => { const H = window.__seenHarvest; return JSON.stringify(H ? { running: H.running, phase: H.phase, method: H.method, detail: H.detail, listed: H.listed, done: H.done, noData: H.noData, failed: H.failed, ready: H.out.length, errors: H.errors.slice(-5), notes: H.notes.slice(-5) } : { missing: true }); })()`;
export const harvestTakeJs = (n) => `(() => { const H = window.__seenHarvest; return JSON.stringify(H ? H.out.splice(0, ${Math.max(1, Math.min(100, Number(n) || 50))}) : []); })()`;

/** Parse an eval result that should be a JSON string (through OpenCLI's envelope). */
export function parseEvalJson(value, fallback = null) {
  let v = value;
  if (v && typeof v === 'object' && 'result' in v) v = v.result;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
  return v && typeof v === 'object' ? v : fallback;
}
