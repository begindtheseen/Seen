# Self-hosting the Graphiti graph engine (optional, your cloud steps)

This is **Phase 3** — the optional upgrade that adds LLM-extracted entity/relationship
reasoning and hybrid semantic retrieval *on top of* the deterministic vault facts you already
have. **You do not need it to have temporal memory** — [[temporal|Chronos]] + the
[[mcp/README|local MCP server]] already give bi-temporal, point-in-time recall today. Add
Graphiti when you want fuzzy semantic search and auto-extracted relationships over your prose.

> These steps touch **your** Google Cloud and **your** Claude Desktop config — I can't do them
> from the repo. Everything below is a runbook.

## What stays the same

The vault is still the single source of truth. Graphiti is another **derived** consumer of the
same `memory/.graph/*.jsonl` that `scripts/memory-sync.mjs` produces:
- `facts.jsonl` → Graphiti `add_triplet` (typed, **no LLM** on ingest)
- `episodes.jsonl` → Graphiti `add_episode` (prose; LLM extracts entities/edges)

If Graphiti ever breaks or you switch engines, `clear_graph` and re-ingest. No lock-in.

## 1. Run it locally first

```bash
cp memory/graph/.env.example memory/graph/.env   # then fill in the values below
docker compose -f memory/graph/docker-compose.yml up -d
```

`.env` values:

| Var | Notes |
|---|---|
| `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY` + `MODEL_NAME`) | LLM for ingestion extraction. **This is the real cost** — see below. |
| `FALKORDB_URI` | `redis://falkordb:6379` (set in compose). |
| `SEMAPHORE_LIMIT` | concurrent ingest LLM calls; keep low (5) to cap cost/429s. |
| `GRAPHITI_TELEMETRY_ENABLED` | `false`. |

Verify the MCP endpoint is up: `curl http://localhost:8000/health` (or the browser UI on
`:3000` for FalkorDB).

## 2. Ingest the vault

Point an ingestion run at the derived index:

```bash
npm run memory:sync          # refresh memory/.graph/*.jsonl from the vault
# then feed facts.jsonl via add_triplet and episodes.jsonl via add_episode
# (a small ingest script is the natural next addition once the server is up)
```

## 3. Deploy on Google Cloud

Recommended for a single user: **one small Compute Engine VM** (stateful, simplest).

1. `gcloud compute instances create chronos-graph --machine-type=e2-small --boot-disk-size=20GB --image-family=cos-stable --image-project=cos-cloud` (Container-Optimized OS).
2. SSH in, install/enable Docker (COS ships it), copy `docker-compose.yml` + `.env`, `docker compose up -d`.
3. Lock it down: firewall so only your IP reaches `:8000`, or (better) keep it private and reach it over the `gcloud` SSH tunnel / Tailscale. **Do not expose the graph DB port publicly.**
4. Persistent disk holds `falkordb_data` so memory survives restarts.

**Cost (honest):**
- **Infra:** e2-small (2 GB) ≈ **$13/mo** + ~20 GB disk ≈ $1 → ~**$15/mo** with FalkorDB. Neo4j wants more RAM (e2-medium, ~$25/mo). Cloud Run is cheaper when idle but has **no persistent disk**, so the DB would need a separate stateful home — a VM is simpler here.
- **LLM tokens (separate, can dominate):** every `add_episode` triggers **several** LLM calls (entity extract, edge extract, dedup) — not one. High-volume prose ingestion can exceed the infra bill. **This is exactly why the typed-fact path matters:** structured facts ingest via `add_triplet` with no LLM. Keep prose ingestion selective.

## 4. Wire Graphiti into Claude Desktop

Claude Desktop has no native HTTP transport, so bridge with `mcp-remote`:

```json
{
  "mcpServers": {
    "chronos":         { "command": "node", "args": ["/abs/path/seen/memory/mcp/server.mjs"], "env": { "CHRONOS_VAULT": "/abs/path/seen/memory" } },
    "graphiti-memory": { "command": "npx",  "args": ["mcp-remote", "http://YOUR_VM_IP:8000/mcp/"] }
  }
}
```

Run **both**: `chronos` for deterministic bi-temporal facts, `graphiti-memory` for semantic/
relationship recall. Same vault behind both.

## Gotchas to verify (from research, 2026)

- **FalkorDB in the official image** may be incomplete ([getzep/graphiti#749]) — test locally; fall back to the Neo4j service in the compose file if needed.
- **Temporal backfill** has known edge cases for bulk backdated imports ([getzep/graphiti#1489]) — ingest incrementally; trust the vault's `valid_*`/`recorded` dates as the authority.
- **MCP tool names vary by version** (`add_memory` vs `add_episode`, `search_nodes` vs `search_memory_nodes`) — check the version you install.

## Source
Research brief in this session; official docs: github.com/getzep/graphiti,
help.getzep.com/graphiti. Cost figures are infra-only estimates (FalkorDB, light use).
