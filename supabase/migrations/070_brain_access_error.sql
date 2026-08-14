-- Preserve the reason a Chronos brain request failed so denied traffic is visible, not a silent red row.
-- Safe on environments where brain_access was provisioned out-of-band; no-op if the table is absent.
do $$
begin
  if to_regclass('public.brain_access') is not null then
    alter table public.brain_access add column if not exists error text;
  end if;
end $$;
