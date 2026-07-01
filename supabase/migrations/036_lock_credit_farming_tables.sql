-- SECURITY: same class of bug as ai_credits (035). credit_transactions and
-- answered_questions gate credit EARNING (earn caps + per-question reward dedup), and their
-- policies were FOR ALL (incl. DELETE) for the public role scoped only by auth.uid()=user_id.
-- A signed-in user could DELETE their own rows via the public anon key to reset caps / dedup
-- and farm credits repeatedly. The client never writes these — the server does via the
-- service_role key (bypasses RLS). Fix: users may only READ their own rows.

drop policy if exists "own_tx" on public.credit_transactions;
create policy "own_tx_read"
  on public.credit_transactions
  for select to public
  using (auth.uid() = user_id);

drop policy if exists "own_answers" on public.answered_questions;
create policy "own_answers_read"
  on public.answered_questions
  for select to public
  using (auth.uid() = user_id);
