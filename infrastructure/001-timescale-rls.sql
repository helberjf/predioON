-- Prédio ON: TimescaleDB + tenant isolation with PostgreSQL RLS.
-- Apply AFTER `pnpm --filter @predioon/db db:push`.
-- IMPORTANT: production API must connect with a NON-OWNER database role.
-- PostgreSQL table owners bypass RLS unless FORCE ROW LEVEL SECURITY is enabled.

CREATE EXTENSION IF NOT EXISTS timescaledb;

SELECT create_hypertable(
  'telemetry',
  'time',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- Timescale/query indexes (safe to re-run).
CREATE INDEX IF NOT EXISTS telemetry_device_time_idx
  ON telemetry(device_id, time DESC);
CREATE INDEX IF NOT EXISTS telemetry_building_time_desc_idx
  ON telemetry(building_id, time DESC);
CREATE INDEX IF NOT EXISTS telemetry_metric_time_idx
  ON telemetry(metric, time DESC);

-- Optional production policies once data volume grows.
-- SELECT add_retention_policy('telemetry', INTERVAL '24 months', if_not_exists => TRUE);
-- ALTER TABLE telemetry SET (
--   timescaledb.compress,
--   timescaledb.compress_segmentby = 'building_id,device_id,metric',
--   timescaledb.compress_orderby = 'time DESC'
-- );
-- SELECT add_compression_policy('telemetry', INTERVAL '7 days', if_not_exists => TRUE);

-- Context helpers. The API should set app.user_id and app.role inside each DB transaction.
CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$;

CREATE OR REPLACE FUNCTION app_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.role', true) = 'PLATFORM_ADMIN';
$$;

-- SECURITY DEFINER avoids recursive RLS while the function checks memberships.
CREATE OR REPLACE FUNCTION app_can_access_building(target_building_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM memberships m
      WHERE m.user_id = app_current_user_id()
        AND m.building_id = target_building_id
        AND m.active = TRUE
        AND (m.starts_at IS NULL OR m.starts_at <= now())
        AND (m.ends_at IS NULL OR m.ends_at > now())
    );
$$;

CREATE OR REPLACE FUNCTION app_is_building_admin(target_building_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM memberships m
      WHERE m.user_id = app_current_user_id()
        AND m.building_id = target_building_id
        AND m.role = 'BUILDING_ADMIN'
        AND m.active = TRUE
        AND (m.starts_at IS NULL OR m.starts_at <= now())
        AND (m.ends_at IS NULL OR m.ends_at > now())
    );
$$;

CREATE OR REPLACE FUNCTION app_can_access_organization(target_organization_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM buildings b
      WHERE b.organization_id = target_organization_id
        AND app_can_access_building(b.id)
    );
$$;

CREATE OR REPLACE FUNCTION app_can_access_user(target_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_is_platform_admin()
    OR target_user_id = app_current_user_id()
    OR EXISTS (
      SELECT 1
      FROM memberships target_m
      WHERE target_m.user_id = target_user_id
        AND app_is_building_admin(target_m.building_id)
    );
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingest_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_scope_policy ON users;
CREATE POLICY users_scope_policy ON users
FOR ALL
USING (app_can_access_user(id))
WITH CHECK (app_is_platform_admin() OR id = app_current_user_id());

DROP POLICY IF EXISTS organizations_scope_policy ON organizations;
CREATE POLICY organizations_scope_policy ON organizations
FOR ALL
USING (app_can_access_organization(id))
WITH CHECK (app_is_platform_admin());

DROP POLICY IF EXISTS buildings_scope_policy ON buildings;
CREATE POLICY buildings_scope_policy ON buildings
FOR ALL
USING (app_can_access_building(id))
WITH CHECK (app_is_platform_admin() OR app_is_building_admin(id));

DROP POLICY IF EXISTS memberships_scope_policy ON memberships;
CREATE POLICY memberships_scope_policy ON memberships
FOR ALL
USING (
  app_is_platform_admin()
  OR user_id = app_current_user_id()
  OR app_is_building_admin(building_id)
)
WITH CHECK (app_is_platform_admin() OR app_is_building_admin(building_id));

DROP POLICY IF EXISTS gateways_scope_policy ON gateways;
CREATE POLICY gateways_scope_policy ON gateways
FOR ALL
USING (app_can_access_building(building_id))
WITH CHECK (app_is_platform_admin() OR app_is_building_admin(building_id));

DROP POLICY IF EXISTS devices_scope_policy ON devices;
CREATE POLICY devices_scope_policy ON devices
FOR ALL
USING (app_can_access_building(building_id))
WITH CHECK (app_is_platform_admin() OR app_is_building_admin(building_id));

DROP POLICY IF EXISTS device_metrics_scope_policy ON device_metrics;
CREATE POLICY device_metrics_scope_policy ON device_metrics
FOR ALL
USING (app_can_access_building(building_id))
WITH CHECK (app_is_platform_admin() OR app_is_building_admin(building_id));

-- Ingest service should use a dedicated non-public DB role or owner/service role.
-- Normal application users do not need to read the deduplication ledger.
DROP POLICY IF EXISTS ingest_events_scope_policy ON ingest_events;
CREATE POLICY ingest_events_scope_policy ON ingest_events
FOR ALL
USING (app_is_platform_admin())
WITH CHECK (app_is_platform_admin());

DROP POLICY IF EXISTS telemetry_scope_policy ON telemetry;
CREATE POLICY telemetry_scope_policy ON telemetry
FOR SELECT
USING (app_can_access_building(building_id));

DROP POLICY IF EXISTS alert_rules_scope_policy ON alert_rules;
CREATE POLICY alert_rules_scope_policy ON alert_rules
FOR ALL
USING (app_can_access_building(building_id))
WITH CHECK (app_is_platform_admin() OR app_is_building_admin(building_id));

DROP POLICY IF EXISTS alerts_scope_policy ON alerts;
CREATE POLICY alerts_scope_policy ON alerts
FOR ALL
USING (app_can_access_building(building_id))
WITH CHECK (app_can_access_building(building_id));




DROP POLICY IF EXISTS audit_logs_scope_policy ON audit_logs;
CREATE POLICY audit_logs_scope_policy ON audit_logs
FOR SELECT
USING (
  app_is_platform_admin()
  OR (building_id IS NOT NULL AND app_is_building_admin(building_id))
);
