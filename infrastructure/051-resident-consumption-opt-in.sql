-- Residents and technical readings.
--
-- 1. A resident no longer reads the water tank level: it is an operation
--    figure, of no use to them. The capability stays with the building staff.
-- 2. Consumption can be shown to residents only when the condominium's
--    administration says so. The switch is per condominium and starts off.
--    What a resident then receives is a fixed, reduced projection: daily
--    quantity of energy and water. Never tariffs, costs, limits, pump cycles,
--    learned references, raw readings or equipment identifiers.
DELETE FROM role_permissions WHERE role_key='RESIDENT' AND permission_key='telemetry:read-published';

INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('monitoring:read-published','telemetry','read-published-usage','Consultar o consumo liberado pela administração')
ON CONFLICT(key) DO UPDATE SET label=EXCLUDED.label;
-- The administrator holds it too: a role can only be granted by someone who
-- holds every capability in it, and administrators invite and bind residents.
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('RESIDENT','monitoring:read-published'),('BUILDING_ADMIN','monitoring:read-published')
ON CONFLICT(role_key,permission_key) DO NOTHING;

-- No row means not released. Reached only through the helpers below.
CREATE TABLE IF NOT EXISTS resident_consumption_settings (
  building_id text PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  version integer NOT NULL DEFAULT 1 CONSTRAINT resident_consumption_version_ck CHECK (version > 0),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE resident_consumption_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE resident_consumption_settings FROM PUBLIC, predioon_app, predioon_identity, predioon_broker_auth, predioon_notifications;

-- Whoever manages the readings sees the switch; a resident learns only whether
-- there is something for them to open.
CREATE OR REPLACE FUNCTION app_resident_consumption_released(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN app_rbac_tenant_active(target_building_id)
   AND (app_has_capability(target_building_id,'monitoring:read-published')
     OR (app_has_capability(target_building_id,'buildings:manage') AND app_has_capability(target_building_id,'telemetry:read')))
  THEN coalesce((SELECT s.enabled FROM resident_consumption_settings s WHERE s.building_id=target_building_id),false) END;
$$;

-- The administration of the condominium decides, and the decision is audited
-- in the same transaction. Returns the state now in force.
CREATE OR REPLACE FUNCTION app_set_resident_consumption(target_building_id text, release boolean)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previous boolean; actor text;
BEGIN
 IF target_building_id IS NULL OR release IS NULL THEN RAISE EXCEPTION 'Invalid resident consumption request' USING ERRCODE='22023'; END IF;
 IF NOT (app_rbac_tenant_active(target_building_id) AND app_has_capability(target_building_id,'buildings:manage')
   AND app_has_capability(target_building_id,'telemetry:read')) THEN
  RAISE EXCEPTION 'Building administration required' USING ERRCODE='42501';
 END IF;
 actor:=app_current_user_id();
 PERFORM 1 FROM buildings WHERE id=target_building_id FOR UPDATE;
 SELECT enabled INTO previous FROM resident_consumption_settings WHERE building_id=target_building_id;
 IF coalesce(previous,false) IS NOT DISTINCT FROM release THEN RETURN release; END IF;
 INSERT INTO resident_consumption_settings(building_id,enabled,updated_by) VALUES(target_building_id,release,actor)
 ON CONFLICT(building_id) DO UPDATE SET enabled=release,version=resident_consumption_settings.version+1,updated_by=actor,updated_at=clock_timestamp();
 INSERT INTO audit_logs(building_id,user_id,actor_type,action,resource_type,resource_id,metadata)
 VALUES(target_building_id,actor,'USER','RESIDENT_CONSUMPTION_CHANGED','building',target_building_id,
  jsonb_build_object('before',coalesce(previous,false),'after',release));
 RETURN release;
END $$;

-- Fixed projection for residents. Authority is rechecked on every call, so
-- switching the release off, or losing the bond with the condominium, ends it.
CREATE OR REPLACE FUNCTION app_published_consumption(target_building_id text, first_day text, last_day text)
RETURNS TABLE(kind text, day text, quantity double precision, incomplete boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.kind, u.day, sum(u.quantity), bool_or(u.incomplete)
 FROM monitoring_profiles p JOIN daily_usage u ON u.profile_id=p.id AND u.building_id=p.building_id
 WHERE p.building_id=target_building_id AND p.enabled AND p.kind IN ('ENERGY','WATER')
  AND u.day BETWEEN first_day AND last_day
  AND first_day ~ '^\d{4}-\d{2}-\d{2}$' AND last_day ~ '^\d{4}-\d{2}-\d{2}$'
  AND app_rbac_tenant_active(target_building_id)
  AND app_has_capability(target_building_id,'monitoring:read-published')
  AND EXISTS(SELECT 1 FROM resident_consumption_settings s WHERE s.building_id=target_building_id AND s.enabled)
 GROUP BY p.kind, u.day ORDER BY p.kind, u.day;
$$;

DO $$ DECLARE helper_owner text; grantee_name text; helper regprocedure; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER TABLE resident_consumption_settings OWNER TO %I',helper_owner);
 FOREACH helper IN ARRAY ARRAY[
   'app_resident_consumption_released(text)'::regprocedure,
   'app_set_resident_consumption(text,boolean)'::regprocedure,
   'app_published_consumption(text,text,text)'::regprocedure
 ] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
  FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) acl
    JOIN pg_roles r ON r.oid=acl.grantee WHERE p.oid=helper AND acl.grantee<>p.proowner
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
 END LOOP;
END $$;
