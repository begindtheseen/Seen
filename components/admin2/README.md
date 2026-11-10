# components/admin2 — the new admin

`/admin` renders `core/AdminApp.tsx`. The previous admin is at `/admin/legacy` (same sign-in token,
`sessionStorage.admin_token`) until the owner accepts this one. The server contract is `contract.ts`;
the server's own shapes are in `lib/server/admin/SHAPES.md` (engineer A1).

```
contract.ts            the shapes every action answers with (do not change shapes; add optional fields)
core/                  the foundation: api, cache, actions, jobs, URL places, shell, sheet host, login
  api.ts               adminApi(action, body) → AdminOk | AdminErr; 401 → sign-in sheet → replay
  cache.ts             QueryCache: stale-while-revalidate, keyset lists, touched-only invalidation
  action.ts            the action pipeline (double-tap block, optimistic + rollback, Undo, Retry)
  jobs.ts              the job manager ("until done" loops, cancel, resume after reload)
  hooks.tsx            useAdminQuery · useAdminList · useAdminAction · useAdminJob · useAdminJobs · useAdminDownload · useApi
  place.ts             useSection · useItemPlace · useUrlFilter
  sections.tsx         THE section registry        items.tsx   THE item-sheet registry
  shellContext.ts      useShell(): goSection, openItem, openPanel, sheetOpen, signOut
  devlab/              the lab section (compiled only with NEXT_PUBLIC_ADMIN_LAB=1) — a reference section
ui/                    primitives on DESIGN.md tokens (below)
sections/<name>/       one folder per section
```

## Adding a section

1. Create `sections/<name>/<Name>Section.tsx` with a default export `(props: SectionProps) => JSX`.
2. In `core/sections.tsx` point the section's `load` at your module:
   `load: () => import('../sections/<name>/<Name>Section.tsx')`. That is the only shared line you edit.
3. Your section is mounted on first visit and then **kept mounted** (hidden) when the owner leaves —
   your `useState` (selection, half-typed fields, open confirm steps) survives a round trip. Do not
   reset state on `active` changes. Use `active` only to scope keyboard shortcuts.
4. Start with `<SectionHeader title="Review" sub="…" fetching={q.fetching && !!q.data} />` — it renders
   the screen's one `<h1>` and the refreshing hairline.

The reference is `core/devlab/LabSection.tsx` (list + URL filter + selection + bulk bar + row actions +
inline confirm + result line with Undo + a job + items in the sheet). Read it first.

## Reading data

```tsx
const api = useApi()
// one value
const q = useAdminQuery<AdminOverview>('overview', () => api<AdminOverview>('overview'), { staleMs: 30_000 })
// a keyset list — the KEY includes every filter, so each filter combination is its own cache entry
const [kind, setKind] = useUrlFilter('review', 'kind', 'held')
const list = useAdminList<HeldRow>(`held?kind=${kind}`, ({ after }) => api<AdminList<HeldRow>>('list_held_reports', { kind, after }))
<List rows={list.rows} idOf={(r) => r.id} noun="held reports" loading={list.loading} error={list.error}
      onRetry={list.refresh} total={list.total} hasMore={list.hasMore} loadingMore={list.loadingMore}
      onLoadMore={list.loadMore} newCount={list.newCount} onShowNew={list.showNew} renderRow={(r) => <Row … />} />
```

- **Stale-while-revalidate.** A re-read keeps the old data on screen (`fetching` → hairline). A failed
  re-read keeps the old data and sets `error` — `List` shows "Couldn't refresh — Retry" above the rows.
  A first read that fails shows `ErrorState` with Retry. A failed read is never drawn as empty.
- **Never re-ordered under the finger.** A re-read merges the first page in place: rows that left are
  removed, changed rows are replaced where they are, rows sliding up from page 2 go below, and NEW
  rows wait as `newCount` ("3 new rows — show") — unless the owner caused the re-read (his action's
  `touched`, a Refresh press): what he caused (Undo putting rows back) appears at once.
- **Adapters.** Keep every server shape behind a small pure adapter next to your section (see
  `sections/today/adapter.ts` + its test). A shape change is then a one-file edit. Missing or malformed
  numbers become `null` → "couldn't read", never 0.

### Cache keys

A key names the data, with its filters after `?`: `held?kind=held`, `listings?q=walmart`, `company:acme`,
`company:acme:reports`, `user:<id>`, `report:<id>`. An action's `touched` invalidates by prefix:

| touched        | re-reads                                              |
|----------------|-------------------------------------------------------|
| `held`         | `held`, `held?kind=…`, `held:…`                       |
| `company:acme` | `company:acme`, `company:acme:reports` (not `company:acmeco`) |
| `company:`     | every `company:*`                                     |

Only entries something is subscribed to are re-read immediately; the rest are marked stale and re-read
when they next mount. Nothing else is ever re-read — **never call a whole-dashboard refresh after an
action.** Use the contract's key names (`AdminCacheKey`) so the server's `touched` matches your keys.

## Writing an action

```tsx
const decide = useAdminAction('review_held', {
  optimistic: (tx, args) => tx.removeRows('held', args.ids as string[]),   // rolled back on failure
  onSettled: (res, args) => { if (res.ok) clearSelection(args.ids) },
})
<Button onClick={() => decide.run({ ids: [row.id], decision: 'approve' }, row.id)}>Approve</Button>
<ResultLine state={decide.state(row.id)} onUndo={() => decide.undo(row.id)} onRetry={() => decide.retry(row.id)}
            onDismiss={() => decide.dismiss(row.id)}
            skipLinks={{ possible_duplicate: { label: 'Review them', onSelect: () => setKind('dupes') } }} />
```

- `target` (2nd argument of `run`) scopes the double-tap block and the result line: a row id for a row
  action, `'bulk'` for the bulk bar. A second `run` on a busy target returns `{ code: 'busy' }` and
  sends nothing.
- A row that leaves the list takes its result line with it — keep the last row result at the section
  level (see the lab's `lastRow`) so its Undo stays reachable.
- The api turns every failure into an `AdminErr` with a sentence (network, timeout, empty body, HTML
  error page, 5xx). A 401 opens the "Session ended" step in the sheet and **replays the same call** after
  sign-in — you do nothing.
- **A big Undo becomes a job (added 2026-11-10, additive).** When the server's `undo` answers
  `complete:false` (it restores in rounds), `decide.undo(target)` hands it to the job manager: the result
  line says "Undo is running: 400 of 1,200 restored so far…", the shell chip shows "Restoring rows ·
  400 of 1,200", the owner can leave the section, Cancel, and resume after a reload. `state(target).jobId`
  names the job. Nothing to do in your section. (`JobSpec.initial` lets a job start from a round the
  caller already ran; a running total the server reports as `restored` wins over the summed `changed`.)
- Keep a `ConfirmStep` mounted with `busy` until the action settles (close it in `onSettled`): if it
  collapsed on the tap, a double tap would land on whatever moved up under the finger (found by the
  smoke test: a double tap on "Approve all" opened the first row's sheet).
- Never `window.confirm/alert/prompt`. A destructive action uses `ConfirmStep` inline (in the row via
  `Row below={…}` or in the item sheet). Type-to-confirm (`typeToConfirm="DELETE"`) for deleting an
  account and for the credit-system flag.
- Never reload the page, never `router.refresh()`, never re-read what the server did not touch.

## Long jobs ("until done")

```tsx
const job = useAdminJob({ action: 'purge_stale_jobs', label: 'Clearing stale listings', past: 'Cleared', noun: 'stale listings' })
// size known up front? pass it: useAdminJob({ …, total: 58 }) — the shell bar and JobProgress then both say "0 of 58"
<Button onClick={job.start}>Clear stale</Button>
{job.job ? <JobProgress job={job.job} onCancel={job.cancel} onResume={job.resume} onDismiss={job.dismiss} /> : null}
```

The server answers each round with `changed`, `remaining`, `complete`, `cursor` (the cursor is sent back
on the next round). The job manager lives at the shell root: it survives section changes, shows the
global chip, retries ≤2 lost rounds in a row, stops on no progress, pauses at 120 rounds / 15 minutes
(resumable), and after a reload offers "Resume clearing stale listings — 12,582 left". A second press
focuses the running job. `args` are part of the job's identity (`jobKey`).

**Progress rules (core behaviour since 2026-11-10 — sections may delete their workarounds):** a round that
moves its `cursor` forward counts as progress even when `changed` is 0 (a scan that reads before it writes),
so only a round that neither changes rows nor moves the cursor stops as "no progress"; and the server's own
sentence for the last round is kept on the job as `job.last_message` and shown by `JobProgress` while it runs
("Scanned 61,000 listings so far — keep going."). The Listings workaround that restarted a job when the
cursor moved (`ListingsSection.tsx`, "The job manager stops on 'no change'…") can go.

A finished multi-round job keeps the server's Undo (`job.undo` = the last round's `undo`, kept only while
every round answered with the same `request_id` — send one per press) and `JobProgress` shows it when you
pass `onUndo={job.undo}` (from `useAdminJob`); the Undo runs as its own job. No more digging through the activity log.

Scroll memory restores only on a SECTION change and gives way to any scroll intent; a filter or kind change
never moves the page.

A job's size is ONE number: `JobSpec.total` (when known up front) and then `changed + remaining` from the
server. Show progress with `jobProgressText(job)` / `<JobProgress job={job} />` — never compute your own
"N of M" in a section (the bar and the section said "0 so far" vs "0 of 58" before this).

The List primitive's row checkbox is itself a 44×44 target (the drawn box stays 20px) — a section override
for it (review.module.css `.rowWrap input[type=checkbox]`) is no longer needed.

The lab (lab builds only) opens its own item kind `labitem`; `report` sheets belong to Review.

On a phone the shell shows the job as a one-line bar directly above the bottom bar (never in the header);
on desktop it stays in the rail.

## Downloads (binary endpoints)

```tsx
const dl = useAdminDownload()
<Button icon="download" loading={dl.busy} onClick={() => dl.run('/api/admin-company-audit-pdf', { company }, { fallbackName: 'audit.pdf' })}>Legal audit PDF</Button>
<ResultLine state={dl.state} runningText="Building the PDF…" onRetry={dl.retry} onDismiss={dl.dismiss} />
```

Same token, same error sentences, same 401 → sign-in → replay as actions; the file name comes from the
server's Content-Disposition; an empty file or a JSON answer is an error, never a silent 0-byte download.
For text the server returns inside JSON (`export_csv` → `{ csv, filename }`, `export_company` → `bundle`)
use `saveText(text, filename, type)` from `core/api.ts` after an ordinary `useAdminAction`/`api` call.

## Item sheets

`?item=<kind>:<id>` opens the ONE sheet. To give a kind its view, add a line in `core/items.tsx`:
`ITEM_VIEWS.report = () => import('../sections/review/ReportItem.tsx')`. The view gets
`{ kind, id, close, open, setTitle }`:

- read with `useAdminQuery(\`report:${id}\`, …)`; on `not_found` render `<ItemNotFound kind={kind} id={id} />`;
- call `setTitle('Walmart report', 'ghosted · 12 days ago')` once the item is read;
- `open('company', key)` replaces the sheet's content and Back returns to this item; `close()` closes the
  whole stack. Never render your own `Sheet`/`Dialog`. For a non-item form use
  `useShell().openPanel({ kind: 'custom', title, render: (close) => … })` — sparingly.
- Open an item from a row with `useShell().openItem(kind, id)`; the `Row onOpen` title button gets focus
  back when the sheet closes.

## URL params

| param             | meaning                                  | how                                  |
|-------------------|------------------------------------------|--------------------------------------|
| `s`               | section (absent = Today)                 | `useShell().goSection('review')`     |
| `item`            | open sheet `<kind>:<id>` (pushed)        | `openItem` / `close`                 |
| `<section>.<name>`| a section's filter, e.g. `review.kind`   | `useUrlFilter('review', 'kind', def)`|

`goSection(section, filter)` (what a Today queue row does) opens the section with exactly that filter.
Today's `queues[].filter` is `{ kind: 'held' }` → `?s=review&review.kind=held`; read it with
`useUrlFilter('review', 'kind')`.

## Primitives (`ui/`)

| | |
|---|---|
| `AdminShell` | the frame (rail / top bar / bottom bar) — the shell renders it; sections never do |
| `SectionHeader` | the screen's one `<h1>`, sub line, actions, refreshing hairline |
| `StatStrip` + `StatTile` | numbers; `value={null}` shows "couldn't read" |
| `QueueRow` | a 56px row: label · count · chevron |
| `List`, `Row`, `RowActions`, `BulkBar` | keyset list; rows stack to cards under 560px; bulk bar sticks above the phone bar |
| `Sheet` | the overlay (used only by the shell's SheetHost) |
| `ConfirmStep` | inline confirm; `typeToConfirm`; Esc cancels the step, not the sheet |
| `ResultLine` | glyph + word + the server's sentence + skipped links + Undo / Retry / dismiss |
| `JobProgress`, `JobChip` | a job inline / the shell's chip |
| `EmptyState`, `ErrorState`, `RefreshFailed`, `Skeleton`, `RefreshHairline` | the states |
| `SearchField`, `FilterChips`, `StatusChip`, `KeyHint` | inputs and chips (StatusChip = tint + word + icon) |

Buttons are `components/ui/Button` (`primary` at most once per screen; `secondary`, `ghost`, `danger`).

## Rules you must not break

1. One `<h1>` per screen (SectionHeader), one filled (`primary`) button per screen. Row buttons are
   `secondary`/`ghost`.
2. Tokens only (DESIGN.md): no raw hex/rgb in `.tsx` or `.module.css`, no inline style objects for layout,
   8px grid (4px inside a component), text ≥12px, every control ≥44px at every width, `minmax(0,1fr)`.
   `components/admin2/admin2.test.mjs` enforces the admin's stricter version.
3. No `window.confirm/alert/prompt`, no `location.reload`, no `router.refresh`, no full re-read after an
   action, no second overlay.
4. Ids for bulk actions go in the POST body (the api always POSTs JSON — never build `id=in.(…)` URLs).
5. A count that could not be read is `null` and says "couldn't read". A capped list says it is capped.
6. California time on every displayed date: `formatPacific` from `lib/time/pacific`.
7. Every label and message is read as the owner would: what happened, with the number, in a whole
   sentence. No "Error", no "Success!", no "Something went wrong".

## Running it

```bash
node --test components/admin2/**/*.test.mjs lib/ui/*.test.mjs     # core logic + design rules
npx tsc --noEmit -p . 2>&1 | grep admin2                           # judge by YOUR files only
# private build (the main tree may be mid-edit by others):
git -C /home/user/Seen worktree add --detach <dir> 2c9336c && ln -s /home/user/Seen/node_modules <dir>/node_modules
#   copy components/admin2, app/admin, scripts/admin-smoke.mjs and the Nav/Footer/CommandPalette edits over it
cd <dir> && NEXT_PUBLIC_ADMIN_LAB=1 npx next build && npx next start -p <port> -H 127.0.0.1
node scripts/admin-smoke.mjs --base http://127.0.0.1:<port> --shots <dir>/shots   # add --skip-timeout to skip the 32 s case
```

The smoke test answers `/api/admin-stats` itself (a seeded store that really changes, with 500 / 401 /
timeout / empty-body switches). Copy its pattern for your section's actions. The director's rig
(`director/admin/rig`, README there) runs the real handlers against a fake database — that is the
acceptance test.
