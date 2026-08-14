#!/bin/bash
# SessionStart hook — Seen Chronos memory boot.
#
# Injects the LIVE brain briefing (the always-on online brain in a cloud session, the
# local vault on a Mac) as SessionStart additionalContext, so the session starts already
# oriented — ZERO tool calls. That is the whole point: connect the session to the info it
# needs and save the round-trip. Falls back to a directive if the briefing can't be fetched.
# Exists because a 2026-07-29 session shipped real work without ever booting the brain.
#
# scripts/memory-status.mjs is cloud-aware (fetches via the token-gated gateway when
# all four gateway values are set (URL, outer token, exact client name, unique client token) and is
# dependency-free, so this needs no node_modules. The cloud role is always `claude-seenjobs`.
# Deps + brain reachability are handled separately by scripts/cloud-setup.sh.
set -uo pipefail  # NOT -e: a briefing failure must fall back to the directive, never abort the session.

PROJ="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STATUS="$PROJ/scripts/memory-status.mjs"

# Bound the (possibly networked) briefing so session start never hangs. `timeout` exists on
# Linux (every cloud session); a Mac without it runs unbounded — local vault, no network, fast.
if command -v timeout >/dev/null 2>&1; then RUN=(timeout 15 node "$STATUS"); else RUN=(node "$STATUS"); fi

BRIEF=""
[ -f "$STATUS" ] && BRIEF="$("${RUN[@]}" 2>/dev/null || true)"

if [ -n "$BRIEF" ]; then
  CONTEXT="🧠 Chronos brain — LIVE briefing for authenticated source claude-seenjobs, injected at session start so you begin oriented (recall, don't re-read). Every Brain request must identify as exactly claude-seenjobs; never use claude-session or another fallback. Follow CLAUDE.md's Brain protocol and WRITE BACK before the session ends with recordFactCloud + appendTimelineCloud, then run contradictionsCloud.

$BRIEF"
else
  CONTEXT="🧠 CHRONOS MEMORY (CLAUDE.md rule 1) — authenticated source must be exactly claude-seenjobs. The auto-briefing couldn't be fetched, so verify BRAIN_CLIENT=claude-seenjobs and the protected BRAIN_CLIENT_TOKEN environment variable, then run npm run memory:status before substantive work. Never use claude-session or another fallback. Follow CLAUDE.md's Brain protocol and WRITE BACK before ending."
fi

# JSON-encode via node (always present) so any briefing bytes — quotes, backslashes, emoji —
# are escaped correctly into the SessionStart additionalContext payload.
printf '%s' "$CONTEXT" | node -e '
  const c = require("fs").readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: c } }));
'
