// Fixture career sites for the career-site collector's end-to-end test (scripts/career-e2e/run.mjs).
// One HTTPS server answers for every host (the test Chromium maps all hosts to it); each host copies a
// real pattern the collector must get through:
//   www.voltmotors.com     Tesla-like: /careers landing → "Search jobs" → /careers/search/?site=US, a
//                          JavaScript app that loads 25 jobs per page from a JSON feed and pages with a
//                          Next BUTTON (no URL change); job pages have no JSON-LD (plain text only)
//   www.pagedworks.com     server-rendered /jobs/?page=N, 10 per page, rel=next links, tracking params on
//                          links, a page that repeats 2 jobs from the page before; JSON-LD job pages, and
//                          every 13th job page fails the FIRST time it is read (the second pass gets it)
//   www.morebuttonco.com   "Load more" button over data embedded in the page; job pages render their text
//                          in JavaScript (only a rendered frame sees it)
//   www.scrollco.com       infinite scroll; JSON-LD job pages
//   www.acmerobotics.com   /careers landing that links OUT to its Workday site
//   acme.wd5.myworkdayjobs.com  Workday: POST /wday/cxs/acme/External/jobs {limit, offset, searchText}
//   www.spaworks.com       single-page app: a search box with NO form, a Country dropdown, a Search button,
//                          10 jobs per page from POST /api/jobs/search {query, filters:{country},
//                          pagination:{page,pageSize}} — the first load happens before the agent arrives,
//                          so only the requests the page makes while we use it can be replayed
//   www.facetco.com        a filter sidebar: "Location" is collapsed; inside it, checkboxes "United States
//                          (n)" / "Germany (n)"; the keyword box reacts to Enter (keydown handler, no form);
//                          numbered page buttons (aria-current)
//   www.aheadco.com        a keyword box + a location TYPE-AHEAD ("United States" appears as a suggestion
//                          after typing), a "Find jobs" button, then "Load more"
// Every site also lists a few jobs outside the US, which must never be read.
import https from 'node:https';

const CITIES = ['Austin, TX', 'Fremont, CA', 'Reno, NV', 'Buffalo, NY', 'Palo Alto, CA', 'Remote', 'Chicago, IL', 'Seattle, WA'];
const ABROAD = ['Berlin, Germany', 'Shanghai, China', 'Toronto, ON'];
const ROLES = ['Software Engineer', 'Service Technician', 'Production Associate', 'Sales Advisor', 'Data Analyst', 'Electrical Engineer', 'Field Technician', 'Program Manager', 'Recruiter', 'Quality Inspector'];
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const desc = (title, co) => `${co} is hiring a ${title}. In this role you will work with a small team on real problems every day, own your work end to end, and learn quickly. You will need two years of related experience, clear written communication and a habit of finishing what you start. We offer health, dental and vision coverage, paid time off, a 401(k) match and paid parental leave. ${title} candidates who like hands-on work will thrive here.`;
export function makeJobs(n, abroad, seed) {
  const out = [];
  for (let i = 0; i < n + abroad; i++) {
    const role = ROLES[(i * 7 + seed) % ROLES.length];
    const id = String(100000 + seed * 1000 + i);
    out.push({ id, title: `${role}${i % 3 ? '' : ' II'}`, location: i < n ? CITIES[(i + seed) % CITIES.length] : ABROAD[i % ABROAD.length] });
  }
  return out;
}
export const SITES = {
  volt: { company: 'Volt Motors', jobs: makeJobs(137, 5, 1) },
  paged: { company: 'Paged Works', jobs: makeJobs(63, 4, 2) },
  more: { company: 'More Button Co', jobs: makeJobs(45, 3, 3) },
  scroll: { company: 'Scroll Co', jobs: makeJobs(60, 3, 4) },
  acme: { company: 'Acme Robotics', jobs: makeJobs(87, 6, 5) },
  spa: { company: 'Spa Works', jobs: makeJobs(130, 20, 6) },
  facet: { company: 'Facet Co', jobs: makeJobs(70, 10, 7) },
  ahead: { company: 'Ahead Co', jobs: makeJobs(50, 8, 8) },
};
const countryOf = (j) => (ABROAD.includes(j.location) ? (j.location.includes('Germany') ? 'Germany' : j.location.includes('China') ? 'China' : 'Canada') : 'United States');
const words = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
const matches = (j, q) => words(q).every((w) => j.title.toLowerCase().includes(w));
const ldPage = (host, S, re, p) => { const m = re.exec(p); if (!m) return null; const j = S.jobs.find((x) => x.id === m[1]); if (!j) return [404, page('Not found', '<h1>Not found</h1>')]; return [200, page(j.title, `<h1>${j.title}</h1>`, ld(j, S.company, `https://${host}${p}`))]; };
const us = (j) => !ABROAD.includes(j.location);
const page = (title, body, head = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><nav><a href="/">Home</a> <a href="/about">About</a></nav><main>${body}</main><footer>© fixture</footer></body></html>`;
const ld = (j, co, url) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: j.title, description: desc(j.title, co), hiringOrganization: { '@type': 'Organization', name: co }, url, identifier: j.id, datePosted: '2026-10-01', jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: j.location.split(',')[0], addressRegion: (j.location.split(', ')[1] || ''), addressCountry: us(j) ? 'US' : 'DE' } } })}</script>`;
export const hits = { pagedFirstFail: new Set() };

function handle(req, res) {
  const host = String(req.headers.host || '').split(':')[0];
  const u = new URL(req.url, `https://${host}`);
  const send = (code, body, type = 'text/html; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  const json = (v) => send(200, JSON.stringify(v), 'application/json');
  const p = u.pathname;
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    // ---- Volt Motors (Tesla-like) ----
    if (host === 'www.voltmotors.com') {
      const S = SITES.volt;
      if (p === '/careers' || p === '/careers/') return send(200, page('Careers | Volt Motors', `<h1>Build the future at Volt</h1><p>We are hiring across engineering, service and manufacturing.</p><a class="cta" href="/careers/search/?site=US">Search jobs</a> <a href="/careers/students">Students</a>`));
      if (p === '/careers/search/' || p === '/careers/search') return send(200, page('Search jobs | Volt Motors', `<h1>Open roles</h1><p id="count"></p><ul id="list"></ul><button id="next" type="button">Next</button>
<script>let pg=1;const site=new URLSearchParams(location.search).get('site')||'';async function load(){const r=await fetch('/api/careers/listings?site='+site+'&page='+pg+'&size=25');const d=await r.json();document.getElementById('count').textContent=d.total+' jobs';document.getElementById('list').innerHTML=d.results.map(j=>'<li class="job-row"><a href="/careers/search/job/'+j.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+j.id+'">'+j.title+'</a> <span class="loc">'+j.location+'</span></li>').join('');document.getElementById('next').disabled=pg*25>=d.total;}document.getElementById('next').onclick=()=>{pg++;load();};load();</script>`));
      if (p === '/api/careers/listings') { const size = Number(u.searchParams.get('size')) || 25; const pg = Number(u.searchParams.get('page')) || 1; const all = S.jobs; return json({ total: all.length, page: pg, results: all.slice((pg - 1) * size, pg * size) }); }
      const m = /^\/careers\/search\/job\/.*-(\d+)$/.exec(p);
      if (m) { const j = S.jobs.find((x) => x.id === m[1]); if (!j) return send(404, page('Not found', '<h1>Page not found</h1>')); return send(200, page(`${j.title} | Volt Motors`, `<h1>${j.title}</h1><p class="loc">${j.location}</p><div class="job-description"><p>${desc(j.title, S.company)}</p></div>`)); }
    }
    // ---- Paged Works (server-rendered pages) ----
    if (host === 'www.pagedworks.com') {
      const S = SITES.paged;
      if (p === '/careers' || p === '/careers/') return send(200, page('Careers at Paged Works', `<h1>Careers</h1><p>Join our team.</p><a href="/jobs/?page=1">View all openings</a>`));
      if (p === '/jobs/' || p === '/jobs') {
        const pg = Number(u.searchParams.get('page')) || 1; const size = 10; const all = S.jobs;
        let rows = all.slice((pg - 1) * size, pg * size);
        if (pg === 3) rows = all.slice(18, 20).concat(rows); // repeats 2 jobs from page 2
        const last = Math.ceil(all.length / size);
        return send(200, page(`Jobs — page ${pg}`, `<h1>Jobs</h1><p>Showing ${(pg - 1) * size + 1}–${Math.min(pg * size, all.length)} of ${all.length} jobs</p><ul>${rows.map((j) => `<li><a href="/jobs/${j.id}-${slug(j.title)}?utm_source=list&src=board">${j.title}</a> <span>${j.location}</span></li>`).join('')}</ul>
<nav class="pagination">${pg > 1 ? `<a rel="prev" href="/jobs/?page=${pg - 1}">Previous</a>` : ''} <span aria-current="page">${pg}</span> ${pg < last ? `<a rel="next" href="/jobs/?page=${pg + 1}">Next</a>` : ''}</nav>`));
      }
      const m = /^\/jobs\/(\d+)-/.exec(p);
      if (m) {
        const j = S.jobs.find((x) => x.id === m[1]); if (!j) return send(404, page('Not found', '<h1>Not found</h1>'));
        if (Number(j.id) % 13 === 0 && !hits.pagedFirstFail.has(j.id)) { hits.pagedFirstFail.add(j.id); return send(500, 'temporary error'); }
        return send(200, page(`${j.title}`, `<h1>${j.title}</h1><p>${desc(j.title, S.company)}</p>`, ld(j, S.company, `https://${host}${p}`)));
      }
    }
    // ---- More Button Co ("Load more" + JavaScript job pages) ----
    if (host === 'www.morebuttonco.com') {
      const S = SITES.more;
      if (p === '/careers/openings') return send(200, page('Openings', `<h1>${S.jobs.length} open positions</h1><div id="list"></div><button id="more">Load more</button>
<script>const DATA=${JSON.stringify(S.jobs)};let n=0;function show(){n+=15;document.getElementById('list').innerHTML=DATA.slice(0,n).map(j=>'<div class="job-card"><a href="/careers/openings/position/'+j.id+'">'+j.title+'</a><p>'+j.location+'</p></div>').join('');if(n>=DATA.length)document.getElementById('more').remove();}document.getElementById('more').onclick=show;show();</script>`));
      const m = /^\/careers\/openings\/position\/(\d+)$/.exec(p);
      if (m) { const j = S.jobs.find((x) => x.id === m[1]); if (!j) return send(404, page('Not found', '<h1>Not found</h1>')); return send(200, page(j.title, `<div id="app"></div><script>setTimeout(()=>{document.getElementById('app').innerHTML=${JSON.stringify(`<h1>${j.title}</h1><p>${j.location}</p><section class="description">${desc(j.title, S.company)}</section>`)};},300);</script>`)); }
    }
    // ---- Scroll Co (infinite scroll) ----
    if (host === 'www.scrollco.com') {
      const S = SITES.scroll;
      if (p === '/careers/jobs') return send(200, page('Jobs', `<h1>Jobs</h1><div id="list"></div><div style="height:2000px"></div>
<script>const DATA=${JSON.stringify(S.jobs)};let n=0;function more(){n=Math.min(DATA.length,n+20);document.getElementById('list').innerHTML=DATA.slice(0,n).map(j=>'<article class="job"><a href="/careers/jobs/'+j.id+'">'+j.title+'</a> · '+j.location+'</article>').join('');}more();addEventListener('scroll',()=>{if(innerHeight+scrollY>=document.body.scrollHeight-50)setTimeout(more,200);});</script>`));
      const m = /^\/careers\/jobs\/(\d+)$/.exec(p);
      if (m) { const j = S.jobs.find((x) => x.id === m[1]); if (!j) return send(404, page('Not found', '<h1>Not found</h1>')); return send(200, page(j.title, `<h1>${j.title}</h1>`, ld(j, S.company, `https://${host}${p}`))); }
    }
    // ---- Acme Robotics → Workday ----
    if (host === 'www.acmerobotics.com') {
      if (p === '/careers' || p === '/careers/') return send(200, page('Careers | Acme Robotics', `<h1>Work at Acme</h1><p>Robots for every warehouse.</p><a href="https://acme.wd5.myworkdayjobs.com/en-US/External">Search open positions</a>`));
      if (p === '/') return send(200, page('Acme Robotics', '<h1>Acme</h1><a href="/careers">Careers</a>'));
    }
    if (host === 'acme.wd5.myworkdayjobs.com') {
      const S = SITES.acme;
      const path = (j) => `/job/${slug(j.location)}/${slug(j.title)}_JR${j.id}`;
      if (p === '/en-US/External' || p === '/en-US/External/') return send(200, page('Acme Robotics Careers', `<div id="root">Loading…</div>
<script>fetch('/wday/cxs/acme/External/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({appliedFacets:{},limit:20,offset:0,searchText:''})}).then(r=>r.json()).then(d=>{document.getElementById('root').innerHTML='<p>'+d.total+' JOBS FOUND</p>'+d.jobPostings.map(j=>'<li><a href="/en-US/External'+j.externalPath+'">'+j.title+'</a> '+j.locationsText+'</li>').join('')+'<button aria-label="next">›</button>';});</script>`));
      if (p === '/wday/cxs/acme/External/jobs' && req.method === 'POST') {
        let q = {}; try { q = JSON.parse(body || '{}'); } catch { /* ignore */ }
        const words = String(q.searchText || '').toLowerCase().split(/\s+/).filter(Boolean);
        const all = S.jobs.filter((j) => words.every((w) => j.title.toLowerCase().includes(w)));
        const off = Number(q.offset) || 0; const lim = Math.min(20, Number(q.limit) || 20);
        return json({ total: all.length, jobPostings: all.slice(off, off + lim).map((j) => ({ title: j.title, externalPath: path(j), locationsText: j.location, postedOn: 'Posted Today' })) });
      }
      const m = /^\/wday\/cxs\/acme\/External(\/job\/.+)$/.exec(p);
      if (m) { const j = S.jobs.find((x) => path(x) === m[1]); if (!j) return send(404, '{}', 'application/json'); return json({ jobPostingInfo: { title: j.title, jobDescription: `<p>${desc(j.title, S.company)}</p>`, location: j.location, jobReqId: `JR${j.id}`, timeType: 'Full time', country: { descriptor: us(j) ? 'United States of America' : 'Germany' } } }); }
      if (/^\/en-US\/External\/job\//.test(p)) return send(200, page('Job', '<div id="root"></div>'));
    }

    // ---- Spa Works (single-page app, POST API, search box without a form, Country dropdown) ----
    if (host === 'www.spaworks.com') {
      const S = SITES.spa;
      if (p === '/careers' || p === '/careers/') return send(200, page('Careers | Spa Works', `<h1>Jobs at Spa Works</h1>
<div class="searchbar"><input id="q" placeholder="Search by job title or keyword"><select id="country" aria-label="Country"><option value="">All countries</option><option value="United States">United States</option><option value="Germany">Germany</option><option value="Canada">Canada</option></select><button id="go" type="button">Search</button></div>
<p id="count"></p><ul id="list"></ul><button id="next" type="button">Next</button>
<script>let st={query:'',country:'',page:1};const q=document.getElementById('q'),c=document.getElementById('country');q.addEventListener('input',e=>{st.query=e.target.value;});c.addEventListener('change',e=>{st.country=e.target.value;});
async function load(){const r=await fetch('/api/jobs/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:st.query,filters:{country:st.country},pagination:{page:st.page,pageSize:10}})});const d=await r.json();document.getElementById('count').textContent=d.data.totalCount+' results';document.getElementById('list').innerHTML=d.data.items.map(j=>'<li class="job-card"><a href="/careers/job/'+j.jobId+'">'+j.jobTitle+'</a> <span>'+j.city+'</span></li>').join('');document.getElementById('next').style.display=st.page*10>=d.data.totalCount?'none':'';}
document.getElementById('go').onclick=()=>{st.page=1;load();};document.getElementById('next').onclick=()=>{st.page++;load();};load();</script>`));
      if (p === '/api/jobs/search' && req.method === 'POST') {
        let b = {}; try { b = JSON.parse(body || '{}'); } catch { /* ignore */ }
        const all = S.jobs.filter((j) => matches(j, b.query) && (!b.filters?.country || countryOf(j) === b.filters.country));
        const pg = Number(b.pagination?.page) || 1, size = Math.min(10, Number(b.pagination?.pageSize) || 10);
        return json({ data: { totalCount: all.length, items: all.slice((pg - 1) * size, pg * size).map((j) => ({ jobId: j.id, jobTitle: j.title, city: j.location })) } });
      }
      const r = ldPage(host, S, /^\/careers\/job\/(\d+)$/, p); if (r) return send(...r);
    }
    // ---- Facet Co (collapsed Location filter with checkboxes, Enter-to-search box, numbered pages) ----
    if (host === 'www.facetco.com') {
      const S = SITES.facet;
      if (p === '/jobs' || p === '/jobs/') return send(200, page('Jobs | Facet Co', `<h1>Find your role</h1><div class="kw"><input id="kw" type="search" placeholder="Keywords"></div>
<aside class="filters"><button id="locbtn" aria-expanded="false">Location</button><div id="locs" hidden></div></aside><p id="count"></p><div id="list"></div><nav class="pagination" id="pages"></nav>
<script>const DATA=${JSON.stringify(S.jobs.map((j) => ({ ...j, country: countryOf(j) })))};let kw='',cs=new Set(),pg=1;
const box=document.getElementById('locs');const counts={};DATA.forEach(j=>counts[j.country]=(counts[j.country]||0)+1);box.innerHTML=Object.keys(counts).map(k=>'<label><input type="checkbox" value="'+k+'"> '+k+' ('+counts[k]+')</label>').join('<br>');
document.getElementById('locbtn').onclick=()=>{box.hidden=!box.hidden;};box.addEventListener('change',e=>{if(e.target.checked)cs.add(e.target.value);else cs.delete(e.target.value);pg=1;draw();});
document.getElementById('kw').addEventListener('keydown',e=>{if(e.key==='Enter'){kw=e.target.value.toLowerCase();pg=1;draw();}});
function draw(){const all=DATA.filter(j=>(!cs.size||cs.has(j.country))&&kw.split(/\\s+/).filter(Boolean).every(w=>j.title.toLowerCase().includes(w)));document.getElementById('count').textContent=all.length+' jobs';document.getElementById('list').innerHTML=all.slice((pg-1)*12,pg*12).map(j=>'<div class="job-row"><a href="/jobs/view/'+j.id+'">'+j.title+'</a> <em>'+j.location+'</em></div>').join('');const n=Math.ceil(all.length/12);document.getElementById('pages').innerHTML=Array.from({length:n},(_,i)=>'<button '+(i+1===pg?'aria-current="page"':'')+' data-p="'+(i+1)+'">'+(i+1)+'</button>').join('');}
document.getElementById('pages').onclick=e=>{const b=e.target.closest('button');if(b){pg=Number(b.dataset.p);draw();}};draw();</script>`));
      const r = ldPage(host, S, /^\/jobs\/view\/(\d+)$/, p); if (r) return send(...r);
    }
    // ---- Ahead Co (location type-ahead, Find jobs button, Load more) ----
    if (host === 'www.aheadco.com') {
      const S = SITES.ahead;
      if (p === '/careers' || p === '/careers/') return send(200, page('Careers | Ahead Co', `<h1>Careers</h1><div class="finder"><input id="what" placeholder="Job title"><div class="where"><input id="where" placeholder="City, state or country"><ul role="listbox" id="sugg"></ul></div><button id="find" type="button">Find jobs</button></div>
<p id="count"></p><div id="list"></div><button id="more" type="button">Load more</button>
<script>const DATA=${JSON.stringify(S.jobs.map((j) => ({ ...j, country: countryOf(j) })))};const PLACES=['United States','United Kingdom','Germany','Canada'];let what='',where='',n=0;
const sg=document.getElementById('sugg');document.getElementById('where').addEventListener('input',e=>{const v=e.target.value.toLowerCase();sg.innerHTML=v.length<2?'':PLACES.filter(x=>x.toLowerCase().startsWith(v.slice(0,6))).map(x=>'<li role="option">'+x+'</li>').join('');});
sg.onclick=e=>{const li=e.target.closest('li');if(li){where=li.textContent;document.getElementById('where').value=where;sg.innerHTML='';}};
document.getElementById('find').onclick=()=>{what=document.getElementById('what').value.toLowerCase();n=0;more();};
function rows(){return DATA.filter(j=>(!where||j.country===where)&&what.split(/\\s+/).filter(Boolean).every(w=>j.title.toLowerCase().includes(w)));}
function more(){const all=rows();n=Math.min(all.length,n+8);document.getElementById('count').textContent=all.length+' openings';document.getElementById('list').innerHTML=all.slice(0,n).map(j=>'<article class="job"><a href="/careers/opening/'+j.id+'">'+j.title+'</a> · '+j.location+'</article>').join('');document.getElementById('more').style.display=n>=all.length?'none':'';}
document.getElementById('more').onclick=more;more();</script>`));
      const r = ldPage(host, S, /^\/careers\/opening\/(\d+)$/, p); if (r) return send(...r);
    }
    send(404, page('Not found', '<h1>404 Page not found</h1>'));
  });
}
export function startSites({ port, key, cert }) {
  return new Promise((resolve) => { const s = https.createServer({ key, cert }, handle); s.listen(port, '127.0.0.1', () => resolve(s)); });
}
export const usCount = (k) => SITES[k].jobs.filter(us).length;
export const usMatching = (k, word) => SITES[k].jobs.filter((j) => us(j) && j.title.toLowerCase().includes(word)).length;
export const abroadCount = (k) => SITES[k].jobs.filter((j) => !us(j)).length;
