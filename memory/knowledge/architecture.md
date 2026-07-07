---
title: Architecture
tags: [architecture]
updated: 2026-07-07
facts:
  - id: stack-framework
    subject: Seen
    predicate: framework
    object: Next.js 15.5 (App Router, React 19)
    valid_from: 2026-06-01
    valid_to: null
    confidence: high
    source: "[[architecture]] · package.json"
    recorded: 2026-07-07
  - id: api-pattern
    subject: Seen API
    predicate: runs_as
    object: Vercel serverless api/*.js (plain JS, not app/api)
    valid_from: 2026-06-01
    valid_to: null
    confidence: high
    source: "[[architecture]]"
    recorded: 2026-07-07
  - id: styling
    subject: Seen
    predicate: styling
    object: CSS variables in app/globals.css (no Tailwind)
    valid_from: 2026-06-01
    valid_to: null
    confidence: high
    source: "[[architecture]]"
    recorded: 2026-07-07
  - id: db-auth
    subject: Seen
    predicate: auth_and_db
    object: Supabase (service_role server-only)
    valid_from: 2026-06-01
    valid_to: null
    confidence: high
    source: "[[architecture]]"
    recorded: 2026-07-07
  - id: main-branch-status
    subject: main branch
    predicate: status
    object: old HTML app — never touch, unrelated history
    valid_from: 2026-06-01
    valid_to: null
    confidence: high
    source: "[[architecture]] · [[deployment]]"
    recorded: 2026-07-07
---

# Architecture

## Stack
- **Next.js 15.5.x** (App Router), **React 19**. `package.json` → `next
  ^15.5.19`, `react 19.0.0`, `"type": "module"`.
- **Supabase** auth + DB. anon key is public *intentionally*; `service_role` key
  is **server-only — NEVER in frontend**.
- **Styling:** custom CSS variables in `app/globals.css`. **No Tailwind.** Vars:
  `--blue --red --green --amber --white --sub --muted --dim --mono --display
  --card --line --line2 --surface --ink`. Inline styles for one-offs, `globals.css`
  for reusable classes.
- **State:** React Context (`AuthProvider` in `lib/auth.tsx`), localStorage
  stores in `lib/stores/`.
- **Deploy:** Vercel. See [[deployment]].

## Directory layout
- `app/` — App Router pages (`/`, `/jobs`, `/jobs/[id]`, `/dashboard`, `/tracker`,
  `/company/[slug]`, `/admin`, `/employers`, `/resume`, `/pricing`, …).
- `api/*.js` — **Vercel serverless functions in plain JS** (NOT `app/api/`; there
  are no App Router API routes). e.g. `jobs.js`, `resume.js`, `admin-stats.js`,
  `stripe.js`, `reports.js`, `user-sync.js`, `outcome-followups.js`,
  `unsubscribe.js`.
- `api/_utils/` — server helpers (companyIntel, companyScore, reportWrite,
  resumeSurvey, opportunityEngine). **Credits gate is `lib/server/credits.js`,
  NOT `api/_utils/credits.js`** (verified [[timeline/2026-07-02]]).
- `lib/` — shared code: `supabase.ts`, `auth.tsx`, `score.ts`, `constants.ts`,
  `stores/`, `hooks/`, `server/` (pure, testable modules — flywheel/email/
  realtime/pdf/resume logic lives here).
- `components/` — React components (`admin/`, `employer/`, `jobs/`, `optimizer/`).
- `supabase/migrations/` — SQL migrations. See [[database]].

## Hard rules (do not break)
- **Two unrelated git histories:** `main` (old HTML app) and `next-migration`
  share **no common ancestor**. Never `git merge` between them. Sync a file with
  `git show origin/main:path > path`. **Never push to / touch `main`.**
- **Serverless cap is a non-issue** — Vercel **Pro = 500 functions**; ~9 declared.
  Add `api/*.js` freely. (The old "12-function Hobby limit" that merged
  parse-resume into resume.js was a wrong assumption.)
- Keep helpers in `lib/` (or `api/_utils/`), not new files under `api/` for pure
  logic. Pure server logic → `lib/server/` with a `*.test.mjs` beside it.

## The Mandatory Thought Process (8 rules — run on EVERY change)
Added 2026-07-02 after ~30 features "looked built but never once worked." Full
text in `CLAUDE.md`. The spine:
1. **Trace the full contract** (field names, auth header, HTTP method, response
   fields) on both sides before writing OR trusting code.
2. **Verify the actual DB schema**, not the one you assume (`IF NOT EXISTS`
   silently no-ops over drift). See [[database]].
3. **Exercise the runtime path once** — reading code is not verification.
4. **Hunt the class, not the instance** — one bug found = one pattern grep owed.
5. **Never ship a known approximation** — do it right or surface the blocker.
6. **Decide once, then build once** — if it hinges on an owner decision, ask
   first / park it. See [[decisions/log]].
7. **Fixes ride with proof** (test/probe/build named in the PR).
8. **Leave ground truth better than you found it** — update docs + this vault
   with FACTS you verified, never from memory. See [[protocol]].

## Source docs
`CLAUDE.md`, `MASTER_PROJECT_STATE.md` (architecture sections),
`CLAUDE_HANDOFF.md` (architecture facts).
