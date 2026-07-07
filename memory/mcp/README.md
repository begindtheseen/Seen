# Chronos MCP server

Exposes the vault's bi-temporal memory ([[temporal|Chronos]]) to Claude as MCP tools.
Dependency-free Node stdio server — no SDK, no `npm install`, no external DB. It re-reads the
vault on every call, so answers are always current.

## Tools

| Tool | Use |
|---|---|
| `memory_search_facts({query?, as_of?, subject?, predicate?})` | Point-in-time recall. `as_of: "2026-07-01"` → what was true then; omit → current. |
| `memory_whats_changed({since})` | Facts recorded/invalidated since a date. Run at **session start** with the last session's date. |
| `memory_contradictions()` | Overlapping-validity conflicts (a supersede that forgot to close `valid_to`). |
| `memory_timeline({from?, to?})` | Dated session episodes, newest first. |
| `memory_get_entity({name})` | A note's current + historical facts and its links/backlinks. |

## Wire it into Claude Code

From the repo root:

```bash
claude mcp add chronos -- node memory/mcp/server.mjs
```

Or commit the project-scoped `memory/mcp/mcp.json` example (copy to `.mcp.json` at repo root):

```json
{
  "mcpServers": {
    "chronos": { "command": "node", "args": ["memory/mcp/server.mjs"] }
  }
}
```

Set `CHRONOS_VAULT` to point at a different vault directory (defaults to `memory/`).

## Wire it into Claude Desktop

Claude Desktop launches stdio servers directly. Edit its config
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "chronos": {
      "command": "node",
      "args": ["/absolute/path/to/seen/memory/mcp/server.mjs"],
      "env": { "CHRONOS_VAULT": "/absolute/path/to/seen/memory" }
    }
  }
}
```

For a **standalone / Obsidian-Sync global vault**, point `args` + `CHRONOS_VAULT` at that
vault's folder instead — the server has no dependency on the Seen repo beyond
`lib/server/memoryGraph.js` (copy that file alongside the server when extracting the vault).

## Verify by hand

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_search_facts","arguments":{"subject":"Seen free tier","predicate":"daily_ai_credits","as_of":"2026-07-01"}}}' \
 | node memory/mcp/server.mjs
```

Expect the `as_of 2026-07-01` call to return the historical **3/day** credit fact with its
closed validity window — proof the point-in-time recall works.

## Relationship to Graphiti

This local server IS the temporal query layer today. When you stand up Graphiti (see
[[graph/README]]), run **both**: `chronos` for the deterministic vault-derived facts, and
`graphiti-memory` for LLM-extracted entities/relationships over the same episodes. Same vault
feeds both; you swap or add without touching the notes.
