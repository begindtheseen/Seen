-- SECURITY (critical): the previous policy `own_credits` was FOR ALL (select/insert/update/
-- delete) for the public role with only USING (auth.uid() = user_id) and NO WITH CHECK.
-- That let any signed-in user PATCH their own ai_credits row via the public anon key and set
-- balance/pro to anything — granting themselves unlimited credits and free Pro, bypassing all
-- server logic. Fix: users may only READ their own credits. Every write (grant, consume, pro)
-- goes through the server's service_role key, which bypasses RLS. The client never writes this
-- table directly.
drop policy if exists "own_credits" on public.ai_credits;

create policy "own_credits_read"
  on public.ai_credits
  for select
  to public
  using (auth.uid() = user_id);
