-- Demand data: one row per city+role. Upserted by /api/refresh-demand on a schedule.
-- Frontend reads via /api/demand-data (public). Only service role may write.

CREATE TABLE IF NOT EXISTS demand_data (
  id            serial PRIMARY KEY,
  city          text        NOT NULL,
  urg           text        NOT NULL DEFAULT 'warm' CHECK (urg IN ('hot','warm')),
  src           text        NOT NULL DEFAULT 'BLS OES 2024',
  role_title    text        NOT NULL,
  niche         text        NOT NULL,
  level         text        NOT NULL,
  count         int         NOT NULL DEFAULT 0 CHECK (count >= 0),
  di            int         NOT NULL DEFAULT 50 CHECK (di >= 0 AND di <= 100),
  note          text        NOT NULL DEFAULT '',
  bls_series_id text,                              -- JOLTS series backing the sector signal
  bls_period    text,                              -- e.g. "2024-M09" (most recent period used)
  bls_raw_value numeric,                           -- JOLTS openings (000s) at time of last refresh
  data_version  text,                              -- e.g. "2024-Q3"
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per city+role pair (upsert key)
CREATE UNIQUE INDEX IF NOT EXISTS idx_demand_data_city_role
  ON demand_data(city, role_title);

CREATE INDEX IF NOT EXISTS idx_demand_data_updated
  ON demand_data(updated_at DESC);

-- Row-level security: public read, service-role write only
ALTER TABLE demand_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demand_public_read" ON demand_data
  FOR SELECT USING (true);

CREATE POLICY "demand_service_write" ON demand_data
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Audit log: one row per refresh run
CREATE TABLE IF NOT EXISTS demand_refresh_log (
  id            serial PRIMARY KEY,
  ran_at        timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL CHECK (status IN ('ok','error','partial')),
  rows_upserted int         NOT NULL DEFAULT 0,
  bls_period    text,
  details       text
);

ALTER TABLE demand_refresh_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demand_log_service_only" ON demand_refresh_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
