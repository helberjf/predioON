-- Private telemetry is authorized per current device, never by global app.role.
-- The controlled migration runner applies this file in one transaction.
INSERT INTO permissions(key,resource_type,action,label) VALUES
 ('telemetry:read-published','telemetry','read-published','Ler nível de água publicado')
ON CONFLICT(key) DO UPDATE SET label=EXCLUDED.label;
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('BUILDING_ADMIN','telemetry:read-published'),('MAINTENANCE_MANAGER','telemetry:read-published'),
 ('MAINTENANCE','telemetry:read-published'),('RESIDENT','telemetry:read-published')
ON CONFLICT(role_key,permission_key) DO NOTHING;

-- Candidate tenants come only from the subject's facts. The materialized set
-- prevents a private/global building scan before evaluating exact devices.
-- This projection deliberately omits configuration, metadata and credentials.
CREATE OR REPLACE FUNCTION app_telemetry_authorized_devices(
 target_building_id text DEFAULT NULL, target_capability text DEFAULT 'telemetry:read'
) RETURNS TABLE(building_id text,device_id text,device_name text,device_type text,gate_kind text,parking_vehicle_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 WITH candidate_buildings AS MATERIALIZED (
   SELECT rb.building_id FROM role_bindings rb
   WHERE rb.building_id IS NOT NULL AND (target_building_id IS NULL OR rb.building_id=target_building_id)
     AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
     AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
   UNION
   SELECT m.building_id FROM memberships m WHERE m.user_id=app_current_user_id()
     AND (target_building_id IS NULL OR m.building_id=target_building_id)
     AND app_rbac_window(m.active,m.starts_at,m.ends_at)
   UNION
   SELECT sg.building_id FROM support_grants sg WHERE sg.support_user_id=app_current_user_id()
     AND (target_building_id IS NULL OR sg.building_id=target_building_id)
     AND sg.capability=target_capability AND sg.revoked_at IS NULL
     AND sg.created_at<=now() AND sg.expires_at>now()
 )
 SELECT d.building_id,d.id,d.name,d.type::text,
   (SELECT g.kind::text FROM gates g WHERE g.building_id=d.building_id AND g.device_id=d.id ORDER BY g.id LIMIT 1),
   (SELECT p.vehicle_type::text FROM parking_lots p WHERE p.building_id=d.building_id AND p.sensor_id=d.id ORDER BY p.id LIMIT 1)
 FROM candidate_buildings cb JOIN devices d ON d.building_id=cb.building_id
 WHERE target_capability IN ('telemetry:read','telemetry:read-published')
   AND app_has_capability(d.building_id,target_capability,'device',d.id);
$$;

DROP POLICY IF EXISTS telemetry_scope_policy ON telemetry;
CREATE POLICY telemetry_scope_policy ON telemetry FOR SELECT TO predioon_app
 USING ((building_id,device_id) IN (
   SELECT building_id,device_id FROM app_telemetry_authorized_devices(NULL)
 ));
REVOKE INSERT,UPDATE,DELETE ON telemetry FROM predioon_app;

-- Feature-state visibility follows telemetry authorization independently of
-- buildings:read. Otherwise RLS-hidden local settings would resolve to enabled
-- defaults after that unrelated capability is revoked.
CREATE OR REPLACE FUNCTION app_telemetry_can_read_feature_state(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_has_capability(target_building_id,'telemetry:read')
   OR app_has_capability(target_building_id,'telemetry:read-published')
   OR EXISTS(SELECT 1 FROM app_telemetry_authorized_devices(target_building_id,'telemetry:read'))
   OR EXISTS(SELECT 1 FROM app_telemetry_authorized_devices(target_building_id,'telemetry:read-published'));
$$;
DROP POLICY IF EXISTS feature_building_telemetry_read ON building_feature_settings;
CREATE POLICY feature_building_telemetry_read ON building_feature_settings FOR SELECT TO predioon_app
 USING (app_telemetry_can_read_feature_state(building_id));
DROP POLICY IF EXISTS feature_runtime_telemetry_read ON feature_runtime;
CREATE POLICY feature_runtime_telemetry_read ON feature_runtime FOR SELECT TO predioon_app
 USING (app_telemetry_can_read_feature_state(building_id));

-- Owner reads raw samples internally; callers receive only this fixed DTO.
-- Original JSON, arbitrary units, event IDs, other metrics and history never
-- leave this function. Invalid numeric values become JSON/SQL NULL.
CREATE OR REPLACE FUNCTION app_published_water_levels(target_building_id text)
RETURNS TABLE(device_id text,device_name text,metric text,value jsonb,numeric_value double precision,unit text,quality text,"time" timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT d.device_id,d.device_name,'water_level_percent'::text,
   CASE WHEN t.numeric_value BETWEEN 0 AND 100 THEN to_jsonb(t.numeric_value) ELSE NULL END,
   CASE WHEN t.numeric_value BETWEEN 0 AND 100 THEN t.numeric_value ELSE NULL END,
   '%'::text,CASE WHEN t.quality::text IN ('GOOD','UNCERTAIN','BAD') THEN t.quality::text ELSE 'UNCERTAIN' END,t.time
 FROM app_telemetry_authorized_devices(target_building_id,'telemetry:read-published') d
 JOIN LATERAL (
   SELECT t.numeric_value,t.quality,t.time FROM telemetry t
   WHERE t.building_id=d.building_id AND t.device_id=d.device_id
     AND t.metric='water_level_percent' AND t.time>now()-interval '7 days'
   ORDER BY t.time DESC,t.id DESC LIMIT 1
 ) t ON true
 WHERE coalesce((SELECT enabled FROM global_feature_settings WHERE feature_key='WATER_TANK'),true)
   AND coalesce((SELECT enabled FROM building_feature_settings WHERE building_id=d.building_id AND feature_key='WATER_TANK'),true)
   AND NOT EXISTS(SELECT 1 FROM feature_runtime fr WHERE fr.building_id=d.building_id
     AND fr.feature_key='WATER_TANK' AND fr.resumed_at IS NOT NULL AND t.time<=fr.resumed_at);
$$;

DO $$ DECLARE helper_owner text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
 FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION app_telemetry_authorized_devices(text,text) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_telemetry_can_read_feature_state(text) OWNER TO %I',helper_owner);
 EXECUTE format('ALTER FUNCTION app_published_water_levels(text) OWNER TO %I',helper_owner);
END $$;
REVOKE ALL ON FUNCTION app_telemetry_authorized_devices(text,text),app_telemetry_can_read_feature_state(text),app_published_water_levels(text) FROM PUBLIC,predioon_identity,predioon_broker_auth;
GRANT EXECUTE ON FUNCTION app_telemetry_authorized_devices(text,text),app_telemetry_can_read_feature_state(text),app_published_water_levels(text) TO predioon_app;
