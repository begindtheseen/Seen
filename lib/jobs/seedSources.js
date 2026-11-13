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

  // Oilfield employers that hire green hands (research 2026-11-13: none of them post on a system Seen
  // read before, so Seen held zero live oilfield listings). Each tenant is the board's own public feed,
  // read live on 2026-11-13; tenant formats are documented in lib/jobs/providers/<provider>.js.
  // Workday — "<host prefix>/<tenant>/<site>".
  { companyName: 'Helmerich & Payne', provider: 'workday', tenant: 'hpinc.wd5/hpinc/hpinc' },
  { companyName: 'Baker Hughes', provider: 'workday', tenant: 'bakerhughes.wd5/bakerhughes/bakerhughes' },
  { companyName: 'ProPetro', provider: 'workday', tenant: 'propetroservices.wd5/propetroservices/propetro_careers' },
  { companyName: 'Silvertip Completion Services', provider: 'workday', tenant: 'propetroservices.wd5/propetroservices/silvertip_careers' },
  { companyName: 'Kodiak Gas Services', provider: 'workday', tenant: 'kodiakgas.wd12/kodiakgas/kodiakgascareers' },
  { companyName: 'ChampionX', provider: 'workday', tenant: 'championx.wd1/championx/championx_external' },
  // Oracle Recruiting Cloud — "<host>/<site number>".
  { companyName: 'Patterson-UTI', provider: 'oraclecloud', tenant: 'fa-elpm-saasfaprod1.fa.ocs.oraclecloud.com/cx' },
  { companyName: 'Nabors', provider: 'oraclecloud', tenant: 'fa-eyem-saasfaprod1.fa.ocs.oraclecloud.com/cx_1' },
  { companyName: 'NOV', provider: 'oraclecloud', tenant: 'egay.fa.us6.oraclecloud.com/cx_2001' },
  { companyName: 'Weatherford', provider: 'oraclecloud', tenant: 'fa-exmi-saasfaprod1.fa.ocs.oraclecloud.com/cx_1' },
  { companyName: 'Archrock', provider: 'oraclecloud', tenant: 'edva.fa.us2.oraclecloud.com/cx_1' },
  // UKG Pro (UltiPro) Recruiting — "<host>/<company code>/<job board id>".
  { companyName: 'Atlas Energy Solutions', provider: 'ukg', tenant: 'recruiting2.ultipro.com/atl1007atsc/6eb447b8-e4eb-4c77-8c5c-5c6dc1f7a616' },
  { companyName: 'TETRA Technologies', provider: 'ukg', tenant: 'recruiting2.ultipro.com/tet1000tetra/b9c888fa-45a6-454f-951a-0e24b3db84ef' },
  { companyName: 'Cactus', provider: 'ukg', tenant: 'recruiting2.ultipro.com/cac1001cacc/a107cbd1-c097-4da7-a6f4-2a4ab021b86e' },
  // EmpForce — "<pod>/<board key as hex>" (the key `Cd=cXSAlMyrKnU=` is case-sensitive base64).
  { companyName: 'Liberty Energy', provider: 'empforce', tenant: 'na1/71748094ccab2a75' },
];
