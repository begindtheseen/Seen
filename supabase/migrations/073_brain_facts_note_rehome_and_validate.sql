-- Re-home the legacy prose-note rows, then validate the constraint 072 added NOT VALID.
--
-- 072 shut the door on new bad writes but deliberately left 13 historical rows alone, because brain
-- facts are append-only history and validating would have failed against them. This finishes the job.
--
-- WHAT MOVES AND WHAT IS PRESERVED. Those rows carried the writer's rationale sentence in `note`
-- instead of a vault path, and all 13 had `change` NULL — which is exactly the field that rationale
-- belongs in. So this is a LOSSLESS RELOCATION, not a rewrite: `note` becomes a real path and the
-- original prose is preserved verbatim in `change` behind a short recovery preamble. No subject,
-- predicate, object or validity window is touched, so nothing the facts ASSERT changes.
--
-- WHY THIS TARGET NOTE. The rows come from the 4am routine identities and exist only in Postgres —
-- they never materialised in the local vault, because pullBrain writes files from brain_notes and
-- these have no note row. Sending them to an actively-synced note such as claude-observations.md
-- would inject cloud-only facts under a note the local vault also owns, creating exactly the
-- local-versus-cloud divergence that already makes the hourly keeper and the gateway disagree about
-- contradiction counts. A dedicated note keeps them valid, queryable and clearly labelled as
-- cloud-origin, without muddying a note the vault is the source of truth for.
--
-- The composite primary key is (note, id), so changing `note` moves the key. Verified before this
-- was applied: 0 rows already at the target, 0 primary-key collisions, 13 distinct ids across 13
-- rows, and 0 rows whose `change` would have been overwritten.
--
-- IDEMPOTENT. On a fresh database, or on a second run, the UPDATE matches nothing and VALIDATE is a
-- no-op on an already-valid constraint.
--
-- Already applied to production on 2026-08-15 as migration `brain_facts_note_rehome_and_validate`;
-- this file closes the repo-versus-prod schema gap, the same reason 070, 071 and 072 were added.
-- Verified after applying: convalidated = true, 490 rows, 0 bad notes, 13 re-homed with their prose
-- preserved.
update public.brain_facts
set change = 'Recovered from a malformed note field on 2026-08-15 (the note held this rationale instead of a vault path). Original text: ' || note,
    note = 'knowledge/4am-routine-observations.md'
where note not like '%.md';

-- Every row now satisfies the predicate, so the constraint can finally cover the whole table
-- rather than only future writes.
alter table public.brain_facts
  validate constraint brain_facts_note_is_vault_path;
