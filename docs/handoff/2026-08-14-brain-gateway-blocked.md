# Cloud Brain path: BLOCKED → RESOLVED, verified as `claude-seenjobs` (2026-08-14)

Status: **resolved 16:00Z.** Written by the SeenJobs product session on branch
`claude/chronos-brain-session-kxt7ep`. The original blocked report is kept below as history —
it is why the earlier session made zero Brain calls — followed by the verification that
unblocked it. **Two owner-gated risks remain open; see the last section.**

These findings are now durable in Chronos as three facts under `Seen brain gateway` and
`Seen brain cloud client`, plus a `timeline/2026-08-14.md` entry. This file is the in-repo
copy, which still matters while cloud sessions boot unoriented.

---

## Part 1 — the blocked report (11:56Z, history)

The earlier session found the cloud path not cleared for use and made **zero Brain requests**.
It wrote its handoff to git rather than the Brain because writing to the Brain would have
required the path it was reporting as forbidden.

Surface: cloud/container. `/home/user/Seen` exists, `/Users/brandonburnett` does not. There is
**no local Brain MCP** — `.mcp.json` registers a `chronos` server at `memory/mcp/server.mjs`,
but `.gitignore:23` excludes `memory/`, so the server cannot start and no `brain_*` tools are
registered. `AGENTS.md` is absent. The command-os `BRAIN_AI_CLIENT_PROTOCOL.txt` is Mac-only
and was **not** read — reported rather than pretended.

Both preconditions failed at the time:

- **(a) Hardened gateway not in production.** `2279783` had exactly one Vercel deployment and it
  was a `target: preview`. Latest `target: production` was `458d1a3` — PR #284's own base,
  unmoved. The "silently promoted preview" scenario was checked and, at that moment, ruled out.
- **(b) The prescribed provisioning check was not trustworthy against `458d1a3`.** That gateway
  took the audit `by` from a caller-supplied body field (defaulting to `claude:cloud-session`)
  and never verified it, and authorized on one shared `BRAIN_API_TOKEN` with no per-client
  identity or scopes. So "confirm Chronos recorded exactly `claude-seenjobs`" would have passed
  on assertion alone, writing a fake-authentic row indistinguishable from real provisioning.

It also disclosed that `.claude/hooks/session-start.sh` fetches the briefing through the gateway
at every cloud boot with zero tool calls, so one `claude:cloud-session`-attributed read had
already occurred before that session had any control.

**Both points were since confirmed from the other side.** The `brain_access` audit log contains
`claude:cloud-session` rows at `11:56:24` and `11:56:43` — exactly the disclosed hook reads.

## Part 2 — verification that unblocked it (16:00Z)

Both preconditions verified complete, **independently of the PR body's claim**:

- **(a) Promoted, verified via the Vercel API.** `dpl_8fpCkEGdRAVjgdCxcBH4UxcRxv3r` ·
  `state: READY` · `target: production` · sha `2279783` · `meta.action: "promote"` ·
  `originalDeploymentId: dpl_CpXq5MJ8X4T82eQE8tywppaBxERo` (the preview identified in Part 1) ·
  created `2026-08-14T12:04:13.503Z`, superseding `458d1a3`.
- **(b) Credential installed.** This fresh session's environment carries `BRAIN_CLIENT=claude-seenjobs`
  and `BRAIN_CLIENT_TOKEN` alongside `BRAIN_API_TOKEN`.

The deployed contract at sha `2279783` was read before any call, so the first request would not
fumble into denial rows. Auth is **four-part**: `Authorization: Bearer <BRAIN_API_TOKEN>` +
`x-chronos-client-token` header + a nonblank body `by` (else 428) + `by` must match the
credential owner case-insensitively (else 403).

**First Brain operation: one harmless read.** `op: "counts"` → `200 {notes:63, facts:401, episodes:291}`.

**Provisioning check PASSED:**

```
2026-08-14 16:00:25.589Z | by: claude-seenjobs | op: counts | read | ok: true | 270ms | error: null
```

Exactly `claude-seenjobs`. No `claude-session*` row.

Part 1's concern (b) is **fixed in the deployed code**: `audit()` now records
`client.identity.name` resolved from the credential registry rather than the caller's claim;
denials are audited too (428/401/403); the audit insert is awaited rather than fire-and-forget
so serverless teardown cannot drop it; write ops require read **and** write scope; and
`record_fact` runs `assertNotePath`, closing the stranded-facts-at-root class for the cloud
writer. The provisioning check is therefore a meaningful test now, where against `458d1a3` it
was a false-positive risk.

## Part 3 — open, owner-gated

Both stem from one condition: **`2279783` is promoted but unmerged.** `origin/next-migration` is
still `458d1a3`, so production runs code that exists on no merged branch.

1. **Silent rollback risk.** The next merge to `next-migration` deploys `next-migration` and
   rolls the hardened gateway back to the pre-hardening version — un-hardening Brain auth
   without anyone touching security code. This is CLAUDE.md's PR #124 lesson in a new form.
2. **Every cloud session boots unoriented.** PR #284 changes the client side too
   (`.claude/hooks/session-start.sh`, `scripts/memory-status.mjs`, `lib/server/brainCloud.js`,
   `scripts/cloud-setup.sh`), but a container clones from `next-migration@458d1a3` and therefore
   runs the **pre-hardening client against the hardened gateway**: it sends no `by` and gets
   `428 Identify yourself`. Measured as two `by=unidentified` rows at `15:58:27` and `15:58:28`
   — this session's own boot attempts. It fails *closed*, which is the right failure, but the
   briefing is gone until the client matches the server.

**One action closes both: merge PR #284 into `next-migration`.** That is a protected-branch
merge, so it needs Brandon's explicit scoped approval and was not taken by this session.

Also still true from Part 1: migrations `070`/`071` are applied to production but absent from
`supabase/migrations/` — they live on the PR branch, so merging #284 resolves that too.

## Not available on this surface

`brain_contradictions` has no cloud-gateway op — the gateway exposes only
`notes` / `counts` / `record_fact` / `append_timeline`. The session-end contradiction sweep was
**not performed** rather than faked.
