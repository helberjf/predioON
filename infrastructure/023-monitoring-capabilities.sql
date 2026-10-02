-- Apply atomically. Monitoring is private technical telemetry, including its
-- estimated costs; equipment inventory and configuration are independent.
CREATE OR REPLACE FUNCTION app_monitoring_device_has_capability(target_building_id text,target_device_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT CASE target_capability
   WHEN 'telemetry:read' THEN EXISTS (
     SELECT 1 FROM devices d WHERE d.id=target_device_id AND d.building_id=target_building_id
       AND app_equipment_gateway_belongs(d.building_id,d.gateway_id)
       AND app_has_capability(d.building_id,'telemetry:read','device',d.id)
   )
   WHEN 'devices:read' THEN app_device_has_capability(target_building_id,target_device_id,target_capability)
   WHEN 'devices:configure' THEN app_device_has_capability(target_building_id,target_device_id,target_capability)
   ELSE false END;
$$;

CREATE OR REPLACE FUNCTION app_monitoring_profile_has_capability(target_building_id text,target_profile_id text,target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_capability IN ('telemetry:read','devices:read','devices:configure') AND EXISTS (
   SELECT 1 FROM monitoring_profiles p
   WHERE p.id=CASE WHEN target_profile_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_profile_id::uuid END
     AND p.building_id=target_building_id
     AND app_monitoring_device_has_capability(p.building_id,p.device_id,target_capability)
 );
$$;

CREATE OR REPLACE FUNCTION app_monitoring_authorized_profiles(target_building_id text DEFAULT NULL)
RETURNS TABLE(profile_id uuid,building_id text,device_id text,device_name text,device_type text,device_enabled boolean,device_status text,timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT p.id,d.building_id,d.id,d.name,d.type::text,d.enabled,d.status::text,b.timezone
 FROM app_telemetry_authorized_devices(target_building_id,'telemetry:read') scope
 JOIN devices d ON d.id=scope.device_id AND d.building_id=scope.building_id
 JOIN monitoring_profiles p ON p.device_id=d.id AND p.building_id=d.building_id
 JOIN buildings b ON b.id=d.building_id
 WHERE app_equipment_gateway_belongs(d.building_id,d.gateway_id)
 ORDER BY p.kind,d.name;
$$;

CREATE OR REPLACE FUNCTION app_monitoring_can_read_scope(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_rbac_tenant_active(target_building_id) AND (
   app_has_capability(target_building_id,'telemetry:read') OR EXISTS (
     SELECT 1 FROM app_telemetry_authorized_devices(target_building_id,'telemetry:read') scope
     JOIN devices d ON d.id=scope.device_id AND d.building_id=scope.building_id
     WHERE app_equipment_gateway_belongs(d.building_id,d.gateway_id)
   )
 );
$$;

-- These controlled projections require current technical scope before exposing
-- a timezone or active-device fact. Neither exposes private inventory/config.
CREATE OR REPLACE FUNCTION app_monitoring_scope_context(target_building_id text)
RETURNS TABLE(timezone text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT b.timezone FROM buildings b WHERE b.id=target_building_id AND app_monitoring_can_read_scope(b.id);
$$;
CREATE OR REPLACE FUNCTION app_monitoring_active_device(target_building_id text,target_device_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_monitoring_can_read_scope(target_building_id) AND EXISTS (
   SELECT 1 FROM devices d WHERE d.id=target_device_id AND d.building_id=target_building_id AND d.enabled
     AND app_equipment_gateway_belongs(d.building_id,d.gateway_id)
     AND app_monitoring_device_has_capability(d.building_id,d.id,'telemetry:read')
 );
$$;

DROP POLICY IF EXISTS monitoring_read ON monitoring_profiles;
DROP POLICY IF EXISTS monitoring_write ON monitoring_profiles;
DROP POLICY IF EXISTS monitoring_capabilities_read ON monitoring_profiles;
CREATE POLICY monitoring_capabilities_read ON monitoring_profiles FOR SELECT TO predioon_app
 USING (app_monitoring_profile_has_capability(building_id,id::text,'telemetry:read'));
DROP POLICY IF EXISTS monitoring_capabilities_insert ON monitoring_profiles;
CREATE POLICY monitoring_capabilities_insert ON monitoring_profiles FOR INSERT TO predioon_app WITH CHECK (
 app_monitoring_active_device(building_id,device_id)
 AND app_monitoring_device_has_capability(building_id,device_id,'devices:read')
 AND app_monitoring_device_has_capability(building_id,device_id,'devices:configure')
);
DROP POLICY IF EXISTS monitoring_capabilities_update ON monitoring_profiles;
CREATE POLICY monitoring_capabilities_update ON monitoring_profiles FOR UPDATE TO predioon_app USING (
 app_monitoring_profile_has_capability(building_id,id::text,'telemetry:read')
 AND app_monitoring_profile_has_capability(building_id,id::text,'devices:read')
 AND app_monitoring_profile_has_capability(building_id,id::text,'devices:configure')
) WITH CHECK (
 app_monitoring_profile_has_capability(building_id,id::text,'telemetry:read')
 AND app_monitoring_profile_has_capability(building_id,id::text,'devices:read')
 AND app_monitoring_profile_has_capability(building_id,id::text,'devices:configure')
);
REVOKE UPDATE,DELETE ON monitoring_profiles FROM predioon_app;
GRANT SELECT,INSERT ON monitoring_profiles TO predioon_app;
GRANT UPDATE(tariff,daily_limit,daily_cost_limit,continuous_limit_minutes,max_gap_seconds,adaptive_enabled,minimum_history_days,deviation_percent,enabled,updated_at) ON monitoring_profiles TO predioon_app;
REVOKE INSERT,UPDATE,DELETE ON daily_usage,usage_cursors FROM predioon_app,predioon_identity,predioon_broker_auth;

-- One scalar InitPlan builds an ordered pair map per statement. Authority comes
-- from current profiles/devices and never scans historical totals or cursors.
DROP POLICY IF EXISTS daily_usage_read ON daily_usage;
CREATE POLICY daily_usage_read ON daily_usage FOR SELECT TO predioon_app USING (
 (SELECT coalesce(jsonb_object_agg(jsonb_build_array(scope.building_id,scope.profile_id)::text,true),'{}'::jsonb)
  FROM app_monitoring_authorized_profiles(NULL) scope)
 ? jsonb_build_array(building_id,profile_id)::text
);
DROP POLICY IF EXISTS usage_cursor_read ON usage_cursors;
CREATE POLICY usage_cursor_read ON usage_cursors FOR SELECT TO predioon_app USING (
 (SELECT coalesce(jsonb_object_agg(jsonb_build_array(scope.building_id,scope.profile_id)::text,true),'{}'::jsonb)
  FROM app_monitoring_authorized_profiles(NULL) scope)
 ? jsonb_build_array(building_id,profile_id)::text
);

-- Replace only the two monitoring CASE branches of the current policy. Keeping
-- its catalog expression preserves every migrated and compatibility branch.
DO $$ DECLARE policy_expression text; monitoring_branches text; BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO STRICT policy_expression
 FROM pg_policy WHERE polrelid='audit_logs'::regclass AND polname='audit_logs_insert_policy';
 monitoring_branches := $branches$
 WHEN 'MONITORING_CREATED'::text THEN resource_type='monitoring_profile' AND building_id IS NOT NULL
   AND app_monitoring_profile_has_capability(building_id,resource_id,'telemetry:read')
   AND app_monitoring_profile_has_capability(building_id,resource_id,'devices:read')
   AND app_monitoring_profile_has_capability(building_id,resource_id,'devices:configure')
 WHEN 'MONITORING_UPDATED'::text THEN resource_type='monitoring_profile' AND building_id IS NOT NULL
   AND app_monitoring_profile_has_capability(building_id,resource_id,'telemetry:read')
   AND app_monitoring_profile_has_capability(building_id,resource_id,'devices:read')
   AND app_monitoring_profile_has_capability(building_id,resource_id,'devices:configure')
 $branches$;
 -- Reapplication removes these two previously added branches only.
 policy_expression := regexp_replace(policy_expression,
   'WHEN ''MONITORING_CREATED''::text THEN .*?WHEN ''MONITORING_UPDATED''::text THEN .*?(?=ELSE)', '', 'ns');
 IF policy_expression NOT LIKE '%CASE action%' OR policy_expression NOT LIKE '%ELSE%' THEN
   RAISE EXCEPTION 'Unexpected audit policy shape';
 END IF;
 policy_expression := regexp_replace(policy_expression,'ELSE',monitoring_branches || ' ELSE');
 EXECUTE 'ALTER POLICY audit_logs_insert_policy ON audit_logs WITH CHECK (' || policy_expression || ')';
END $$;

DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_monitoring_device_has_capability(text,text,text)'::regprocedure,
   'app_monitoring_profile_has_capability(text,text,text)'::regprocedure,
   'app_monitoring_authorized_profiles(text)'::regprocedure,
   'app_monitoring_can_read_scope(text)'::regprocedure,
   'app_monitoring_scope_context(text)'::regprocedure,
   'app_monitoring_active_device(text,text)'::regprocedure
 ] LOOP
   EXECUTE format('ALTER FUNCTION %s OWNER TO %I',helper,helper_owner);
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',helper);
   FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(p.proacl) acl JOIN pg_roles r ON r.oid=acl.grantee
     WHERE p.oid=helper AND acl.grantee<>p.proowner
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',helper,grantee_name); END LOOP;
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO predioon_app',helper);
 END LOOP;
END $$;
