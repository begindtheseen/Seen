# admin2 core — READY (A2, 2026-11-10)

The core API below is stable. Build sections on it; read `../README.md` first, then `devlab/LabSection.tsx`.

```ts
// data
useApi(): <T>(action, body?, { timeoutMs?, signal?, noReauth? }) => Promise<(AdminOk & T) | AdminErr>
useAdminQuery<T>(key, () => api<T>(action, body), { staleMs?, refetchOnFocus?, enabled? })
  → { data, error, loading, fetching, updatedAt, refresh }
useAdminList<Row>(key, ({ after }) => api<AdminList<Row>>(action, { ...filters, after }), { staleMs?, idOf? })
  → { rows, total, hasMore, loadMore, loadingMore, newCount, showNew, data, error, loading, fetching, refresh }
// writes
useAdminAction(action, { optimistic?(tx, args), onRows?(rows, cache, args), onSettled?(res, args), partialTouched?, timeoutMs? })
  → { run(args, target?), state(target?), busy(target?), undo(target?), retry(target?), dismiss(target?) }
  tx: { patch(keyPrefix | (key)=>bool, fn), removeRows(keyPrefix, ids), rollback() }
// long jobs
useAdminJob({ action, args?, label, past, noun, total?, initial? }) → { job, running, start, cancel, resume, dismiss }
useAdminJob(...).undo()          // a finished job's Undo (job.undo: last round's undo, kept while every round had one request_id)
useAdminJobs() → Job[]            // Job.last_message = the server's sentence for the last round
// files
useAdminDownload() → { run(endpoint, body?, { fallbackName?, timeoutMs? }), state, busy, retry, dismiss }
saveText(text, filename, type?)   // core/api.ts, for CSV/JSON returned inside an action's answer
// places
useShell() → { section, goSection(s, filter?), openItem(kind, id), closeItem, openPanel, closePanel, sheetOpen, username, signOut }
useUrlFilter(section, name, fallback) → [value, set]
afterSheetClose(fn)  // URL changes right after closing a panel
// registries
core/sections.tsx  SECTIONS[].load          core/items.tsx  ITEM_VIEWS[kind]
```

Primitives: `ui/` (SectionHeader, StatStrip/StatTile, QueueRow, List/Row/RowActions/BulkBar, ConfirmStep,
ResultLine, JobProgress/JobChip, EmptyState/ErrorState/RefreshFailed/Skeleton, SearchField, FilterChips,
StatusChip, KeyHint). Item views: `ItemNotFound` from `core/SheetHost.tsx`.

Verified: `node --test components/admin2/**/*.test.mjs` (core 23, admin2 rules 7, today 5) and
`scripts/admin-smoke.mjs` 161/161 at 390×844 and 1280×800 against a lab build; Today, search, an expired
session (sign in → replay) and /admin/legacy checked against A1's real handlers on the director's rig.

## Round 6 (judge D) — what sections adopt
- **History:** a section change PUSHES one entry (Back walks back through sections; only the first leaves /admin);
  filters/kinds still replace. An open `ConfirmStep` owns a Back (Back cancels the step). While a job runs, leaving
  /admin asks the browser's "Leave site?" (beforeunload). Nothing to do in a section.
- **Results where he is:** every `useAdminAction` result is pinned to the shell's **result dock** (above the job bar on a
  phone, bottom-right on desktop) with Undo / Retry / Check again, until dismissed or replaced — automatic; opt out with
  `useAdminAction(action, { dock: false })`. **Pass your row actions to the list:** `<List … actions={[decide, moderate]} />`
  — a row that leaves because one of them ran keeps its slot for 6 s as that action's result line with Undo.
- **request_id on every write:** `useAdminAction` adds `request_id` to every run (unless you pass one) and reuses it on
  Retry, "Check again" and the sign-in replay. Remove hand-made ids only if you want; a passed `request_id` is kept.
- **Unknown outcomes:** a timeout / empty / unreadable answer / bare 502-504 / `in_progress` is CHECKED (same request_id
  re-asked: 1.5 s, 3 s, 6 s, 12 s) with the word "Checking", then shows the server's true answer; if still unknown:
  "Not known yet … Check again" (state.error.code `unknown_outcome`). No sentence says "refresh" or "reload".
- **Declined sign-in / any failure:** the optimistic patch is rolled back (row comes back).
- **After a reload mid-job:** the job shows "Checking what was done…" and asks the server (`job_status`
  `{ job_action, args, cursor }` → `{ remaining, done, complete }` — A1); finished there → done, no Resume. Without that
  action it says plainly the last round is not known — never "cleared 0".
- **Labels:** ResultLine while undoing says "Undoing — putting N back…"; `<ResultLine followUp={job} />` replaces a
  "… · still updating" line with the finished job's sentence; a job Undo is labelled "Undoing — putting N <noun> back".
  Undoing an audit id anywhere (activity log `undo` action, a line's Undo, a job's Undo) clears every other line and job
  still offering that Undo.
- **Narrow widths:** `SearchField` uses `placeholderShort` (or the placeholder cut at a whole word) under 560px; admin
  selects size to their label and take the full row on a phone.
