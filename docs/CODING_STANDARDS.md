# SeenJobs — Coding Standards

Enforceable conventions for keeping SeenJobs maintainable. "Usually" means the
limit is a default, not a hard wall; exceeding it requires a one-line written
reason in the file or PR. These standards are aspirational for legacy code and
mandatory for new and refactored code.

## File size

- Components should usually stay under **200 lines**.
- Service files (`lib/<feature>/*`) should usually stay under **300 lines**.
- API routes should usually stay under **150 lines** (logic lives in services).
- **No file should exceed 500 lines without a written reason** at the top of the file.

15 files currently exceed 500 lines (see `CODEBASE_HEALTH_AUDIT.md`); they are
brought under the limit through Phases 3–5.

## TypeScript

- No `any` unless documented with a `// reason:` comment.
- Prefer `unknown` over `any`; narrow before use.
- Validate all external data: request bodies, AI output, third-party API responses.
- Use typed API responses (`lib/api/response.ts`) and typed errors
  (`lib/api/errors.ts`).
- Share types between client and server via `types/` rather than re-declaring.
- `strict` mode stays on. Do not weaken `tsconfig.json` to silence errors.

## React

- Keep pages thin — layout + composition + one data call. No business logic.
- Avoid unnecessary `'use client'`. Default to Server Components; opt into client
  only for state, effects, or browser APIs.
- Components are presentational: data and callbacks in via props; no direct
  Supabase or API `fetch` inside a presentational component.
- Extract repeated markup into `components/ui/` primitives instead of copying
  inline styles.

## API routes

- Validate input at the boundary (`lib/security/validation.ts`).
- Use the shared response helpers; never build ad-hoc `{ error }` shapes.
- Use shared error handling — throw `ApiError` subclasses; let the handler format.
- Use server-side auth checks (`requireUser`); **never trust `user_id` from the
  client**.
- Never expose raw stack traces or internal messages — 5xx responses are generic.
- Use the shared CORS helper, not per-route copies.

## Supabase

- The browser client uses the **anon key only**.
- Server and admin clients are isolated in `lib/supabase/`.
- The **service-role key must never be imported client-side** (admin client has a
  runtime guard).
- User-owned data must be filtered by the authenticated user ID; prefer the
  RLS-enforced server client over the service-role client where possible.
- No unbounded selects — always constrain/limit queries.

## Payments

- Never trust client payment state.
- Stripe events must be verified server-side (signature + replay window).
- Webhook events must be idempotent (dedupe by event id).
- Subscription / Pro state lives server-side and is the single source of truth.
- The existing `api/stripe.js` security (signature verify, 5-min replay window,
  idempotency table, no unsigned fallback) is the standard — preserve it when
  migrating to `lib/payments/`.

## AI

- AI output is untrusted — schema-validate before use or storage.
- AI prompts must not include secrets.
- AI endpoints need token / cost / rate limits.
- Keep prompt construction and Anthropic calls in `lib/ai/`, not inline in routes.

## Environment & config

- Only `lib/config/env.ts` reads `process.env`.
- Server secrets are never `NEXT_PUBLIC_*` and never referenced in client code.
- Required env is resolved through `requireEnv` / `requireSupabaseServer` so
  misconfiguration fails loudly and consistently.

## Formatting & tooling

- Prettier config (`.prettierrc.json`): no semicolons, single quotes, trailing
  commas, 100-col width, 2-space indent.
- Run `npm run check` (typecheck + test + build) before pushing.
- New code must pass `npm run lint` with zero new errors.
- Tests live in `tests/` and run via `npm test` (Node's native runner; `.ts`
  imports use explicit extensions).

## Validation library

`lib/security/validation.ts` is intentionally dependency-free today. When the
validated surface grows, adopt **`zod`** for declarative schemas (request bodies +
AI output) and infer types from schemas. Introduce it in Phase 3 as a single,
deliberate dependency — not piecemeal.

## Commits & PRs

- One concern per PR (one route, one page, one primitive set).
- Every PR states: what changed, what behavior was preserved, and gate status.
- Never merge red gates; never hide failures by disabling rules or gates.
