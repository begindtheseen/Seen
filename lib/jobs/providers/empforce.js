// EmpForce (Empower) Recruiting — the public job listing page and each posting's page.
//
// Tenant string: "<pod>/<company key as hex>", e.g. "na1/71748094ccab2a75" for Liberty Energy's board
// https://na1.empforce.com/Recruiting/Applicant/JobListings.aspx?Cd=cXSAlMyrKnU%3d.
// The board key (`Cd`) is base64 and CASE-SENSITIVE — the lower-cased "cxsalmyrknu=" answers an empty
// board (verified 2026-11-13) — while the registry lowercases every tenant. So the tenant holds the
// key's bytes as hex (lower case by nature) and the provider turns it back into the base64 `Cd`.
// A raw `Cd` is still accepted when it is not hex (a hand-entered tenant), used as given.
//
//   list:   GET https://<pod>.empforce.com/Recruiting/Applicant/JobListings.aspx?Cd=<cd>
//           → the job list is JSON in <span id="ctl00_CPH1_lblJobs">{"Data1":"[ …jobs… ]"}</span>:
//             { JobTitle, PostedJobId, Location ("Kermit, Texas, US"), AllLocations ("| Houston, Texas, US | …"),
//               Salary, SalaryType ("Hourly"|"Salary"), MinimumSalary, MaximumSalary, Currency_Code,
//               ShowCompensation, isSalaryVisible, PostedOn, WorkRemotely, url ("Job.aspx?Pd=…&Cd=…") }
//   detail: GET https://<pod>.empforce.com/Recruiting/Applicant/Job.aspx?Pd=<pd>&Cd=<cd>
//           → the posting text in <div id="ctl00_CPH1_divJobDescription"> (+ the Benefits block).
//
// Pay is kept only when the board shows it (ShowCompensation and isSalaryVisible) in US dollars; the
// period is the board's own SalaryType. Nothing is estimated.

import { buildJob, cleanDescription } from '../../server/jobSources.js';
import { pickCompanyName } from '../companyName.js';
import { payFields } from '../pay.js';
import { inUsMarket } from '../usLocation.js';
import { empforceKeyHex } from '../atsDetect.js';
import { request, makeBudget, callTimeout, mapWithin, rotated, plainText, rowsForPlaces, tidyCaps } from './common.js';

const POD_RE = /^[a-z0-9]{2,12}$/;
const HEX_RE = /^(?:[0-9a-f]{2}){4,64}$/;
const CD_RE = /^[A-Za-z0-9+/=_-]{4,120}$/;

/** "<pod>/<hex key | raw Cd>" → { pod, host, cd, key } or null. */
export function parseEmpforceTenant(value) {
  const parts = String(value || '').trim().split('/');
  if (parts.length !== 2) return null;
  const pod = parts[0].toLowerCase();
  if (!POD_RE.test(pod)) return null;
  const raw = parts[1];
  let cd;
  if (HEX_RE.test(raw)) cd = Buffer.from(raw, 'hex').toString('base64');
  else if (CD_RE.test(raw)) cd = raw;
  else return null;
  return { pod, host: `${pod}.empforce.com`, cd, key: HEX_RE.test(raw) ? raw : (empforceKeyHex(raw) || raw.toLowerCase()) };
}

/** The job list embedded in a JobListings.aspx page ([] when absent). */
export function empforceJobsFromPage(html) {
  const s = String(html || '');
  const m = s.match(/<span[^>]*\bid="ctl00_CPH1_lblJobs"[^>]*>([\s\S]*?)<\/span>/);
  if (!m) return [];
  let raw = m[1].trim();
  if (raw.startsWith('{&quot;')) raw = raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  try {
    const outer = JSON.parse(raw);
    const list = typeof outer?.Data1 === 'string' ? JSON.parse(outer.Data1) : outer?.Data1;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// The inner HTML of one `ctl00_CPH1_<id>` block: from its opening tag to the next block of the
// template (the posting's own HTML never carries the template's ids). Hidden blocks give ''.
function block(html, id) {
  const start = html.indexOf(`id="ctl00_CPH1_${id}"`);
  if (start < 0) return '';
  const tagEnd = html.indexOf('>', start);
  if (tagEnd < 0) return '';
  if (/display\s*:\s*none/i.test(html.slice(start, tagEnd))) return '';
  const next = html.indexOf('id="ctl00_CPH1_', tagEnd);
  return html.slice(tagEnd + 1, next < 0 ? Math.min(html.length, tagEnd + 60000) : next).replace(/<[^>]*$/, '');
}

/** A posting page → its whole text as HTML: the description, then the Benefits block. */
export function empforceDescriptionFromPage(html) {
  const s = String(html || '');
  // A block counts when it has text once read as text (cleanDescription is the same reader the row goes through).
  return [block(s, 'divJobDescription'), block(s, 'divJobBenefit')].filter((x) => cleanDescription(x).trim()).join('\n');
}

/** The pay the board shows for a job, through the one pay normaliser; nulls when it shows none. */
export function empforcePay(j, text = '') {
  const shown = j?.ShowCompensation === true && String(j?.isSalaryVisible ?? '1') === '1';
  const usd = !j?.Currency_Code || String(j.Currency_Code).toUpperCase() === 'USD';
  const lo = Number(j?.MinimumSalary) || 0; const hi = Number(j?.MaximumSalary) || 0;
  if (!shown || !usd || !(lo > 0 || hi > 0)) return { salary: null, salaryMin: 0 };
  const type = String(j.SalaryType || '');
  const period = /hour/i.test(type) ? 'hour' : /salary|annual|year/i.test(type) ? 'year' : null;
  const f = payFields({ min: lo, max: hi, period, text });
  return f.salary ? { salary: f.salary, salaryMin: f.salaryMin } : { salary: null, salaryMin: 0 };
}

export const empforce = {
  id: 'empforce', sourceType: 'ATS_DIRECT', ingestable: true,
  /**
   * @param {string} tenantValue "<pod>/<hex key>"
   * @param {{ companyName?: string, fetchImpl?: typeof fetch, timeoutMs?: number, budgetMs?: number, maxPostings?: number, concurrency?: number }} opts
   */
  async fetchCompanyJobs(tenantValue, { companyName, fetchImpl, timeoutMs = 15000, budgetMs = 60000, maxPostings = 1000, concurrency = 6, rotate } = {}) {
    const t = parseEmpforceTenant(tenantValue);
    if (!t) return [];
    const budget = makeBudget(budgetMs);
    const base = `https://${t.host}/Recruiting/Applicant/`;
    const page = await request(`${base}JobListings.aspx?Cd=${encodeURIComponent(t.cd)}`, { as: 'text', fetchImpl, timeoutMs: callTimeout(budget, timeoutMs) });
    const jobs = empforceJobsFromPage(page).slice(0, maxPostings);
    if (!jobs.length) return [];

    const seen = new Set();
    const wanted = jobs.filter((j) => {
      const id = String(j?.PostedJobId ?? '');
      if (!/^\d{1,12}$/.test(id) || seen.has(id) || j.Externall === false) return false;
      seen.add(id);
      const places = [j.Location, ...String(j.AllLocations || '').split('|')].map((x) => plainText(x)).filter(Boolean);
      return j.WorkRemotely === 1 || places.some((p) => inUsMarket(p));
    });
    const rows = await mapWithin(rotated(wanted, rotate), concurrency, budget, async (j) => {
      // The posting's public page, rebuilt from its own Pd + this board's Cd (never a foreign host).
      let pd = '';
      try { pd = new URL(String(j.url || ''), base).searchParams.get('Pd') || ''; } catch { pd = ''; }
      if (!/^[A-Za-z0-9+/=_-]{4,120}$/.test(pd)) return null;
      const applyUrl = `${base}Job.aspx?Pd=${encodeURIComponent(pd)}&Cd=${encodeURIComponent(t.cd)}`;
      const html = await request(applyUrl, { as: 'text', fetchImpl, timeoutMs: callTimeout(budget, timeoutMs) });
      const description = cleanDescription(empforceDescriptionFromPage(html));
      if (!description) return null;
      const title = plainText(tidyCaps(j.JobTitle));
      const placeTexts = [j.Location, ...String(j.AllLocations || '').split('|')].map((x) => plainText(x, 160)).filter(Boolean);
      const places = (placeTexts.length ? placeTexts : (j.WorkRemotely === 1 ? ['Remote'] : [])).map((text) => ({ text }));
      return {
        id: String(j.PostedJobId), title, description, applyUrl,
        places: [...places.filter((p) => inUsMarket(p.text)), ...places.filter((p) => !inUsMarket(p.text))],
        pay: empforcePay(j, `${title}\n${description}`),
        partTime: /part/i.test([j.HireType, j.WorkHours, j.ShiftName].filter(Boolean).join(' ')),
      };
    });

    const company = pickCompanyName({ registered: companyName, feed: '', tenant: t.pod });
    const tenantKey = `${t.pod}/${t.key}`;
    const out = rows.filter(Boolean).flatMap((r) => rowsForPlaces(r.places, (place) => buildJob({
      title: r.title,
      company,
      location: place.text,
      salary: r.pay.salary,
      salaryMin: r.pay.salaryMin,
      description: r.description,
      apply_url: r.applyUrl,
      source: 'EmpForce',
      type: r.partTime ? 'Part-time' : 'Full-time',
      searchQuery: r.title,
    }), { provider: 'empforce', tenant: tenantKey, externalId: `empforce:${tenantKey}:${r.id}`, applyUrl: r.applyUrl }));
    out.boardTotal = jobs.length; // the board's own count (fetchSourceJobs)
    return out;
  },
};
