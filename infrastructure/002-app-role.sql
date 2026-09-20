-- Prédio ON: application database role.
--
-- WHY THIS FILE EXISTS
-- 001-timescale-rls.sql creates the RLS policies, but a PostgreSQL table OWNER bypasses RLS.
-- While the API connects as `predioon` (the owner), those policies protect nothing.
-- The API must connect as this NON-OWNER role so the policies are actually enforced.
--
-- Connection split:
--   predioon      (owner)     -> migrations, ingest service, seed
--   predioon_app  (non-owner) -> API, always inside a transaction that sets app.user_id/app.role

-- A senha vem de fora: psql -v app_password="..."; sem isso, usa o valor de desenvolvimento.
\if :{?app_password}
\else
\set app_password 'predioon_app'
\endif

SELECT format('CREATE ROLE predioon_app LOGIN PASSWORD %L', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'predioon_app')
\gexec

SELECT format('ALTER ROLE predioon_app PASSWORD %L', :'app_password')
\gexec

GRANT CONNECT ON DATABASE predioon TO predioon_app;
GRANT USAGE ON SCHEMA public TO predioon_app;

-- Re-running this file after new tables are created re-applies the grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO predioon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO predioon_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO predioon_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO predioon_app;

-- The deduplication ledger belongs to ingestion only; the API never needs it.
REVOKE ALL ON ingest_events FROM predioon_app;

-- Telemetry is append-only from the application's point of view.
REVOKE INSERT, UPDATE, DELETE ON telemetry FROM predioon_app;

-- ---------------------------------------------------------------------------
-- RLS for the tables added after 001.
-- ---------------------------------------------------------------------------

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS refresh_tokens_scope_policy ON refresh_tokens;
CREATE POLICY refresh_tokens_scope_policy ON refresh_tokens
FOR ALL
USING (user_id = app_current_user_id())
WITH CHECK (user_id = app_current_user_id());

ALTER TABLE notices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notices_scope_policy ON notices;
DROP POLICY IF EXISTS notices_read_policy ON notices;
CREATE POLICY notices_read_policy ON notices
FOR SELECT
USING (app_can_access_building(building_id));
DROP POLICY IF EXISTS notices_write_policy ON notices;
CREATE POLICY notices_write_policy ON notices
FOR ALL
USING (app_is_building_admin(building_id))
WITH CHECK (app_is_building_admin(building_id));

ALTER TABLE occurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS occurrences_scope_policy ON occurrences;
-- A resident sees only their own tickets; a building admin sees every ticket of the building.
CREATE POLICY occurrences_scope_policy ON occurrences
FOR ALL
USING (
  app_is_building_admin(building_id)
  OR (app_can_access_building(building_id) AND opened_by = app_current_user_id())
)
WITH CHECK (
  app_is_building_admin(building_id)
  OR (app_can_access_building(building_id) AND opened_by = app_current_user_id())
);

ALTER TABLE occurrence_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS occurrence_events_scope_policy ON occurrence_events;
CREATE POLICY occurrence_events_scope_policy ON occurrence_events
FOR ALL
USING (
  app_is_building_admin(building_id)
  OR EXISTS (
    SELECT 1 FROM occurrences o
    WHERE o.id = occurrence_events.occurrence_id
      AND o.opened_by = app_current_user_id()
  )
)
WITH CHECK (app_can_access_building(building_id));
