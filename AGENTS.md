# AGENTS.md — Codex (and any non-Claude AI), start here

You're in **Seen** (seenjobs.io), owned by Brandon (`begindtheseen`). `CLAUDE.md` is the full project
guide and applies to you too — read it, then `SEEN_STRATEGY.md`. This file covers the one thing
`CLAUDE.md` doesn't: **how you, Codex, reach the shared brain.**

## You have access to the shared brain (Chronos) — use it
Chronos is the memory every AI on this project shares: Claude, Seen Command, and you. You are a
registered source named **`codex`**. Brandon issued your credential in Chronos → Access; it lives at
`~/.chronos/credentials/codex.token`. Every call you make is authenticated, scoped (read + write),
and shown to Brandon in Chronos → AI traffic under `codex`.

**If your session has `brain_*` tools**, use them directly.

**If it doesn't, use the shell** — the Seen Command repo (usually a sibling folder, `../seen-command`,
sometimes named `command-os`) ships a one-shot caller over the same server:

```sh
cd ../seen-command
BRAIN_CLIENT=codex node brain/mcp/call.mjs tools                 # list every tool
BRAIN_CLIENT=codex node brain/mcp/call.mjs brain_overview
BRAIN_CLIENT=codex node brain/mcp/call.mjs brain_whats_changed '{"since":"2026-10-01"}'
BRAIN_CLIENT=codex node brain/mcp/call.mjs brain_search_facts '{"query":"tracker"}'
BRAIN_CLIENT=codex node brain/mcp/call.mjs brain_add_fact \
  '{"note":"knowledge/seen.md","subject":"…","predicate":"…","object":"…","confidence":"high"}'
echo '{"heading":"Codex session","text":"…"}' | BRAIN_CLIENT=codex node brain/mcp/call.mjs brain_append_timeline -
BRAIN_CLIENT=codex node brain/mcp/call.mjs brain_contradictions
```

It finds the vault at `../seen/memory` (this repo's local `memory/` folder — not in git); set `CHRONOS_VAULT` to the
absolute path if yours lives elsewhere. "Identify yourself" means the credential file is missing or
the `codex` client was revoked — tell Brandon to check Chronos → Access. Never use another source's
credential, and never print, paste, or commit yours.

## How to use it
1. **Start of session:** `brain_overview`, then `brain_whats_changed` since your last entry.
2. **Before relying on a project fact:** `brain_search_facts`.
3. **When you verify something durable** (a merged PR, a schema fact, a decision): `brain_add_fact`,
   or `brain_supersede_fact` if it changes an existing fact. Supersede — never overwrite.
4. **Anything Brandon or Claude must act on is a FACT**, not just a timeline line — timeline entries
   don't appear in fact searches.
5. **End of session:** one `brain_append_timeline` entry (what you did, tests run, what's left), then
   `brain_contradictions`, and read your key facts back before saying they were recorded.
6. Record only what you verified. Label anything else unverified.

Full contract: `../seen-command/BRAIN_AI_CLIENT_PROTOCOL.txt`.

## Branch rules (from CLAUDE.md — the ones that bite)
- Work on `next-migration` or a branch off it. **Never push to or merge into `main`** (the old app).
- Open PRs as drafts. Merging to `next-migration` deploys production — verify the deploy happened.
- Tests: `node --test lib/server/*.test.mjs api/_utils/*.test.mjs` (and the suites next to files you touch).
