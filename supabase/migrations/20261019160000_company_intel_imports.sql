-- Durable dedupe registry for locally imported, source-attributed company intelligence.
create table if not exists public.company_intel_imports (
  id bigserial primary key,
  company_name text not null,
  source text not null,
  source_url text not null,
  source_hash text not null unique,
  kind text not null check (kind in ('applicant_outcome','employee_review','public_commentary')),
  created_at timestamptz not null default now()
);
create unique index if not exists company_intel_imports_source_url_hash_idx on public.company_intel_imports (source_url, source_hash);
alter table public.company_intel_imports enable row level security;
create policy "company_intel_imports_service_only" on public.company_intel_imports for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
