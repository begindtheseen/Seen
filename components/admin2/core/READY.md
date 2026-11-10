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
