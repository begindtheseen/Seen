# CLAUDE HANDOFF
*For: Any new Claude instance picking up this project*
*Last updated: 2026-06-13*

---

## READ THIS FIRST

CLAUDE.md describes a Next.js 15 app. **That app does not exist in production.**
The real app is a monolithic `index.html` + Vercel serverless functions in `/api/`.
Read `MASTER_PROJECT_STATE.md` for the full truth before touching anything.

---

## CURRENT BLOCKER

**Vercel deployment is broken.** Pushes to `main` do not trigger deployments.
This requires owner action in the Vercel dashboard — Claude cannot fix it.

Required owner action:
> vercel.com → seen project → Settings → General → Framework Preset → "Other" → Save → Deployments → Redeploy latest

Until this is fixed, no code changes will reach production.

---

## ACTIVE BRANCH

```
claude/index-file-stability-LrIfU
```

Always push to BOTH:
```bash
git push -u origin claude/index-file-stability-LrIfU
git push origin claude/index-file-stability-LrIfU:main
```

---

## WHAT NEEDS APPROVAL BEFORE WORK BEGINS

1. **Should CLAUDE.md be updated** to describe the real static HTML architecture instead of the Next.js architecture it currently (incorrectly) describes?
2. **Should the Next.js migration be restarted** properly, or should the static HTML monolith be the ongoing approach?

These are strategic direction decisions. Do not assume either way.

---

## TOP PARITY GAPS (waiting on approval)

| # | Gap | Blocker |
|---|---|---|
| P0 | Vercel deployment broken | Owner must fix in dashboard |
| P1 | CLAUDE.md describes non-existent Next.js app | Needs approval to update |
| P2 | Event system not fully wired to Supabase | Needs codebase audit |
| P3 | Outcome card viral share flow incomplete | Needs UI audit |

---

## SESSION HISTORY (this session)

Previous session (compacted): Was investigating Vercel deployment failures.
This session:
- Confirmed: GitHub Actions workflow failing (missing VERCEL_TOKEN secret)
- Fixed: Added `"framework": null` to vercel.json
- Removed: GitHub Actions workflow (wasn't helping, needed secrets)
- Closed: PR #35 (dead Next.js migration branch)
- Confirmed: Vercel still not deploying — requires dashboard fix
- Created: MASTER_PROJECT_STATE.md + this file

---

## DO NOT PROCEED WITHOUT ASKING

- Do not build Next.js components (no runtime in production)
- Do not push new features (deployment broken — users won't see them)
- Do not merge stale branches
- Do not assume any architecture that contradicts what's in MASTER_PROJECT_STATE.md
