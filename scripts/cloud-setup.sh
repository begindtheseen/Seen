#!/usr/bin/env bash
# Seen cloud-environment setup — verifies a Claude-on-web session can reach the always-on Chronos brain
# (the Supabase mirror) through the token-gated gateway. Wire it as the environment's Setup script:
#   bash scripts/cloud-setup.sh
# Full contract: memory/CHRONOS_BRIDGE.md. NOT `set -e`: the brain check is informational and must
# never fail environment setup.
set -uo pipefail

echo "▶ Seen cloud setup"

# 0) Sanity: is the bridge actually in this checkout? (Guards the seen vs seen-command mixup.)
if [ ! -f memory/CHRONOS_BRIDGE.md ] || [ ! -f lib/server/brainCloud.js ]; then
  echo "⚠ Bridge files not found — are you on begindtheseen/seen @ next-migration?"
  echo "  (seen-command does NOT contain the bridge.)"
fi

# 1) Chronos brain check — the point of this script.
echo "▶ Chronos brain check"
if [ -z "${BRAIN_API_URL:-}" ] || [ -z "${BRAIN_API_TOKEN:-}" ]; then
  echo "⚠ BRAIN_API_URL / BRAIN_API_TOKEN not set — chronos tools fall back to the (empty) local vault."
  echo "  Add them in this environment's Environment variables (see memory/CHRONOS_BRIDGE.md §2)."
else
  code=$(curl -sS --max-time 15 -o /tmp/brain.json -w '%{http_code}' -X POST "$BRAIN_API_URL" \
    -H "authorization: Bearer $BRAIN_API_TOKEN" -H "content-type: application/json" \
    -d '{"op":"counts"}' || echo 000)
  case "$code" in
    200) echo "✓ brain reachable: $(cat /tmp/brain.json)" ;;
    401) echo "✗ 401 — BRAIN_API_TOKEN doesn't match the gateway (check the Vercel value)." ;;
    503) echo "✗ 503 — gateway not configured (BRAIN_API_TOKEN missing on Vercel)." ;;
    000) echo "✗ could not reach $BRAIN_API_URL (network/URL)." ;;
    *)   echo "✗ unexpected HTTP $code: $(cat /tmp/brain.json)" ;;
  esac
fi

# 2) Orientation hint for the session.
echo "▶ Next: read memory/CHRONOS_BRIDGE.md, then call memory_status() to orient from the brain."

# 3) OPTIONAL — product deps (only if you build/run the Next.js app or run tests here).
#    The chronos MCP itself is dependency-free, so delete this block for a brain-only environment.
if [ -f package-lock.json ]; then
  echo "▶ npm ci…"
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund || echo "⚠ install failed (continuing)"
fi

echo "✔ setup done"
