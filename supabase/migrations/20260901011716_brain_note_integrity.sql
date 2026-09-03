-- Restore the invariant that every queryable brain fact is derived from a canonical brain note.
--
-- Migration 073 correctly recovered malformed `note` values into the safe vault path
-- knowledge/4am-routine-observations.md, but it moved only brain_facts rows. `pullBrain` downloads
-- brain_notes, so the recovered facts remained invisible to the local vault and could never
-- converge. Materialize the missing note from the preserved rows before adding the FK that prevents
-- this silent split from recurring.
--
-- Every scalar is JSON-quoted. Chronos's YAML-subset parser treats JSON strings as an exact,
-- lossless representation, including quotes, backslashes, colons and control characters. The
-- INSERT is intentionally DO NOTHING when the note already exists: rerunning this migration must
-- never overwrite a later human or writer update.
insert into public.brain_notes (path, content, updated_at)
select
  'knowledge/4am-routine-observations.md',
  E'---\ntitle: 4am routine observations\ntags: [observations, recovered]\nupdated: '
    || to_char(current_date, 'YYYY-MM-DD')
    || E'\nfacts:\n'
    || string_agg(
      '  - id: ' || to_jsonb(f.id::text)::text || E'\n'
      || '    subject: ' || to_jsonb(f.subject::text)::text || E'\n'
      || '    predicate: ' || to_jsonb(f.predicate::text)::text || E'\n'
      || '    object: ' || to_jsonb(f.object::text)::text || E'\n'
      || '    valid_from: ' || coalesce(to_jsonb(f.valid_from::text)::text, 'null') || E'\n'
      || '    valid_to: ' || coalesce(to_jsonb(f.valid_to::text)::text, 'null') || E'\n'
      || '    confidence: ' || coalesce(to_jsonb(f.confidence::text)::text, 'null') || E'\n'
      || '    source: ' || coalesce(to_jsonb(f.source::text)::text, 'null') || E'\n'
      || '    recorded: ' || coalesce(to_jsonb(f.recorded::text)::text, 'null') || E'\n'
      || '    recorded_at: ' || coalesce(to_jsonb(f.recorded_at::text)::text, 'null') || E'\n'
      || '    invalidated: ' || coalesce(to_jsonb(f.invalidated::text)::text, 'null') || E'\n'
      || '    by: ' || coalesce(to_jsonb(f.by::text)::text, 'null') || E'\n'
      || '    change: ' || coalesce(to_jsonb(f.change::text)::text, 'null') || E'\n'
      || '    supersedes: ' || coalesce(to_jsonb(f.supersedes::text)::text, 'null'),
      E'\n' order by f.recorded_at nulls last, f.id
    )
    || E'\n---\n\n# 4am routine observations\n\nRecovered losslessly from legacy cloud facts whose note field contained prose instead of a vault path.\n',
  now()
from public.brain_facts f
where f.note = 'knowledge/4am-routine-observations.md'
having count(*) > 0
on conflict (path) do nothing;

-- One legacy daily note predates the timeline frontmatter contract. Repair only that exact shape;
-- the condition makes this idempotent and refuses to touch a note that already has frontmatter.
update public.brain_notes
set content = E'---\ntitle: 2026-08-15\ntype: daily\ndate: 2026-08-15\ntags: [timeline]\n---\n\n' || content,
    updated_at = now()
where path = 'timeline/2026-08-15.md'
  and content not like E'---\n%';

-- A path-shaped string is not enough: it must resolve to a canonical note. The FK makes direct SQL
-- writers fail loudly instead of creating facts that cloud search can see but the local vault cannot.
alter table public.brain_facts
  drop constraint if exists brain_facts_note_fkey;

alter table public.brain_facts
  add constraint brain_facts_note_fkey
  foreign key (note) references public.brain_notes(path)
  on update cascade on delete restrict
  not valid;

alter table public.brain_facts
  validate constraint brain_facts_note_fkey;

comment on constraint brain_facts_note_fkey on public.brain_facts is
  'Every mirrored fact must belong to a canonical brain_notes row; prevents cloud/local timeline blindness.';
