# SeenJobs — Target Architecture

This document defines the architecture SeenJobs is moving toward. It is the
reference for where new code goes and how existing code is reorganized during the
refactor. It does not describe the current state (see `CODEBASE_HEALTH_AUDIT.md`)
— it describes the destination.

## Core principles

1. **Pages are thin.** A page composes feature components and calls a service/hook.
   It owns layout and wiring, not business logic or data transformation.
2. **API routes are thin.** A route handles transport (parse, auth, validate,
   respond) and delegates all logic to a service in `lib/`.
3. **Components are presentational.** They receive data and callbacks as props and
   render. They do not contain business rules or direct DB/API access.
4. **Business logic lives in services** under `lib/<feature>/`.
5. **Supabase access is centralized** in `lib/supabase/` (browser / server / admin).
6. **Auth and security logic are centralized** in `lib/auth/` and `lib/security/`.
7. **Payments live in `lib/payments/`. AI lives in `lib/ai/`. Admin lives in `lib/admin/`.**
8. **Validation lives in schemas** (`lib/security/validation.ts`, per-feature schemas).
9. **UI primitives live in `components/ui/`; feature UI lives in feature folders.**
10. **External data is untrusted** — request bodies and AI output are validated before use.

## Directory layout

```
app/                      # Next.js App Router — thin pages only
  api/                    #   (future) App Router route handlers, thin
  dashboard/
  jobs/
  tracker/
  resume/
  company/
  admin/

components/
  ui/                     # Design primitives: Button, Card, Badge, Input, Modal,
                          #   Table, KpiCard, SectionHeader, EmptyState,
                          #   LoadingState, ErrorState
  layout/                 # Nav, Footer, shells, page scaffolding
  admin/                  # Admin-only feature UI
  jobs/                   # Job list/detail UI pieces
  companies/              # Company profile UI pieces
  applications/           # Tracker / application card UI
  resume/                 # Resume scanner/coach UI
  reports/                # Outcome cards, report UI
  dashboard/              # Dashboard widgets
  landing/                # Marketing/landing sections

lib/
  api/                    # HTTP plumbing: response helpers, error classes,
                          #   shared handler, request/response types
  auth/                   # Server identity resolution + guards (resolveIdentity,
                          #   requireUser); client auth context stays in lib/auth.tsx
  config/                 # env.ts — centralized, validated environment access
  supabase/               # browser.ts (anon), server.ts (user-scoped, RLS),
                          #   admin.ts (service-role, RLS-bypass)
  security/               # cors.ts, rateLimit.ts, validation.ts
  payments/               # Stripe: checkout, portal, webhook handling, subscription state
  ai/                     # Anthropic calls, prompt builders, AI-output schema validation
  jobs/                   # Job search/refresh/dedup services
  companies/              # Company stats / verification services
  applications/           # Application + event-system services
  reports/                # Report generation, outcome-card data
  admin/                  # Admin operations + admin auth
  logging/               # errlog / structured logging helpers

types/
  db/                     # Database row types (Supabase schema mirror)
docs/                     # This audit, architecture, plan, standards
tests/                    # Unit/integration tests for the foundation + services
```

## What belongs in each folder

### `app/`
Route segments only. Each `page.tsx` should: render layout, mount feature
components, and call a hook/service for data. Prefer Server Components; add
`'use client'` only when a component needs browser APIs, state, or effects.
Future server-side API endpoints belong in `app/api/` route handlers (today the
serverless functions live in top-level `api/*.js`).

### `components/ui/`
Stateless, reusable design primitives. No data fetching, no feature knowledge.
This is the single source of visual truth that replaces inline styles.

### `components/<feature>/`
Presentational components for one feature area. They import `components/ui/`
primitives and receive data via props. No direct Supabase or `fetch` to APIs.

### `lib/api/`
The HTTP plumbing every route shares:
- `types.ts` — `ApiRequest` / `ApiResponse` / `ApiHandler` (Vercel-style, dep-free).
- `errors.ts` — typed `ApiError` hierarchy; 5xx never leaks internal detail.
- `response.ts` — `ok` / `created` / `noContent` / `fail`.
- `handler.ts` — `createHandler()` composing CORS, method check, rate limit, auth,
  and error handling so routes stay thin.

### `lib/config/`
`env.ts` is the only place that reads `process.env`. It exposes `publicEnv`
(browser-safe), lazy `serverEnv` accessors, `requireEnv`, and
`requireSupabaseServer`. Nothing else should touch `process.env` directly.

### `lib/supabase/`
Three clients, three trust levels:
- `browser.ts` — anon key, RLS-enforced, used in the browser. Single instance.
- `server.ts` — anon key + the caller's access token, RLS-enforced, for
  user-owned reads/writes from server code.
- `admin.ts` — service role, **RLS-bypassing**. Only after the caller is
  authenticated/authorized. Has a runtime guard against browser import.

### `lib/auth/`
`server.ts` — `resolveIdentity(req)` and `requireUser(req)`; the single
implementation of Supabase JWT verification + `/auth/v1/user` fallback. The
client-side React auth context remains in `lib/auth.tsx`.

### `lib/security/`
- `cors.ts` — the one CORS policy (`applyCors`, `handlePreflight`).
- `rateLimit.ts` — typed surface over the shared Supabase-backed limiter.
- `validation.ts` — request-body validators that throw `BadRequestError`.

### `lib/payments/`
All Stripe logic: checkout-session creation, billing portal, **server-side
webhook signature verification + idempotency**, and subscription-state writes.
Subscription/Pro state is server-authoritative. (Today this lives in `api/stripe.js`.)

### `lib/ai/`
Anthropic client, prompt construction (no secrets in prompts), and **schema
validation of AI output** before it is used or stored. AI endpoints are
token/cost/rate limited. (Today AI calls are inline in `api/resume.js`,
`api/job-insights.js`, `api/jobs.js`.)

### `lib/<domain>/` (jobs, companies, applications, reports, admin)
Pure business logic: takes validated input + a Supabase client, returns typed
results. No HTTP concerns, no `res.status()`. This is what makes logic testable.

### `lib/logging/`
Structured server logging / error capture (today `lib/server/errlog.js`).

### `types/db/`
TypeScript mirrors of the Supabase schema (from `supabase/migrations/`), so
services and routes share row types.

## Request lifecycle (target)

```
Browser (components/ui + feature components)
  → calls a typed client wrapper (lib/api client or feature service)
  → HTTP →
Route (app/api or api/*) via createHandler():
  1. applyCors / preflight            (lib/security/cors)
  2. method allow-list                (lib/api/handler)
  3. rate limit                       (lib/security/rateLimit)
  4. resolveIdentity / requireUser    (lib/auth/server)
  5. validate body                    (lib/security/validation)
  6. delegate to a service            (lib/<feature>/*)
       └─ uses lib/supabase/{server|admin} for data
  7. respond with ok()/fail()         (lib/api/response, lib/api/errors)
```

A route should read as those seven steps and little else. Anything longer is a
sign logic belongs in a service.

## Trust boundaries (non-negotiable)

- **Never trust `user_id` from a request body.** Identity comes only from
  `resolveIdentity`/`requireUser`.
- **Service-role key is server-only** and used only after authorization.
- **Payment state is server-authoritative** — verified via Stripe webhooks, never
  taken from the client.
- **AI output is untrusted** — schema-validated before use.
- **Submissions are claims, not facts** — confidence/trust weighting stays
  server-side (see `SEEN_STRATEGY.md`).
