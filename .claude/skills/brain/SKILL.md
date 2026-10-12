---
name: brain
description: How to talk to the Chronos brain (shared cross-session memory) from a Seen session — orient at start, search facts, record verified facts, write the session episode, check contradictions. Use at session start, whenever you need prior context ("what do we know about X", "where did we leave off"), when you verify a durable truth, and before ending any session that did real work.
---

# Chronos brain — the session loop

The brain is the always-on shared memory. Every call goes through **one CLI**, `node scripts/brain.mjs`
(also `npm run -s brain -- <cmd>`), which wraps `lib/server/brainCloud.js`. Credentials and identity
come only from the environment (`BRAIN_API_URL`, `BRAIN_API_TOKEN`, `BRAIN_CLIENT=claude-seenjobs`,
`BRAIN_CLIENT_TOKEN`). **Never** echo, print, pass as an argument, or write those tokens anywhere.
The CLI refuses any identity other than exactly `claude-seenjobs`.

## 1. Start — orient (cheap, do it first)

The SessionStart hook usually already injected a "🧠 Chronos brain — LIVE briefing". If it did, you are
oriented — don't re-fetch. If it didn't (or says the briefing couldn't be fetched):

```bash
node scripts/brain.mjs ping     # transport + counts; proves credentials work
node scripts/brain.mjs status   # compact briefing: what changed, open threads, shaky facts
```

If `ping` fails with "not configured", the environment lacks the brain secrets — tell the user once
and continue without writing; do not invent a fallback identity.

## 2. During — recall instead of re-reading

Search before re-deriving anything from docs or code history:

```bash
node scripts/brain.mjs search --query "stale jobs" --limit 10
node scripts/brain.mjs search --subject "Seen Command gate"
node scripts/brain.mjs search --predicate status --as-of 2026-09-01
```

At least one of `--query/--subject/--predicate` is required; `--limit` is 1–100. **The code wins over a
stale fact** — if they disagree, verify in code and record the corrected fact (it supersedes).

## 3. Record durable truths as you verify them

Only things verified this session with evidence (file:line, command run, prod probe) — not plans,
not guesses:

```bash
node scripts/brain.mjs fact --subject "Free tier" --predicate daily_ai_credits --object "1/day" \
  --confidence high --source "lib/server/creditRules.js FREE_DAILY_CREDITS"
```

- Same `subject`+`predicate` as an existing fact → the new one **supersedes** it (history kept). Reuse
  existing subject/predicate names (search first) so supersede works instead of forking duplicates.
- `--confidence high|medium|low`; `--source` = where you verified it; `--note` = vault note file.
- **A handoff is a FACT, never a timeline entry.** Anything another agent/session must act on
  (request, instruction, blocker) goes in `fact` — timeline episodes don't surface in search/briefings.
- Long values: `--object -` reads stdin.

## 4. End — write back (mandatory if the session did real work)

```bash
node scripts/brain.mjs timeline --heading "<branch/PR> — <one-line what>" --text - <<'EOF'
Shipped: … (PR #, sha). Verified: … (how). Decided: … Next: …
EOF
node scripts/brain.mjs contradictions
```

`timeline` defaults `--date` to today (UTC). If `contradictions` returns `count > 0`, resolve each by
recording the correct fact (supersede) and report it to the user. Skipping write-back means the next
session pays the context cost again.

## Rules

- Supersede, never overwrite; never delete facts.
- Never put secrets, tokens, user PII, or emails into a fact or episode.
- Local Mac sessions may instead use the private `brain` MCP (`brain_overview`, `brain_search_facts`,
  `brain_add_fact`, `brain_append_timeline`, …) registered as `claude-seenjobs`; the loop is identical.
