-- A brain fact's `note` must be a vault path, not prose — enforced at the storage layer.
--
-- WHY THE DATABASE AND NOT AN APPLICATION GUARD. Both application guards already do this correctly:
-- assertNotePath at the Chronos MCP boundary (seen-command 18ea9a8) and record_fact in api/brain.js
-- (a169afc). But 13 rows in brain_facts carry a rationale sentence in `note` and carry neither
-- guard's fingerprint — all 13 have recorded_at NULL, which is what a direct Postgres INSERT looks
-- like. They come from the 4am routine identities (seenjobs-4am-routine, 4am-seenjobs-cloud,
-- claude-4am-applications, seenjobs-4am-session), which reach the brain over SQL rather than through
-- either writer. There is no application writer left to patch, so a constraint is the only
-- enforcement point that covers them.
--
-- WHY IT MATTERS. A non-path `note` is unreachable by note-scoped queries: the write succeeds and the
-- read returns a legitimate-looking empty. That is the silent-zero class at the storage layer, and
-- it is the same failure that once stranded facts at the vault root where nothing indexed them.
--
-- THE PREDICATE MIRRORS THE APPLICATION so the two layers cannot disagree about what a valid note is:
-- assertNotePath's NOTE_PATH_RE, no '..', a 120-character bound, and the '.md' suffix that
-- assertNotePath appends. It accepts BOTH shapes that are actually in use — root-level notes such as
-- claude-observations.md (293 rows, the majority) and dir/file notes such as knowledge/architecture.md
-- (184 rows). A naive 'dir/file.md' rule would have rejected more legitimate rows than bad ones.
--
-- Dry-run over every row before this was applied: 477 pass, and the 13 that fail are exactly the
-- stranded prose ones — no false positives in either direction.
--
-- NOT VALID IS DELIBERATE. It enforces every INSERT and UPDATE from here on while leaving those 13
-- historical rows in place; brain facts are append-only history, validating now would fail, and
-- re-homing them is a separate decision. Once they are re-homed:
--   alter table public.brain_facts validate constraint brain_facts_note_is_vault_path;
--
-- EXPECTED BEHAVIOUR CHANGE: the 4am routines will now fail loudly on a bad note instead of silently
-- polluting the store. That is the intent.
--
-- Already applied to production on 2026-08-15 as migration `brain_facts_note_path_check`; this file
-- closes the repo-versus-prod schema gap, the same reason 070 and 071 were added.
alter table public.brain_facts
  drop constraint if exists brain_facts_note_is_vault_path;

alter table public.brain_facts
  add constraint brain_facts_note_is_vault_path
  check (
    note is not null
    and length(note) <= 120
    and note not like '%..%'
    and note like '%.md'
    and note ~ '^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$'
  ) not valid;

comment on constraint brain_facts_note_is_vault_path on public.brain_facts is
  'note must be a vault path (mirrors assertNotePath NOTE_PATH_RE, no .., <=120 chars, ends .md). NOT VALID: 13 legacy prose-note rows from 4am routines predate it and are left as history.';
