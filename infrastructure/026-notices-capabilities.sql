-- Apply atomically with the controlled runner. Notice authority is independent
-- of building discovery, legacy app.role and temporary support permissions.
CREATE OR REPLACE FUNCTION app_notice_has_capability(target_building_id text, target_notice_id text, target_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT target_capability IN ('notices:read','notices:manage') AND EXISTS (
   SELECT 1 FROM notices n
   WHERE n.id=CASE WHEN target_notice_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_notice_id::uuid END
     AND n.building_id=target_building_id
     AND app_has_capability(n.building_id,target_capability,'notice',n.id::text)
 );
$$;

-- Both notices and schedules use the same real parent and statement clock.
-- Management alone never confers read access to unpublished/private content.
CREATE OR REPLACE FUNCTION app_notice_can_read(target_building_id text, target_notice_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM notices n
   WHERE n.id=CASE WHEN target_notice_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN target_notice_id::uuid END
     AND n.building_id=target_building_id
     AND app_notice_has_capability(n.building_id,n.id::text,'notices:read')
     AND ((n.published_at<=statement_timestamp() AND (n.expires_at IS NULL OR n.expires_at>statement_timestamp()))
       OR app_notice_has_capability(n.building_id,n.id::text,'notices:manage'))
 );
$$;

CREATE OR REPLACE FUNCTION app_notice_can_read_scope(target_building_id text, require_management boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT (app_has_capability(target_building_id,'notices:read')
   AND (NOT require_management OR app_has_capability(target_building_id,'notices:manage')))
 OR EXISTS (
   -- Enumerate only current subject grants, then resolve their exact primary
   -- keys. Feature state must not scan notice bodies or historical content.
   WITH candidates AS MATERIALIZED (
     SELECT rb.resource_id FROM role_bindings rb
     WHERE rb.building_id=target_building_id AND rb.resource_type='notice'
       AND (rb.user_id=app_current_user_id() OR app_rbac_team_member(rb.building_id,rb.team_id))
       AND app_rbac_window(rb.active,rb.starts_at,rb.ends_at)
   )
   SELECT 1 FROM candidates candidate
   WHERE app_notice_has_capability(target_building_id,candidate.resource_id,'notices:read')
     AND (NOT require_management OR app_notice_has_capability(target_building_id,candidate.resource_id,'notices:manage'))
 );
$$;

CREATE OR REPLACE FUNCTION app_notice_can_read_feature_state(target_building_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT app_notice_can_read_scope(target_building_id,false);
$$;

DROP POLICY IF EXISTS notices_scope_policy ON notices;
DROP POLICY IF EXISTS notices_read_policy ON notices;
DROP POLICY IF EXISTS notices_write_policy ON notices;
DROP POLICY IF EXISTS notices_insert_policy ON notices;
DROP POLICY IF EXISTS notices_update_policy ON notices;
DROP POLICY IF EXISTS notices_delete_policy ON notices;
CREATE POLICY notices_read_policy ON notices FOR SELECT TO predioon_app
 USING (app_notice_can_read(building_id,id::text));
CREATE POLICY notices_insert_policy ON notices FOR INSERT TO predioon_app
 WITH CHECK (created_by=app_current_user_id()
   AND app_has_capability(building_id,'notices:read') AND app_has_capability(building_id,'notices:manage'));
CREATE POLICY notices_update_policy ON notices FOR UPDATE TO predioon_app
 USING (app_notice_has_capability(building_id,id::text,'notices:read') AND app_notice_has_capability(building_id,id::text,'notices:manage'))
 WITH CHECK (app_notice_has_capability(building_id,id::text,'notices:read') AND app_notice_has_capability(building_id,id::text,'notices:manage'));
CREATE POLICY notices_delete_policy ON notices FOR DELETE TO predioon_app
 USING (app_notice_has_capability(building_id,id::text,'notices:read') AND app_notice_has_capability(building_id,id::text,'notices:manage'));
REVOKE UPDATE ON notices FROM predioon_app;
GRANT UPDATE(category,title,body,pinned,published_at,expires_at,updated_at) ON notices TO predioon_app;

DROP POLICY IF EXISTS notice_schedules_read_policy ON notice_schedules;
DROP POLICY IF EXISTS notice_schedules_write_policy ON notice_schedules;
DROP POLICY IF EXISTS notice_schedules_insert_policy ON notice_schedules;
DROP POLICY IF EXISTS notice_schedules_update_policy ON notice_schedules;
DROP POLICY IF EXISTS notice_schedules_delete_policy ON notice_schedules;
CREATE POLICY notice_schedules_read_policy ON notice_schedules FOR SELECT TO predioon_app
 USING (app_notice_can_read(building_id,notice_id::text));
CREATE POLICY notice_schedules_insert_policy ON notice_schedules FOR INSERT TO predioon_app
 WITH CHECK (app_notice_has_capability(building_id,notice_id::text,'notices:read') AND app_notice_has_capability(building_id,notice_id::text,'notices:manage'));
CREATE POLICY notice_schedules_update_policy ON notice_schedules FOR UPDATE TO predioon_app
 USING (app_notice_has_capability(building_id,notice_id::text,'notices:read') AND app_notice_has_capability(building_id,notice_id::text,'notices:manage'))
 WITH CHECK (app_notice_has_capability(building_id,notice_id::text,'notices:read') AND app_notice_has_capability(building_id,notice_id::text,'notices:manage'));
CREATE POLICY notice_schedules_delete_policy ON notice_schedules FOR DELETE TO predioon_app
 USING (app_notice_has_capability(building_id,notice_id::text,'notices:read') AND app_notice_has_capability(building_id,notice_id::text,'notices:manage'));
REVOKE UPDATE ON notice_schedules FROM predioon_app;
GRANT UPDATE(starts_at,recurrence,time_zone) ON notice_schedules TO predioon_app;

DROP POLICY IF EXISTS building_features_notices_read ON building_feature_settings;
CREATE POLICY building_features_notices_read ON building_feature_settings FOR SELECT TO predioon_app
 USING (app_notice_can_read_feature_state(building_id));
DROP POLICY IF EXISTS feature_runtime_notices_read ON feature_runtime;
CREATE POLICY feature_runtime_notices_read ON feature_runtime FOR SELECT TO predioon_app
 USING (app_notice_can_read_feature_state(building_id));

-- Preserve every existing domain and the global marker from migration 022.
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
     OR app_notice_can_read_feature_state(b.id)
   )
 );
$$;

-- Preserve the complete policy from 020; only these four notice actions gain
-- a new branch. Audit deletion while the current parent still exists.
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
   WHEN 'ALERT_ACKNOWLEDGED' THEN resource_type='alert' AND building_id IS NOT NULL
     AND app_alert_has_capability(building_id,resource_id,'alerts:read')
     AND app_alert_has_capability(building_id,resource_id,'alerts:acknowledge')
   WHEN 'ALERT_RESOLVED' THEN resource_type='alert' AND building_id IS NOT NULL
     AND app_alert_has_capability(building_id,resource_id,'alerts:read')
     AND app_alert_has_capability(building_id,resource_id,'alerts:resolve')
   WHEN 'DEVICE_CREATED' THEN resource_type='device' AND building_id IS NOT NULL
     AND app_has_capability(building_id,'devices:read') AND app_has_capability(building_id,'devices:configure')
     AND app_device_has_capability(building_id,resource_id,'devices:read')
   WHEN 'GATEWAY_CREATED' THEN resource_type='gateway' AND building_id IS NOT NULL
     AND app_has_capability(building_id,'devices:read') AND app_has_capability(building_id,'devices:configure')
     AND app_gateway_has_capability(building_id,resource_id,'devices:read')
   WHEN 'DEVICE_UPDATED' THEN resource_type='device' AND building_id IS NOT NULL
     AND app_device_has_capability(building_id,resource_id,'devices:read')
     AND app_device_has_capability(building_id,resource_id,'devices:configure')
   WHEN 'GATEWAY_UPDATED' THEN resource_type='gateway' AND building_id IS NOT NULL
     AND app_gateway_has_capability(building_id,resource_id,'devices:read')
     AND app_gateway_has_capability(building_id,resource_id,'devices:configure')
   WHEN 'GATEWAY_CREDENTIALS_ISSUED' THEN resource_type='gateway' AND building_id IS NOT NULL
     AND app_gateway_has_capability(building_id,resource_id,'devices:read')
     AND app_gateway_has_capability(building_id,resource_id,'devices:configure')
   WHEN 'DEVICE_METRIC_CREATED' THEN resource_type='device_metric' AND building_id IS NOT NULL
     AND app_device_metric_has_capability(building_id,resource_id,'devices:read')
     AND app_device_metric_has_capability(building_id,resource_id,'devices:configure')
   WHEN 'NOTICE_SCHEDULED' THEN resource_type='notice' AND building_id IS NOT NULL
     AND app_notice_has_capability(building_id,resource_id,'notices:read') AND app_notice_has_capability(building_id,resource_id,'notices:manage')
   WHEN 'NOTICE_PUBLISHED' THEN resource_type='notice' AND building_id IS NOT NULL
     AND app_notice_has_capability(building_id,resource_id,'notices:read') AND app_notice_has_capability(building_id,resource_id,'notices:manage')
   WHEN 'NOTICE_UPDATED' THEN resource_type='notice' AND building_id IS NOT NULL
     AND app_notice_has_capability(building_id,resource_id,'notices:read') AND app_notice_has_capability(building_id,resource_id,'notices:manage')
   WHEN 'NOTICE_DELETED' THEN resource_type='notice' AND building_id IS NOT NULL
     AND app_notice_has_capability(building_id,resource_id,'notices:read') AND app_notice_has_capability(building_id,resource_id,'notices:manage')
   ELSE app_is_platform_admin() OR (building_id IS NOT NULL AND (
     app_can_access_building(building_id) OR app_has_capability(building_id,'units:manage')
     OR app_has_capability(building_id,'teams:manage') OR app_has_capability(building_id,'memberships:manage')
   )) END
);

DO $$ DECLARE helper_owner text; helper regprocedure; grantee_name text; BEGIN
 SELECT pg_get_userbyid(proowner) INTO STRICT helper_owner
 FROM pg_proc WHERE oid='app_has_capability(text,text,text,text)'::regprocedure;
 FOREACH helper IN ARRAY ARRAY[
   'app_notice_has_capability(text,text,text)'::regprocedure,
   'app_notice_can_read(text,text)'::regprocedure,
   'app_notice_can_read_scope(text,boolean)'::regprocedure,
   'app_notice_can_read_feature_state(text)'::regprocedure,
   'app_can_read_feature_event(text)'::regprocedure
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
