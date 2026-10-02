-- Additive event projections; apply atomically with the controlled runner.
-- The point classification exposes no equipment configuration or history.
CREATE OR REPLACE FUNCTION app_equipment_device_classification(target_building_id text,target_device_id text)
RETURNS TABLE(device_type text,gate_kind text,parking_vehicle_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 WITH point_device AS MATERIALIZED (
   SELECT d.id,d.building_id,d.type FROM devices d WHERE d.id=target_device_id
 )
 SELECT d.type::text,g.kind::text,p.vehicle_type::text
 FROM point_device d
 LEFT JOIN gates g ON g.device_id=d.id AND g.building_id=d.building_id
 LEFT JOIN parking_lots p ON p.sensor_id=d.id AND p.building_id=d.building_id
 WHERE d.building_id=target_building_id
   AND app_device_has_capability(d.building_id,d.id,'devices:read');
$$;

-- Invalidation reveals only an actual building identifier. Reuse the current
-- domain authorities without promoting a resource grant into tenant authority.
CREATE OR REPLACE FUNCTION app_can_read_feature_event(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM buildings b WHERE b.id=target_building_id AND (
     app_has_global_capability('features:manage')
     OR app_can_discover_building(b.id)
     OR app_telemetry_can_read_feature_state(b.id)
     OR app_alert_can_read_feature_state(b.id)
     OR app_equipment_can_read_scope(b.id,'device')
     OR app_equipment_can_read_scope(b.id,'gateway')
   )
 );
$$;

-- Equipment-only readers must see local pause/runtime state. No write policy
-- or data grant changes; all existing feature policies remain intact.
DROP POLICY IF EXISTS building_features_equipment_read ON building_feature_settings;
CREATE POLICY building_features_equipment_read ON building_feature_settings FOR SELECT TO predioon_app
 USING (app_equipment_can_read_scope(building_id,'device') OR app_equipment_can_read_scope(building_id,'gateway'));
DROP POLICY IF EXISTS feature_runtime_equipment_read ON feature_runtime;
CREATE POLICY feature_runtime_equipment_read ON feature_runtime FOR SELECT TO predioon_app
 USING (app_equipment_can_read_scope(building_id,'device') OR app_equipment_can_read_scope(building_id,'gateway'));

DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
 FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_equipment_device_classification(text,text)'::regprocedure,
   'app_can_read_feature_event(text)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   -- Default ACLs may grant other runtime roles; retain only the owner.
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
     WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
 END LOOP;
END $$;
