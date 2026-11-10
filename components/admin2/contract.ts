// The admin contract — the ONE shape every admin action answers with and every admin screen reads.
// Server: lib/server/admin/respond.js builds these. Client: components/admin2/core reads them.
// Rules: `changed` is the number of rows actually written (counted from the write, never assumed);
// `message` is one plain sentence that says what happened; an action never asks the page to reload.

export const ADMIN_SECTIONS = ['today', 'review', 'listings', 'companies', 'people', 'system'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** What `?item=<kind>:<id>` can open. One sheet at a time. */
export type AdminItemKind =
  | 'report' | 'job' | 'company' | 'user' | 'ticket' | 'dispute' | 'claim' | 'reply' | 'purchase' | 'issue' | 'cluster';

export type AdminSkipped = { reason: string; count: number; ids?: string[] };
export type AdminUndo = { action: string; args: Record<string, unknown>; label: string; expires_at?: string };

export type AdminOk<Row = Record<string, unknown>> = {
  ok: true;
  changed: number;
  skipped: AdminSkipped[];
  /** "until done" jobs: rows still to do, whether the job is finished, and where to resume. */
  remaining?: number;
  complete?: boolean;
  cursor?: string;
  message: string;
  undo?: AdminUndo;
  /** Cache keys this action made stale (see AdminCacheKey). Only these are re-read. */
  touched: string[];
  /** Updated rows, for in-place replacement. */
  rows?: Row[];
};

export type AdminErr = {
  ok: false;
  error: string;
  /** 'unauthorized' | 'bad_request' | 'not_found' | 'conflict' | 'timeout' | 'upstream' | 'unknown_action' */
  code: string;
  retryable: boolean;
  /** Partial work, when some rows were written before the failure. */
  changed?: number;
  remaining?: number;
};

export type AdminResponse<Row = Record<string, unknown>> = AdminOk<Row> | AdminErr;

/** Every list is keyset-paged: pass `after` = the previous answer's `next`. Never offset, never a silent cap. */
export type AdminList<Row> = { ok: true; rows: Row[]; next?: string; total?: number | null; as_of?: string };

export type AdminCacheKey =
  | 'overview' | 'held' | 'reports' | 'report_dupes' | 'tickets' | 'disputes' | 'issues' | 'claims' | 'replies' | 'purchases'
  | 'listings' | 'listing_counts' | 'job_dupes' | 'sources' | 'companies' | 'company_dupes' | 'merges'
  | 'users' | 'clusters' | 'signups' | 'revenue' | 'flags' | 'crons' | 'errors' | 'activity'
  | `company:${string}` | `user:${string}` | `job:${string}` | `report:${string}`;

export type AdminQueueKey =
  | 'held_reports' | 'listing_tickets' | 'reddit_disputes' | 'employer_claims' | 'employer_replies'
  | 'purchases_to_fulfil' | 'data_issues' | 'account_clusters';

/** action: 'overview' — the Today screen. A null number means that count could not be read (never shown as 0). */
export type AdminOverview = {
  ok: true;
  as_of: string;
  degraded: boolean;
  failed: string[];
  stats: {
    listings_live: number | null;
    listings_stale: number | null;
    reports_24h: number | null;
    signups_24h: number | null;
    revenue_7d_cents: number | null;
  };
  queues: Array<{ key: AdminQueueKey; label: string; count: number | null; section: AdminSection; filter?: Record<string, string> }>;
  system: { ok: boolean; line: string; failing?: Array<{ name: string; last_run: string | null; detail: string }> };
};

/** action: 'search' { q } — one box for an email, a company, a listing id or URL, a report id. */
export type AdminSearch = {
  ok: true;
  q: string;
  results: Array<{ kind: AdminItemKind; id: string; title: string; sub?: string }>;
};

/** action: 'activity_log' { after?, action?, target? } — admin_audit_log, newest first. */
export type AdminActivityRow = {
  id: string;
  at: string;
  admin: string;
  action: string;
  target_kind: AdminItemKind | 'bulk' | 'system' | null;
  target_id: string | null;
  summary: string;
  undoable: boolean;
};

/** action: 'cron_health' — one row per cron in vercel.json. 'unknown' when no run has been recorded. */
export type AdminCron = {
  name: string;
  path: string;
  schedule: string;
  last_run: string | null;
  last_result: 'ok' | 'failed' | 'partial' | 'unknown';
  next_run: string | null;
  overdue: boolean;
  detail?: string;
};

/** A long job tracked by the shell's job manager (survives section changes; resumable after a reload). */
export type AdminJobState = {
  id: string;
  action: string;
  label: string;
  status: 'running' | 'cancelling' | 'done' | 'error' | 'cancelled';
  changed: number;
  remaining: number | null;
  rounds: number;
  message: string;
  cursor?: string;
  started_at: string;
};
