-- Additive building discovery/management and global feature administration.
-- The controlled migration runner applies this entire file in one transaction.
INSERT INTO permissions (key, resource_type, action, label) VALUES
 ('buildings:read','building','read','Selecionar condomínio'),
 ('buildings:manage','building','manage','Gerenciar condomínio'),
 ('buildings:provision','building','provision','Provisionar condomínio'),
 ('features:manage','feature','manage','Configurar funcionalidades')
ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label;
INSERT INTO role_permissions (role_key,permission_key) VALUES
 ('PLATFORM_ADMIN','buildings:read'),('PLATFORM_ADMIN','buildings:manage'),
 ('PLATFORM_ADMIN','buildings:provision'),('PLATFORM_ADMIN','features:manage'),
 ('BUILDING_ADMIN','buildings:read'),('BUILDING_ADMIN','buildings:manage'),
 ('MAINTENANCE_MANAGER','buildings:read'),('MAINTENANCE','buildings:read'),('RESIDENT','buildings:read')
ON CONFLICT (role_key,permission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION app_has_global_capability(target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_capability IN ('plans:read','plans:manage','rbac:manage','support:grant',
   'buildings:read','buildings:manage','buildings:provision','features:manage')
   AND app_rbac_platform_role(app_current_user_id(),'PLATFORM_ADMIN')
   AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.key=rp.permission_key AND p.active
     WHERE rp.role_key='PLATFORM_ADMIN' AND p.key=target_capability);
$$;

-- This helper exposes only the basic building selector/state. It deliberately
-- leaves app_can_access_building and app_governance_access unchanged.
CREATE OR REPLACE FUNCTION app_can_discover_building(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_has_global_capability('buildings:read') OR (
   app_rbac_tenant_active(target_building_id) AND (
     app_has_capability(target_building_id,'buildings:read')
     OR EXISTS (SELECT 1 FROM role_bindings rb
       WHERE rb.building_id=target_building_id AND rb.resource_type IS NOT NULL
         AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
         AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
         AND app_has_capability(target_building_id,'buildings:read',rb.resource_type,rb.resource_id))
     OR EXISTS (SELECT 1 FROM support_grants sg
       WHERE sg.building_id=target_building_id AND sg.support_user_id=app_current_user_id()
         AND app_has_capability(target_building_id,sg.capability,sg.resource_type,sg.resource_id))
   )
 );
$$;
-- Match the administrative owner of the existing capability helpers explicitly.
DO $$ DECLARE helper_owner text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
 FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 EXECUTE format('ALTER FUNCTION app_can_discover_building(text) OWNER TO %I',helper_owner);
END $$;
REVOKE ALL ON FUNCTION app_can_discover_building(text), app_has_global_capability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_discover_building(text), app_has_global_capability(text) TO predioon_app;

-- Split the legacy ALL policy so tenant discovery cannot authorize a mutation.
-- Identity/broker SELECT policies installed in 015 retain their separate roles.
DROP POLICY IF EXISTS buildings_scope_policy ON buildings;
DROP POLICY IF EXISTS buildings_capability_read ON buildings;
CREATE POLICY buildings_capability_read ON buildings FOR SELECT TO predioon_app
 USING (app_can_discover_building(id));
DROP POLICY IF EXISTS buildings_capability_insert ON buildings;
CREATE POLICY buildings_capability_insert ON buildings FOR INSERT TO predioon_app
 WITH CHECK (app_has_global_capability('buildings:provision'));
DROP POLICY IF EXISTS buildings_capability_update ON buildings;
CREATE POLICY buildings_capability_update ON buildings FOR UPDATE TO predioon_app
 USING (app_has_global_capability('buildings:manage') OR app_has_capability(id,'buildings:manage','building',id))
 WITH CHECK (app_has_global_capability('buildings:manage') OR app_has_capability(id,'buildings:manage','building',id));
REVOKE DELETE ON buildings FROM predioon_app;
GRANT SELECT,INSERT,UPDATE ON buildings TO predioon_app;

DROP POLICY IF EXISTS feature_global_write ON global_feature_settings;
CREATE POLICY feature_global_write ON global_feature_settings FOR ALL TO predioon_app
 USING (app_has_global_capability('features:manage')) WITH CHECK (app_has_global_capability('features:manage'));
DROP POLICY IF EXISTS feature_building_read ON building_feature_settings;
CREATE POLICY feature_building_read ON building_feature_settings FOR SELECT TO predioon_app USING (app_can_discover_building(building_id));
DROP POLICY IF EXISTS feature_building_write ON building_feature_settings;
CREATE POLICY feature_building_write ON building_feature_settings FOR ALL TO predioon_app
 USING (app_has_global_capability('features:manage')) WITH CHECK (app_has_global_capability('features:manage'));
DROP POLICY IF EXISTS feature_runtime_read ON feature_runtime;
CREATE POLICY feature_runtime_read ON feature_runtime FOR SELECT TO predioon_app USING (app_can_discover_building(building_id));

-- Migrated actions never fall through to the legacy app.role-based branch.
DROP POLICY IF EXISTS audit_logs_insert_policy ON audit_logs;
CREATE POLICY audit_logs_insert_policy ON audit_logs FOR INSERT TO predioon_app WITH CHECK (
 user_id=app_current_user_id() AND actor_type='USER' AND CASE action
   WHEN 'BUILDING_CREATED' THEN resource_type='building' AND resource_id=building_id
     AND building_id IS NOT NULL AND app_has_global_capability('buildings:provision')
   WHEN 'BUILDING_UPDATED' THEN resource_type='building' AND resource_id=building_id
     AND building_id IS NOT NULL AND (app_has_global_capability('buildings:manage')
       OR app_has_capability(building_id,'buildings:manage','building',building_id))
   WHEN 'FEATURE_CONFIGURATION_CHANGED' THEN resource_type='feature'
     AND resource_id IS NOT NULL AND app_has_global_capability('features:manage')
   ELSE app_is_platform_admin() OR (building_id IS NOT NULL AND (
     app_can_access_building(building_id) OR app_has_capability(building_id,'units:manage')
     OR app_has_capability(building_id,'teams:manage') OR app_has_capability(building_id,'memberships:manage')
   )) END
);

CREATE OR REPLACE FUNCTION app_apply_feature_transition(target text, feature text, enabled_now boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed timestamptz := clock_timestamp(); paused timestamptz; zone text; usage_kind text; gate_kind text; vehicle text;
BEGIN
 IF NOT app_has_global_capability('features:manage') THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE = '42501'; END IF;
 PERFORM pg_advisory_xact_lock(814772, 1);
 SELECT timezone INTO STRICT zone FROM buildings WHERE id = target;
 SELECT paused_at INTO paused FROM feature_runtime WHERE building_id = target AND feature_key = feature;
 INSERT INTO feature_runtime(building_id, feature_key, resumed_at, paused_at)
 VALUES(target, feature, CASE WHEN enabled_now THEN changed END, CASE WHEN NOT enabled_now THEN changed END)
 ON CONFLICT(building_id, feature_key) DO UPDATE SET
   resumed_at = CASE WHEN enabled_now THEN changed ELSE feature_runtime.resumed_at END,
   paused_at = CASE WHEN enabled_now THEN feature_runtime.paused_at ELSE changed END,
   generation = feature_runtime.generation + 1;

 usage_kind := CASE feature WHEN 'WATER_CONSUMPTION' THEN 'WATER' WHEN 'ENERGY_CONSUMPTION' THEN 'ENERGY' WHEN 'PUMP' THEN 'PUMP' END;
 IF usage_kind IS NOT NULL THEN
  DELETE FROM usage_cursors c USING monitoring_profiles p WHERE c.profile_id = p.id AND p.building_id = target AND p.kind = usage_kind;
  UPDATE daily_usage d SET incomplete = true FROM monitoring_profiles p
   WHERE d.profile_id = p.id AND p.building_id = target AND p.kind = usage_kind
     AND d.day >= to_char((CASE WHEN enabled_now THEN coalesce(paused, changed) ELSE changed END) AT TIME ZONE zone, 'YYYY-MM-DD')
     AND d.day <= to_char(changed AT TIME ZONE zone, 'YYYY-MM-DD');
 END IF;
 vehicle := CASE feature WHEN 'CAR_PARKING' THEN 'CAR' WHEN 'MOTORCYCLE_PARKING' THEN 'MOTORCYCLE' END;
 IF vehicle IS NOT NULL THEN
  UPDATE parking_lots SET occupied = NULL, observed_at = NULL, source = 'UNKNOWN', version = version + 1, updated_at = changed
   WHERE building_id = target AND vehicle_type = vehicle;
 END IF;
 gate_kind := CASE feature WHEN 'GARAGE_ACCESS' THEN 'GARAGE' WHEN 'PEDESTRIAN_ACCESS' THEN 'PEDESTRIAN' END;
 IF gate_kind IS NOT NULL AND NOT enabled_now THEN
  WITH cancelled AS (
   UPDATE gate_commands c SET status = 'FAILED', failure_reason = 'Funcionalidade desativada'
    FROM gates g WHERE c.gate_id = g.id AND c.building_id = target AND g.kind = gate_kind AND c.status = 'PENDING'
    RETURNING c.id
  ) INSERT INTO audit_logs(building_id, user_id, actor_type, action, resource_type, resource_id, metadata)
    SELECT target, app_current_user_id(), 'USER', 'ACCESS_COMMAND_CANCELLED_BY_FEATURE', 'gate_command', id::text,
      jsonb_build_object('feature', feature, 'reason', 'Funcionalidade desativada') FROM cancelled;
 END IF;
END $$;
REVOKE ALL ON FUNCTION app_apply_feature_transition(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_apply_feature_transition(text,text,boolean) TO predioon_app;
