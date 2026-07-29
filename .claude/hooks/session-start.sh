#!/bin/bash
# SessionStart hook — Seen memory-boot enforcement.
#
# Deterministic backstop for CLAUDE.md rule 1 ("memory boot"): inject a short,
# unmissable directive at the top of EVERY session so the Chronos brain gets booted
# AND written back — even when the long CLAUDE.md is skimmed. (This exists because a
# session shipped real work on 2026-07-29 without ever booting the brain.)
#
# Works in both cloud (online brain) and local Mac (file vault) sessions: it only
# tells the agent which chronos MCP tools to call; the chronos server auto-picks the
# backend. Dependency install is handled separately by scripts/cloud-setup.sh (the
# environment Setup script), so this hook stays a pure, fast context injector.
set -euo pipefail

MSG=$(cat <<'EOF'
🧠 CHRONOS MEMORY — do this before substantive work (CLAUDE.md rule 1), unless already done this session:
1. Call the chronos `memory_status` MCP tool to orient (it auto-uses the always-on online brain in cloud sessions, the local vault on a Mac). Check `memory_open_threads` too. Skim memory/HOME.md only if you still need more.
2. For any non-trivial decision, follow memory/decision-protocol.md.
3. BEFORE you end the session, WRITE BACK: `memory_record_fact` for durable typed facts, `memory_append_timeline` for what happened, and open/close threads. Skipping the write-back costs the next session the tokens this boot just saved.
No task is "too small" to skip this — the boot + write-back loop is unconditional.
EOF
)

# Emit as SessionStart additionalContext. node is always available in this repo env and
# guarantees valid JSON escaping of the multi-line message.
printf '%s' "$MSG" | node -e '
  const c = require("fs").readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: c }
  }));
'
