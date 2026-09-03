-- Supabase's security advisor flags extensions installed in `public` because that schema is exposed
-- through the API surface and is commonly writable by application roles. pg_trgm is relocatable;
-- existing GIN indexes bind to its operator-class OIDs and continue working after the schema move.
-- SeenJobs does not call similarity()/word_similarity() by name, so no application search_path
-- dependency changes. Future ILIKE queries continue to use the existing trigram indexes.
create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

comment on extension pg_trgm is
  'Trigram index support for SeenJobs search; isolated in extensions rather than the API-exposed public schema.';
