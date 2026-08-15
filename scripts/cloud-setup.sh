#!/usr/bin/env bash
# Seen cloud-environment setup — verifies the SeenJobs Claude cloud session can reach the always-on
# Chronos brain (the Supabase mirror) through the identity-gated gateway. Wire it as the setup script:
#   bash scripts/cloud-setup.sh
# Full contract: CLAUDE.md, "START HERE EVERY SESSION". NOT `set -e`: the brain check is informational and must
# never fail environment setup.
set -uo pipefail

echo "▶ Seen cloud setup"

# 0) Sanity: is the bridge actually in this checkout? (Guards the seen vs seen-command mixup.)
if [ ! -f lib/server/brainCloud.js ] || [ ! -f scripts/memory-status.mjs ]; then
  echo "⚠ Bridge files not found — are you on begindtheseen/seen @ next-migration?"
  echo "  (seen-command does NOT contain the bridge.)"
fi

# 1) Chronos brain check — the point of this script.
echo "▶ Chronos brain check"
if [ -z "${BRAIN_API_URL:-}" ] || [ -z "${BRAIN_API_TOKEN:-}" ] \
  || [ -z "${BRAIN_CLIENT:-}" ] || [ -z "${BRAIN_CLIENT_TOKEN:-}" ]; then
  echo "✗ Brain gateway configuration incomplete. Required: BRAIN_API_URL, BRAIN_API_TOKEN, BRAIN_CLIENT, BRAIN_CLIENT_TOKEN."
  echo "  Store secrets only in this environment's protected variables; never paste them into a prompt or commit them."
elif [ "$BRAIN_CLIENT" != "claude-seenjobs" ]; then
  echo "✗ Access denied: BRAIN_CLIENT must be exactly claude-seenjobs for this cloud environment."
else
  # The canonical bridge reads credentials from the process environment. Keeping them out of curl
  # arguments prevents the two tokens from appearing in the process list during the self-test.
  if brain_status=$(node lib/server/brainCloud.js 2>&1); then
    echo "✓ brain reachable as claude-seenjobs: $brain_status"
  else
    echo "✗ brain access denied or unavailable: $brain_status"
  fi
fi

# 2) Orientation hint for the session.
echo "▶ Next: run npm run memory:status, then follow the Brain protocol at the top of CLAUDE.md."

# 3) OPTIONAL — product deps (only if you build/run the Next.js app or run tests here).
#    The chronos MCP itself is dependency-free, so delete this block for a brain-only environment.
if [ -f package-lock.json ]; then
  echo "▶ npm ci…"
  # Dependency lifecycle scripts are executable code. Never let them inherit either Brain token or
  # the identity-routing values from the credential-bearing setup environment.
  env -u BRAIN_API_URL -u BRAIN_API_TOKEN -u BRAIN_CLIENT -u BRAIN_CLIENT_TOKEN \
    npm ci --no-audit --no-fund \
    || env -u BRAIN_API_URL -u BRAIN_API_TOKEN -u BRAIN_CLIENT -u BRAIN_CLIENT_TOKEN \
      npm install --no-audit --no-fund \
    || echo "⚠ install failed (continuing)"
fi

echo "✔ setup done"
