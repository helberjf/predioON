-- Additive migration. Existing ticket priorities and protocols remain intact.
ALTER TYPE notice_category ADD VALUE IF NOT EXISTS 'GESTAO';
ALTER TABLE occurrences ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS occurrences_group_idx ON occurrences(building_id, group_id);

CREATE OR REPLACE FUNCTION app_governance_access(target text, manage boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM users u JOIN buildings b ON b.id = target
 WHERE u.id = app_current_user_id() AND u.active AND b.active AND (
   (app_is_platform_admin() AND u.is_platform_admin) OR EXISTS (
     SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.building_id = b.id AND m.active
       AND (m.starts_at IS NULL OR m.starts_at <= now()) AND (m.ends_at IS NULL OR m.ends_at > now())
       AND (NOT manage OR m.role = 'BUILDING_ADMIN')
   )
 ));
$$;
REVOKE ALL ON FUNCTION app_governance_access(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_governance_access(text, boolean) TO predioon_app;
DROP POLICY IF EXISTS occurrences_active_access ON occurrences;
CREATE POLICY occurrences_active_access ON occurrences AS RESTRICTIVE FOR ALL
USING (app_governance_access(building_id)) WITH CHECK (app_governance_access(building_id));
DROP POLICY IF EXISTS occurrence_events_active_access ON occurrence_events;
CREATE POLICY occurrence_events_active_access ON occurrence_events AS RESTRICTIVE FOR ALL
USING (app_governance_access(building_id)) WITH CHECK (app_governance_access(building_id));

CREATE TABLE IF NOT EXISTS financial_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
 month text NOT NULL CHECK (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'), title text NOT NULL, summary text NOT NULL,
 opening_balance_cents bigint NOT NULL CHECK (opening_balance_cents BETWEEN -100000000000 AND 100000000000),
 entries jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(entries) = 'array' AND jsonb_array_length(entries) <= 500),
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 created_by text REFERENCES users(id) ON DELETE SET NULL, published_by text REFERENCES users(id) ON DELETE SET NULL,
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_reports_revision_uq ON financial_reports(building_id, month, revision);
ALTER TABLE financial_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_reports_read ON financial_reports;
CREATE POLICY financial_reports_read ON financial_reports FOR SELECT
USING (app_governance_access(building_id) AND (published_at IS NOT NULL OR app_governance_access(building_id, true)));
DROP POLICY IF EXISTS financial_reports_insert ON financial_reports;
CREATE POLICY financial_reports_insert ON financial_reports FOR INSERT
WITH CHECK (app_governance_access(building_id, true) AND published_at IS NULL AND created_by = app_current_user_id());
DROP POLICY IF EXISTS financial_reports_update ON financial_reports;
CREATE POLICY financial_reports_update ON financial_reports FOR UPDATE
USING (app_governance_access(building_id, true) AND published_at IS NULL)
WITH CHECK (app_governance_access(building_id, true));
GRANT SELECT, INSERT, UPDATE ON financial_reports TO predioon_app;
REVOKE DELETE ON financial_reports FROM predioon_app;
