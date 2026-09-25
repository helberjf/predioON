-- Additive monitoring schema. Safe before/after drizzle push; no existing readings are removed.
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS property_type text NOT NULL DEFAULT 'CONDOMINIUM';
CREATE TABLE IF NOT EXISTS monitoring_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ENERGY','WATER','PUMP')),
  tariff double precision CHECK (tariff >= 0), daily_limit double precision CHECK (daily_limit > 0),
  daily_cost_limit double precision CHECK (daily_cost_limit > 0), continuous_limit_minutes double precision CHECK (continuous_limit_minutes > 0),
  max_gap_seconds integer NOT NULL DEFAULT 300 CHECK (max_gap_seconds BETWEEN 10 AND 3600),
  adaptive_enabled boolean NOT NULL DEFAULT true, minimum_history_days integer NOT NULL DEFAULT 7 CHECK (minimum_history_days BETWEEN 7 AND 28),
  deviation_percent double precision NOT NULL DEFAULT 50 CHECK (deviation_percent >= 10),
  enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS monitoring_device_kind_uq ON monitoring_profiles(device_id,kind);
CREATE INDEX IF NOT EXISTS monitoring_building_idx ON monitoring_profiles(building_id);
CREATE TABLE IF NOT EXISTS usage_cursors (
  profile_id uuid PRIMARY KEY REFERENCES monitoring_profiles(id) ON DELETE CASCADE,
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  last_at timestamptz NOT NULL, last_value double precision NOT NULL, good boolean NOT NULL,
  continuous_seconds double precision NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_usage (
  profile_id uuid NOT NULL REFERENCES monitoring_profiles(id) ON DELETE CASCADE,
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE, day text NOT NULL,
  quantity double precision NOT NULL DEFAULT 0, estimated_cost double precision,
  covered_seconds double precision NOT NULL DEFAULT 0, resets integer NOT NULL DEFAULT 0, samples integer NOT NULL DEFAULT 0,
  first_at timestamptz NOT NULL, last_at timestamptz NOT NULL, PRIMARY KEY(profile_id,day)
);
CREATE INDEX IF NOT EXISTS daily_usage_building_day_idx ON daily_usage(building_id,day);
ALTER TABLE monitoring_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS monitoring_read ON monitoring_profiles;
CREATE POLICY monitoring_read ON monitoring_profiles FOR SELECT USING (app_can_access_building(building_id));
DROP POLICY IF EXISTS monitoring_write ON monitoring_profiles;
CREATE POLICY monitoring_write ON monitoring_profiles FOR ALL USING (app_is_building_admin(building_id)) WITH CHECK (
  app_is_building_admin(building_id) AND EXISTS (SELECT 1 FROM devices d WHERE d.id = device_id AND d.building_id = monitoring_profiles.building_id)
);
DROP POLICY IF EXISTS usage_cursor_read ON usage_cursors;
CREATE POLICY usage_cursor_read ON usage_cursors FOR SELECT USING (app_can_access_building(building_id));
DROP POLICY IF EXISTS daily_usage_read ON daily_usage;
CREATE POLICY daily_usage_read ON daily_usage FOR SELECT USING (app_can_access_building(building_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring_profiles TO predioon_app;
GRANT SELECT ON usage_cursors, daily_usage TO predioon_app;
REVOKE INSERT, UPDATE, DELETE ON usage_cursors, daily_usage FROM predioon_app;
