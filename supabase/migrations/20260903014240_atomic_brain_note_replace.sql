-- Replace one canonical Brain note and its entire derived fact mirror as one transaction.
-- The gateway can have concurrent writers for the same note; a transaction-scoped advisory lock
-- makes their order deterministic, while atomic commit prevents readers from observing a split.
create or replace function public.brain_replace_note(
  p_path text,
  p_content text,
  p_updated_at timestamptz,
  p_facts jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if p_path is null or p_path = '' or p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    raise exception 'brain_replace_note requires a path and a JSON fact array';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_path, 0));

  insert into public.brain_notes (path, content, updated_at)
  values (p_path, p_content, p_updated_at)
  on conflict (path) do update
    set content = excluded.content,
        updated_at = excluded.updated_at;

  delete from public.brain_facts where note = p_path;

  insert into public.brain_facts (
    note, id, subject, predicate, object, valid_from, valid_to, confidence, source,
    recorded, recorded_at, invalidated, by, change, supersedes, synced_at
  )
  select
    p_path, f.id, f.subject, f.predicate, f.object, f.valid_from, f.valid_to, f.confidence, f.source,
    f.recorded, f.recorded_at, f.invalidated, f.by, f.change, f.supersedes, f.synced_at
  from pg_catalog.jsonb_populate_recordset(null::public.brain_facts, p_facts) as f;
end;
$function$;

revoke all on function public.brain_replace_note(text, text, timestamptz, jsonb) from public;
revoke all on function public.brain_replace_note(text, text, timestamptz, jsonb) from anon;
revoke all on function public.brain_replace_note(text, text, timestamptz, jsonb) from authenticated;
grant execute on function public.brain_replace_note(text, text, timestamptz, jsonb) to service_role;

comment on function public.brain_replace_note(text, text, timestamptz, jsonb) is
  'Service-role-only atomic replacement of a canonical Brain note and its exact derived fact mirror.';
