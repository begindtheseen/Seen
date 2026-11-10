// One validator for components/admin2/contract.ts — run over every action's answer in the tests.
// Returns a list of problems ([] = the answer matches the contract).

const CODES = new Set(['unauthorized', 'bad_request', 'not_found', 'conflict', 'timeout', 'upstream', 'unknown_action', 'forbidden', 'rate_limited', 'not_available']);
const KEYS = new Set(['overview', 'held', 'reports', 'report_dupes', 'tickets', 'disputes', 'issues', 'claims', 'replies', 'purchases', 'listings', 'listing_counts', 'job_dupes', 'sources', 'companies', 'company_dupes', 'merges', 'users', 'clusters', 'signups', 'revenue', 'flags', 'crons', 'errors', 'activity']);
const KEY_PREFIX = /^(?:company|user|job|report):.+$/;
const KINDS = new Set(['report', 'job', 'company', 'user', 'ticket', 'dispute', 'claim', 'reply', 'purchase', 'issue', 'cluster']);
const QUEUE_KEYS = new Set(['held_reports', 'listing_tickets', 'reddit_disputes', 'employer_claims', 'employer_replies', 'purchases_to_fulfil', 'data_issues', 'account_clusters']);
const SECTIONS = new Set(['today', 'review', 'listings', 'companies', 'people', 'system']);

const isInt = (n) => Number.isInteger(n) && n >= 0;
const isStr = (s) => typeof s === 'string' && s.length > 0;
const nullableNum = (n) => n === null || typeof n === 'number';

export function checkOk(x) {
  const p = [];
  if (!x || x.ok !== true) p.push('ok must be true');
  if (!isInt(x?.changed)) p.push(`changed must be a whole number (got ${JSON.stringify(x?.changed)})`);
  if (!Array.isArray(x?.skipped)) p.push('skipped must be an array');
  else x.skipped.forEach((s, i) => { if (!isStr(s?.reason) || !isInt(s?.count) || (s.ids !== undefined && !Array.isArray(s.ids))) p.push(`skipped[${i}] must be {reason, count, ids?}`); });
  if (!isStr(x?.message)) p.push('message must be a sentence');
  if (!Array.isArray(x?.touched)) p.push('touched must be an array');
  else x.touched.forEach((k) => { if (!KEYS.has(k) && !KEY_PREFIX.test(k)) p.push(`touched has an unknown cache key: ${k}`); });
  if (x?.remaining !== undefined && !isInt(x.remaining)) p.push('remaining must be a whole number when present');
  if (x?.complete !== undefined && typeof x.complete !== 'boolean') p.push('complete must be boolean when present');
  if (x?.cursor !== undefined && typeof x.cursor !== 'string') p.push('cursor must be a string when present');
  if (x?.undo !== undefined) {
    const u = x.undo;
    if (!isStr(u?.action) || !u.args || typeof u.args !== 'object' || !isStr(u.label) || (u.expires_at !== undefined && typeof u.expires_at !== 'string')) p.push('undo must be {action, args, label, expires_at?}');
  }
  if (x?.rows !== undefined && !Array.isArray(x.rows)) p.push('rows must be an array when present');
  return p;
}

export function checkList(x, rowCheck = null) {
  const p = [];
  if (!x || x.ok !== true) p.push('ok must be true');
  if (!Array.isArray(x?.rows)) p.push('rows must be an array');
  if (x?.next !== undefined && typeof x.next !== 'string') p.push('next must be a string when present');
  if (x?.total !== undefined && !nullableNum(x.total)) p.push('total must be number|null when present');
  if (x?.as_of !== undefined && typeof x.as_of !== 'string') p.push('as_of must be a string when present');
  if (rowCheck && Array.isArray(x?.rows)) x.rows.forEach((r, i) => rowCheck(r).forEach((e) => p.push(`rows[${i}]: ${e}`)));
  return p;
}

export function checkErr(x) {
  const p = [];
  if (!x || x.ok !== false) p.push('ok must be false');
  if (!isStr(x?.error)) p.push('error must be a sentence');
  if (!CODES.has(x?.code)) p.push(`code must be a known code (got ${x?.code})`);
  if (typeof x?.retryable !== 'boolean') p.push('retryable must be boolean');
  if (x?.changed !== undefined && !isInt(x.changed)) p.push('changed must be a whole number when present');
  if (x?.remaining !== undefined && !isInt(x.remaining)) p.push('remaining must be a whole number when present');
  return p;
}

export function checkOverview(x) {
  const p = [];
  if (x?.ok !== true) p.push('ok must be true');
  if (!isStr(x?.as_of)) p.push('as_of');
  if (typeof x?.degraded !== 'boolean') p.push('degraded must be boolean');
  if (!Array.isArray(x?.failed)) p.push('failed must be an array');
  for (const k of ['listings_live', 'listings_stale', 'reports_24h', 'signups_24h', 'revenue_7d_cents']) if (!nullableNum(x?.stats?.[k])) p.push(`stats.${k} must be number|null`);
  if (!Array.isArray(x?.queues)) p.push('queues must be an array');
  else x.queues.forEach((q, i) => {
    if (!QUEUE_KEYS.has(q.key) || !isStr(q.label) || !nullableNum(q.count) || !SECTIONS.has(q.section)) p.push(`queues[${i}] shape`);
    if (q.count === null && !x.failed.includes(q.key)) p.push(`queues[${i}] is null but not named in failed`);
  });
  if (typeof x?.system?.ok !== 'boolean' || !isStr(x?.system?.line)) p.push('system must be {ok, line}');
  if (x?.degraded !== (x?.failed?.length > 0)) p.push('degraded must equal failed.length > 0');
  return p;
}

export function checkSearch(x) {
  const p = [];
  if (x?.ok !== true || typeof x?.q !== 'string' || !Array.isArray(x?.results)) p.push('search must be {ok, q, results[]}');
  else x.results.forEach((r, i) => { if (!KINDS.has(r.kind) || !isStr(String(r.id ?? '')) || !isStr(r.title)) p.push(`results[${i}] shape`); });
  return p;
}

export function checkActivityRow(r) {
  const p = [];
  if (!isStr(r?.id) || !isStr(r?.at) || !isStr(r?.admin) || !isStr(r?.action) || !isStr(r?.summary) || typeof r?.undoable !== 'boolean') p.push('activity row fields');
  if (r?.target_kind !== null && !KINDS.has(r?.target_kind) && r?.target_kind !== 'bulk' && r?.target_kind !== 'system') p.push(`target_kind ${r?.target_kind}`);
  if (r?.target_id !== null && typeof r?.target_id !== 'string') p.push('target_id must be string|null');
  return p;
}

export function checkCron(r) {
  const p = [];
  if (!isStr(r?.name) || !isStr(r?.path) || !isStr(r?.schedule)) p.push('cron name/path/schedule');
  if (r?.last_run !== null && typeof r?.last_run !== 'string') p.push('last_run');
  if (!['ok', 'failed', 'partial', 'unknown'].includes(r?.last_result)) p.push('last_result');
  if (r?.next_run !== null && typeof r?.next_run !== 'string') p.push('next_run');
  if (typeof r?.overdue !== 'boolean') p.push('overdue');
  if (r?.last_run === null && r?.last_result !== 'unknown') p.push('no last run must read unknown');
  return p;
}
