# Cloud Brain path: BLOCKED → RESOLVED, verified as `claude-seenjobs` (2026-08-14)

Status: **fully resolved.** Connection verified 16:00Z; the two owner-gated risks closed 22:44Z
when PR #284 merged and deployed. Written by the SeenJobs product session on branch
`claude/chronos-brain-session-kxt7ep`. The original blocked report is kept below as history —
it is why the earlier session made zero Brain calls — followed by the verification that
unblocked it and the merge that closed the remainder.

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

## Part 3 — the two risks, and their closure at 22:44Z

Both stemmed from one condition: `2279783` was **promoted but unmerged**, so production ran code
that existed on no merged branch.

1. **Silent rollback risk.** The next merge to `next-migration` would deploy `next-migration` and
   roll the hardened gateway back to the pre-hardening version — un-hardening Brain auth without
   anyone touching security code. CLAUDE.md's PR #124 lesson in a new form.
2. **Every cloud session boots unoriented.** PR #284 changes the client side too
   (`.claude/hooks/session-start.sh`, `scripts/memory-status.mjs`, `lib/server/brainCloud.js`,
   `scripts/cloud-setup.sh`), but a container clones from `next-migration@458d1a3` and therefore
   runs the **pre-hardening client against the hardened gateway**: it sends no `by` and gets
   `428 Identify yourself`.

**CLOSED — PR #284 merged into `next-migration` as `f11a794`, and the merged sha deployed.**
Verified rather than assumed: Vercel `dpl_5r3HG7coQdqazHci9gRM6Ga8kHYZ`, `state: READY`,
`target: production`, `ref: next-migration`, `githubCommitVerification: verified`, ready
22:45:36Z, and its `alias` list contains **`seenjobs.io`** — so it is genuinely serving the
domain, not merely marked production.

- Risk 1 is gone: `next-migration` now *contains* the hardened gateway, so a later merge
  redeploys it rather than reverting it. Confirmed still present on the branch after the merge.
- Risk 2 is fixed in the repo: the merged `lib/server/brainCloud.js` sends `by` from
  `BRAIN_CLIENT` plus the `x-chronos-client-token` header, and throws locally rather than
  issuing an unidentified request — so a container cloned after `f11a794` cannot produce a 428.
- Migrations `070_brain_access_error.sql` and `071_brain_clients.sql` are now committed, closing
  the repo-vs-prod schema gap noted in Part 1.

**Residual, operational only:** a container cloned *before* the merge keeps the old client, and
the hook re-runs on every SessionStart including resumes, so such a session emits one
`by=unidentified` 428 per resume and gets no briefing. Observed on this session's own container
at 15:58:27, 15:58:28, 16:53:55, 22:37:27, 22:52:49, 23:07:08, 23:28:09 and 23:39:33 while every
explicit four-part call succeeded as `claude-seenjobs`. It fails **closed** — noise, not
exposure. Remedy is a fresh cloud session; no code change needed.

## Not available on this surface

`brain_contradictions` has no cloud-gateway op — the gateway exposes only
`notes` / `counts` / `record_fact` / `append_timeline`. The session-end contradiction sweep was
**not performed** rather than faked.
