# Handoff → `claude-brain`: cloud Brain path BLOCKED (2026-08-14)

Written by the SeenJobs product session on branch `claude/chronos-brain-session-kxt7ep`.
It is a **git** handoff rather than a Brain fact/timeline entry **because writing it to the
Brain would require the very path this document reports as forbidden.** Someone with a
role-qualified surface should transcribe the facts at the bottom into Chronos.

## Verdict

The cloud Brain path is **blocked pending role-qualified gateway provisioning**. Zero Brain
requests were made by this session's own tool calls. See the disclosure below for one that
the SessionStart hook made before the session had any control.

Both preconditions from the role briefing fail, and the second fails structurally, not just
on timing.

## Surface determination

This is a cloud/container workspace: `/home/user/Seen` exists, `/Users/brandonburnett` does not.

There is **no local Brain MCP here**. `.mcp.json` registers a `chronos` server at
`memory/mcp/server.mjs`, but `memory/` is not in the checkout — `.gitignore:23` excludes it
(`memory/`, with only `memory/graph/.env.example` re-included). The server cannot start, and
no `brain_*` / `memory_*` tools are registered in this session. The cloud gateway is the only
surface, at `BRAIN_API_URL=https://seenjobs.io/api/brain` with `BRAIN_API_TOKEN` set.

## (a) Hardened gateway is NOT in production — verified

| Evidence | Value |
|---|---|
| PR #284 | `state: open`, `draft: true`, `merged: false` |
| PR #284 head | `227978354b0bff2dbec74e94fe8332f630a1512c` |
| PR #284 base | `next-migration` @ `458d1a3` |
| `origin/next-migration` tip | `458d1a3` — the PR's base, unmoved |
| `2279783` in this checkout | absent (`git cat-file -t` → not a valid object) |
| Only Vercel deployment of `2279783` | `target: preview`, READY, 2026-08-14T11:25:20Z, branch `codex/brain-client-identity-gate` |
| Latest `target: production` | `458d1a3` / `next-migration`, READY, 2026-08-13T09:50:01Z |

The "silently promoted preview" scenario (CLAUDE.md's PR #124 incident) was checked and ruled
out: `2279783` has exactly one deployment and it is a preview. `seenjobs.io/api/brain` is
running `458d1a3`, which is the code in this checkout.

Migrations `070`/`071` are **applied to production but absent from `supabase/migrations/`**
(only `069` is present; they live on the PR branch). The verifier registry therefore exists in
the prod database while no deployed code reads it — schema ahead of code, the same ordering
hazard CLAUDE.md records for migration 069. It is inert rather than harmful, but it means prod
DB state currently overstates what prod actually enforces.

## (b) The prescribed verification cannot be trusted against the deployed gateway

This is the finding worth acting on. In `api/brain.js` as deployed to production:

- **`tokenOk()` (`api/brain.js:31-40`)** compares the bearer against a single shared
  `BRAIN_API_TOKEN`. There is no per-client credential, no verifier lookup, and no scopes. Any
  holder of that one token is fully authorized for every op. That is shared-credential auth by
  construction.
- **`audit()` (`api/brain.js:84`)** sets
  `by: (typeof body.by === 'string' && body.by.trim()) ? body.by.trim() : 'claude:cloud-session'`.
  **The attribution is caller-asserted and never verified.**

Consequence: the role briefing's check — "after the first successful call, require confirmation
that Chronos recorded exactly `claude-seenjobs`" — is **not a valid test against this gateway
version**. Any client can send `by: "claude-seenjobs"` and manufacture a passing audit row.
Running the prescribed verification now would produce a **false positive that is
indistinguishable after the fact from real provisioning**, which is worse than the
`claude-session-*` row it is meant to catch: the bad outcome would be a Brain audit log
containing a fake-authentic `claude-seenjobs` row, permanently.

So the check must run **only** against the hardened gateway, where identity is bound to a
credential. Until `2279783` is in production, "install the unique credential in Claude Cloud"
cannot mean anything the deployed code can honor — changing `BRAIN_API_TOKEN` in Vercel to the
new value would only rename the shared secret, not make it role-qualified.

## Disclosure: one legacy-attributed read already happened, before session control

`.claude/hooks/session-start.sh` runs `scripts/memory-status.mjs`, which is cloud-aware and
fetches the briefing over `BRAIN_API_URL` + `BRAIN_API_TOKEN` at SessionStart with **zero tool
calls** — by design ("connect the session to the info it needs and save the round-trip").

Per `api/brain.js:21-24`, every authenticated op **including reads** appends a `brain_access`
row. The hook sends no `by`, so that row is attributed `claude:cloud-session` — a
`claude-session*` row, which the role briefing defines as a failed provisioning check.

Therefore: **one legacy-path read occurred at this session's start, not by the session's
choice**, and the orientation context this session holds is that **boot-time snapshot**, not a
live query. Nothing was re-queried.

Standing consequence: **the hook is an unconditional legacy-path caller.** Every future cloud
session boot makes another `claude:cloud-session`-attributed Brain read until either the
hardened gateway ships or the hook is gated. If the forbiddance is meant to hold in the
interim, the hook needs a guard — that is Brain-infrastructure work and was deliberately left
untouched by this session.

## Unblock sequence

1. Promote `2279783` to production (owner-approved merge of PR #284 → `next-migration`, then
   confirm a `target: production` deployment exists for the merged sha — CLAUDE.md's
   deploy-drift rule; a green PR check is a preview, not production).
2. Commit migrations `070`/`071` into `supabase/migrations/` so the repo stops describing a
   database that differs from it (CLAUDE.md's uncommitted-061 lesson).
3. Install the unique `claude-seenjobs` credential in Claude Cloud as protected env vars, then
   **start a fresh cloud session** so it receives them. Never pasted into chat.
4. In that fresh session: one harmless read, then confirm the `brain_access` source is exactly
   `claude-seenjobs`. Any `claude-session*` row is a failed provisioning check.
5. Gate or remove the SessionStart hook's unconditional Brain fetch, or accept that each boot
   writes a legacy-attributed read row.

## Facts to transcribe into Chronos

Supersede, do not overwrite.

- `Seen brain gateway prod_state` → As of 2026-08-14, production `seenjobs.io/api/brain` runs
  `458d1a3` (deployed 2026-08-13T09:50:01Z). The hardened identity gateway `2279783` exists
  only as a Vercel **preview** on PR #284, which is open/draft/unmerged; `origin/next-migration`
  is still at the PR's base `458d1a3`. Migrations 070/071 are applied to prod but absent from
  `supabase/migrations/`, so the verifier registry is inert — no deployed code reads it.
- `Seen brain gateway attribution_is_unverified` → In the deployed gateway, `api/brain.js:84`
  takes the audit `by` from the request body and falls back to `claude:cloud-session`. It is
  never verified against the credential, and `tokenOk()` (`api/brain.js:31-40`) accepts one
  shared `BRAIN_API_TOKEN` with no per-client identity or scopes. Therefore the
  "confirm Chronos recorded exactly `claude-seenjobs`" provisioning check is a FALSE-POSITIVE
  RISK against this version: any caller can assert that label and manufacture a passing row.
  Run that check only against the hardened gateway.
- `Seen session-start hook legacy_brain_read` → `.claude/hooks/session-start.sh` fetches the
  briefing through the cloud gateway at every cloud session start with zero tool calls, and
  reads are audited, so each boot writes a `brain_access` row attributed `claude:cloud-session`.
  This happens before the session can consent. Any interim ban on the legacy path must gate the
  hook or it will keep being violated at boot.
