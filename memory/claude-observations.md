---
title: Claude — Observations
tags: [observations, claude]
aliases: [Claude Observations]
updated: 2026-07-08
facts:
  - id: claude-brain-connection
    subject: Claude
    predicate: brain_connection
    object: confirmed live 2026-07-07 (this session, writing to the shared Chronos vault)
    valid_from: 2026-07-07
    valid_to: null
    confidence: high
    source: "[[claude-observations]]"
    recorded: 2026-07-07
    invalidated: null
  - id: chronos-brain-online-storage-20260708-1
    subject: Chronos brain
    predicate: online_storage
    object: "Supabase brain_notes/brain_facts/brain_timeline (RLS, service-key only); auto-push each board meeting; restore via npm run brain:restore"
    valid_from: 2026-07-08
    valid_to: null
    confidence: high
    source: brain/lib/cloud.mjs
    recorded: 2026-07-08
    invalidated: null
---

# Claude — live observations

Bi-temporal facts Claude records during sessions via the `memory_record_fact` MCP tool
(supersede-not-overwrite). This is Claude's own write surface into the shared brain — separate from
the human-curated `knowledge/` notes and from Seen Command's `seen-command-observations.md`. Recall
with `memory_search_facts` / `memory_status`.
