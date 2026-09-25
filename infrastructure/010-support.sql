-- Additive migration: remote support registration never stores AnyDesk credentials.
CREATE TABLE IF NOT EXISTS support_hosts (
  building_id text PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  anydesk_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  building_id text NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  requested_by text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  anydesk_id text NOT NULL,
  config_revision integer NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  notes text,
  closed_by text REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS support_requests_request_uq ON support_requests(requested_by, request_id);
CREATE INDEX IF NOT EXISTS support_requests_building_created_idx ON support_requests(building_id, created_at);

CREATE OR REPLACE FUNCTION app_support_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app_is_platform_admin() AND EXISTS (
    SELECT 1 FROM users WHERE id = app_current_user_id() AND active AND is_platform_admin
  )
$$;
REVOKE ALL ON FUNCTION app_support_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_support_admin() TO predioon_app;

ALTER TABLE support_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_hosts_admin ON support_hosts;
CREATE POLICY support_hosts_admin ON support_hosts FOR ALL
USING (app_support_admin()) WITH CHECK (app_support_admin());
DROP POLICY IF EXISTS support_requests_admin ON support_requests;
CREATE POLICY support_requests_admin ON support_requests FOR ALL
USING (app_support_admin()) WITH CHECK (app_support_admin());
GRANT SELECT, INSERT, UPDATE ON support_hosts, support_requests TO predioon_app;
REVOKE DELETE ON support_hosts, support_requests FROM predioon_app;

-- The existing audit endpoint also serves building managers; support remains restricted there.
DROP POLICY IF EXISTS support_audit_restriction ON audit_logs;
CREATE POLICY support_audit_restriction ON audit_logs AS RESTRICTIVE FOR ALL
USING (resource_type <> 'remote_support' OR app_support_admin())
WITH CHECK (resource_type <> 'remote_support' OR app_support_admin());

ALTER TABLE support_hosts DROP CONSTRAINT IF EXISTS support_hosts_input_check;
ALTER TABLE support_hosts ADD CONSTRAINT support_hosts_input_check CHECK (
  anydesk_id ~ '^[0-9]{9,10}$' AND length(btrim(display_name)) BETWEEN 2 AND 120 AND revision > 0
);
ALTER TABLE support_requests DROP CONSTRAINT IF EXISTS support_requests_input_check;
ALTER TABLE support_requests ADD CONSTRAINT support_requests_input_check CHECK (
  anydesk_id ~ '^[0-9]{9,10}$' AND config_revision > 0 AND length(btrim(display_name)) BETWEEN 2 AND 120
  AND length(btrim(reason)) BETWEEN 3 AND 1000
);
ALTER TABLE support_requests DROP CONSTRAINT IF EXISTS support_requests_result_check;
ALTER TABLE support_requests ADD CONSTRAINT support_requests_result_check CHECK (
  (status = 'OPEN' AND notes IS NULL AND closed_by IS NULL AND closed_at IS NULL)
  OR (status IN ('RESOLVED','UNRESOLVED','NOT_CONNECTED') AND notes IS NOT NULL
    AND length(btrim(notes)) BETWEEN 3 AND 2000 AND closed_by IS NOT NULL AND closed_at >= created_at AND closed_at IS NOT NULL)
);
