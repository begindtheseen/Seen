// Seen Job Ingestion — REGISTRY BOOTSTRAP SEED.
//
// A small, hand-curated set of well-known employers and their PUBLIC ATS tenant, so the source
// registry isn't cold on day one and there's employer-direct inventory immediately. These are
// individually-known public facts (a company's own public job board), NOT a copied compilation —
// deliberately avoiding job-board-aggregator's CC BY-NC dataset. The scale seed is meant to come
// from (a) SNOWBALL discovery off real search results (100% accurate — it reads live URLs),
// (b) the Common Crawl discovery pass (lib/jobs/discovery.js), and (c) optionally importing the
// MIT-licensed ats-companies/*.csv directory from kalil0321/ats-scrapers.
//
// A wrong tenant here is self-correcting: it returns no jobs, the circuit breaker degrades then
// disables it after repeated empty/failed syncs. So the bootstrap is safe even if a slug is off.

export const SEED_SOURCES = [
  // Greenhouse (public boards-api) — large, well-known users.
  { companyName: 'Stripe', provider: 'greenhouse', tenant: 'stripe' },
  { companyName: 'Coinbase', provider: 'greenhouse', tenant: 'coinbase' },
  { companyName: 'Databricks', provider: 'greenhouse', tenant: 'databricks' },
  { companyName: 'Robinhood', provider: 'greenhouse', tenant: 'robinhood' },
  { companyName: 'Brex', provider: 'greenhouse', tenant: 'brex' },
  { companyName: 'Ramp', provider: 'greenhouse', tenant: 'ramp' },
  { companyName: 'Plaid', provider: 'greenhouse', tenant: 'plaid' },
  { companyName: 'Gusto', provider: 'greenhouse', tenant: 'gusto' },
  { companyName: 'Samsara', provider: 'greenhouse', tenant: 'samsara' },
  { companyName: 'Instacart', provider: 'greenhouse', tenant: 'instacart' },
  { companyName: 'DoorDash', provider: 'greenhouse', tenant: 'doordash' },
  { companyName: 'Reddit', provider: 'greenhouse', tenant: 'reddit' },
  { companyName: 'Discord', provider: 'greenhouse', tenant: 'discord' },
  { companyName: 'Cloudflare', provider: 'greenhouse', tenant: 'cloudflare' },
  { companyName: 'Snowflake', provider: 'greenhouse', tenant: 'snowflake' },
  { companyName: 'Pinterest', provider: 'greenhouse', tenant: 'pinterest' },
  { companyName: 'Airbnb', provider: 'greenhouse', tenant: 'airbnb' },
  { companyName: 'Dropbox', provider: 'greenhouse', tenant: 'dropbox' },
  { companyName: 'Sofi', provider: 'greenhouse', tenant: 'sofi' },
  { companyName: 'Anthropic', provider: 'greenhouse', tenant: 'anthropic' },
  // Lever (public postings API).
  { companyName: 'Netflix', provider: 'lever', tenant: 'netflix' },
  { companyName: 'Plaid', provider: 'lever', tenant: 'plaid' },
  { companyName: 'KeepTruckin', provider: 'lever', tenant: 'motive' },
  // Ashby (public posting API) — common among newer startups.
  { companyName: 'Linear', provider: 'ashby', tenant: 'linear' },
  { companyName: 'Vanta', provider: 'ashby', tenant: 'vanta' },
  { companyName: 'Ashby', provider: 'ashby', tenant: 'ashby' },
  { companyName: 'Runway', provider: 'ashby', tenant: 'runwayml' },
];
