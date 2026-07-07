---
title: Session Hook
tags: [meta, protocol]
updated: 2026-07-07
---

# Auto-boot hook (opt-in)

`CLAUDE.md` already tells every session to boot memory. This hook makes it **automatic and
guaranteed** — the harness runs it, not the model — by printing the memory briefing into
context at session start (and installing deps once on the web). It needs your explicit OK
because it auto-executes shell commands each session.

## What it does
- `node scripts/memory-sync.mjs` — rebuild the derived index (dependency-free, quiet).
- On the web, one-time `npm install` if `node_modules` is missing (idempotent; the container
  caches it after).
- `node scripts/memory-status.mjs` — print the compact briefing to stdout, which Claude Code
  injects into the session's context.

Synchronous, non-interactive, and never fails the session (all guarded with `|| true`).

## To enable
Create these two files (already un-ignored in `.gitignore` so they commit and apply to every
web session once merged):

`.claude/hooks/session-start.sh` (make it executable — `chmod +x`):
```bash
#!/bin/bash
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
node scripts/memory-sync.mjs >/dev/null 2>&1 || true
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ ! -d node_modules ]; then
  npm install >/dev/null 2>&1 || true
fi
node scripts/memory-status.mjs 2>/dev/null || echo "🧠 Chronos memory: run 'npm run memory:status' (start at memory/HOME.md)."
```

`.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh" } ] }
    ]
  }
}
```

Trade-off: **synchronous** start guarantees the briefing is in context before the session
begins (a few seconds slower on a cold web container; cached after). Say the word and I'll
add these two files.

## Why it's worth it
Without it, "boot memory every session" relies on the model following `CLAUDE.md`. With it,
the briefing is *always* there — the token save (recall, not re-read) becomes structural, not
best-effort.
