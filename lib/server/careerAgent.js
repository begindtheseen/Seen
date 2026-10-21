// The career-site agent: runs INSIDE a page open in the owner's Chrome (OpenCLI `browser eval`) and does
// what a person does on a career site:
//   scout  — what is this page? A job list (how many jobs, how the site says it pages, the total it
//            claims), or a landing page with links deeper ("Search jobs", "View all openings", the
//            company's Workday/iCIMS/… site)?
//   list   — every job on the list: the site's own listings feed when it has one (Tesla's feed, Workday's
//            jobs API, or the JSON request the page itself made, replayed page by page), else the page
//            itself — Next buttons, numbered pages, "Load more", infinite scroll — until nothing new.
//            A Next LINK to another document is handed back to the collector, which opens it.
//   filter — use the site's own search and filters, whatever the layout: type the keywords into its search
//            box (input events a React/Vue page reacts to, Enter, its search button, its form), and set the
//            location to the United States through whatever control it has (a dropdown, a type-ahead
//            suggestion, a checkbox or button in a filter panel, opening a collapsed "Location" section).
//            Says exactly what it applied and what it could not find.
//   detail — each job's own data: schema.org JobPosting on its page, a site feed (Tesla, Workday), else
//            the job page's main text (fetched, or rendered in a hidden same-origin frame).
// Long work runs in the background in the page; the collector polls (`poll`) and takes results in
// batches (`take`). `careerAgent` is serialized into the page with toString(), so it must not reference
// anything outside itself. Seen checks every posting server-side (rowFromPosting); nothing is invented:
// a job without enough data is counted, not sent.
// Tests: lib/server/careerAgent.test.mjs (VM) + scripts/career-site-e2e.mjs (real Chromium, fixture sites).

export function careerAgent(cmd) {
  const W = typeof window !== 'undefined' ? window : globalThis;
  const D = W.document;
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = W.__seenAgent || (W.__seenAgent = { running: false, op: null, out: [], items: [], errors: [], notes: [] });
  const fail = (e) => { if (st.errors.length < 20) st.errors.push(norm((e && e.message) || e).slice(0, 200)); };
  const note = (e) => { if (st.notes.length < 20) st.notes.push(norm((e && e.message) || e).slice(0, 200)); };
  const pause = (k, d) => (cmd && Number.isFinite(cmd[k]) ? cmd[k] : d);

  // ---- what a job link looks like -----------------------------------------------------------------
  const JOB_PATH = /\/(?:jobs?|job-details?|jobdetails?|positions?|openings?|postings?|vacanc(?:y|ies)|requisitions?|opportunit(?:y|ies)|careers?\/[^/?#]*\/?(?:job|position)s?)\/[^/?#]+/i;
  const NOT_A_JOB = /^(?:search|results?|categor(?:y|ies)|locations?|teams?|departments?|alerts?|saved|login|sign-?in|faq|benefits|students?|university|military|events?|culture|life|about|apply|internships?|all|index|list|map|filter|page|\d{1,2})$/i;
  const NAV_TEXT = /^(?:search( jobs)?|view (all|more|details)|see (all|more)|apply( now)?|learn more|read more|next|previous|back|home|careers?|jobs?|load more|show more|more)$/i;
  const ID_IN = /(?:^|[^a-z0-9])((?:jr|req|r)?-?\d{4,}|[a-f0-9]{8}-[a-f0-9-]{27,})(?:[^a-z0-9]|$)/i;
  function jobKey(u) { const x = new URL(u); x.hash = ''; for (const k of [...x.searchParams.keys()]) if (/^(?:utm_|src|source|ref|gh_src|lever-|trk|from)/i.test(k)) x.searchParams.delete(k); return x.toString(); }
  function isJobHref(u, text) {
    if (!/^https?:$/.test(u.protocol)) return false;
    const m = JOB_PATH.exec(u.pathname);
    const last = u.pathname.replace(/\/+$/, '').split('/').pop() || '';
    if (m && !NOT_A_JOB.test(last)) return true;
    // An id-like segment under a careers-ish path (/careers/requisition-123/…, /us/en/job/R123456/…).
    return /career|job|position|opening|vacanc|requisition/i.test(u.pathname) && ID_IN.test(last) && norm(text).length >= 3 && !NAV_TEXT.test(norm(text));
  }
  function jobLinks(root) {
    const out = new Map();
    for (const a of (root || D).querySelectorAll('a[href]')) {
      let u; try { u = new URL(a.getAttribute('href'), W.location.href); } catch (e) { continue; }
      const text = norm(a.textContent).slice(0, 200);
      if (!isJobHref(u, text)) continue;
      let key; try { key = jobKey(u.toString()); } catch (e) { continue; }
      if (out.has(key)) { if (!out.get(key).title && text && !NAV_TEXT.test(text)) out.get(key).title = text; continue; }
      // The listing card around the link often carries the location ("Austin, TX").
      const card = a.closest('li, tr, article, [class*="job" i], [class*="result" i], [class*="card" i], [class*="row" i]') || a.parentElement;
      const cardText = card ? norm(card.textContent).slice(0, 400) : '';
      const loc = (/(?:^|\s)((?:remote|[A-Z][a-zA-Z .'-]+, (?:[A-Z]{2}|[A-Z][a-z]+)(?:,? (?:US|USA|United States))?))(?:\s|$)/.exec(cardText.replace(text, ' ')) || [])[1] || '';
      out.set(key, { url: key, id: (ID_IN.exec(u.pathname) || [])[1] || null, title: NAV_TEXT.test(text) ? '' : text, location: norm(loc), source: 'page' });
    }
    return [...out.values()];
  }

  // ---- the total a page claims ("1,234 jobs", "Showing 1–20 of 345", "345 results") ----------------
  function siteTotal() {
    const t = norm(D.body ? D.body.innerText || D.body.textContent : '').slice(0, 200000);
    const pats = [/\b(?:of|from)\s+([\d,.]{1,9})\s+(?:jobs?|results?|positions?|openings?|opportunities|roles|matches)\b/i,
      /\b([\d,.]{1,9})\s+(?:jobs?|results?|positions?|open(?:ings| positions| roles)?|opportunities|roles|matches)\s+(?:found|available|match|matching)?/i,
      /\b(?:showing|displaying)\s+[\d,]+\s*[-–]\s*[\d,]+\s+of\s+([\d,.]{1,9})\b/i];
    for (const re of pats) { const m = re.exec(t); if (m) { const n = Number(m[1].replace(/[,.]/g, '')); if (n > 0 && n < 1e6) return n; } }
    return null;
  }

  // ---- links that lead deeper ("Search jobs", "View all openings", the company's ATS) --------------
  const ATS = /(?:^|\.)(?:myworkdayjobs\.com|myworkdaysite\.com|icims\.com|taleo\.net|successfactors\.(?:com|eu)|greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|jobvite\.com|workable\.com|recruitee\.com|bamboohr\.com|ultipro\.com|ukg\.net|oraclecloud\.com|eightfold\.ai|phenompeople\.com|avature\.net|brassring\.com|dayforcehcm\.com|paylocity\.com|adp\.com|jazzhr\.com|applytojob\.com|breezy\.hr|rippling\.com|pinpointhq\.com|teamtailor\.com|personio\.(?:de|com))$/i;
  const DEEPER_TEXT = /\b(?:(?:search|find|view|see|browse|explore|show)\s+(?:all\s+|our\s+|open\s+|current\s+)*(?:jobs?|openings?|positions?|roles?|opportunities|careers?|vacancies)|open (?:positions|roles|jobs)|current (?:openings|opportunities|vacancies)|job (?:search|openings|listings|opportunities|board)|all (?:jobs|openings|positions)|career opportunities|search (?:and apply|careers)|join (?:us|our team)|apply (?:now|today)|see openings|work (?:with|for) us)\b/i;
  function deeperLinks() {
    const here = (() => { try { return jobKey(W.location.href); } catch (e) { return W.location.href; } })();
    const site = W.location.hostname.split('.').slice(-2).join('.');
    const out = new Map();
    for (const a of D.querySelectorAll('a[href], [role="link"][data-href]')) {
      const href = a.getAttribute('href') || a.getAttribute('data-href');
      let u; try { u = new URL(href, W.location.href); } catch (e) { continue; }
      if (!/^https:$/.test(u.protocol) && !(W.location.protocol === 'http:' && u.protocol === 'http:')) continue;
      u.hash = '';
      const key = u.toString(); if (key === here) continue;
      const text = norm(a.textContent || a.getAttribute('aria-label') || a.getAttribute('title')).slice(0, 120);
      const ats = ATS.test(u.hostname);
      const sameSite = u.hostname === W.location.hostname || u.hostname.endsWith('.' + site);
      if (!ats && !sameSite) continue;
      let score = 0;
      if (DEEPER_TEXT.test(text)) score += 10;
      if (ats) score += 8;
      if (/\/(?:search|jobs?|openings|positions|opportunities|vacancies|job-search|careers?\/search)(?:\/|$|\?)/i.test(u.pathname + u.search)) score += 3;
      if (/[?&](?:site|country|location|region)=/i.test(u.search)) score += 1;
      if (isJobHref(u, text)) score -= 6; // a single job is not the list
      if (score <= 0) continue;
      const prev = out.get(key); if (!prev || prev.score < score) out.set(key, { url: key, text, score, ats });
    }
    return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 8);
  }

  // ---- site recipes -------------------------------------------------------------------------------
  const resources = () => { try { return W.performance.getEntriesByType('resource').map((e) => ({ url: e.name, type: e.initiatorType })); } catch (e) { return []; } };
  function workdayBase() {
    // https://acme.wd5.myworkdayjobs.com/en-US/External → /wday/cxs/acme/External ; or the request the page made.
    const seen = resources().map((r) => r.url).find((u) => /\/wday\/cxs\/[^/]+\/[^/]+\/jobs(?:\?|$)/.test(u));
    if (seen) { const m = /^(https?:\/\/[^/]+)(\/wday\/cxs\/[^/]+\/[^/]+)\/jobs/.exec(seen); if (m && m[1] === W.location.origin) return { api: m[2], site: null }; }
    if (/(?:^|\.)myworkday(?:jobs|site)\.com$/i.test(W.location.hostname)) {
      const tenant = W.location.hostname.split('.')[0];
      const parts = W.location.pathname.split('/').filter(Boolean);
      const site = parts.find((p, i) => i <= 1 && !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(p) && p !== 'job' && p !== 'details');
      if (tenant && site) return { api: `/wday/cxs/${tenant}/${site}`, site };
    }
    return null;
  }
  const recipe = () => (/(^|\.)tesla\.com$/i.test(W.location.hostname) || resources().some((r) => /\/cua-api\//.test(r.url)) ? 'tesla' : workdayBase() ? 'workday' : null);

  // ---- the page's own requests --------------------------------------------------------------------
  // A spy on fetch/XMLHttpRequest records every same-origin request the PAGE makes (method, URL, body)
  // from the moment the agent arrives — so the listing request a single-page site makes when we click
  // Next or search (often a POST with { page, size } in its body) can be replayed page by page.
  // The agent's own requests use the original fetch and are not recorded.
  function spy() {
    if (W.__seenNet) return W.__seenNet;
    const log = W.__seenNet = [];
    const rec = (method, url, body) => {
      try { const u = new URL(String(url), W.location.href); if (u.origin !== W.location.origin) return;
        log.push({ method: String(method || 'GET').toUpperCase(), url: u.toString(), body: typeof body === 'string' ? body.slice(0, 20000) : null, at: Date.now() }); if (log.length > 300) log.shift(); } catch (e) { /* ignore */ }
    };
    const of = W.fetch;
    if (of && !W.__seenFetch) {
      W.__seenFetch = of.bind(W);
      W.fetch = function (input, init) { try { rec((init && init.method) || (input && input.method) || 'GET', typeof input === 'string' ? input : input && input.url, init && init.body); } catch (e) { /* ignore */ } return of.apply(this, arguments); };
    }
    const XO = W.XMLHttpRequest && W.XMLHttpRequest.prototype;
    if (XO && !XO.__seenSpy) {
      const o = XO.open, sd = XO.send; XO.__seenSpy = true;
      XO.open = function (m, u) { this.__seenReq = [m, u]; return o.apply(this, arguments); };
      XO.send = function (b) { try { if (this.__seenReq) rec(this.__seenReq[0], this.__seenReq[1], b); } catch (e) { /* ignore */ } return sd.apply(this, arguments); };
    }
    return log;
  }
  spy();
  const ownFetch = (...a) => (W.__seenFetch || W.fetch)(...a);

  // ---- JSON listing feeds -------------------------------------------------------------------------
  const getJson = async (path, init) => { const r = await ownFetch(path, { credentials: 'include', ...(init || {}), headers: { accept: 'application/json', ...((init && init.headers) || {}) } }); if (!r.ok) throw new Error(`${String(path).slice(0, 120)} answered ${r.status}`); return r.json(); };
  const str = (v) => (v == null ? '' : typeof v === 'object' ? String(v.name || v.label || v.title || v.descriptor || v.value || '') : String(v));
  const slug = (t) => String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const ID_KEYS = ['id', 'jobId', 'job_id', 'jobID', 'requisitionId', 'requisition_id', 'reqId', 'req_id', 'jobReqId', 'postingId', 'positionId', 'uuid', 'slug', 'externalPath', 'jobCode'];
  const TITLE_KEYS = ['title', 'jobTitle', 'job_title', 'name', 'postingTitle', 'positionTitle', 't', 'text'];
  const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return null; };
  function findTotal(doc) {
    let best = null;
    (function visit(v, d) {
      if (!v || typeof v !== 'object' || d > 4) return;
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (/^(?:total|totalCount|total_count|totalResults|totalHits|totalJobs|numFound|count|nbHits|totalElements|recordsTotal)$/i.test(k)) {
          const n = typeof x === 'number' ? x : x && typeof x === 'object' && typeof x.value === 'number' ? x.value : Number(x);
          if (Number.isFinite(n) && n > 0 && (best == null || n > best)) best = n;
        } else if (x && typeof x === 'object' && !Array.isArray(x)) visit(x, d + 1);
      }
    })(doc, 0);
    return best;
  }
  function findListings(doc) {
    let best = [];
    const seenNodes = new Set();
    (function visit(v, depth) {
      if (!v || typeof v !== 'object' || depth > 7 || seenNodes.has(v)) return; seenNodes.add(v);
      if (Array.isArray(v)) {
        const good = v.filter((o) => o && typeof o === 'object' && !Array.isArray(o) && pick(o, ID_KEYS) != null && typeof pick(o, TITLE_KEYS) === 'string' && norm(pick(o, TITLE_KEYS)).length >= 2);
        if (good.length > best.length && good.length >= v.length * 0.8) best = good;
        for (const x of v.slice(0, 60)) visit(x, depth + 1);
        return;
      }
      for (const k of Object.keys(v)) visit(v[k], depth + 1);
    })(doc, 0);
    // Ids resolved through lookup tables in the same document (Tesla's feed keys locations by id).
    const tables = [];
    (function collect(v, depth, name) {
      if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 4) return;
      const keys = Object.keys(v);
      if (keys.length && keys.every((k) => /^\w+$/.test(k)) && keys.slice(0, 20).every((k) => typeof v[k] === 'string' || (v[k] && typeof v[k] === 'object' && !Array.isArray(v[k]) && (v[k].name || v[k].label)))) tables.push({ name, map: v });
      for (const k of keys) collect(v[k], depth + 1, k);
    })(doc, 0, '');
    const resolve = (val, hint) => {
      if (val == null) return '';
      if (Array.isArray(val)) return val.map((x) => resolve(x, hint)).filter(Boolean).join('; ');
      if (typeof val === 'object') return str(val) || [val.city, val.state || val.region, val.country].filter(Boolean).map(str).join(', ');
      const t = tables.find((x) => hint.test(x.name) && x.map[val] != null) || null;
      return t ? str(t.map[val]) : String(val);
    };
    return best.map((o) => {
      const desc = pick(o, ['description', 'jobDescription', 'job_description', 'descriptionHtml', 'content', 'summary', 'descriptionPlain']);
      return {
        id: String(pick(o, ID_KEYS)),
        title: norm(pick(o, TITLE_KEYS)).slice(0, 200),
        location: norm(resolve(pick(o, ['location', 'locationName', 'locations', 'locationsText', 'city', 'l', 'jobLocation', 'primaryLocation', 'workLocation']), /loc|city|site/i)).slice(0, 200),
        url: typeof o.url === 'string' ? o.url : typeof o.absolute_url === 'string' ? o.absolute_url : typeof o.applyUrl === 'string' ? o.applyUrl : typeof o.jobUrl === 'string' ? o.jobUrl : typeof o.hostedUrl === 'string' ? o.hostedUrl : null,
        description: typeof desc === 'string' && desc.length >= 80 ? desc.slice(0, 20000) : '',
        source: 'feed',
      };
    });
  }
  // A job URL for feed items that carry none: learn the pattern from a job link on the page that
  // contains one of the item ids (Tesla: /careers/search/job/<slug>-<id>).
  function urlTemplate(items) {
    const links = jobLinks().map((l) => l.url);
    for (const it of items.slice(0, 400)) {
      if (!it.id || it.id.length < 3) continue;
      const hit = links.find((h) => h.includes(it.id));
      if (!hit) continue;
      let tpl = hit.replace(it.id, '{id}');
      const s = slug(it.title); if (s && tpl.includes(s)) tpl = tpl.replace(s, '{slug}');
      return tpl;
    }
    return null;
  }
  const PAGE_KEYS = /^(?:page|pageNumber|pageNum|pageIndex|p|pg|currentPage|pageNo)$/i;
  const OFFSET_KEYS = /^(?:offset|start|from|skip|startIndex|startrow|first|begin)$/i;
  const SIZE_KEYS = /^(?:limit|size|pageSize|page_size|per_page|perPage|rows|num|results_per_page|hitsPerPage|count|max)$/i;
  // Where a page/offset/size number lives in a JSON body: [path, value] pairs, two levels deep.
  function numberKeys(obj, test) {
    const out = [];
    (function visit(v, path, d) {
      if (!v || typeof v !== 'object' || Array.isArray(v) || d > 2) return;
      for (const k of Object.keys(v)) { const x = v[k]; if ((typeof x === 'number' || /^\d+$/.test(String(x))) && test.test(k)) out.push([path.concat(k), Number(x)]); else visit(x, path.concat(k), d + 1); }
    })(obj, [], 0);
    return out;
  }
  const setPath = (obj, path, val) => { let o = obj; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = val; };
  // Every listing request this page made — the ones it made while loading (GET, from the resource list)
  // and the ones the spy saw since (any method, with body) — newest first, one per method+path+body shape.
  function feedCandidates() {
    const out = []; const keys = new Set();
    const add = (c) => { let u; try { u = new URL(c.url); } catch (e) { return; } if (u.origin !== W.location.origin) return; const k = `${c.method} ${u.pathname} ${c.body ? Object.keys((() => { try { return JSON.parse(c.body); } catch (e) { return {}; } })()).sort().join(',') : ''}`; if (keys.has(k)) return; keys.add(k); out.push(c); };
    for (const c of [...(W.__seenNet || [])].reverse()) add(c);
    for (const r of resources().reverse()) if (/^(?:fetch|xmlhttprequest)$/.test(r.type)) add({ method: 'GET', url: r.url, body: null });
    return out;
  }
  async function request(c, url, body) {
    if (c.method === 'GET') return getJson(url);
    return getJson(url, { method: c.method, headers: { 'content-type': 'application/json' }, body: body == null ? c.body : JSON.stringify(body) });
  }
  // The listing request, replayed page by page until the site has no more (or says how many it has).
  async function replayFeeds(max, total0) {
    for (const c of feedCandidates().slice(0, 40)) {
      let doc; try { doc = await request(c, c.url); } catch (e) { continue; }
      const first = findListings(doc);
      if (first.length < 2) continue;
      const found = new Map(first.map((x) => [x.id, x]));
      const total = findTotal(doc) || total0;
      const u = new URL(c.url);
      const qk = [...u.searchParams.keys()];
      const qPage = qk.find((k) => PAGE_KEYS.test(k)), qOff = qk.find((k) => OFFSET_KEYS.test(k)), qSize = qk.find((k) => SIZE_KEYS.test(k));
      let body = null; try { body = c.body ? JSON.parse(c.body) : null; } catch (e) { body = null; }
      const bPage = body ? numberKeys(body, PAGE_KEYS)[0] : null, bOff = body ? numberKeys(body, OFFSET_KEYS)[0] : null, bSize = body ? numberKeys(body, SIZE_KEYS)[0] : null;
      st.method = c.method === 'GET' ? 'site_feed' : 'site_feed_post'; st.listed = found.size; st.siteTotal = total || st.siteTotal;
      const size = (qSize ? Number(u.searchParams.get(qSize)) : bSize ? bSize[1] : 0) || first.length;
      let n = qPage ? Number(u.searchParams.get(qPage)) || 0 : qOff ? Number(u.searchParams.get(qOff)) || 0 : bPage ? bPage[1] : bOff ? bOff[1] : null;
      if (n != null) {
        for (let i = 0, still = 0; i < 5000 && found.size < max && still < 2; i++) {
          if (total && found.size >= total) break;
          n = (qPage || (!qOff && bPage)) ? n + 1 : n + size;
          let url = c.url, b = body;
          if (qPage || qOff) { u.searchParams.set(qPage || qOff, String(n)); url = u.toString(); }
          else { b = JSON.parse(JSON.stringify(body)); setPath(b, (bPage || bOff)[0], n); }
          let page; try { page = findListings(await request(c, url, b)); } catch (e) { note(e); break; }
          const before = found.size; for (const x of page) if (!found.has(x.id)) found.set(x.id, x);
          still = found.size === before ? still + 1 : 0;
          st.listed = found.size; st.feedPages = (st.feedPages || 1) + 1;
          await sleep(pause('feedPauseMs', 250));
        }
      }
      const items = [...found.values()];
      const tpl = items.some((x) => !x.url) ? urlTemplate(items) : null;
      return items.map((x) => ({ ...x, url: x.url ? new URL(x.url, W.location.href).toString() : tpl ? tpl.replace('{id}', x.id).replace('{slug}', slug(x.title)) : null }));
    }
    return [];
  }
  async function listFromTesla() {
    const doc = await getJson('/cua-api/apps/careers/state');
    const items = findListings(doc);
    if (!items.length) throw new Error('the Tesla careers feed answered but carried no job list');
    st.siteTotal = findTotal(doc) || st.siteTotal;
    const tpl = urlTemplate(items);
    return items.map((x) => ({ ...x, url: x.url || (tpl ? tpl.replace('{id}', x.id).replace('{slug}', slug(x.title)) : `${W.location.origin}/careers/search/job/${slug(x.title)}-${x.id}`) }));
  }
  async function listFromWorkday(max, keywords) {
    const wd = workdayBase(); if (!wd) throw new Error('not a Workday site');
    const sitePath = wd.site ? W.location.pathname.slice(0, W.location.pathname.indexOf(wd.site) + wd.site.length) : W.location.pathname.replace(/\/(?:job|details)\/.*$/, '').replace(/\/+$/, '');
    const found = new Map(); let total = null;
    for (let offset = 0; offset < 10000 && found.size < max; offset += 20) {
      const doc = await getJson(`${wd.api}/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: keywords || '' }) });
      if (total == null) total = Number(doc.total) || null;
      const rows = Array.isArray(doc.jobPostings) ? doc.jobPostings : [];
      if (!rows.length) break;
      for (const j of rows) {
        const path = String(j.externalPath || ''); if (!path || found.has(path)) continue;
        found.set(path, { id: path, title: norm(j.title), location: norm(j.locationsText), url: `${W.location.origin}${sitePath}${path}`, description: '', source: 'workday', wdPath: path });
      }
      st.listed = found.size; st.siteTotal = total || st.siteTotal;
      if (total && offset + 20 >= total) break;
      await sleep(pause('feedPauseMs', 250));
    }
    st.workdayApi = wd.api;
    return [...found.values()];
  }

  // ---- the page itself: Next / numbered pages / Load more / infinite scroll ------------------------
  const visible = (el) => { if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || /\bdisabled\b/.test(el.className || '')) return false; const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 }; return r.width > 0 && r.height > 0; };
  function nextControl() {
    const cands = [...D.querySelectorAll('a[rel~="next"], link[rel~="next"], [aria-label*="next" i], [title*="next" i], [data-testid*="next" i], button, a')];
    for (const el of cands) {
      const label = norm(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent);
      const isNext = el.matches('a[rel~="next"], link[rel~="next"]') || /^(?:next|next page|go to next page|›|»|>|→|next ›|next »|next >)$/i.test(label) || (/\bnext\b/i.test(label) && label.length < 30 && !/previous|prev/i.test(label));
      if (isNext && (el.tagName === 'LINK' || visible(el))) return el;
    }
    // Numbered pages: the control after the current page number.
    const cur = D.querySelector('[aria-current="page"], .pagination .active, [class*="pagination" i] [class*="active" i], [class*="pager" i] [class*="current" i]');
    const n = cur ? Number(norm(cur.textContent)) : NaN;
    if (Number.isFinite(n)) for (const el of D.querySelectorAll('a, button')) if (norm(el.textContent) === String(n + 1) && visible(el)) return el;
    return null;
  }
  function moreControl() {
    for (const el of D.querySelectorAll('button, a, [role="button"]')) {
      if (/^(?:(?:load|show|view|see) more(?: jobs| results| positions| openings)?|more (?:jobs|results)|show all)\b/i.test(norm(el.textContent)) && visible(el)) return el;
    }
    return null;
  }
  async function listFromPage(max) {
    const found = new Map();
    const grab = () => { let added = 0; for (const j of jobLinks()) if (!found.has(j.url)) { found.set(j.url, j); added++; } st.listed = found.size; return added; };
    grab();
    st.siteTotal = siteTotal() || st.siteTotal;
    let stuck = 0;
    for (let round = 0; round < 5000 && found.size < max && stuck < 3; round++) {
      if (st.siteTotal && found.size >= st.siteTotal) break;
      const more = moreControl();
      const next = more ? null : nextControl();
      if (next && next.tagName === 'LINK') { st.next = next.href; break; }
      if (next && next.tagName === 'A') {
        // A Next link to another document: the collector opens it (our context ends with this page).
        let u = null; try { u = new URL(next.getAttribute('href') || '', W.location.href); } catch (e) { /* ignore */ }
        const sameDoc = !u || (u.pathname === W.location.pathname && u.search === W.location.search) || /^(?:#|javascript:)/i.test(next.getAttribute('href') || '#');
        if (!sameDoc && !next.hasAttribute('data-spa')) { st.next = u.toString(); break; }
      }
      const before = found.size;
      const sig = () => jobLinks().map((j) => j.url).join('|').slice(0, 4000);
      const was = sig();
      if (more || next) { try { (more || next).click(); } catch (e) { note(e); } }
      else W.scrollTo(0, D.body ? D.body.scrollHeight : 0);
      // Wait for the list to change (a click re-renders; a scroll appends).
      for (let w = 0; w < 20; w++) { await sleep(pause('pagePauseMs', 400)); if (sig() !== was) break; }
      await sleep(pause('settleMs', 300));
      grab();
      stuck = found.size === before ? stuck + 1 : 0;
      st.pages = (st.pages || 1) + (more || next ? 1 : 0);
    }
    st.siteTotal = siteTotal() || st.siteTotal;
    return [...found.values()];
  }

  // ---- details ------------------------------------------------------------------------------------
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
  // The job page's main text: the biggest block that is not navigation.
  function mainText(doc) {
    for (const el of doc.querySelectorAll('script, style, noscript, nav, header, footer, form, svg')) el.remove();
    const cands = [...doc.querySelectorAll('[class*="description" i], [id*="description" i], [class*="job-detail" i], [class*="jobdetail" i], [class*="posting" i], main, article, [role="main"], #content, .content')];
    let best = '';
    for (const el of cands) { const t = norm(el.textContent); if (t.length > best.length) best = t; }
    if (best.length < 200 && doc.body) best = norm(doc.body.textContent);
    return best.slice(0, 20000);
  }
  function headline(doc) { const h = doc.querySelector('h1'); return h ? norm(h.textContent).slice(0, 200) : ''; }
  async function viaFrame(url) {
    return new Promise((resolve) => {
      const f = D.createElement('iframe');
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;visibility:hidden';
      let done = false;
      const finish = (v) => { if (done) return; done = true; try { f.remove(); } catch (e) { /* ignore */ } resolve(v); };
      f.onload = async () => {
        for (let i = 0; i < 16; i++) {
          await sleep(pause('framePauseMs', 500));
          let doc; try { doc = f.contentDocument; } catch (e) { return finish(null); }
          if (!doc || !doc.body) continue;
          const lds = postingsInHtml(doc.documentElement.outerHTML);
          const text = mainText(doc.cloneNode(true));
          if (lds.length || text.length >= 400) return finish({ lds, text, title: headline(doc) });
        }
        finish(null);
      };
      setTimeout(() => finish(null), pause('frameTimeoutMs', 12000));
      f.src = url; D.body.appendChild(f);
    });
  }
  const company = String((cmd && cmd.company) || '');
  const asPosting = (it, extra) => ({ '@type': 'JobPosting', title: it.title, description: '', hiringOrganization: { name: company }, url: it.url, identifier: it.id || undefined,
    ...(it.location ? { jobLocation: { address: { addressLocality: it.location } } } : {}), ...extra });
  async function detail(it) {
    const push = (posting, how) => { st.out.push({ page_url: it.url, posting, how }); st.detail = st.detail || how; };
    try {
      if (it.description && it.description.length >= 80) return push(asPosting(it, { description: it.description }), 'feed');
      if (it.wdPath && st.workdayApi) {
        const d = await getJson(`${st.workdayApi}${it.wdPath}`);
        const j = d.jobPostingInfo || {};
        if (j.jobDescription) return push(asPosting(it, { title: norm(j.title) || it.title, description: String(j.jobDescription), identifier: j.jobReqId || it.id,
          jobLocation: { address: { addressLocality: norm(j.location) || it.location, addressCountry: j.country ? str(j.country) : undefined } }, ...(j.timeType ? { employmentType: str(j.timeType) } : {}) }), 'workday_api');
      }
      if (it.url) {
        let html = null;
        try { const r = await fetch(it.url, { credentials: 'include' }); if (r.ok) html = await r.text(); } catch (e) { note(e); }
        if (html) {
          const lds = postingsInHtml(html);
          if (lds.length) { for (const p of lds) push({ url: it.url, identifier: it.id || undefined, ...p }, 'job_page'); return; }
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const text = mainText(doc);
          if (text.length >= 300) return push(asPosting(it, { title: it.title || headline(doc), description: text }), 'page_text');
        }
        if (st.recipe === 'tesla' && it.id) {
          const d = await getJson(`/cua-api/careers/job/${encodeURIComponent(it.id)}`);
          let desc = ''; const stack = [d];
          while (stack.length) { const n = stack.pop(); if (typeof n === 'string') { if (n.length > desc.length) desc = n; continue; } if (n && typeof n === 'object') stack.push(...Object.values(n)); }
          if (desc.length > 80) return push(asPosting(it, { title: str(d.title || d.jobTitle) || it.title, description: desc, ...(str(d.location || d.locationName || d.city) ? { jobLocation: { address: { addressLocality: str(d.location || d.locationName || d.city) } } } : {}) }), 'tesla_job_feed');
        }
        // A job page that builds itself in JavaScript: render it in a hidden same-origin frame.
        let same = false; try { same = new URL(it.url).origin === W.location.origin; } catch (e) { /* ignore */ }
        if (same) {
          const r = await viaFrame(it.url);
          if (r && r.lds.length) { for (const p of r.lds) push({ url: it.url, identifier: it.id || undefined, ...p }, 'rendered_page'); return; }
          if (r && r.text.length >= 300) return push(asPosting(it, { title: it.title || r.title, description: r.text }), 'rendered_text');
        }
      }
      st.noData++;
    } catch (e) { st.failed++; fail(e); }
  }


  // ---- the site's own search and filters, whatever the layout ---------------------------------------
  const hintOf = (el) => {
    const lab = (el.id && D.querySelector(`label[for="${(W.CSS && W.CSS.escape) ? W.CSS.escape(el.id) : el.id}"]`)) || el.closest('label');
    return norm(`${el.name || ''} ${el.id || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('autocomplete') || ''} ${lab ? lab.textContent : ''} ${el.className || ''}`).toLowerCase();
  };
  const LOC_HINT = /locat|where|city|zip|postal|country|region|address|near|place|geo|state\b/;
  const KEY_HINT = /keyword|search|job|title|query|what|role|position|skill|q\b|term|find/;
  const typable = (el) => el && el.tagName === 'INPUT' && /^(?:text|search|)$/i.test(el.getAttribute('type') || '') && !el.readOnly && !el.disabled && visible(el);
  function searchBox() {
    let best = null, bestScore = 0;
    for (const el of D.querySelectorAll('input')) {
      if (!typable(el)) continue;
      const h = hintOf(el); if (LOC_HINT.test(h) && !/keyword|title|job/.test(h)) continue;
      let sc = 0; if ((el.getAttribute('type') || '').toLowerCase() === 'search') sc += 3; if (KEY_HINT.test(h)) sc += 4; if (el.getAttribute('role') === 'combobox') sc += 1;
      if (sc > bestScore) { best = el; bestScore = sc; }
    }
    if (best) return best;
    const all = [...D.querySelectorAll('input')].filter((el) => typable(el) && !LOC_HINT.test(hintOf(el)));
    return all.length === 1 ? all[0] : null;
  }
  function setValue(el, v) {
    const proto = el.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype;
    const set = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus(); el.dispatchEvent(new W.FocusEvent('focus', { bubbles: false }));
    set.call(el, ''); el.dispatchEvent(new W.Event('input', { bubbles: true }));
    set.call(el, v); el.dispatchEvent(new W.Event('input', { bubbles: true })); el.dispatchEvent(new W.Event('change', { bubbles: true }));
  }
  const pressEnter = (el) => { for (const t of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new W.KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); };
  // The site's Search / Find button for a box: the form's submit button, else the nearest one walking OUT
  // from the box (a location box often sits in its own wrapper, with "Find jobs" one level further out).
  function searchButton(input) {
    const isSearch = (b) => b.type === 'submit' || /^(?:search|find|go|submit|search jobs|find jobs|apply|show results|see results|update)$/i.test(norm(b.textContent || b.value || b.getAttribute('aria-label') || '')) || /search|submit|find/i.test(b.getAttribute('aria-label') || '');
    if (input.form) { const b = [...input.form.querySelectorAll('button, input[type="submit"]')].filter(visible).find(isSearch); if (b) return b; }
    let scope = input.parentElement;
    for (let i = 0; scope && i < 6; i++, scope = scope.parentElement) {
      const b = [...scope.querySelectorAll('button, input[type="submit"], [role="button"]')].filter(visible).find(isSearch);
      if (b) return b;
    }
    return null;
  }
  const pageSig = () => `${W.location.href}|${siteTotal()}|${jobLinks().map((j) => j.url).join('|').slice(0, 6000)}`;
  async function waitChange(was, ms) { for (let t = 0; t < ms; t += 300) { await sleep(300); if (pageSig() !== was) { await sleep(pause('settleMs', 600)); return true; } } return false; }
  async function typeAndSubmit(el, value) {
    const was = pageSig();
    setValue(el, value); pressEnter(el);
    if (await waitChange(was, 2500)) return 'search box + Enter';
    const btn = searchButton(el);
    if (btn) { try { btn.click(); } catch (e) { note(e); } if (await waitChange(was, 6000)) return 'search box + its search button'; }
    if (el.form) { st.navigating = true; try { el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit(); } catch (e) { note(e); } if (await waitChange(was, 6000)) return 'search box + its form'; }
    return null;
  }
  const US_TEXT = /^(?:united states(?: of america)?|usa|u\.s\.a?\.?|us)(?:\s*[\(\[]\s*[\d,]+\s*[\)\]])?(?:\s*[\d,]+)?$/i;
  function usChoice(root) {
    for (const el of (root || D).querySelectorAll('label, button, a, li, span, div, [role="checkbox"], [role="option"], [role="menuitemcheckbox"]')) {
      if (!visible(el) || el.children.length > 3) continue;
      const t = norm(el.textContent); if (!US_TEXT.test(t)) continue;
      // Only a control in a filter area — a job card that says "United States" is not a filter.
      const a = el.closest('a[href]'); if (a) { try { if (isJobHref(new URL(a.getAttribute('href'), W.location.href), t)) continue; } catch (e) { continue; } }
      if (!el.closest('[class*="filter" i], [class*="facet" i], [class*="refine" i], [id*="filter" i], [id*="facet" i], aside, fieldset, [role="group"], [role="listbox"], [role="menu"], [role="dialog"], form, [class*="dropdown" i], [aria-label*="filter" i]')) continue;
      return el;
    }
    return null;
  }
  // A choice some sites only act on when their Search / Find button is pressed.
  async function submitNear(el, was, how) {
    if (await waitChange(was, 2500)) return how;
    const btn = searchButton(el);
    if (btn) { try { btn.click(); } catch (e) { note(e); } if (await waitChange(was, 6000)) return `${how} + its search button`; }
    return `${how} (the list did not change)`;
  }
  async function setLocation() {
    const was = pageSig();
    // a) a dropdown that offers the United States
    for (const sel of D.querySelectorAll('select')) {
      if (!visible(sel) && !visible(sel.parentElement)) continue;
      const opt = [...sel.options].find((o) => US_TEXT.test(norm(o.textContent)) || /^(?:us|usa)$/i.test(o.value));
      if (!opt) continue;
      if (sel.value === opt.value) return 'already set (dropdown)';
      const set = Object.getOwnPropertyDescriptor(W.HTMLSelectElement.prototype, 'value').set; set.call(sel, opt.value);
      sel.dispatchEvent(new W.Event('input', { bubbles: true })); sel.dispatchEvent(new W.Event('change', { bubbles: true }));
      return submitNear(sel, was, 'dropdown');
    }
    // b) a checkbox / button in a filter panel, opening a collapsed "Country" / "Location" section first
    let el = usChoice();
    if (!el) {
      for (const t of D.querySelectorAll('button, [role="button"], summary, [aria-expanded="false"], h2, h3, h4, legend')) {
        if (!visible(t) || !/^(?:countr(?:y|ies)|locations?|regions?|where|country\/region|location\s*\/\s*country)\b/i.test(norm(t.textContent))) continue;
        try { t.click(); } catch (e) { /* ignore */ } await sleep(700); el = usChoice(); if (el) break;
      }
    }
    if (el) {
      const box = el.tagName === 'LABEL' ? (el.control || el.querySelector('input')) : el.querySelector && el.querySelector('input[type="checkbox"], input[type="radio"]');
      if (box && box.checked) return 'already set (filter)';
      try { (box || el).click(); } catch (e) { note(e); }
      await waitChange(was, 6000); return 'filter panel';
    }
    // c) a location box with a type-ahead
    const inp = [...D.querySelectorAll('input')].find((x) => typable(x) && LOC_HINT.test(hintOf(x)));
    if (inp) {
      setValue(inp, 'United States');
      for (let i = 0; i < 10; i++) {
        await sleep(400);
        const opt = [...D.querySelectorAll('[role="option"], [role="listbox"] li, [class*="suggest" i] li, [class*="suggest" i] button, [class*="autocomplete" i] li, [class*="typeahead" i] li, [class*="dropdown" i] li')]
          .find((o) => visible(o) && /^united states(?: of america)?\b/i.test(norm(o.textContent)) && norm(o.textContent).length < 60);
        if (opt) { try { opt.click(); } catch (e) { note(e); } return submitNear(inp, was, 'location box + suggestion'); }
      }
      const r = await typeAndSubmit(inp, 'United States');
      return r ? `location box (${r.replace('search box', 'typed')})` : null;
    }
    return null;
  }
  async function applyFilters({ keywords, location }) {
    const before = { links: jobLinks().length, total: siteTotal() };
    st.applied = []; st.missed = [];
    if (location) { const how = await setLocation(); if (how) st.applied.push({ what: 'location', how }); else st.missed.push('location: no United States filter on this page'); }
    if (keywords) {
      const box = searchBox();
      if (!box) st.missed.push('keywords: no search box on this page');
      else { const how = await typeAndSubmit(box, keywords); if (how) st.applied.push({ what: 'keywords', how }); else st.missed.push('keywords: typed into the search box but the list did not change'); }
    }
    st.before = before; st.after = { links: jobLinks().length, total: siteTotal() };
  }

  // ---- commands -----------------------------------------------------------------------------------
  const op = cmd && cmd.op;
  if (op === 'scout') {
    const links = jobLinks();
    let searchForm = null;
    for (const inp of D.querySelectorAll('input[type="search"], input[type="text"], input:not([type])')) {
      const hint = `${inp.name} ${inp.id} ${inp.placeholder} ${inp.getAttribute('aria-label') || ''}`;
      if (!/keyword|search|job|title|query|what|role/i.test(hint) || !visible(inp)) continue;
      const form = inp.form;
      searchForm = { name: inp.name || null, inForm: !!form, method: form ? String(form.method || 'get').toLowerCase() : null, action: form ? form.action || W.location.href : null };
      break;
    }
    return JSON.stringify({ url: W.location.href, title: norm(D.title).slice(0, 200), h1: D.querySelector('h1') ? norm(D.querySelector('h1').textContent).slice(0, 200) : '',
      notFound: /\b(?:404|page not found|not found|no longer available)\b/i.test(`${D.title} ${D.querySelector('h1') ? D.querySelector('h1').textContent : ''}`),
      jobLinks: links.length, sample: links.slice(0, 5).map((l) => l.title || l.url), siteTotal: siteTotal(), recipe: recipe(), deeper: deeperLinks(), searchForm,
      careerish: /career|job|opening|position|hiring|vacanc/i.test(`${W.location.href} ${D.title} ${D.body ? norm(D.body.textContent).slice(0, 5000) : ''}`) });
  }
  if (op === 'poll') {
    return JSON.stringify({ running: st.running, op: st.op, method: st.method || null, detail: st.detail || null, listed: st.listed || 0, siteTotal: st.siteTotal || null,
      pages: st.pages || 1, next: st.next || null, done: st.done || 0, noData: st.noData || 0, failed: st.failed || 0, ready: st.op === 'list' ? (st.running ? 0 : st.items.length) : st.out.length,
      applied: st.applied || [], missed: st.missed || [], before: st.before || null, after: st.after || null, url: W.location.href,
      errors: st.errors.slice(-5), notes: st.notes.slice(-5) });
  }
  if (op === 'take') { const n = Math.max(1, Math.min(200, Number(cmd.n) || 50)); return JSON.stringify(st.op === 'list' ? st.items.splice(0, n) : st.out.splice(0, n)); }
  if (st.running) return JSON.stringify({ started: false, already: true });
  if (op === 'list') {
    Object.assign(st, { running: true, op: 'list', method: null, detail: null, listed: 0, siteTotal: null, pages: 1, next: null, items: [], out: [], errors: [], notes: [], recipe: recipe() });
    const max = Math.max(1, Math.min(20000, Number(cmd.maxJobs) || 5000));
    (async () => {
      try {
        let list = [];
        if (st.recipe === 'tesla') { try { list = await listFromTesla(); st.method = 'tesla_feed'; } catch (e) { note(e); } }
        if (!list.length && st.recipe === 'workday') { try { list = await listFromWorkday(max, cmd.keywords); st.method = 'workday_api'; st.siteFiltered = !!cmd.keywords; } catch (e) { note(e); } }
        if (!list.length) { try { list = await replayFeeds(max, siteTotal()); } catch (e) { note(e); } }
        // Never stop at one source: when a feed found fewer jobs than the site says it has (or none), walk
        // the visible pages too. Clicking Next makes the page fire its own listing request, which the spy
        // records — so a feed is tried again afterwards, and everything is merged (one job = one key).
        const total = () => st.siteTotal || siteTotal() || 0;
        const merged = new Map(); const keyOf = (j) => (j.url ? (() => { try { return jobKey(j.url); } catch (e) { return j.url; } })() : `id:${j.id}`);
        const add = (xs) => { for (const j of xs) { const k = keyOf(j); if (!merged.has(k)) merged.set(k, j); else if (!merged.get(k).description && j.description) merged.set(k, { ...merged.get(k), ...j }); } };
        add(list);
        const method0 = st.method;
        if (!list.length || (total() && list.length < total() * 0.95)) {
          const fromPage = await listFromPage(max);
          add(fromPage);
          if (!st.next && (!total() || merged.size < total() * 0.95)) { try { const again = await replayFeeds(max, total()); if (again.length) { add(again); st.method = st.method || 'site_feed'; } } catch (e) { note(e); } }
          st.method = method0 && fromPage.length ? `${method0}+page` : method0 || (st.method && st.method !== 'page' ? `page+${st.method}` : 'page');
        }
        st.items = [...merged.values()].slice(0, max); st.listed = st.items.length;
      } catch (e) { fail(e); } finally { st.running = false; }
    })();
    return JSON.stringify({ started: true });
  }
  if (op === 'filter') {
    Object.assign(st, { running: true, op: 'filter', applied: [], missed: [], errors: [], notes: [], before: null, after: null });
    (async () => { try { await applyFilters({ keywords: cmd.keywords ? String(cmd.keywords).slice(0, 120) : '', location: !!cmd.us }); } catch (e) { fail(e); } finally { st.running = false; } })();
    return JSON.stringify({ started: true });
  }
  if (op === 'detail') {
    const items = Array.isArray(cmd.items) ? cmd.items.slice(0, 200) : [];
    Object.assign(st, { running: true, op: 'detail', detail: null, done: 0, noData: 0, failed: 0, out: [], errors: [], notes: [], recipe: cmd.recipe || recipe(), workdayApi: cmd.workdayApi || (workdayBase() || {}).api || null });
    (async () => {
      let i = 0;
      const worker = async () => { while (i < items.length) { const it = items[i++]; await detail(it); st.done++; await sleep(pause('jobPauseMs', 300)); } };
      try { await Promise.all([worker(), worker()]); } catch (e) { fail(e); } finally { st.running = false; }
    })();
    return JSON.stringify({ started: true });
  }
  return JSON.stringify({ error: 'unknown op' });
}

/** The eval text that runs one agent command in the page. */
export const agentJs = (cmd) => `(${careerAgent.toString()})(${JSON.stringify(cmd)})`;
