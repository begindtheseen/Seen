# Chronos Bridge — how a CLOUD session talks to the brain

**Audience:** any Claude session running as a **cloud / repo-connected session** (Claude Code on the
web, attached to `begindtheseen/seen`) with **no Mac filesystem access**. This is your contract for
querying **and** writing the Chronos brain — the always-on **Supabase mirror** — treating it as the
source of truth. A **local** (Mac) session should instead use the local vault directly (see
`seen/CLAUDE.md`); this doc is the cloud path.

> **Hard rule:** offline/local files NEVER go to GitHub. The brain is reached ONLY through the private,
> token-gated gateway described here. You never hold the Supabase key and never commit brain contents.

Branch that introduced this: **`feat/chronos-cloud-bridge`**.

---

## 1. Access route chosen — scoped gateway + token (NOT the raw service key)

A **scoped brain gateway**: a server-side endpoint `api/brain.js` on seenjobs.io that exposes **only**
brain read/write ops, gated by a dedicated bearer token `BRAIN_API_TOKEN`.

**Why, not the raw service key:** the brain tables live in the **same Supabase project as the entire
Seen product** (users/`profiles`, `admin_accounts`, `admin_sessions`, `credit_transactions`, `jobs`,
23k `companies`, …). The Supabase `service_role` key bypasses RLS on **all** of it. Shipping that key
to a cloud sandbox means one leak = the whole business. The gateway keeps the service key server-side
(where it already lives, in Vercel's env) and hands the cloud session only a **narrow, independently
revocable** token whose blast radius is *brain-only*. Rotate `BRAIN_API_TOKEN` to cut cloud access
without touching the service key or the product DB.

## 2. EXACT secrets the cloud session needs (set by Brandon in the web env — NONE committed to git)

| Env var | Value | Who sets it |
|---|---|---|
| `BRAIN_API_URL` | `https://seenjobs.io/api/brain` | Brandon, in the cloud/web environment's secrets |
| `BRAIN_API_TOKEN` | the shared secret (same value set on Vercel) | Brandon, in the cloud/web environment's secrets |

Optional: `CHRONOS_SOURCE=cloud` to force cloud mode (auto-detected when the two vars above are present).

**None of these are in git.** `seen/.gitignore` ignores `.env` / `.env.*`; `.env.example` documents the
names only. You (the cloud session) must NOT print, echo, commit, or paste these values anywhere.

Server side (already on Vercel for seenjobs.io — you do not touch these): `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, plus a new `BRAIN_API_TOKEN` Brandon adds to the Vercel project.

## 3. HTTP contract (if you call the gateway directly instead of via the MCP tools)

- **Endpoint:** `POST {BRAIN_API_URL}` (single endpoint; the operation is in the body).
- **Auth header:** `Authorization: Bearer {BRAIN_API_TOKEN}`
- **Content-Type:** `application/json`
- **Body:** `{ "op": "<op>", ...args }`

| op | request body | success response |
|---|---|---|
| `notes` | `{ "op":"notes" }` | `{ "ok":true, "notes":[{ "path":"…", "text":"…markdown…" }] }` |
| `counts` | `{ "op":"counts" }` | `{ "ok":true, "counts":{ "notes":N, "facts":N, "episodes":N } }` |
| `record_fact` | `{ "op":"record_fact", "fact":{ "subject","predicate","object","confidence"?,"source"? }, "note"? }` | `{ "ok":true, "written":0\|1, "note":"…" }` |
| `append_timeline` | `{ "op":"append_timeline", "date"?, "heading", "text" }` | `{ "ok":true, "note":"timeline/YYYY-MM-DD.md", "heading":"…" }` |

Errors: `401` missing/bad token · `405` non-POST · `400` bad op/params · `503` not configured ·
`500` `{ "ok":false, "error":"…" }`. Server-to-server only (no CORS; call it from a script/MCP server,
not a browser).

## 4. Does the `chronos` MCP server have a remote mode? Yes.

- **File:** `seen/memory/mcp/server.mjs` (client transport: `seen/lib/server/brainCloud.js`; gateway
  handler: `seen/api/brain.js`; service-side store: `seen/lib/server/brainStore.js`). **Branch:**
  `feat/chronos-cloud-bridge`.
- **How it picks local vs cloud** (`resolveCloud()`): env `CHRONOS_SOURCE=cloud|local` forces it;
  default `auto` → **cloud** when brain creds are present (`BRAIN_API_URL`+`BRAIN_API_TOKEN`, or direct
  Supabase creds), else **local** (reads the vault files under `CHRONOS_VAULT`). On the Mac the seen MCP
  has no brain creds → local; in your web session with the two secrets set → cloud (gateway).
- **Auto-load:** `seen/.mcp.json` declares the `chronos` server, so it's available in a repo session; it
  inherits `process.env`, so once Brandon sets `BRAIN_API_URL`+`BRAIN_API_TOKEN` in the web env the tools
  answer from the online brain. In cloud mode the index is fetched once at startup and refreshed every
  ~20s (and immediately after each write). If the MCP tools don't engage in your session, fall back to
  the HTTP contract in §3 (same data), and check the env vars are visible to the MCP process.

## 5. Tool surface available FROM THE CLOUD (all 9 tools; each returns MCP text content)

**READ**
- `memory_status()` — one-call session briefing (what changed, open threads, contradictions).
- `memory_search_facts({ query?, as_of?, subject?, predicate? })` — point-in-time fact search;
  `as_of` = ISO date for "what was true then", omit for "currently true".
- `memory_whats_changed({ since })` — facts recorded/invalidated on/after an ISO date.
- `memory_get_entity({ name })` — everything known about one entity (facts + links).
- `memory_timeline({ from?, to? })` — dated episodes, newest first.
- `memory_open_threads({ area?, includeDone? })` — open work items.
- `memory_contradictions()` — hygiene: overlapping-window fact conflicts.

**WRITE** (land in the online brain — see §6)
- `memory_record_fact({ subject, predicate, object, confidence?, source?, note? })` — record a durable
  bi-temporal fact (supersede-safe). `note` defaults to `claude-observations.md`.
- `memory_append_timeline({ date?, heading, text })` — append a dated episode (`date` defaults to today).

## 6. WRITE semantics — where writes land, supersede rule, and how the Mac pulls them back

- **Where they land:** the gateway calls `brainStore` with the service key, which fetches the target
  note from `brain_notes`, applies the change with **`applyFact`** (the *same* pure writer the local
  vault uses), writes the note back to `brain_notes`, and re-derives that note's `brain_facts` rows.
  Byte-identical to a Mac write; the note markdown stays canonical.
- **Supersede, never overwrite** (bi-temporal): recording a new value for an existing
  `subject`+`predicate` **closes** the prior fact's window (`valid_to`/`invalidated` = today) and
  **appends** the new fact (`valid_to: null`). Identical value = no-op (`written:0`). A write that would
  create an overlapping-window contradiction is rejected. (Verified live: `ok-first` window closed,
  `ok-second` left open.)
- **How the Mac pulls it back:** on the Mac, `command-os/brain/lib/cloud.mjs` `syncDown` / `pull` folds
  changed notes from Supabase down into the local vault (the board meeting runs this). So a fact you
  write from the cloud shows up on the Mac after its next sync.
- **⚠ Clobber risk to flag:** the Mac's `pushBrain` (board meeting) does a **blind full-vault overwrite**
  of `brain_notes` from local files. If the Mac edits a note locally and pushes **without** syncing down
  your cloud write first, it overwrites the note content and drops your change. **Rule:** the Mac must
  `syncDown`/`pull` **before** local writes or pushes. Cloud writes themselves are safe (read-modify-write
  against Supabase). Since Brandon is going cloud-primary, treat the Mac vault as a cache.

## 7. brain_* schema + blast radius

Shared with the **product** Supabase project (ref `tmngmmofrplsldvlobfx`) — the reason for the gateway.

| table | columns | key |
|---|---|---|
| `brain_notes` | `path`, `content`, `updated_at` | PK `path` |
| `brain_facts` | `note`, `id`, `subject`, `predicate`, `object`, `valid_from`, `valid_to`, `confidence`, `source`, `recorded`, `invalidated`, `synced_at` | PK `(note, id)` |
| `brain_timeline` | `id`, `date`, `heading`, `body`, `synced_at` | unique `(date, heading, body)` |
| `brain_conversation` | `id`, `role`, `text`, `dept`, `at` | PK `id` |

All have RLS **on with no policies** → only the service key (server-side, in the gateway) can read/write.
Your token reaches these **only** through the gateway's four ops — never arbitrary SQL, never other tables.

## 8. Connectivity self-test (run once the two secrets are set)

```bash
curl -sS -X POST "$BRAIN_API_URL" \
  -H "authorization: Bearer $BRAIN_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"op":"counts"}'
```
Expected (counts grow over time):
```json
{"ok":true,"counts":{"notes":47,"facts":111,"episodes":148}}
```
A `401` means the token is missing/wrong; `503 gateway not configured` means `BRAIN_API_TOKEN` isn't set
on Vercel yet. From inside the repo you can also run: `node lib/server/brainCloud.js` (prints the same
counts via whichever transport is configured).

## 9. Current brain scale + freshness (so you can confirm you're reading the LIVE brain)

As of **2026-07-23**: **47 notes · 111 facts · 148 timeline episodes** (+158 conversation rows). Newest
timeline date: **2026-07-23**. If `counts` returns roughly these or higher and `memory_status` shows
recent dates, you're on the live brain.

## 10. What the cloud session must NOT do

- **Never** request, store, print, or commit `SUPABASE_SERVICE_KEY` (or any Supabase key). You use the
  gateway token only.
- **Never** commit brain/offline content into git — no vault notes, no `.env`, no secrets. The repo
  never holds brain data. Reads/writes go through the gateway, not into files you commit.
- **Do not** bypass the gateway (no direct PostgREST, no arbitrary SQL, no other tables).
- **Writes are durable and shared** — don't spam test facts into real notes. Use an obviously-namespaced
  throwaway note (e.g. `note:"scratch-<yourhandle>.md"`) for experiments, and prefer `confidence:"low"`
  when unsure. Records supersede real history — write deliberately.
- **Don't hammer** the gateway (it's a serverless function on the production site). Cache within a
  session; the MCP server already refreshes ~every 20s. No tight polling loops.
- **Coordinate writes** with the Mac per §6 (syncDown-before-push is the Mac's job, but avoid racing the
  same note in the same minute).
