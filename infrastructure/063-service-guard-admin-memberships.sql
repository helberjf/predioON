-- PostgreSQL 16+ (Neon included) gives the role that creates a login an admin-only
-- membership in it: ADMIN OPTION, no INHERIT, no SET. Such a membership grants no
-- privilege of the role, so the service identity guard must not treat it as one.
-- Anything that can inherit or SET ROLE is still refused, as are memberships the
-- service role itself holds in other roles.
CREATE OR REPLACE FUNCTION public.service_runtime_guard(expected_role name) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE authenticated oid;
BEGIN
 IF expected_role IS NULL OR expected_role NOT IN ('predioon_ingest','predioon_access_service') THEN
   RAISE EXCEPTION 'Invalid service identity' USING ERRCODE='42501'; END IF;
 SELECT a.usesysid INTO authenticated FROM pg_catalog.pg_stat_activity a WHERE a.pid=pg_catalog.pg_backend_pid();
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=authenticated AND r.rolname=expected_role
   AND session_user=expected_role AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolinherit AND NOT r.rolbypassrls
   AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid OR (m.roleid=r.oid
     AND (coalesce((pg_catalog.to_jsonb(m)->>'inherit_option')::boolean,true) OR coalesce((pg_catalog.to_jsonb(m)->>'set_option')::boolean,true))))
   AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_shdepend d WHERE d.refclassid='pg_catalog.pg_authid'::regclass AND d.refobjid=r.oid AND d.deptype='o'))
 THEN RAISE EXCEPTION 'Authenticated restricted service required' USING ERRCODE='42501'; END IF;
END $$;
