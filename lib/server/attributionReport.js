// Admin "Where signups come from" (api/admin-stats.js GET ?action=signup_attribution&days=30).
//
// Pure grouping first (landingGroup / referrerGroup / aggregateAttribution — tested on their own), then
// one loader that reads the window's sign-ups from signup_attribution and, for those users only, what
// they did next:
//   tracked       ≥1 row in applications
//   pro_or_trial  started a Stripe subscription (any status, the no-card trial included), bought a
//                 one-time SKU, or carries Stripe's Pro flag (ai_credits.pro, set for trialing AND paying
//                 subscriptions). Reward days (pro_until from reports/invites) and admin comps are NOT a
//                 conversion and are not counted.
//   paid          money changed hands: a Stripe invoice with amount_paid > 0 for the user's customer, or a
//                 one-time purchase (credit_transactions reason purchase_*). Only when Stripe could be
//                 read; otherwise `paid_known: false` and the panel shows "Pro (incl. trial)" alone.
// Every PostgREST read is paged (one read returns at most 1,000 rows). The window starts at California
// midnight `days - 1` days ago (lib/time/pacific.js).

import { isMissingTable } from './growthRewards.js';
import { pacificDayStart } from '../time/pacific.js';

export const MAX_DAYS = 365;
export const TOP_COMPANIES = 20;
export const TOP_LIST = 20;
const PAGE = 1000;
const ID_CHUNK = 120;
const STRIPE_MAX_PAGES = 20;

export const LANDING_GROUPS = [
  ['company', 'Company pages'], ['jobs', 'Jobs'], ['agencies', 'Agencies'], ['home', 'Home'],
  ['pricing', 'Pricing'], ['faq', 'FAQ'], ['data', 'Data'], ['lists', 'Lists'], ['other', 'Other pages'],
];
export const REFERRER_GROUPS = [
  ['google', 'Google'], ['bing', 'Bing'], ['reddit', 'Reddit'], ['chatgpt', 'ChatGPT'], ['perplexity', 'Perplexity'],
  ['tiktok', 'TikTok'], ['linkedin', 'LinkedIn'], ['x', 'X / Twitter'], ['direct', 'Direct / none'], ['other', 'Other sites'],
];

const under = (p, base) => p === base || p.startsWith(`${base}/`);

/** The landing-page group for a path ('/company/walmart' → 'company'). */
export function landingGroup(path) {
  const p = String(path || '/').toLowerCase().replace(/\/+$/, '') || '/';
  if (p === '/') return 'home';
  if (p.startsWith('/company/')) return 'company';
  if (p.startsWith('/jobs')) return 'jobs';
  if (under(p, '/agencies')) return 'agencies';
  if (under(p, '/pricing')) return 'pricing';
  if (under(p, '/faq')) return 'faq';
  if (under(p, '/data')) return 'data';
  if (under(p, '/lists')) return 'lists';
  return 'other';
}

/** The company slug of a /company/<slug> path, decoded the way /company/[slug] reads it, or null. */
export function companyFromPath(path) {
  const m = /^\/company\/([^/]+)/i.exec(String(path || ''));
  if (!m) return null;
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch { /* keep the raw segment */ }
  slug = slug.toLowerCase().trim();
  return slug ? { slug, name: slug.replace(/-/g, ' ') } : null;
}

/** The referrer group for a hostname (null = direct / none). AI assistants are recognised by host. */
export function referrerGroup(host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return 'direct';
  if (/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(h) || h.startsWith('com.google.android.googlequicksearchbox')) return 'google';
  if (/(^|\.)bing\.com$/.test(h)) return 'bing';
  if (/(^|\.)reddit\.com$/.test(h) || h === 'redd.it') return 'reddit';
  if (h === 'chatgpt.com' || /(^|\.)chatgpt\.com$/.test(h) || h === 'chat.openai.com' || h === 'openai.com') return 'chatgpt';
  if (/(^|\.)perplexity\.ai$/.test(h)) return 'perplexity';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
  if (/(^|\.)linkedin\.com$/.test(h) || h === 'lnkd.in') return 'linkedin';
  if (h === 'x.com' || h === 't.co' || /(^|\.)twitter\.com$/.test(h)) return 'x';
  return 'other';
}

const blank = () => ({ signups: 0, tracked: 0, pro_or_trial: 0, paid: 0 });
function bump(map, key, extra, o) {
  const g = map.get(key) || { key, ...extra, ...blank() };
  g.signups += 1;
  if (o.tracked) g.tracked += 1;
  if (o.pro) g.pro_or_trial += 1;
  if (o.paid) g.paid += 1;
  map.set(key, g);
}
const bySignups = (a, b) => b.signups - a.signups || String(a.key).localeCompare(String(b.key));

/**
 * Group the window's sign-ups. `rows` = signup_attribution rows; `outcomes` = { tracked, pro, paid }
 * Sets of user ids (`paid` null when unknown → every paid count is null).
 */
export function aggregateAttribution(rows, { tracked = new Set(), pro = new Set(), paid = null } = {}) {
  const landing = new Map(), companies = new Map(), referrer = new Map(), otherHosts = new Map();
  const source = new Map(), campaign = new Map(), invite = new Map();
  const total = blank();
  for (const r of rows || []) {
    const o = { tracked: tracked.has(r.user_id), pro: pro.has(r.user_id), paid: !!paid && paid.has(r.user_id) };
    total.signups += 1;
    if (o.tracked) total.tracked += 1;
    if (o.pro) total.pro_or_trial += 1;
    if (o.paid) total.paid += 1;
    const lg = landingGroup(r.landing_path);
    bump(landing, lg, {}, o);
    if (lg === 'company') { const c = companyFromPath(r.landing_path); if (c) bump(companies, c.slug, { slug: c.slug, name: c.name }, o); }
    const rg = referrerGroup(r.referrer_host);
    bump(referrer, rg, {}, o);
    if (rg === 'other') bump(otherHosts, String(r.referrer_host).toLowerCase(), {}, o);
    bump(source, r.utm_source ? String(r.utm_source).toLowerCase() : '(none)', {}, o);
    bump(campaign, r.utm_campaign ? String(r.utm_campaign).toLowerCase() : '(none)', {}, o);
    bump(invite, r.ref_code ? 'invite' : 'no_invite', {}, o);
  }
  const fixed = (map, groups) => groups.map(([key, label]) => ({ key, label, ...blank(), ...(map.get(key) || {}) })).filter((g) => g.signups > 0);
  const top = (map, n) => [...map.values()].sort(bySignups).slice(0, n);
  const out = {
    total,
    by_landing: fixed(landing, LANDING_GROUPS).sort(bySignups),
    top_companies: top(companies, TOP_COMPANIES),
    by_referrer: fixed(referrer, REFERRER_GROUPS).sort(bySignups),
    other_referrers: top(otherHosts, TOP_LIST),
    by_utm_source: top(source, TOP_LIST),
    by_utm_campaign: top(campaign, TOP_LIST),
    by_invite: fixed(invite, [['invite', 'Invite link (?ref=)'], ['no_invite', 'No invite']]),
  };
  if (!paid) {
    const strip = (g) => ({ ...g, paid: null });
    out.total = strip(out.total);
    for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = out[k].map(strip);
  }
  return out;
}

/** Clamp ?days= to 1…365 (default 30). */
export function clampDays(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_DAYS) : 30;
}

async function readJson(r) {
  const text = await r.text().catch(() => '');
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/** Every row of a PostgREST read, page by page. { ok, rows, missing }. */
async function readAll(db, pathFor) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    let r;
    try { r = await db(pathFor(offset)); } catch { return { ok: false, rows }; }
    const body = await readJson(r);
    if (!r.ok) return { ok: false, rows, missing: isMissingTable(r.status, body) };
    if (!Array.isArray(body)) return { ok: false, rows };
    rows.push(...body);
    if (body.length < PAGE) return { ok: true, rows };
  }
}

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/** Every Stripe list item (subscriptions / invoices), paged by starting_after. null on any failure. */
async function stripeList(fetchImpl, key, path) {
  const items = [];
  let after = null;
  for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
    let r;
    try {
      r = await fetchImpl(`https://api.stripe.com/v1/${path}&limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ''}`, { headers: { Authorization: `Bearer ${key}` } });
    } catch { return null; }
    if (!r || !r.ok) return null;
    const d = await readJson(r);
    if (!d || !Array.isArray(d.data)) return null;
    items.push(...d.data);
    if (!d.has_more || !d.data.length) return { items, truncated: false };
    after = d.data[d.data.length - 1].id;
  }
  return { items, truncated: true };
}

/**
 * Load and group the report. `db` = the admin-stats PostgREST fetcher; `stripeKey` optional;
 * `fetchImpl` for Stripe (defaults to global fetch). Never throws on a failed read: a missing table is
 * { ready: false }, any other failed read is { ok: false, error }.
 */
export async function loadAttributionReport(db, { days, stripeKey = null, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const d = clampDays(days);
  const since = pacificDayStart(now, -(d - 1)).toISOString();
  const sel = 'user_id,landing_path,referrer_host,utm_source,utm_medium,utm_campaign,ref_code,account_created_at';
  const att = await readAll(db, (off) => `signup_attribution?select=${sel}&account_created_at=gte.${encodeURIComponent(since)}&order=user_id.asc&limit=${PAGE}&offset=${off}`);
  if (att.missing) return { ok: true, ready: false, days: d, since };
  if (!att.ok) return { ok: false, error: 'could not read signup_attribution' };
  const rows = att.rows;
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];

  const tracked = new Set(), pro = new Set(), purchased = new Set(), customerOf = new Map();
  for (const part of chunks(ids, ID_CHUNK)) {
    const inList = `in.(${part.join(',')})`;
    const [apps, credits, buys] = await Promise.all([
      readAll(db, (off) => `applications?select=user_id&user_id=${inList}&order=id.asc&limit=${PAGE}&offset=${off}`),
      readAll(db, (off) => `ai_credits?select=user_id,pro,comped,stripe_customer_id&user_id=${inList}&order=user_id.asc&limit=${PAGE}&offset=${off}`),
      readAll(db, (off) => `credit_transactions?select=user_id&reason=like.purchase_*&user_id=${inList}&order=id.asc&limit=${PAGE}&offset=${off}`),
    ]);
    if (!apps.ok || !credits.ok || !buys.ok) return { ok: false, error: 'could not read what these accounts did next' };
    for (const a of apps.rows) tracked.add(a.user_id);
    for (const c of credits.rows) {
      if (c.pro === true && c.comped !== true) pro.add(c.user_id);
      if (c.stripe_customer_id) customerOf.set(String(c.stripe_customer_id), c.user_id);
    }
    for (const b of buys.rows) { purchased.add(b.user_id); pro.add(b.user_id); }
  }

  // Stripe: a subscription of any status = a trial or plan was started; a paid invoice = money.
  let paid = null;
  let stripeNote = stripeKey ? null : 'Stripe not connected';
  let truncated = false;
  if (stripeKey && customerOf.size) {
    const [subs, invoices] = await Promise.all([
      stripeList(fetchImpl, stripeKey, 'subscriptions?status=all'),
      stripeList(fetchImpl, stripeKey, 'invoices?status=paid'),
    ]);
    if (subs && invoices) {
      truncated = subs.truncated || invoices.truncated;
      paid = new Set(purchased);
      for (const s of subs.items) { const u = customerOf.get(String(s.customer || '')); if (u) pro.add(u); }
      for (const inv of invoices.items) {
        const u = customerOf.get(String(inv.customer || ''));
        if (u && Number(inv.amount_paid) > 0) { paid.add(u); pro.add(u); }
      }
    } else stripeNote = 'Stripe could not be read';
  } else if (stripeKey) {
    paid = new Set(purchased); // no Stripe customer among these accounts: only one-time buys can count
  }

  return {
    ok: true,
    ready: true,
    days: d,
    since,
    paid_known: !!paid,
    paid_note: paid ? (truncated ? 'Stripe history longer than the pages read — paid may be undercounted' : null) : `${stripeNote} — showing Pro (incl. trial) only`,
    ...aggregateAttribution(rows, { tracked, pro, paid }),
  };
}
