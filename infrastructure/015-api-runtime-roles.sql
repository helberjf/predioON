-- Apply transactionally (migration runner or psql --single-transaction).
-- Credentials are provisioned separately; this file never sets a password or enables LOGIN.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'predioon_identity') THEN
    CREATE ROLE predioon_identity NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'predioon_broker_auth') THEN
    CREATE ROLE predioon_broker_auth NOLOGIN;
  END IF;
END $$;

ALTER ROLE predioon_app NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE predioon_identity NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE predioon_broker_auth NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

DO $$
DECLARE membership record;
BEGIN
  -- Runtime roles must not be able to SET ROLE to an owner or a broader service.
  FOR membership IN
    SELECT parent.rolname AS parent_name, member.rolname AS member_name
    FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE member.rolname IN ('predioon_app', 'predioon_identity', 'predioon_broker_auth')
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.parent_name, membership.member_name);
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_shdepend d JOIN pg_roles r ON r.oid=d.refobjid
    WHERE d.refclassid='pg_authid'::regclass AND d.deptype='o'
      AND r.rolname IN ('predioon_app', 'predioon_identity', 'predioon_broker_auth')
  ) THEN RAISE EXCEPTION 'Runtime roles must not own database objects'; END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO predioon_identity, predioon_broker_auth', current_database());
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC, predioon_identity, predioon_broker_auth', current_database());
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, predioon_identity, predioon_broker_auth;
GRANT USAGE ON SCHEMA public TO predioon_identity, predioon_broker_auth;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM predioon_identity, predioon_broker_auth;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM predioon_identity, predioon_broker_auth;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM predioon_identity, predioon_broker_auth;

-- Existing application policies must not run under either authentication role.
DO $$
DECLARE policy record; helper record;
BEGIN
  FOR policy IN SELECT schemaname, tablename, policyname FROM pg_policies
    WHERE schemaname='public' AND roles=ARRAY['public']::name[]
      AND tablename IN ('users','memberships','buildings','organizations','sessions','refresh_tokens','gateways','devices','gates')
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO predioon_app', policy.policyname, policy.schemaname, policy.tablename);
  END LOOP;
  -- Legacy SECURITY DEFINER app helpers were executable by PUBLIC. Keep their
  -- original application use without exposing business state to auth services.
  FOR helper IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'app\_%' ESCAPE '\'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, predioon_identity, predioon_broker_auth', helper.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app', helper.signature);
  END LOOP;
END $$;

GRANT SELECT ON users, memberships, buildings, organizations TO predioon_identity;
GRANT SELECT, INSERT, UPDATE ON sessions, refresh_tokens TO predioon_identity;

DROP POLICY IF EXISTS identity_users_read ON users;
CREATE POLICY identity_users_read ON users FOR SELECT TO predioon_identity USING (true);
DROP POLICY IF EXISTS identity_memberships_read ON memberships;
CREATE POLICY identity_memberships_read ON memberships FOR SELECT TO predioon_identity USING (true);
DROP POLICY IF EXISTS identity_buildings_read ON buildings;
CREATE POLICY identity_buildings_read ON buildings FOR SELECT TO predioon_identity USING (true);
DROP POLICY IF EXISTS identity_organizations_read ON organizations;
CREATE POLICY identity_organizations_read ON organizations FOR SELECT TO predioon_identity USING (true);
DROP POLICY IF EXISTS identity_sessions_read ON sessions;
CREATE POLICY identity_sessions_read ON sessions FOR SELECT TO predioon_identity USING (true);
DROP POLICY IF EXISTS identity_sessions_insert ON sessions;
CREATE POLICY identity_sessions_insert ON sessions FOR INSERT TO predioon_identity WITH CHECK (true);
DROP POLICY IF EXISTS identity_sessions_update ON sessions;
CREATE POLICY identity_sessions_update ON sessions FOR UPDATE TO predioon_identity USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS identity_refresh_read ON refresh_tokens;
CREATE POLICY identity_refresh_read ON refresh_tokens FOR SELECT TO predioon_identity USING (true);
DROP POLICY IF EXISTS identity_refresh_insert ON refresh_tokens;
CREATE POLICY identity_refresh_insert ON refresh_tokens FOR INSERT TO predioon_identity WITH CHECK (true);
DROP POLICY IF EXISTS identity_refresh_update ON refresh_tokens;
CREATE POLICY identity_refresh_update ON refresh_tokens FOR UPDATE TO predioon_identity USING (true) WITH CHECK (true);

-- SELECT FOR UPDATE needs UPDATE permission. Expose only this account lock,
-- never a user UPDATE grant, so deactivation and refresh serialize on the row.
CREATE OR REPLACE FUNCTION identity_lock_account_active(target_user_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE account_active boolean;
BEGIN
  SELECT active INTO account_active FROM public.users WHERE id=target_user_id FOR UPDATE;
  RETURN coalesce(account_active, false);
END $$;
REVOKE ALL ON FUNCTION identity_lock_account_active(text) FROM PUBLIC, predioon_app, predioon_broker_auth;
GRANT EXECUTE ON FUNCTION identity_lock_account_active(text) TO predioon_identity;

GRANT SELECT (id, building_id, enabled, metadata) ON gateways TO predioon_broker_auth;
GRANT SELECT (id, building_id, gateway_id, enabled) ON devices TO predioon_broker_auth;
GRANT SELECT (id, active) ON buildings TO predioon_broker_auth;
GRANT SELECT (id, building_id, gateway_id, device_id, enabled) ON gates TO predioon_broker_auth;
DROP POLICY IF EXISTS broker_auth_gateways_read ON gateways;
CREATE POLICY broker_auth_gateways_read ON gateways FOR SELECT TO predioon_broker_auth USING (true);
DROP POLICY IF EXISTS broker_auth_devices_read ON devices;
CREATE POLICY broker_auth_devices_read ON devices FOR SELECT TO predioon_broker_auth USING (true);
DROP POLICY IF EXISTS broker_auth_buildings_read ON buildings;
CREATE POLICY broker_auth_buildings_read ON buildings FOR SELECT TO predioon_broker_auth USING (true);
DROP POLICY IF EXISTS broker_auth_gates_read ON gates;
CREATE POLICY broker_auth_gates_read ON gates FOR SELECT TO predioon_broker_auth USING (true);
